---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-05-session-revert-events

English | [中文](2026-10-05-session-revert-events.zh.md)

## Summary

Adds the required log events session/revert/staged, session/revert/cleared, and session/revert/committed.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Logs that never contain these events stay readable. A log that contains one opens only on a build whose known-event catalog lists it. Older builds still refuse that log. The session format version stays 4.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/api/session-controller/tests/revert.client.spec.ts: 4 passed. pnpm exec vitest run packages/client/ui-chat/tests/revert-dock.client.spec.tsx: 1 passed.

<a id="dev-note"></a>
## Dev Note

None.
