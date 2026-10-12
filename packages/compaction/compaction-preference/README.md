---
description: "Save whether automatic compaction summarizes older history or prints it onto images."
kind: "package-reference"
---

# @lulu-ling/dsh-compaction-preference

English | [中文](README.zh.md)

## Summary

`dsh-compaction-preference` stores the automatic compaction method for the process. The shipped base profile mounts it as `context-compaction`. Settings → General → Context compaction edits `method`. The default is `soft`. Choosing `snapcompact` does not change a model that has not declared image input: automatic compaction still summarizes for that model. A `/compact` mode token does not write this setting.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The base bundle already mounts the plugin. Change the method from Settings → General → Context compaction, or by editing the user settings entry `context-compaction`.

### Minimal configuration

```yaml
- id: context-compaction
  name: '@lulu-ling/dsh-compaction-preference'
```

| Field | Default | Meaning |
|---|---|---|
| `method` | `soft` | `soft` summarizes. `snapcompact` archives when the routed model declares image input. |

Invalid values fail when the profile loads. The generated configuration catalog lists the accepted values.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The field is volatile, so a settings save updates the live value without remounting. The web preset isolates `ctx.compaction` but not this service, so the nested compaction engine reads `ctx.compactionPreference`.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The preference plugin |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Compaction subsystem](../../../docs/subsystems/compaction.md)
- [`/compact`](../command-compact/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through compaction-basic, which reads the saved method when it compacts.

#### KV Cache effect

None. Saving the method does not call a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The preference is process-wide. General settings does not hide `snapcompact` for a text-only model. The fallback happens when compaction runs.
- The row does not choose a frame shape.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
