---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-30-snapcompact-source-text

English | [中文](2026-10-30-snapcompact-source-text.zh.md)

## Summary

Adds optional snapcompactSourceText on compact-checkpoint sources after the upstream message-source updates.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-30-snapcompact-source-text
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "02e7916b126b6115245aa5b90f4cf6f3ffc94f3fb0ec848befc28a7ca2806578"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "64eda283212665493958d082141befbf806cbb8d440c44c9ca14b2803b431537"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "ff0560047daa48ac8e4c16414840666351f5163b7e40630a6ab4911852812c9e"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-liveshare-share-viewer-principal"
    after: "90bc8ca2c01b0a4124218bdba3a0acb9ff1e3d934c60e7579842628c2747f2ae"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Older readers ignore the unknown field. A compact checkpoint without snapcompactSourceText remains valid, and replay still uses the checkpoint message. New writers may store the source text that produced a snapcompact archive. The field grants no authority and does not change message interpretation.

<a id="verification"></a>
## Verification

The schema diff is only this optional property on the compact-checkpoint source of user messages, developer messages, title requests, and agent inbox splices.

<a id="dev-note"></a>
## Dev Note

None.
