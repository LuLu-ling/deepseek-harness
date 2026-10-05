---
description: "把 git 工作区捕获到独立快照，并在会话撤回移动时恢复。"
kind: "package-reference"
---

# @lulu-ling/dsh-session-file-snapshot

[English](README.md) | 中文

## 摘要

本包把会话工作区捕获到数据目录下的独立 git 目录，不写入用户自己的仓库。回合的第一次 pre-step 记下这棵树。暂存撤回时，只回写第一次暂存时捕获的树和边界所在回合的树之间有差异的路径。清除暂存时，把这些路径写回去。不是 git 检出的目录，以及 `snapshots: false`，都不会捕获。

## 目录

- [使用本包](#use-this-package)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

挂在 `@lulu-ling/dsh-session-revert` 之后。它把文件恢复接到那个服务上。

```yaml
- id: session-snapshot
  name: '@lulu-ling/dsh-session-file-snapshot'
  config:
    snapshots: true
```

`dataDir` 覆盖快照根目录。默认是 `$DSH_HOME/snapshot`；未设置 `DSH_HOME` 时是 `~/.dsh/snapshot`。匹配工作区 `.gitignore` 的文件不进入快照。

`historyLimit`、`diskLimitBytes`、`maxAgeMs`、`gcIntervalMs`、`maxUntrackedBytes` 会立即生效，默认分别是 `100`、`5368709120`（5 GiB）、`604800000`（7 天）、`3600000`（1 小时）和 `2097152`（2 MiB）。`historyLimit` 是一个工作区保留的树的数量。`diskLimitBytes` 是快照根目录的字节上限。`maxAgeMs` 是一棵树保留的毫秒数。`gcIntervalMs` 是两次清扫之间的毫秒数。`maxUntrackedBytes` 是能进入快照的未跟踪文件的最大字节数。每次捕获之后也会清扫一次。正在进行的撤回所使用的树会留下。被记住的回合不会。插件页官方分组里的**文件快照**编辑这五项。保存后，下一次捕获或清理按新值执行。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **回合粒度。** 只在第一次 pre-step 捕获一次，不是每个 step 一次。
- **仅 git。** 其他版本管理目录是空操作。
- **忽略文件保留。** 恢复时不跑 `git clean`，因此 `node_modules` 这类被忽略的文件不会被删掉。
