# 0.2.2-rc.1 适配报告 / Compatibility note for DSH 0.2.2-rc.1

适用版本：dsh-purge **2.0.1**（`dshTarget: 0.2.2-rc.1`，向下兼容 0.2.1-rc.2 / 0.2.0-rc.2 的旧锚点）。

## 结论 / Summary

**80 条补丁在 0.2.2-rc.1 上全部结算，`pending` 为 0，没有一条因锚点失配卡住。**

| 目标树 | applied | already | missing_file | skipped | pending |
| --- | --- | --- | --- | --- | --- |
| 原始 0.2.2-rc.1（`app.asar.bak`，未打补丁） | **54** | 8 | 12 | 6 | **0** |
| 已打补丁（`resources/app`，当前实装） | 0 | 61 | 12 | 7 | **0** |

两张表口径不同但结论一致：干净树上 54 条能直接打进去、8 条本来就是目标态；打过的树上 61 条已是完成态。

> 注意：`--app` 跑的是**已经打过补丁**的树，只能证明补丁在位；要验证「能不能打进 0.2.2」，必须用原始包跑 `--asar`。两者都跑过才算数。

## 0.2.2 的漂移 / What changed in 0.2.2

0.2.2 动了三处，旧锚点全部失效。1.4.4 为它们各补了一条新 pattern，旧 0.2.1 pattern 保留做向下兼容：

| 补丁 | 0.2.2 的改动 | 处理 |
| --- | --- | --- |
| `#74 ASSEMBLE_BEFORE_PRESTEP` | `claim()` 与 `assemble()` 之间插入了 `selection` / `toolSet` 解析，原两行相邻锚点不再匹配，补丁被静默 `skipped` | 新增只锚 `const claimed` 单行的模式，注入点前移到 pre-step 入口 |
| `#67 AGENT_LOOP_MESSAGES_GUARD` | 同一段代码被 `try { }` 再包一层，缩进从 4 tabs 变 5 tabs | 新增 5-tab 模式，旧 4-tab 模式保留以兼容 0.2.1 |
| `#82 DESKTOP_SHELL_PROFILE_FALLBACK` | `lib/main.js` 里紧跟 import 的 region 头从 `packages/util/home-paths` 换成 `node_modules/.pnpm/mime@4.1.1` | 新增只锚 import 单行的模式 |

此外官方 `@deepseek-ai/dsh-tool-subagent` 的 `apply()` 首行改成了硬拦截：

```js
for (const field of ["persona","toolFilter"]) if (Object.hasOwn(config, field)) throw ...
```

红队预设里残留的 `toolFilter` / `backgroundMode` 会让整个预设 `registered-broken`、面板显示「加载失败」。1.4.4 的 `#91` / `#92` 负责清除，`installPreset()` 对已存在的用户预设做就地清理。

## 8 条 already 为什么不是异常

`#2` `#3` `#12` `#21` `#24` `#50` `#73` `#85` 都是**回滚型补丁**：它们的目标态就是上游原文。干净树本来就是原文，所以判 `already` 是正确行为，不是「补丁早就存在」。

以 `#85 STEER_RESTORE_PROMPT` 为例，它把 1.4.2 写进去的

```
agent.followup(message); // [dsh-purge-85] user prompt always next-turn (kill steer→next-step race)
```

还原成上游的

```js
if (request.mode === "steer") agent.steer(message);
else agent.followup(message);
```

干净树上没有那行注释，自然直接判 already。

## 12 条 missing_file 全是可选补丁

都是「目标插件或预设未安装」，不影响应用完成：

| 补丁 | 缺什么 |
| --- | --- |
| `#71` `#28` | 梁神预设 `dsh-liangshen` 未安装 |
| `#30` `#31` `#64` `#65` | hooks 插件（`dsh-hooks-claude-code` / `dsh-hooks-codex`）未安装 |
| `#45` `#46` `#82` `#83` `#84` | 桌面壳入口不在解开的 `resources/app` 里（密封包状态下的已知误报） |
| `#76` | 自造 unrestricted 预设未安装 |

## 6 条 skipped 是条件不满足

`#14`（已有更高优先级的授权路径）、`#80`（极简预设未启用）、`#54`（交付语已被手动改过）、`#60` / `#62`（官方审批链版本差异）、`#86`（队列 steer 的 1.4.2 改动本就不存在）。

## 复现 / Reproduce

```sh
# 干净树：验证锚点能不能匹配
node scripts/compat-check.mjs --asar "<install>/resources/app.asar.bak" --surface desktop --json out.json

# 实装树：验证补丁是否已在位
node scripts/compat-check.mjs --app "<install>/resources/app" --surface desktop --json out2.json
```

退出码 0 = 没有待打补丁，1 = 仍有 pending。

> `desktop-shell` 一族（`#45` `#46` `#82` `#83` `#84`）在 `--asar` / `--app` 下可能误报 `missing_file`：自检把 `DSH_HOME` 指向临时目录，`findDesktopAppExecutable()` 因此定位不到安装目录。这一族以宿主内 `patchStatus` 的结果为准。

## 相关文档

- 上一代适配细节（0.2.1 的提示词迁移）：[compat-0.2.1.md](compat-0.2.1.md)
