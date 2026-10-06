---
kind: upgrade-guide
description: "会话撤回事件带 ignorable，旧构建会打开日志并显示被隐藏的消息。"
---

# 会话撤回事件

[English](guide.md) | 中文

## 变更

使用撤回的会话会写入 `session/revert/staged`、`session/revert/cleared` 或 `session/revert/committed`，每条都带 `ignorable: true`。消息仍留在日志里。本构建从模型历史中省略被隐藏的区间。不认识这些类型的构建会保留这些行，并显示全部消息，包括被撤回的消息。从未使用撤回的日志没有变化，仍可打开。

客户端远程方法 `sessionRevert.stage`、`sessionRevert.clear` 和 `sessionRevert.commit` 是新增的。不调用它们的调用方不受影响。

## 迁移

1. 用新构建打开已有会话。这次改动之后追加的事件带 `ignorable: true`。
2. 旧构建会打开带标记的日志，但不会隐藏被撤回的消息。没有该标记的旧行仍会让旧构建拒绝日志；在那里打开之前，给这些行加上 `ignorable: true`。
3. 确认：旧会话能加载，`/undo` 隐藏最后一条用户消息，`/redo` 再显示它，日志文件里仍有这条消息。
