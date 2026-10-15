---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-15-snapcompact-source-text

[English](2026-10-15-snapcompact-source-text.md) | 中文

## 概述

在 compact-checkpoint 消息来源上增加可选的 snapcompactSourceText。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-snapcompact-source-text
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "05f3d7b08b249e9569338785680f09830e9aac217993209447029badaff3cd5e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "56d7ebf599f882f0aa4415b2495553e47dc33afaf839b3e02cffc0c5b8669303"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "94fa057f2c1cd0467d30529cc0e6aa029a80be8185636fe1f3d76ee9c7016a19"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "c2165d31594ca8dce4bb3a0d63f7f15b4ceedf6a4ca5104208c2036ebbcf500b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

旧读取方忽略该字段。没有该字段的压缩检查点仍然有效，回放仍使用检查点消息。新写入方可以保存生成 snapcompact 档案的源文本。

<a id="verification"></a>
## 验证

schema 差异只是用户消息、开发者消息、标题请求和 agent inbox splice 的 compact-checkpoint 来源上的这个可选属性。同一版本的读取方接受两种形式。

<a id="dev-note"></a>
## 开发备注

无。
