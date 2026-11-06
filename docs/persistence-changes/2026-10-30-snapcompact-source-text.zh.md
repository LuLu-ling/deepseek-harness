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
    previous: "2026-10-27-retry-control-input"
    after: "a17b52015e779aff8315c7899c3fed15510d48289c167fc8fc3147bb1ae66eb8"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "b4d3e3c404a95aa3f3b4fed253a915f8d2157dfecb639ac47232f8bdee7cbf04"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "d983c887a6f12234c04d6aa3f38c45262f084ce2888ab6721507923c38626af9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "e449487c97cbe8b37c0beaaa8ebde915e392402bfce4f7d7e04679a956d9bdfd"
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
