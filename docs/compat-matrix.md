# DSH 版本适配矩阵 / Compatibility matrix

每一行是一次真实测量。**新增 DSH 版本时必须跑一遍并补一行**，否则下一个人（可能是三个月后的你）不知道哪版能用、哪版要补锚点。

## 怎么测

```sh
# 1. 干净树：验证锚点能不能匹配（用未打补丁的官方包）
node scripts/compat-check.mjs --asar "<install>/resources/app.asar.bak" --surface desktop

# 2. 实装树：验证补丁是否已在位
node scripts/compat-check.mjs --app "<install>/resources/app" --surface desktop

# 3. 漂移检测：不需要启动宿主，直接看锚点还在不在
node scripts/drift-check.mjs --app "<install>/resources/app"
```

`drift-check.mjs` 的退出码：`0` = 无漂移，`1` = 有补丁的 pattern 一条都不命中，需要补锚点。

## 矩阵

| dsh-purge | DSH | 干净树 applied / already / missing_file / na | 实装树 applied / na | 漂移 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **2.0.2** | **0.2.2-rc.3** |
| 2.0.1 | **0.2.2-rc.3** | 55 / 9 / 12 / 4 | 62 / 18 | 0 | 补 #13/#18/#35 的 rc.3 锚点（见下）；解封 asar 后全量重打，`dshTarget` 已提到 rc.3 |
| 2.0.1 | 0.2.2-rc.1 | 55 / 9 / 12 / 4 | 61 / 18 | 0 | 补 #14/#17 的 0.2.2 锚点；#54/#60/#62/#80 标 obsoleteWhen（历史记录，dshTarget 已提到 rc.3） |
| 1.4.5 | 0.2.2-rc.1 | 54 / 8 / 12 / 6 | — | — | 首次测 0.2.2；7 条 skipped 未归位 |
| 1.4.4 | 0.2.2-rc.1 | — | — | — | 加 #91/#92（subagent 字段清理）与 #93~#97（远端 Kali） |
| 1.4.3 | 0.2.1-rc.2 | — | 63 / 66 中 63 applied | — | 上游最后一代 |
| 1.3.0 | 0.2.1-rc.2 | 62 / 6 / 12 / 2 | — | — | 提示词迁到 `dsh-harness-dev-context` |

> 「干净树」= 未打补丁的原始包（`app.asar.bak`）。只有这一列能证明「锚点能不能匹配」，实装树只能证明「补丁在不在位」。
>
> 「漂移」= `drift-check.mjs` 报出的 drift 条数。`0` 表示所有补丁的 pattern 要么命中、要么 replace 已在位、要么已声明 obsolete / softSettle。

## 各版本要补的锚点

### 0.2.2-rc.1

上游动了三处，旧锚点全部失效：

| 补丁 | 上游改了什么 | 处理 |
| --- | --- | --- |
| `#74 ASSEMBLE_BEFORE_PRESTEP` | `claim()` 与 `assemble()` 之间插入了 `selection` / `toolSet` 解析 | 新增只锚 `const claimed` 单行的模式 |
| `#67 AGENT_LOOP_MESSAGES_GUARD` | 同一段代码被 `try { }` 再包一层，缩进 4 tabs → 5 tabs | 新增 5-tab 模式，旧 4-tab 保留 |
| `#82 DESKTOP_SHELL_PROFILE_FALLBACK` | `lib/main.js` 的 region 头从 `packages/util/home-paths` 换成 `node_modules/.pnpm/mime@4.1.1` | 新增只锚 import 单行的模式 |
| `#14 ESCALATION_GRANT_UNCONDITIONAL` | `displayReason` 从对象字面量变成 `escalationDisplayReason(mode, justification)` 函数调用 | 2.0.1 补了新 pattern |
| `#17 FS_OBSERVATION_INTENT_FREE` | `editIntent` 收敛成 `requirePresent(target, actor, "edit")` 一行代理 | 2.0.1 补了新 pattern；markers 改 markersAny |

上游删掉目标的（判 `na`，不再需要补）：

| 补丁 | 上游删了什么 |
| --- | --- |
| `#54 DELIVERABLE_DO_NOT` | 两句交付物提示词（`Static Web guidance` / `Do not call present`）|
| `#60 OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL` | 四句 run_code 审批提示词 |
| `#62 OFFICIAL_TOOL_ASK_FAILOPEN` | `approval === undefined` 与 `case "unavailable"` 两个分支 |
| `#80 MINIMAL_OFFICIAL_TOOLSET` | `minimal.patch.yml` 里的 `tool-web` / `tool-fs-search`（本来就没有了）|

### 0.2.2-rc.3

上游把 `throw new Error(...)` 全换成了 `throw new SandboxEscalationError(msg, "SANDBOX_ESCALATION_*")`，
并且删了几段 handler 分支。三条补丁因此失配：

| 补丁 | rc.3 改了什么 | 处理 |
| --- | --- | --- |
| `#13 ESCALATION_WIDENING_EXEMPT` | 三条守卫（`WIDER_MODES` 校验、`approval.approver`、`approval.agent`）从 `throw new Error` 换成 `throw new SandboxEscalationError(msg, CODE)` | 补一整段 rc.3 pattern，replace 与原版同语义（整段注释掉） |
| `#35 ESCALATION_NEVER_REJECT` | 同上；`cancelled` 分支还多了 `approval.signal?.throwIfAborted();` | 补 rc.3 pattern（含新增那行），replace 改成 `case "allowed-once": default: return mode;` |
| `#18 REPEAT_TOOL_REMINDER_DISABLED` | 删掉了 `if (downstream.kind === "block") return {...}` 分支，handler 体只剩「有 reminder 就 prepend」 | 补 rc.3 pattern，replace 不变（整个 handler 换成注释） |

**rc.3 升级带来的第二个坑：`app.asar` 重新出现。**
升级程序把 rc.3 解包到 `resources\app\`，但没删旧的 `app.asar`。Electron 的
加载优先级是 **`app.asar` > `app/`**，所以补丁写进 `app/` 完全不被读取，
面板显示 `asar_still_sealed: true`。

处理：备份 `app.asar` → 挪走 → 重启。之后 `asar_still_sealed: false`，
补丁才会真正生效。挪走的包可以随时改回来回滚。

### 0.2.1-rc.2

提示词从 `dsh-web-app` 搬到新包 `dsh-harness-dev-context`，`${webUrl}` 也去掉了。详见 [compat-0.2.1.md](compat-0.2.1.md)。

## 维护纪律

1. **DSH 发新版 → 先跑 `drift-check.mjs`**。它不需要启动宿主，30 秒内告诉你哪几条失效。
2. **drift > 0 就是必须动手**：去官方包里找那段代码变成了什么，补新 pattern，旧 pattern 保留（向后兼容）。
3. **上游整段删掉的，用 `obsoleteWhen` 标 `na`**，不要留着报 `skipped` —— `skipped` 的意思是「锚点没对上」，那是 bug；`na` 的意思是「本代无事可做」。
4. **每次测完补一行矩阵**，写清 applied / already / missing_file / na 四个数。

## 相关文档

- [compat-0.2.2.md](compat-0.2.2.md) — 0.2.2 的详细实测报告
- [compat-0.2.1.md](compat-0.2.1.md) — 0.2.1 的详细实测报告
