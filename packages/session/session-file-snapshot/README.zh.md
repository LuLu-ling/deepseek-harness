---
description: "把 git 工作区捕获到独立快照，并在会话撤回移动时恢复。"
kind: "package-reference"
---

# @lulu-ling/dsh-session-file-snapshot

[English](README.md) | 中文

## 概述

本包把会话工作区捕获到数据目录下的独立 git 目录，不写入用户自己的仓库。每个回合之前、以及之后每个接收人类消息的 step 之前各捕获一次。暂存撤回时，只回写第一次暂存时的工作区和边界消息之前的捕获之间有差异的路径。清除暂存时把它们写回去。进行中的撤回所需的树保存在快照旁边，所以重做和继续撤回在重启后仍然有效。不是 git 检出的目录，以及 `snapshots: false`，都不会捕获。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
  - [开发备注](#dev-note)

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

`historyLimit`、`diskLimitBytes`、`maxAgeMs`、`gcIntervalMs`、`maxUntrackedBytes` 会立即生效，默认分别是 `100`、`5368709120`（5 GiB）、`604800000`（7 天）、`3600000`（1 小时）和 `2097152`（2 MiB）。`historyLimit` 是一个工作区保留的树的数量。`diskLimitBytes` 是快照根目录的字节上限。`maxAgeMs` 是一棵树保留的毫秒数。`gcIntervalMs` 是两次清扫之间的毫秒数。`maxUntrackedBytes` 是能进入快照的未跟踪文件的最大字节数。每次捕获之后也会清扫一次。正在进行的撤回所使用的树会留下，包括之前进程保存的。被记住的回合不会。插件页官方分组里的**文件快照**编辑这五项。保存后，下一次捕获或清理按新值执行。

### 撤回如何移动文件

每次捕获都在快照目录里绑定到所在回合，或绑定到接收人类消息的那个 step。暂存在覆盖第一次暂存的树里没有的路径之前，比如超过 `maxUntrackedBytes` 的未跟踪文件，会先把该路径当前的字节加入那棵树，这样清除时能写回。删除先于写入，所以文件变成目录或目录变成文件的情况也能恢复。保留限制已经删掉的回合树无法恢复。捕获或恢复失败时会记录一条警告，消息撤回照常生效。

-----

<a id="model-experience"></a>
## 模型体验

无，因为快照只在磁盘上恢复工作区文件，不会有内容进入模型请求。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **按 prompt 粒度。** 在回合之前、以及之后每个接收人类消息的 step 之前各捕获一次，不是每个工具 step 都捕获。在非人类消息处撤回时恢复所在回合的快照。
- **分叉没有对应关系。** 分叉不记录父会话，所以在继承来的消息处撤回只移动消息，不移动文件。
- **撤回期间的编辑。** 重做会写回撤回移动过的每个路径，覆盖暂存期间对这些路径所做的编辑。
- **仅 git。** 其他版本管理目录是空操作。
- **忽略文件保留。** 恢复时不跑 `git clean`，因此 `node_modules` 这类被忽略的文件不会被删掉。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

`dsh-stages.json` 按会话保存进行中的撤回所需的树：第一次暂存时的树（加上每次暂存覆盖过的路径），以及被移动的路径当前对应的树。第一次暂存会丢弃已清除或已提交的撤回留下的记录。保留清理会读取每个快照目录里的这个文件，所以之后的进程也会保留这些树。

</details>
