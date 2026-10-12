---
description: "Turn a discarded conversation span into PNG frames a vision model can read, without calling a summary model."
kind: "package-library"
---

# @lulu-ling/dsh-snapcompact

English | [中文](README.zh.md)

## Summary

`dsh-snapcompact` lets compaction print older history onto PNG frames instead of asking a model to summarize it. `compaction-basic` calls `compactSnapcompact` for a manual `/compact snapcompact` and for automatic compaction when the saved method is `snapcompact` and the routed model declares image input. The caller admits the PNG bytes through the attachment service and puts the image blocks on the replacement user message. Shape selection follows the model id. There is no shape setting.

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

Import it from `compaction-basic`. Do not mount it in `cordis.yml`.

```ts
import { compactSnapcompact } from '@lulu-ling/dsh-snapcompact'

const archive = await compactSnapcompact({
  messages,
  model: { api: 'anthropic', id: 'claude-opus-4-7' },
  includeThinking: false,
  maxFrames: 4,
  filePaths: [],
})
```

`archive.blocks` is text, then PNG frames, then text. `archive.summary` is the reading instructions. `archive.sourceText` is what a later pass unfolds. A pass that does not shrink the priced context must not be committed.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shape table, transcript prefixes, and foveated layout follow the snapcompact algorithm. Frames are rasterized in TypeScript from the bundled public-domain pixel fonts and the CC BY 4.0 Silver font.

| File | Role |
|---|---|
| [`src/archive.ts`](src/archive.ts) | Shape resolution, transcript, layout, and `compactSnapcompact` |
| [`src/raster.ts`](src/raster.ts) | PNG rasterizer |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Compaction subsystem](../../../docs/subsystems/compaction.md)
- [compaction-basic](../compaction-basic/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through compaction-basic, which admits the frames and reading instructions onto the replacement user message.

#### KV Cache effect

None. The archive is local and does not call a model.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- There is no user-facing shape picker. Resolution stays automatic.
- A model that has not declared image input cannot use the archive. Automatic compaction falls back to a summary; a manual snapcompact call fails.
- The TypeScript rasterizer matches the frame geometry used in production shapes. It does not ship a native addon.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
