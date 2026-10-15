---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-15-snapcompact-source-text

English | [中文](2026-10-15-snapcompact-source-text.zh.md)

## Summary

Adds optional snapcompactSourceText on compact-checkpoint message sources.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-10-15-snapcompact-source-text
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-13-user-rpc-principal"
    after: "05f3d7b08b249e9569338785680f09830e9aac217993209447029badaff3cd5e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "56d7ebf599f882f0aa4415b2495553e47dc33afaf839b3e02cffc0c5b8669303"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-13-user-rpc-principal"
    after: "94fa057f2c1cd0467d30529cc0e6aa029a80be8185636fe1f3d76ee9c7016a19"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-13-user-rpc-principal"
    after: "c2165d31594ca8dce4bb3a0d63f7f15b4ceedf6a4ca5104208c2036ebbcf500b"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Old readers ignore the field. A compact checkpoint without it stays valid, and replay still uses the checkpoint message. New writers may store the source text that produced the snapcompact archive.

<a id="verification"></a>
## Verification

The schema diff is only this optional property on the compact-checkpoint source of user messages, developer messages, title requests, and agent inbox splices. Same-version readers accept both forms.

<a id="dev-note"></a>
## Dev Note

None.
