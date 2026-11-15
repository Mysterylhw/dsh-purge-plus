# 历史 tag 存档 / Archived tags

这些 tag 已从仓库删除（面板下拉列表里不再显示 v1.x）。提交仍可从上游
`YuJunZhiXue/dsh-purge` 取回，下面记录它们原本指向的 SHA，便于日后定位。

> 删除原因：面板的版本选择器直接读 `/repos/{repo}/tags`，6 个 tag 里
> 5 个是 v1.x 历史版本。这些提交**不在 main 历史链上**，只是上游发版快照，
> 对 2.x 用户没有意义，却把下拉列表撑得很长。

| tag | commit | 标题 |
| --- | --- | --- |
| v1.3.1 | `d1199e2d847b795f3914eee47a0eb50f4110c66b` | dsh-purge 1.3.1: DSH 0.2.1-rc.2 adaptation, prompt-kernel v3, Settings UI rebuild |
| v1.4.0 | `f959627871cdef419d81a926a6a5eca00839944f` | dsh-purge 1.4.0: harden JSON output, file identity, approval/audit, and revision guard |
| v1.4.1 | `a3153ee7e1e85231cde3c73fc60ab7c800fc9e9c` | dsh-purge 1.4.1: fix unknown prompt variable crash on install |
| v1.4.2 | `1942b1a629e1942f5836533759d07672783969fd` | dsh-purge 1.4.2: remove the input-box rewind button and all of its machinery |
| v1.4.3 | `fe93b2708477a9da9039923a6c22a604d801a61a` | dsh-purge 1.4.3: restore steer delivery, fix the turn-tail wake race (PR #3 by @scially) |

## 需要旧版本时

从上游仓库取：<https://github.com/YuJunZhiXue/dsh-purge>（若已删库，用镜像
`mmparko/dsh-purge`），`git fetch --tags` 后 checkout 对应 tag。

本仓库若要恢复某个 tag：

```sh
git tag v1.4.3 fe93b2708477a9da9039923a6c22a604d801a61a
git push origin refs/tags/v1.4.3
```

## 保留的 tag

| tag | 说明 |
| --- | --- |
| `v2.0.2` | 当前版本（DSH 0.2.2-rc.3） |
| `v2.0.1` | 上一版（DSH 0.2.2-rc.1 时代） |
