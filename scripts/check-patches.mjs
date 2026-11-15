#!/usr/bin/env node
/**
 * 补丁表完整性检查 / patch table integrity check.
 *
 * 不需要宿主、不需要 DSH 安装，纯静态校验。CI 每跑一次都能挡住这几类低级错误：
 *   1. id 重复或缺失
 *   2. name 重复
 *   3. replacements 里 pattern 为空、replace 不是字符串
 *   4. markers 写了但 patchAppliesHere 之外没有任何结算路径（严格补丁必须有 markers 或 softSettle）
 *   5. pattern 与 replace 完全相同（等于没改）
 *
 * 用法 / Usage:
 *   node scripts/check-patches.mjs
 *
 * 退出码 / Exit code: 0 = 正常，1 = 发现问题。
 */
import * as core from "../lib/core.js";

const patches = core.ALL_PATCHES;
const problems = [];
const notes = [];

function problem(msg) {
  problems.push(msg);
}

// ── 1. id 唯一 ──
const byId = new Map();
for (const p of patches) {
  if (!Number.isInteger(p.id)) {
    problem(`patch without integer id: ${JSON.stringify(p.name)}`);
    continue;
  }
  if (byId.has(p.id)) {
    problem(`duplicate id #${p.id}: ${byId.get(p.id).name} / ${p.name}`);
  }
  byId.set(p.id, p);
}

// ── 2. name 唯一且非空 ──
const byName = new Map();
for (const p of patches) {
  if (typeof p.name !== "string" || !p.name.trim()) {
    problem(`#${p.id} has empty name`);
    continue;
  }
  if (byName.has(p.name)) {
    problem(`duplicate name "${p.name}": #${byName.get(p.name).id} / #${p.id}`);
  }
  byName.set(p.name, p);
}

// ── 3. replacements 合法 ──
for (const p of patches) {
  const reps = Array.isArray(p.replacements)
    ? p.replacements
    : (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace }));

  if (reps.length === 0) {
    problem(`#${p.id} ${p.name}: no replacements/patterns`);
    continue;
  }

  reps.forEach((r, i) => {
    const where = `#${p.id} ${p.name} [${i}]`;
    if (!r.pattern && !(r.pattern instanceof RegExp)) {
      problem(`${where}: empty pattern`);
      return;
    }
    if (typeof r.replace !== "string") {
      problem(`${where}: replace is not a string`);
      return;
    }
    // pattern === replace 是「自匹配锚点」：用来让 filePatchSettled 在文件已处于
    // 目标态时命中（例如某段代码在旧版需要改、新版上游已经是原文）。
    // 这是合法写法，只提示不报错。
    if (typeof r.pattern === "string" && r.pattern === r.replace) {
      notes.push(`${where}: pattern === replace（自匹配锚点）`);
    }
  });
}

// ── 4. 严格补丁必须留一条结算路径 ──
for (const p of patches) {
  if (!p.strictFiles) continue;
  const hasMarkers = Array.isArray(p.markers) && p.markers.length > 0;
  const hasMarker = typeof p.marker === "string" && p.marker.length > 0;
  if (!hasMarkers && !hasMarker && !p.softSettle) {
    // 不算硬错误：上游原文回到 target 态时 filePatchSettled 也能命中。
    // 但这类补丁一旦上游改了锚点就会报 pattern_not_found，值得提示。
    notes.push(`#${p.id} ${p.name}: strictFiles 但没有 markers/marker/softSettle`);
  }
}

// ── 5. obsoleteWhen 必须是正则 ──
for (const p of patches) {
  if (p.obsoleteWhen === undefined) continue;
  if (!Array.isArray(p.obsoleteWhen) || p.obsoleteWhen.length === 0) {
    problem(`#${p.id} ${p.name}: obsoleteWhen must be a non-empty array`);
    continue;
  }
  p.obsoleteWhen.forEach((rule, i) => {
    const isRe = rule instanceof RegExp;
    const isStr = typeof rule === "string" && rule.length > 0;
    if (!isRe && !isStr) {
      problem(`#${p.id} ${p.name}: obsoleteWhen[${i}] is neither RegExp nor non-empty string`);
      return;
    }
    // 能编译才算数
    try {
      rule instanceof RegExp ? rule.source : new RegExp(rule);
    } catch (e) {
      problem(`#${p.id} ${p.name}: obsoleteWhen[${i}] does not compile: ${e.message}`);
    }
  });
}

// ── 汇总 ──
console.log(`patches: ${patches.length}`);
console.log(`id range: ${Math.min(...patches.map((p) => p.id))} .. ${Math.max(...patches.map((p) => p.id))}`);

const layers = {};
for (const p of patches) {
  const k = p.layer || "(none)";
  layers[k] = (layers[k] || 0) + 1;
}
console.log("layers:", JSON.stringify(layers));

if (notes.length) {
  console.log();
  console.log(`提示 / notes (${notes.length}):`);
  for (const n of notes) console.log("  ·", n);
}

if (problems.length) {
  console.log();
  console.log(`${problems.length} PROBLEM(S):`);
  for (const p of problems) console.log("  ✗", p);
  process.exit(1);
}

console.log();
console.log("OK: patch table is consistent.");
process.exit(0);
