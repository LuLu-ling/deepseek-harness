---
description: "Prompt-sound settings on the dsh web client's Plugins page: agent, permission, and error sounds."
kind: "package-reference"
---

# @lulu-ling/dsh-client-ui-settings-sounds

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Sound effects** under Built-in plugin settings. Three menus choose the sound for the agent, for permission requests, and for errors. Each menu starts at **None**. Highlighting or choosing a sound previews it. Nothing is written until **Save**.

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

The **Sound effects** card opens the page. **Agent** plays when a listed top-level session stops running. **Permissions** plays for a new approval request, at most once every five seconds for the same session. **Errors** plays for an agent error, including a session that is not on the list yet. A subagent completion or error stays silent. **None** on a row saves silence for that row. Leaving the page drops the draft.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half owns the `sounds` entry schema: three volatile strings, `agent`, `permissions`, and `errors`, each defaulting to `none` and limited to `none` or the 48 shipped ids. `apply` only calls `settings.configure({ auto: false })`, so no generated settings page is added. The browser half binds that namespace through `ctx.configForms.get`, keeps the staged form in `SoundsCardController`, and registers `SoundsCard` into `plugins.item` through `ctx.configForms.whileServed`. Playback reads the saved snapshot, not the draft, and subscribes to `api-session/status`, `api-session/error`, and `approval/request`. The page's copy lives in `settings.sounds`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and menu the page renders.

-----

<a id="model-experience"></a>
## Model Experience

None, as these three fields never enter a model request or the session log.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Browser prompt sounds only** — there is no system notification, volume control, or desktop-native playback.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
