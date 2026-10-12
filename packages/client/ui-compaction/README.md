---
description: "The web GUI for /compact and the saved automatic compaction method."
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-compaction

English | [中文](README.zh.md)

## Summary

Open a bare `/compact` in the web GUI to pick Summarize or Snapcompact for that one call. Snapcompact is omitted unless the selected model declares image input. Settings → General → Context compaction saves the automatic method as soon as it is chosen. The default display is Summarize.

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

The web profile mounts this package next to the host `/compact` command. Picking a row submits `/compact soft` or `/compact snapcompact`. The General settings row edits `context-compaction.method`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`. The browser half decorates the host command with `popupSelect` and registers a General settings row on `settings.general.item` while the Host serves `context-compaction`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [command-compact](../../compaction/command-compact/README.md)
- [compaction-preference](../../compaction/compaction-preference/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings and command surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **General settings does not hide Snapcompact.** The preference is process-wide. A text-only model still summarizes when compaction runs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
