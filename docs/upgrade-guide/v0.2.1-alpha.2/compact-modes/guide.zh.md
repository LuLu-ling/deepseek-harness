---
kind: upgrade-guide
description: "/compact 现在接受 soft 或 snapcompact，自动压缩也可以保存为设置。"
---

# `/compact` 接受压缩方式

[English](guide.md) | 中文

## 变更

此版本之前，`/compact` 会拒绝任何参数，并返回 `Usage: /compact (no arguments)`。不带参数的 `/compact` 仍然把较早历史写成摘要。`/compact soft` 现在只对这一次调用做摘要，`/compact snapcompact` 则在当前模型声明支持图片输入时把那段历史印成图片。其他参数都是 `Usage: /compact [soft|snapcompact]`。方式词不会改已保存的偏好。

图形界面里不带参数的 `/compact` 会打开弹出菜单。只有所选模型声明了图片输入时才列出 Snapcompact。

自动压缩读取用户设置 `context-compaction.method`（`soft` 或 `snapcompact`，默认 `soft`）。只有路由到的模型声明了图片输入时才会自动使用 `snapcompact`；否则自动压缩仍是摘要。

## 迁移

1. 改掉那些发送 `/compact soft` 并期待用法错误的脚本。`/compact` 与 `/compact soft` 做摘要。当前模型未声明图片输入时，`/compact snapcompact` 报错且不压缩。
2. 要改自动方式，把 `context-compaction` 设置项下的 `method` 设为 `soft` 或 `snapcompact`。在设置 → 通用设置 → 上下文压缩中确认，或在声明了图片输入的模型上跑一次有压力的回合，并检查检查点用户消息含有图片块。
