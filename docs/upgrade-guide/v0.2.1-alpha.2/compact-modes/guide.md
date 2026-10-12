---
kind: upgrade-guide
description: "/compact now accepts soft or snapcompact, and automatic compaction can be saved as a setting."
---

# `/compact` accepts a method

English | [中文](guide.zh.md)

## Change

Before this release, `/compact` rejected every argument with `Usage: /compact (no arguments)`. A bare `/compact` still summarizes older history. `/compact soft` now summarizes for that one call, and `/compact snapcompact` archives that history onto images when the current model declares image input. Any other argument is `Usage: /compact [soft|snapcompact]`. A mode token does not change the saved preference.

The GUI's bare `/compact` opens a popup. Snapcompact is listed only when the selected model declares image input.

Automatic compaction reads the user setting `context-compaction.method` (`soft` or `snapcompact`, default `soft`). `snapcompact` is used automatically only when the routed model declares image input; otherwise automatic compaction stays a summary.

## Migration

1. Replace scripts that sent `/compact soft` and expected a usage error. `/compact` and `/compact soft` summarize. `/compact snapcompact` errors, and does not compact, unless the current model declares image input.
2. To change the automatic method, set `method` under the `context-compaction` settings entry to `soft` or `snapcompact`. Confirm in Settings → General → Context compaction, or by running a pressured turn on a model that declares image input and checking that the checkpoint user message contains image blocks.
