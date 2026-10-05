---
description: "在不删除日志的前提下暂存、清除并提交会话消息边界。"
kind: "package-reference"
---

# @lulu-ling/dsh-session-revert

[English](README.md) | 中文

## 概要

本包把撤回边界记在会话日志上。暂存会从派生的模型历史中隐藏一条用户消息及其后的全部内容。清除会恢复这次暂存。下一次人类 prompt 会提交暂存，这些消息不再进入后续请求，日志本身保持完整。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把插件挂在会话存储、agent 注册表和投影注册表旁边。没有投影注册表时 fiber 保持挂起，什么都不会注册。

### 组合

```yaml
- name: '@lulu-ling/dsh-session-revert'
```

### 调用

`stage(agent, atSeq)` 在 `atSeq` 是一条现存 `user/message`、且不落在任何已冻结区间内时追加 `session/revert/staged`。重复当前边界不会产生变化。`clear(agent)` 在存在暂存时追加 `session/revert/cleared`。两者都会拒绝正在运行的 agent，以及收件箱里仍有待处理输入的情况。`commit(agent)` 为当前暂存追加 `session/revert/committed`。人类 prompt 也会提交，时机是 `agent/pre-step`，发生在该 prompt 写入日志之前。
这三条事件追加时都带 `ignorable: true`。

### 失败

`session/revert-busy` 表示 agent 正在运行或有待处理输入。`session/revert-invalid` 表示 `atSeq` 不是用户消息，或落在已提交区间内。`session/not-found` 表示该 agent 对象不是注册表中的活实例。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

### 设计概念

宿主折叠放在 `revert` 投影里。它保存暂存边界、已冻结区间，以及每条 `user/message` 的 seq。客户端视图省略 seq 列表。`Session.deriveMessages()` 应用同一组标记，因此暂存或已提交的区间不会进入模型请求。提交的排他终点是提交事件本身，所以写在它后面的人类 prompt 仍然可见。

### 源码地图

| 文件 | 职责 |
|---|---|
| `src/index.ts` | 服务、远程方法，以及 pre-step 提交 |
| `src/fold.ts` | 纯投影折叠 |
| `src/types.ts` | 投影与远程结果类型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [会话子系统](../../../docs/subsystems/session.zh.md) — 这些标记被追加到的日志。
- [会话投影子系统](../../../docs/subsystems/session-projection.zh.md) — 折叠客户端视图的驱动。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `Session.deriveMessages()` 实现：它会省略被这些标记隐藏的 surface 消息。

#### KV Cache 影响

暂存、清除或提交都会改变派生后缀，因此复用停在第一条被隐藏或被恢复的消息处。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **没有文件回滚。** 标记只隐藏消息。恢复工作区文件属于单独的快照缝。
- **整条消息边界。** 不能在一条用户消息内部按 part 截断。
- **人类 prompt 才提交。** 注入上下文和工具步骤会把暂存留到 `source.kind === 'user'` 的 prompt 进入为止。
