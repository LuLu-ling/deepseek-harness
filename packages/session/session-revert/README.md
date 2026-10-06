---
description: "Stage, clear, and commit a session message boundary without deleting the log."
kind: "package-reference"
---

# @lulu-ling/dsh-session-revert

English | [中文](README.zh.md)

## Summary

This package records a revert boundary on the session log. Stage hides one user message and everything after it from derived model history. Clear restores that stage. The next human prompt commits the stage, so those messages stay out of later requests while the log itself remains intact.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside the session store, the agent registry, and the projection registry. Without the projection registry the fiber stays pending and nothing registers.

### Composition

```yaml
- name: '@lulu-ling/dsh-session-revert'
```

### Calls

`stage(agent, atSeq)` appends `session/revert/staged` when `atSeq` is an existing `user/message` outside every frozen range. A repeat of the current boundary changes nothing. `clear(agent)` appends `session/revert/cleared` when a stage is active. Both refuse a running agent and an inbox that still holds pending input. `commit(agent)` appends `session/revert/committed` for the active stage. A human prompt also commits, from `agent/pre-step`, before that prompt is logged.
Each of those three events is appended with `ignorable: true`.

### Failures

`session/revert-busy` means the agent is running or has pending input. `session/revert-invalid` means `atSeq` is not a user message or sits inside a committed range. `session/not-found` means the agent object is not the live registry instance.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The host fold lives in the `revert` projection. It keeps the staged boundary, frozen ranges, and the seq of every `user/message`. The client view omits the seq list. `Session.deriveMessages()` applies the same markers, so a staged or committed range never reaches a model request. Commit's exclusive end is the commit event, so the human prompt logged after it stays visible.

### Source map

| File | Role |
|---|---|
| `src/index.ts` | Service, remote methods, and the pre-step commit |
| `src/fold.ts` | Pure projection fold |
| `src/types.ts` | Projection and remote result types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session subsystem](../../../docs/subsystems/session.md) — the log these markers are appended to.
- [Session projections subsystem](../../../docs/subsystems/session-projection.md) — the drive that folds the client view.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `Session.deriveMessages()`, which omits surface messages hidden by these markers.

#### KV Cache effect

Staging, clearing, or committing changes the derived suffix, so reuse stops at the first hidden or restored message.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No file rollback.** Markers hide messages only. Restoring workspace files is a separate snapshot seam.
- **Whole-message boundary.** There is no part-level cut inside one user message.
- **Human prompt commits.** Injected context and tool steps leave a stage in place until a `source.kind === 'user'` prompt enters.
