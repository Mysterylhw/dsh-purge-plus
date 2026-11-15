#!/usr/bin/env node
/**
 * 上游漂移检测 / Upstream drift check.
 *
 * 解决的问题：DSH 每次发版改一行代码，补丁的 pattern 就会静默失效，
 * 而 patchStatus 只会在「真机上跑过」之后才告诉你。这个脚本不需要
 * 启动宿主，直接拿补丁的 pattern 首行去官方包里数命中率，命中率掉了
 * 就说明上游动了。
 *
 * 判据：每条 pattern 取「首行去首尾空白」作为探针，在目标文件里查子串。
 *   - 命中  → 锚点大概率还在
 *   - 未命中 → 要么补丁已应用（replace 的结果在文件里），要么上游改了
 * 所以判定顺序是：先看 replace 首行在不在（已应用），再看 pattern 首行
 * （待应用），两者都不在才计入 drift。
 *
 * 用法 / Usage:
 *   node scripts/drift-check.mjs --app "<install>/resources/app"
 *   node scripts/drift-check.mjs --app "<install>/resources/app" --json out.json
 *   node scripts/drift-check.mjs --app ... --verbose      # 列出每条判定依据
 *
 * 退出码 / Exit code: 0 = 无漂移，1 = 有漂移，2 = 参数错误。
 */
import fs from "node:fs";
import path from "node:path";
import * as core from "../lib/core.js";

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: node scripts/drift-check.mjs --app <appDir> [--json out.json] [--verbose]');
  process.exit(2);
}

const argv = process.argv.slice(2);
let appDir = "";
let jsonOut = "";
let verbose = false;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--app") appDir = argv[++i] || "";
  else if (a === "--json") jsonOut = argv[++i] || "";
  else if (a === "--verbose" || a === "-v") verbose = true;
  else usage(`unknown argument: ${a}`);
}

if (!appDir) usage("missing --app");
if (!fs.existsSync(appDir)) usage(`not found: ${appDir}`);

// aiBase 就是 app 下的 dsh/node_modules/@deepseek-ai；解开的包结构可能是
// app/dsh/node_modules/... 或 app/node_modules/...，两种都试。
const candidates = [
  path.join(appDir, "dsh", "node_modules", "@deepseek-ai"),
  path.join(appDir, "node_modules", "@deepseek-ai"),
].filter((p) => fs.existsSync(p));

if (candidates.length === 0) {
  usage(`cannot locate @deepseek-ai under ${appDir}`);
}
const aiBase = candidates[0];

const files = core.targetFiles(aiBase);

// 与 core.js isLayoutSoftPatch 保持一致：#5 #11 #12 是审批句补丁。
// 这类补丁的原文会随官方 layout 变化整段消失，没有残留 pattern 就是完成，
// 不能用「pattern 找不到 = 漂移」来判。
const LAYOUT_SOFT_IDS = new Set([5, 11, 12]);
const dshHome = core.findDshHome();

/**
 * 从 pattern/replace 里挑一段最有辨识度的文本当探针。
 *
 * 只取首行太脆弱：首行可能很长（在文件里被换行折断）、可能是正则源码
 * （取出来的是 /.../ 本身），也可能整行都是缩进。这里改为：
 *   1. 正则不取探针（无法做子串比较），返回空串跳过
 *   2. 按行拆，去掉纯空白/纯括号的噪声行
 *   3. 取最长的一行，且截到 60 字符（够辨识、又不易被折行打断）
 */
function probeOf(text) {
  if (text instanceof RegExp) return "";
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 8 && !/^[\s{}()\[\];,]+$/.test(l));
  if (lines.length === 0) return "";
  lines.sort((a, b) => b.length - a.length);
  return lines[0].slice(0, 60);
}

/** 正则 pattern 的探针：取正则里最长的一段字面量（去掉转义符）。 */
function regexProbeOf(pattern) {
  if (!(pattern instanceof RegExp)) return "";
  const src = pattern.source
    .replace(/\\[sSdDwWbB]/g, " ")
    .replace(/\[^sSdDwWbB]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()|?*+^$]/g, " ");
  const parts = src.split(/\s+/).filter((p) => p.length >= 6);
  if (parts.length === 0) return "";
  parts.sort((a, b) => b.length - a.length);
  return parts[0].slice(0, 60);
}

const rows = [];
let drift = 0;
let applied = 0;
let pending = 0;
let noTarget = 0;
let undecided = 0;
let obsolete = 0;
let noop = 0;
let mixed = 0;

