---
kind: upgrade-guide
description: "Deleting a session from the sidebar removes its log and cannot be undone."
---

# Delete a session

English | [中文](guide.zh.md)

## Change

The sidebar session menu can delete one idle session. Confirmation removes that session's log directory, projection-cache document, reminders, and spill directory, and drops it from archive, pin, and Workspace membership. Attachments and other sessions stay. Edits that session made to project files stay. An active session is refused as `workspace/session-active`. A cleanup failure is `workspace/delete-failed`.

Hosts gain `workspace/deleteSession`. `SessionPersistence.delete` removes one session directory located from the stored header.

## Migration

1. Do not call `workspace/deleteSession` for a session you still need. There is no restore.
2. Before deleting, stop in-progress work. A running turn, pending approval, plan review, question, or running subagent keeps the control disabled and the Host returns `workspace/session-active`.
3. Confirm: the sidebar row is gone, `$DSH_HOME/sessions/` no longer has that session directory, and project files the session edited are unchanged.
