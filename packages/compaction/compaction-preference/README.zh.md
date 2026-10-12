---
description: "保存自动压缩是把较早历史写成摘要，还是印成图片。"
kind: "package-reference"
---

# @lulu-ling/dsh-compaction-preference

[English](README.md) | 中文

## 摘要

`dsh-compaction-preference` 保存进程的自动压缩方式。已交付的 base 配置把它挂成 `context-compaction`。设置 → 通用设置 → 上下文压缩编辑 `method`。默认是 `soft`。选择 `snapcompact` 不会改变未声明图片输入的模型：那些模型的自动压缩仍然写摘要。`/compact` 的方式词不会写入这项设置。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

base 包已经挂载该插件。在设置 → 通用设置 → 上下文压缩中更改方式，或编辑用户设置项 `context-compaction`。

### 最小配置

```yaml
- id: context-compaction
  name: '@lulu-ling/dsh-compaction-preference'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `method` | `soft` | `soft` 写摘要。路由模型声明图片输入时，`snapcompact` 做档案。 |

非法值会在配置加载时失败。生成的配置目录列出可接受的值。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

该字段是 volatile，因此保存设置会更新当前值而不重新挂载。Web 预设隔离 `ctx.compaction`，但不隔离这项服务，所以嵌套的压缩引擎读取 `ctx.compactionPreference`。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 偏好插件 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [压缩子系统](../../../docs/subsystems/compaction.zh.md)
- [`/compact`](../command-compact/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 compaction-basic：压缩时读取已保存的方式。

#### KV Cache 效果

无。保存方式不会调用模型。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 偏好是进程范围的。通用设置不会因为模型只支持文本而隐藏 `snapcompact`。回退发生在压缩执行时。
- 该行不选择帧形状。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
