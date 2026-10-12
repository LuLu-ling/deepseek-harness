---
description: "把被丢弃的会话片段印成视觉模型可读的 PNG 帧，而不调用摘要模型。"
kind: "package-library"
---

# @lulu-ling/dsh-snapcompact

[English](README.md) | 中文

## 摘要

`dsh-snapcompact` 让压缩把较早历史印成 PNG 帧，而不是请模型写摘要。手动 `/compact snapcompact`，以及已保存方式为 `snapcompact` 且路由模型声明了图片输入时的自动压缩，都由 `compaction-basic` 调用 `compactSnapcompact`。调用方通过附件服务接纳 PNG 字节，并把图片块放在替换用的用户消息上。形状按模型 id 选择。没有形状设置。

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

从 `compaction-basic` 导入。不要把它写进 `cordis.yml`。

```ts
import { compactSnapcompact } from '@lulu-ling/dsh-snapcompact'

const archive = await compactSnapcompact({
  messages,
  model: { api: 'anthropic', id: 'claude-opus-4-7' },
  includeThinking: false,
  maxFrames: 4,
  filePaths: [],
})
```

`archive.blocks` 依次是文本、PNG 帧、文本。`archive.summary` 是阅读说明。`archive.sourceText` 是下一次压缩展开的源文本。没有缩小已定价上下文的一次压缩不得提交。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

形状表、记录前缀和中央聚焦排版遵循 snapcompact 算法。帧由 TypeScript 光栅器根据随包提供的公有领域像素字体和 CC BY 4.0 Silver 字体绘制。

| 文件 | 职责 |
|---|---|
| [`src/archive.ts`](src/archive.ts) | 形状选择、记录文本、排版和 `compactSnapcompact` |
| [`src/raster.ts`](src/raster.ts) | PNG 光栅器 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [压缩子系统](../../../docs/subsystems/compaction.zh.md)
- [compaction-basic](../compaction-basic/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 compaction-basic：它把帧和阅读说明放进替换用的用户消息。

#### KV Cache 效果

无。档案在本地生成，不调用模型。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 没有面向用户的形状选择。解析保持自动。
- 未声明图片输入的模型不能使用档案。自动压缩回退到摘要；手动 snapcompact 调用失败。
- TypeScript 光栅器匹配生产形状所用的帧几何。它不附带原生插件。

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
