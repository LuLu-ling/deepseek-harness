---
description: "Web 图形界面中的 /compact，以及保存的自动压缩方式。"
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-compaction

[English](README.md) | 中文

## 摘要

在 Web 图形界面里不带参数地使用 `/compact`，可为这一次调用选择 soft compact 或 snapcompact。所选模型未声明图片输入时不列出 snapcompact。设置 → 通用设置 → 上下文压缩在选中时即保存自动方式。默认显示 soft compact。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 配置把本包挂在宿主 `/compact` 命令旁边。选择一行会提交 `/compact soft` 或 `/compact snapcompact`。通用设置行编辑 `context-compaction.method`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Host 侧是空的 `apply`。浏览器侧用 `popupSelect` 装饰宿主命令，并在 Host 提供 `context-compaction` 时把通用设置行注册到 `settings.general.item`。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [command-compact](../../compaction/command-compact/README.zh.md)
- [compaction-preference](../../compaction/compaction-preference/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无。本包是浏览器侧的设置与命令界面，不注册模型界面。

#### KV Cache 效果

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **通用设置不隐藏 snapcompact。** 偏好是进程范围的。只支持文本的模型在压缩执行时仍然写摘要。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
