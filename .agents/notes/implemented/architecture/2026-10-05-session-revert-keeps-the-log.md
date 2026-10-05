# Agent Note: Session revert hides log rows instead of deleting them

Status: implemented

English | [中文](2026-10-05-session-revert-keeps-the-log.zh.md)

## Problem

Undo has to take a user message, and everything after it, out of the next model request. The session log is also the only reconstruction of that request. Deleting the rows would make a later reader unable to show what was undone, and it would need a new log generation. An old reader that skipped the marker would send the hidden messages anyway.

## Decision

`session/revert/staged`, `session/revert/cleared`, and `session/revert/committed` stay in the log as required events. `Session.deriveMessages()` omits a staged seq and everything after it, and omits each committed range up to but not including the commit event. The rows themselves remain. File rollback is not in the log: `@lulu-ling/dsh-session-file-snapshot` stores a git tree outside the user's repository and restores it when stage or clear runs.

## Consequences

A build that does not know the three event types refuses a log that contains one. A log from before the first undo still opens. Reloading a session restores the message boundary from the log. It restores files only when the snapshot directory from that same machine is still present. Capture is once per turn, at the first pre-step, not once per step.

## Alternatives considered

- **Delete the hidden messages when the next prompt is sent.** That matches the opencode cleanup path. It was rejected because this harness reconstructs model history from the log, and deletion would discard the only copy of the undone turn.
- **Mark the events `ignorable: true`.** An older reader would skip them and send the hidden messages. The marker exists for records whose loss cannot change reconstruction.
- **Keep the boundary only in memory.** A reload would show the undone messages again, including to the model.
