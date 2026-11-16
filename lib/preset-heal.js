/**
 * 预设自愈：清理 agent preset YAML 里引用了「宿主已删除的包」的行。
 *
 * 背景：DSH 每个版本都可能删掉一些 @deepseek-ai/* 包（0.2.2-rc.3 就删了
 * dsh-tool-skill）。第三方插件的预设文件如果还声明着这些包，agent-preset
 * 注册表校验会失败，整个预设进不了注册表 —— 表现为「会话不可用」、
 * 「agent-preset/not-found」，但磁盘上会话数据完好。
 *
 * 这类失效不是我们能改上游源码解决的（包是别人的，升级会覆盖），所以做成
 * 每次 apply 前的自愈步骤：扫预设、找不存在的包、把那一条 row 整块删掉。
 *
 * 只删「宿主里确实不存在」的 @deepseek-ai/* 引用，不碰其他作者生态的包
 * （那些包由 profile 的 node_modules 提供，宿主目录里本来就没有）。
 */
import fs from "node:fs";
import path from "node:path";

/** 只处理官方包的引用：第三方包不在宿主安装目录里是正常的。 */
const OFFICIAL_SCOPE = "@deepseek-ai/";

/**
 * 判断一个官方包在当前 DSH 安装里是否存在。
 * @param packageName - 形如 '@deepseek-ai/dsh-tool-skill'。
 * @param aiBase - 宿主 @deepseek-ai 目录（.../dsh/node_modules/@deepseek-ai）。
 * @returns 存在为 true；无法判定（aiBase 为空）也返回 true，避免误删。
 */
export function officialPackageExists(packageName, aiBase) {
  if (!aiBase) return true;
  if (!packageName.startsWith(OFFICIAL_SCOPE)) return true;
  const short = packageName.slice(OFFICIAL_SCOPE.length);
  if (!short) return true;
  try {
    return fs.existsSync(path.join(aiBase, short));
  } catch {
    return true;
  }
}

/**
 * 从一份 preset YAML 文本里删掉引用了「已不存在官方包」的 row 块。
 *
 * row 块 = 从 `- id: xxx`（或 `- name:`）那一行开始，到下一个同级或更浅缩进
 * 的 `-` 行之前。会顺带删掉块内所有缩进更深的行，以及块后紧跟的空行。
 *
 * @param text - YAML 原文。
 * @param aiBase - 宿主 @deepseek-ai 目录。
 * @returns { text, removed } —— 清理后的文本，以及被删掉的包名列表。
 */
export function stripMissingOfficialPlugins(text, aiBase) {
  if (!text || !aiBase) return { text, removed: [] };

  const lines = text.split("\n");
  const out = [];
  const removed = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 只把「条目起始行」当作候选：`- id:` / `- name:` / `-` 后接映射
    const startMatch = /^(\s*)-\s*(?:id|name)\s*:\s*(.*)$/.exec(line);
    if (!startMatch) {
      out.push(line);
      i += 1;
      continue;
    }

    const indent = startMatch[1].length;

    // 收集这个块：从当前行到下一个「同级或更浅缩进的 `- ` 行」为止。
    // 判定只看两种行：
    //   - 以 `- ` 开头且缩进 <= 当前 → 下一个条目，块到此结束
    //   - 缩进 <= 当前且不是空行/注释 → 同级或上层的其他键，块也结束
    // 缩进更深的行（含空行）都属于这个块。
    let end = i + 1;
    while (end < lines.length) {
      const next = lines[end];

      // 空行：先算进块里，稍后统一裁掉尾部的空行
      if (next.trim() === "") {
        end += 1;
        continue;
      }

      const nextIndent = next.length - next.trimStart().length;
      const isDash = /^\s*-\s/.test(next);

      if (nextIndent <= indent) {
        // 同级或更浅的任何内容（含下一个 `- ` 条目）都结束本块
        break;
      }
      end += 1;
    }

    // 块尾的空行不算块内容（留给下面的分隔处理）
    let blockEnd = end;
    while (blockEnd > i + 1 && lines[blockEnd - 1].trim() === "") blockEnd -= 1;

    const block = lines.slice(i, blockEnd);

    // disabled: true 的 row 不参与加载，引用不存在的包是无害的，
    // 而且作者常把它留着当「这个版本没装就禁用」的开关。绝不能删。
    const isDisabled = block.some((row) => /^\s*disabled\s*:\s*true\s*$/i.test(row));
    if (isDisabled) {
      for (const row of block) out.push(row);
      i = end;
      continue;
    }

    // 在块里找 @deepseek-ai/ 包名引用
    const pkgRe = /@deepseek-ai\/[A-Za-z0-9._-]+/g;
    const missing = new Set();
    for (const row of block) {
      for (const m of row.matchAll(pkgRe)) {
        const pkg = m[0];
        if (!officialPackageExists(pkg, aiBase)) missing.add(pkg);
      }
    }

    if (missing.size === 0) {
      for (const row of block) out.push(row);
      // 保留块后原有的空行分隔
      for (let k = blockEnd; k < end; k += 1) out.push(lines[k]);
      i = end;
      continue;
    }

    // 删这个块。块前后的空行保持原样：被删块自己若跟在空行之后、
    // 后面又跟着空行，就只留一个，避免出现连续空行。
    for (const pkg of missing) removed.push(pkg);
    const prevBlank = out.length === 0 || out[out.length - 1].trim() === "";
    const nextBlank = end < lines.length && lines[end].trim() === "";
    if (!prevBlank && lines.slice(i, end).some((l) => l.trim() === "")) {
      // 被删的块内部本来带空行：补一个，维持段落分隔
      out.push("");
    } else if (!prevBlank && !nextBlank) {
      // 前后都没有空行：不补，紧跟下一条目
    }
    i = end;
  }

  return { text: out.join("\n"), removed: [...new Set(removed)] };
}

