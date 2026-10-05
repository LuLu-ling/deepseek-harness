---
kind: upgrade-guide
description: "会话日志可以包含旧构建拒绝打开的撤回事件。"
---

# 会话撤回事件

[English](guide.md) | 中文

## 变更

使用撤回的会话会写入 `session/revert/staged`、`session/revert/cleared` 或 `session/revert/committed`。消息仍留在日志里。模型历史省略被隐藏的区间。不认识这些类型的构建会拒绝该日志。从未使用撤回的日志没有变化，仍可打开。

客户端远程方法 `sessionRevert.stage`、`sessionRevert.clear` 和 `sessionRevert.commit` 是新增的。不调用它们的调用方不受影响。

## 迁移

1. 用新构建打开已有会话。不需要重写日志。
2. 不要用旧构建打开包含上述事件之一的会话。升级那个安装，或把会话留在新构建上。
3. 确认：旧会话能加载，`/undo` 隐藏最后一条用户消息，`/redo` 再显示它，日志文件里仍有这条消息。