for (const p of core.ALL_PATCHES) {
  const keys = Array.isArray(p.file) ? p.file : [p.file];
  const fields = Array.isArray(p.markers) ? p.markers : [];

  // 汇总这条补丁所有目标文件的文本
  const texts = [];
  let missingKeys = 0;
  for (const key of keys) {
    const v = files[key];
    if (v == null || v === "") {
      missingKeys += 1;
      continue;
    }
    for (const fp of Array.isArray(v) ? v : [v]) {
      try {
        texts.push({ fp, text: fs.readFileSync(fp, "utf8") });
      } catch {
        missingKeys += 1;
      }
    }
  }

  if (texts.length === 0) {
    noTarget += 1;
    rows.push({
      id: p.id,
      name: p.name,
      verdict: "no_target",
      detail: missingKeys ? `目标文件不存在 (${keys.join(", ")})` : "无目标文件",
    });
    continue;
  }

  const reps = Array.isArray(p.replacements)
    ? p.replacements
    : (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace }));

  let patternHits = 0;
  let replaceHits = 0;
  let probes = 0;
  const misses = [];

  for (const r of reps) {
    if (!r || typeof r.replace !== "string") continue;
    // 自匹配锚点跳过（pattern === replace，看不出状态）
    if (typeof r.pattern === "string" && r.pattern === r.replace) continue;
    probes += 1;

    const patternProbe = r.pattern instanceof RegExp
      ? regexProbeOf(r.pattern)
      : probeOf(r.pattern);
    const replaceProbe = probeOf(r.replace);

    let pHit = false;
    let rHit = false;
    for (const t of texts) {
      if (patternProbe && t.text.includes(patternProbe)) pHit = true;
      if (replaceProbe && t.text.includes(replaceProbe)) rHit = true;
    }
    if (pHit) patternHits += 1;
    if (rHit) replaceHits += 1;
    if (!pHit && !rHit && patternProbe) misses.push(patternProbe.slice(0, 70));
  }

  // markers 也能证明已应用
  let markerHit = false;
  if (fields.length > 0) {
    markerHit = fields.some((mk) => {
      const probe = typeof mk === "string" ? mk : "";
      return probe && texts.some((t) => t.text.includes(probe));
    });
  }

  // obsoleteWhen 命中 = 上游已删掉目标，这条补丁本就无事可做，不算漂移。
  let obsoleteHit = false;
  if (Array.isArray(p.obsoleteWhen) && p.obsoleteWhen.length > 0) {
    obsoleteHit = p.obsoleteWhen.some((rule) => {
      try {
        const re = rule instanceof RegExp ? new RegExp(rule.source, rule.flags) : new RegExp(rule);
        return texts.some((t) => re.test(t.text));
      } catch {
        return false;
      }
    });
  }

  let verdict;
  let detail = "";
  if (probes === 0) {
    verdict = "undecided";
    detail = "全是自匹配锚点，无法判定";
    undecided += 1;
  } else if (obsoleteHit) {
    verdict = "obsolete";
    detail = "obsoleteWhen 命中：上游已删目标，判 na";
    obsolete += 1;
  } else if (markerHit) {
    verdict = "applied";
    detail = "marker 命中";
    applied += 1;
  } else if (replaceHits >= probes && probes > 0) {
    // 全部 replace 结果都在文件里 → 已应用。这条要排在 pattern 之前：
    // 有些补丁的 replace 保留了 pattern 的前缀（只改后半句），
    // 只看 pattern 命中会误判成 pending，而真机上其实是 applied。
    verdict = "applied";
    detail = `${replaceHits}/${probes} 条 replace 结果已在文件里`;
    applied += 1;
  } else if (patternHits > 0 && replaceHits === 0) {
    verdict = "pending";
    detail = `${patternHits}/${probes} 条 pattern 仍命中且无 replace 结果，等待 apply`;
    pending += 1;
  } else if (patternHits > 0 && replaceHits > 0) {
    // 部分 pattern 命中、部分 replace 命中：混合状态，交给 patchStatus 定夺。
    verdict = "mixed";
    detail = `pattern ${patternHits}/${probes} 命中, replace ${replaceHits}/${probes} 命中`;
    mixed += 1;
  } else if (LAYOUT_SOFT_IDS.has(p.id) && patternHits === 0) {
    // 与 core 的 isLayoutSoftPatch 对齐：审批句补丁在「原文已不在」时
    // 就算完成（官方副本布局不同、或句子已被别的版本改写）。
    verdict = "applied";
    detail = "layout-soft 补丁：无残留 pattern 即视为完成";
    applied += 1;
  } else if (p.softSettle) {
    // 迁移专用补丁（softSettle）：只负责把旧版留下的值改回去。
    // 目标值不在 = 这台机器没有需要迁移的历史，不是漂移。
    verdict = "noop";
    detail = "softSettle 迁移补丁，目标值不存在（无需处理）";
    noop += 1;
  } else {
    verdict = "drift";
    detail = `${probes} 条探针全部落空：${misses.slice(0, 2).join(" | ")}`;
    drift += 1;
  }

  rows.push({ id: p.id, name: p.name, verdict, detail, probes, patternHits, replaceHits, markerHit });
}

// ── 输出 ──
const tally = {
  total: rows.length,
  applied,
  pending,
  drift,
  no_target: noTarget,
  undecided,
  obsolete,
  noop,
  mixed,
};

console.log(`aiBase : ${aiBase}`);
console.log(`dshHome: ${dshHome}`);
console.log(`patches: ${rows.length}`);
console.log(JSON.stringify(tally));
console.log();

const ORDER = ["drift", "pending", "undecided", "no_target", "applied"];
for (const v of ORDER) {
  const list = rows.filter((r) => r.verdict === v);
  if (list.length === 0) continue;
  if (v === "applied" && !verbose) {
    console.log(`applied (${list.length}) — 明细见 --verbose`);
    continue;
  }
  console.log(`${v} (${list.length}):`);
  for (const r of list) {
    console.log(`  #${String(r.id).padEnd(3)} ${r.name.padEnd(40)} ${r.detail}`);
  }
  console.log();
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ aiBase, dshHome, tally, rows }, null, 2), "utf8");
  console.log(`json -> ${jsonOut}`);
}

if (drift > 0) {
  console.log();
  console.log(`DRIFT: ${drift} 条补丁的 pattern 在这个 DSH 版本上一条都没命中，需要补锚点。`);
  process.exit(1);
}

console.log("OK: no drift detected.");
process.exit(0);
