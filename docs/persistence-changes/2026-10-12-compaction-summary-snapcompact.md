---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-12-compaction-summary-snapcompact

English | [中文](2026-10-12-compaction-summary-snapcompact.zh.md)

## Summary

Adds an optional snapcompact archive record on compaction/summary.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-12-compaction-summary-snapcompact
baseline: false
changes:
  - root: "event:compaction/summary"
    previous: "2026-09-16-session-format-v4"
    after: "f2871dde3aac9eaa06f0552f61a038d917bb3e3fb06195945307158c6b8829e3"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing summaries stay valid because the field is absent. New events store source text, frame geometry, and attachment ids. Old readers ignore the field and still replay the checkpoint user message, whose image blocks already use ImageBlock. Absence does not mean the checkpoint has no images.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/compaction/compaction-basic/tests/snapcompact-manual.spec.ts: 3 tests passed. A vision-model snapcompact writes the field and image blocks; a text-only model writes no compaction/start.

<a id="dev-note"></a>
## Dev Note

None.
