---
description: "dsh Web 客户端插件页上的文件快照设置页：撤回保留多少棵工作区快照、多久清理一次，以及多大的未跟踪文件才会进入快照。"
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-settings-session-snapshot

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**文件快照**，即可设置一个工作区保留多少棵快照、快照根目录最多占用多少字节、一棵快照保留多久、定时清理隔多久，以及多大的未跟踪文件不进入快照。页面暂存输入、只在保存时写入。五项在被覆盖前显示 `100`、`5368709120`、`604800000`、`3600000` 和 `2097152`。页面只在 Host 服务 `session-snapshot` 条目期间存在。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

官方分组里的**文件快照**卡片打开这一页。**保留数量**、**磁盘上限（字节）**、**保留时间（毫秒）**、**清理间隔（毫秒）**、**未跟踪文件上限（字节）**都显示生效值。用户覆盖过的字段带**已覆盖**标签，旁边是**恢复默认**。点击**保存**之前不会写入任何内容。离开页面即丢弃草稿。清空任一字段并保存，会回到 `100`、`5368709120`、`604800000`、`3600000` 或 `2097152`。填了不是数字的文本则保存被阻止，并在字段下说明原因。保存后的值在下一次捕获、恢复或清理时生效。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧是一个空的 `apply`，只为让本包占一条 Loader 行，客户端模块系统据此送出浏览器半侧。浏览器半侧通过 `ctx.configForms.get` 绑定 `session-snapshot` 条目，用 `ui-primitives` 的共享 `SettingsFormModel` 在 `SnapshotCardController` 里维护暂存表单，并通过 `ctx.configForms.whileServed` 把 `SnapshotCard` 注册进插件页的 `plugins.item` slot。页面文案在本包的 `settings.sessionSnapshot` 字典里。`SettingsForm` 框架的文案以 props 传入。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与“命名空间被服务期间”的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与字段。
- [session-file-snapshot](../../session/session-file-snapshot/README.zh.md)——拥有 `session-snapshot` 条目的插件。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧的设置界面，不注册任何模型面。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **本页只编辑上限**——`snapshots` 与 `dataDir` 仍留在条目配置里。关闭快照，或改快照根目录，不在本页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
