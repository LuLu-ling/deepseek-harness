---
kind: upgrade-guide
description: "Session logs can contain revert events that older builds refuse to open."
---

# Session revert events

English | [中文](guide.zh.md)

## Change

A session that uses undo writes `session/revert/staged`, `session/revert/cleared`, or `session/revert/committed`. The messages stay in the log. Model history omits the hidden range. A build that does not know these types refuses the log. A log that never used undo is unchanged and still opens.

The client remote `sessionRevert.stage`, `sessionRevert.clear`, and `sessionRevert.commit` are new. Callers that do not use them are unaffected.

## Migration

1. Open an existing session with the new build. No log rewrite is required.
2. Do not open a session that contains one of those events with an older build. Upgrade that install, or leave the session on the new build.
3. Confirm: the old session loads, `/undo` hides the last user message, `/redo` shows it again, and the log file still contains that message.
