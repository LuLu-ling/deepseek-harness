---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-22-action-card-status

English | [中文](2026-10-22-action-card-status.zh.md)

## Summary

Adds action-card status attribution to logged model context.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-22-action-card-status
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-15-snapcompact-source-text"
    after: "730ff39ec5eb53c090cd8fe794c67eb2820606091836f799688903cc77cd81a2"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-15-snapcompact-source-text"
    after: "2ba70a858b6ede2d30122c0eb2686d372749b94765c22960fd9668fbb3db2496"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-15-snapcompact-source-text"
    after: "b034bda822ba1b386d0fd4a4ed94e77d0aa2f0be211534794e24eaa8676c779c"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-15-snapcompact-source-text"
    after: "b85d4d6e6fa8004a8f9fb849188542a2008c950ead45f5c6cd44c00d73385e2c"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing messages and records are unchanged. Readers without the action-card plugin preserve the new action-cards source kind and its JSON metadata and derive the recorded text as ordinary context. Only the producer uses the through sequence, to acknowledge delivered decisions; it grants no authority and does not change replay interpretation.

<a id="verification"></a>
## Verification

pnpm exec vitest run on the action-cards, creation-recommendations, client-ui-action-cards and client-ui-creation-recommendations tests: 120 tests passed with 100% coverage of their sources. The Web creation-recommendations replay logs the status notice of a dismissed card before the next answer.

<a id="dev-note"></a>
## Dev Note

None.