/**
 * 列出需要自愈的 preset 文件。
 *
 * 覆盖两类：
 *   1. $DSH_HOME/.agent-presets/<name>/agent.cordis.yml（用户层，写入会持久）
 *   2. 各 profile 的 node_modules 里第三方插件自带的 presets/<name>/agent.cordis.yml
 *
 * @param dshHome - $DSH_HOME（如 C:\Users\x\.dsh）。
 * @returns 绝对路径数组。
 */
export function listPresetYmlFiles(dshHome) {
  const found = new Set();

  const addIfFile = (fp) => {
    try {
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) found.add(path.normalize(fp));
    } catch {
      /* ignore */
    }
  };

  // 1) 用户层预设
  const userRoot = path.join(dshHome, ".agent-presets");
  try {
    if (fs.existsSync(userRoot)) {
      for (const name of fs.readdirSync(userRoot)) {
        addIfFile(path.join(userRoot, name, "agent.cordis.yml"));
      }
    }
  } catch {
    /* ignore */
  }

  // 2) 各 profile 的 node_modules 里第三方插件的 presets/
  const profilesRoot = path.join(dshHome, "profiles");
  try {
    if (fs.existsSync(profilesRoot)) {
      for (const profile of fs.readdirSync(profilesRoot)) {
        const nm = path.join(profilesRoot, profile, "node_modules");
        if (!fs.existsSync(nm)) continue;
        // 扫 @scope/pkg 与 pkg 两种形态
        for (const entry of fs.readdirSync(nm)) {
          const dirs = [];
          if (entry.startsWith("@")) {
            const scopeDir = path.join(nm, entry);
            try {
              for (const sub of fs.readdirSync(scopeDir)) dirs.push(path.join(scopeDir, sub));
            } catch {
              /* ignore */
            }
          } else {
            dirs.push(path.join(nm, entry));
          }
          for (const pkgDir of dirs) {
            const presetsDir = path.join(pkgDir, "presets");
            try {
              if (!fs.existsSync(presetsDir)) continue;
              for (const presetName of fs.readdirSync(presetsDir)) {
                addIfFile(path.join(presetsDir, presetName, "agent.cordis.yml"));
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  return [...found];
}

/**
 * 对全部预设执行一次自愈。
 *
 * @param dshHome - $DSH_HOME。
 * @param aiBase - 宿主 @deepseek-ai 目录。
 * @param io - { readFileSync, writeFileSync } 注入，便于测试。
 * @returns { changed, removed, files } —— 改动文件数、被删包名、逐文件明细。
 */
export function healPresets(dshHome, aiBase, io = {}) {
  const readFile = io.readFileSync || ((fp) => fs.readFileSync(fp, "utf8"));
  const writeFile = io.writeFileSync || ((fp, t) => fs.writeFileSync(fp, t, "utf8"));

  const result = { changed: 0, removed: [], files: [] };

  for (const fp of listPresetYmlFiles(dshHome)) {
    let text;
    try {
      text = readFile(fp);
    } catch {
      continue;
    }
    const { text: cleaned, removed } = stripMissingOfficialPlugins(text, aiBase);
    if (cleaned === text || removed.length === 0) continue;

    // 写回前留一份备份，便于人工核对/回滚
    try {
      const bak = `${fp}.bak-before-preset-heal`;
      if (!fs.existsSync(bak)) writeFile(bak, text);
    } catch {
      /* 备份失败不阻断修复 */
    }

    try {
      writeFile(fp, cleaned);
      result.changed += 1;
      result.removed.push(...removed);
      result.files.push({ path: fp, removed });
    } catch {
      /* ignore */
    }
  }

  result.removed = [...new Set(result.removed)];
  return result;
}
