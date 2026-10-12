---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-12-compaction-summary-snapcompact

[English](2026-10-12-compaction-summary-snapcompact.md) | 中文

## 概述

在 compaction/summary 上增加可选的 snapcompact 档案记录。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-compaction-summary-snapcompact
baseline: false
changes:
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "f2871dde3aac9eaa06f0552f61a038d917bb3e3fb06195945307158c6b8829e3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有摘要仍然有效，因为该字段不存在。新事件保存源文本、帧几何和附件 id。旧读者忽略该字段，仍然回放检查点用户消息；其图片块已经使用 ImageBlock。字段缺失不表示检查点没有图片。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/compaction/compaction-basic/tests/snapcompact-manual.spec.ts：3 个测试通过。视觉模型的 snapcompact 会写入该字段和图片块；纯文本模型不会写入 compaction/start。

<a id="dev-note"></a>
## 开发备注

无。
