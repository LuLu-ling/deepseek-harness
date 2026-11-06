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
    previous: "2026-10-27-retry-control-input"
    after: "a17b52015e779aff8315c7899c3fed15510d48289c167fc8fc3147bb1ae66eb8"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-27-retry-control-input"
    after: "b4d3e3c404a95aa3f3b4fed253a915f8d2157dfecb639ac47232f8bdee7cbf04"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-27-retry-control-input"
    after: "d983c887a6f12234c04d6aa3f38c45262f084ce2888ab6721507923c38626af9"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-27-retry-control-input"
    after: "e449487c97cbe8b37c0beaaa8ebde915e392402bfce4f7d7e04679a956d9bdfd"
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
