#!/usr/bin/env node
/**
 * README 资源链接检查 / README asset link check.
 *
 * 只查仓库内的相对路径（docs/... 、LICENSE 之类），不查外链
 * —— 外链在 CI 里查会因网络抖动误报。
 *
 * 用法 / Usage:
 *   node scripts/check-links.mjs
 *
 * 退出码 / Exit code: 0 = 全部存在，1 = 有死链。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const TARGETS = [
  "README.md",
  "README.zh-CN.md",
  "NOTICE.md",
  "DISCLAIMER.md",
  "CHANGELOG.md",
];

// 匹配 markdown 链接目标与 HTML src/href 里的相对路径
const RE_MD = /\]\(([^)\s]+)\)/g;
const RE_HTML = /(?:src|href)="([^"]+)"/g;

let missing = 0;
let checked = 0;

for (const rel of TARGETS) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.log(`skip ${rel} (not present)`);
    continue;
  }
  const text = fs.readFileSync(abs, "utf8");
  const seen = new Set();

  for (const re of [RE_MD, RE_HTML]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      let target = m[1].trim();
      if (!target) continue;
      // 跳过外链、锚点、协议
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) continue;
      // 去掉锚点与查询串
      target = target.split("#")[0].split("?")[0];
      if (!target) continue;
      if (seen.has(target)) continue;
      seen.add(target);

      const resolved = path.resolve(root, target);
      checked += 1;
      if (!fs.existsSync(resolved)) {
        console.log(`MISSING  ${rel} -> ${target}`);
        missing += 1;
      }
    }
  }
}

console.log();
console.log(`checked ${checked} local link(s), ${missing} missing.`);
if (missing > 0) process.exit(1);
console.log("OK: no dead local links.");
process.exit(0);
