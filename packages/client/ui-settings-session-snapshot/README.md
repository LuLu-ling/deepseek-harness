---
description: "The file-snapshot settings page on the dsh web client's Plugins page: how many worktree snapshots a revert keeps, how often they are swept, and how large an untracked file may be."
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-settings-session-snapshot

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **File snapshots** in the Official group to set how many snapshot trees one worktree keeps, how large the snapshot root may grow, how long a tree is kept, how often a timed sweep runs, and how large an untracked file may be before it is left out. The page stages what is typed and writes it only on save. Until overridden, the five fields show `100`, `5368709120`, `604800000`, `3600000`, and `2097152`. The page exists while the Host serves the `session-snapshot` entry.

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

The **File snapshots** card in the Official group opens the page. **Trees kept**, **Disk cap (bytes)**, **Keep for (ms)**, **Sweep interval (ms)**, and **Untracked file cap (bytes)** each render the effective value. A field the user overrode carries an **Overridden** badge with **Reset to default** beside it. Nothing is written until **Save**. Leaving the page drops the drafts. Clearing a field and saving returns it to `100`, `5368709120`, `604800000`, `3600000`, or `2097152`. Text that is not a number blocks the save and says so under the field. A saved value applies on the next capture, restore, or sweep.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `session-snapshot` entry through `ctx.configForms.get`, keeps the staged form in `SnapshotCardController` over the shared `SettingsFormModel` of `ui-primitives`, and registers `SnapshotCard` into the Plugins page's `plugins.item` slot through `ctx.configForms.whileServed`. The page's copy lives in this package's `settings.sessionSnapshot` dictionary. The `SettingsForm` frame takes its copy as props.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [session-file-snapshot](../../session/session-file-snapshot/README.md) — the plugin that owns the `session-snapshot` entry.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The page edits limits only** — `snapshots` and `dataDir` stay in the entry config. Turning snapshots off, or moving the snapshot root, is not on this page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
