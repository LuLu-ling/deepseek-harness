---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-05-session-revert-events

[English](2026-10-05-session-revert-events.md) | 中文

## 概述

新增必需日志事件 session/revert/staged、session/revert/cleared 和 session/revert/committed。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-05-session-revert-events
baseline: false
changes:
  - root: "event:session/revert/cleared"
    previous: null
    after: "a895527b566946881523811a1f5d33a9f1052767d1b3773fd5674727d2d31feb"
    decision: same-version
  - root: "event:session/revert/committed"
    previous: null
    after: "756c26fc06a7f81b49b6d6dc472cff301736b132378894782833decb5a5d867a"
    decision: same-version
  - root: "event:session/revert/staged"
    previous: null
    after: "4c980477e995c940e10e9ac1c9c8f0910123a5aa93d47b29f1e2f1ba727ec122"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

不含这些事件的日志仍可读取。包含其中一条的日志只能在已知事件清单列出该类型的构建上打开。更旧的构建仍会拒绝该日志。会话格式版本保持 4。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/api/session-controller/tests/revert.client.spec.ts：4 个通过。pnpm exec vitest run packages/client/ui-chat/tests/revert-dock.client.spec.tsx：1 个通过。

<a id="dev-note"></a>
## 开发备注

无。
