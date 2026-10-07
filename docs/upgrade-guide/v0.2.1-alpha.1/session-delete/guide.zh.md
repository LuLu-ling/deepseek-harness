---
kind: upgrade-guide
description: "从侧边栏删除会话会移除其日志，且无法撤销。"
---

# 删除会话

[English](guide.md) | 中文

## 变更

侧边栏会话菜单可以删除一个空闲会话。确认后会移除该会话的日志目录、投影缓存文档、定时提醒和 spill 目录，并从归档、置顶和 Workspace 成员关系中去掉它。附件和其他会话保留。该会话对项目文件做过的修改保留。活动会话以 `workspace/session-active` 拒绝。清理失败为 `workspace/delete-failed`。

Host 新增 `workspace/deleteSession`。`SessionPersistence.delete` 按已存储的 header 定位并移除一个会话目录。

## 迁移

1. 不要对仍需要的会话调用 `workspace/deleteSession`。没有恢复手段。
2. 删除前先停止进行中的工作。进行中的回合、待审批、计划待审、待回答或运行中的子代理会禁用入口，Host 返回 `workspace/session-active`。
3. 确认：侧边栏行已消失，`$DSH_HOME/sessions/` 下不再有该会话目录，会话编辑过的项目文件保持不变。
