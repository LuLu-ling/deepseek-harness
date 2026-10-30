---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-30-snapcompact-source-text

[English](2026-10-30-snapcompact-source-text.md) | 中文

## 概述

在上游消息来源更新之后，为 compact-checkpoint 来源增加可选的 snapcompactSourceText。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-30-snapcompact-source-text
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "02e7916b126b6115245aa5b90f4cf6f3ffc94f3fb0ec848befc28a7ca2806578"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "64eda283212665493958d082141befbf806cbb8d440c44c9ca14b2803b431537"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "ff0560047daa48ac8e4c16414840666351f5163b7e40630a6ab4911852812c9e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "90bc8ca2c01b0a4124218bdba3a0acb9ff1e3d934c60e7579842628c2747f2ae"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧读取方忽略未知字段。没有 snapcompactSourceText 的 compact checkpoint 仍然有效，回放仍使用该 checkpoint 消息。新写入方可以保存生成 snapcompact 归档的源文本。该字段不授予权限，也不改变消息解释。

<a id="verification"></a>
## 验证

schema 差异仅是用户消息、开发者消息、标题请求和 agent inbox splice 的 compact-checkpoint 来源上的这个可选属性。

<a id="dev-note"></a>
## 开发备注

无。
