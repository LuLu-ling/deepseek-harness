---
description: "dsh Web 客户端插件页上的提示音设置：智能体、权限和错误的声音。"
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-settings-sounds

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在内置插件配置里选择**音效**。三个菜单分别设置智能体、权限请求和错误的提示音。每个菜单一开始都是**无**。高亮或选中一个声音会试听。点击**保存**之前不会写入。

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

**音效**卡片打开这一页。**智能体**在已列出的顶层会话停止运行时播放。**权限**在新的批准请求时播放，同一会话五秒内最多一次。**错误**在智能体出错时播放，列表里还没有该会话也播放。子代理的完成和错误保持静音。某一行选**无**并保存，该行就是静音。离开页面即丢弃草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

宿主半侧拥有 `sounds` 条目的 schema：`agent`、`permissions`、`errors` 三个易变字符串，默认都是 `none`，只能是 `none` 或随包附带的 48 个 id。`apply` 只调用 `settings.configure({ auto: false })`，因此不会再生成一张通用设置页。浏览器半侧通过 `ctx.configForms.get` 绑定该命名空间，在 `SoundsCardController` 里维护暂存表单，并通过 `ctx.configForms.whileServed` 把 `SoundsCard` 注册进 `plugins.item`。播放读的是已保存快照，不是草稿，并订阅 `api-session/status`、`api-session/error` 和 `approval/request`。页面文案在 `settings.sounds` 字典里。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md)——插件页以及本页注册进去的 `plugins.item` slot。
- [ui-settings](../ui-settings/README.zh.md)——本页依赖的设置 scope 与“命名空间被服务期间”的监视。
- [ui-primitives](../ui-primitives/README.zh.md)——本页渲染的设置表单模型与菜单。

-----

<a id="model-experience"></a>
## 模型体验

无，这三个字段不进入模型请求，也不写会话日志。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有浏览器提示音**——没有系统通知、音量控制或桌面原生播放。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
