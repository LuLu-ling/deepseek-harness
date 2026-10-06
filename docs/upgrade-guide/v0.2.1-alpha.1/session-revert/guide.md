---
kind: upgrade-guide
description: "Session revert events are ignorable, so an older build opens the log and shows the hidden messages."
---

# Session revert events

English | [中文](guide.zh.md)

## Change

A session that uses undo writes `session/revert/staged`, `session/revert/cleared`, or `session/revert/committed`, each with `ignorable: true`. The messages stay in the log. This build omits the hidden range from model history. A build that does not know these types keeps the rows and shows every message, including undone ones. A log that never used undo is unchanged and still opens.

The client remote `sessionRevert.stage`, `sessionRevert.clear`, and `sessionRevert.commit` are new. Callers that do not use them are unaffected.

## Migration

1. Open an existing session with the new build. Events appended after this change carry `ignorable: true`.
2. An older build opens a marked log and does not hide undone messages. A row written without the marker still makes that build refuse the log; add `ignorable: true` to those rows before opening it there.
3. Confirm: the old session loads, `/undo` hides the last user message, `/redo` shows it again, and the log file still contains that message.
