---
description: "Capture a git worktree into an isolated snapshot and restore it when a session revert moves."
kind: "package-reference"
---

# @lulu-ling/dsh-session-file-snapshot

English | [中文](README.zh.md)

## Summary

This package captures the session working tree into a git directory under the data directory, separate from the user's repository. A capture runs before each turn and before each later step that admits a human message. Staging a revert rewrites only the paths that differ between the worktree at the first stage and the capture before the boundary message. Clearing the stage writes them back. The trees an open revert needs are saved beside the snapshots, so redo and further undo survive a restart. A directory that is not a git checkout, and `snapshots: false`, both capture nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
  - [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after `@lulu-ling/dsh-session-revert`. It attaches file restore to that service.

```yaml
- id: session-snapshot
  name: '@lulu-ling/dsh-session-file-snapshot'
  config:
    snapshots: true
```

`dataDir` overrides the snapshot root. The default is `$DSH_HOME/snapshot`, or `~/.dsh/snapshot` when `DSH_HOME` is unset. Files matching the worktree `.gitignore` are left out.

`historyLimit`, `diskLimitBytes`, `maxAgeMs`, `gcIntervalMs`, and `maxUntrackedBytes` are live and default to `100`, `5368709120` (5 GiB), `604800000` (7 days), `3600000` (1 hour), and `2097152` (2 MiB). `historyLimit` is how many trees one worktree keeps. `diskLimitBytes` is the maximum size, in bytes, of the snapshot root. `maxAgeMs` is how many milliseconds a tree is kept. `gcIntervalMs` is how many milliseconds pass between sweeps. `maxUntrackedBytes` is the largest untracked file, in bytes, that enters a tree. A sweep also runs after every capture. A tree an open revert is using stays, including one an earlier process saved. A remembered turn does not. The Plugins page lists the same five fields as **File snapshots** in the Official group. Saving applies on the next capture or sweep.

### How a revert moves files

Each capture is bound to its turn, or to the step that admitted the human message, in the snapshot directory. Before a stage overwrites a path the first-stage tree lacks, such as an untracked file that grew past `maxUntrackedBytes`, it adds that path's current bytes to the first-stage tree, so clear can write it back. Deletions run before writes, so a file that became a directory, or the reverse, comes back too. A turn tree the retention limits already deleted cannot be restored. A failed capture or restore logs a warning and leaves the message revert in place.

-----

<a id="model-experience"></a>
## Model Experience

None, as snapshots restore workspace files on disk and nothing enters a model request.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Prompt granularity.** A snapshot is taken before a turn and before each later step that admits a human message, not before every tool step. Undo at a non-human message restores its turn's snapshot.
- **Forks start without bindings.** A fork does not record its parent session, so undo at an inherited message moves the messages but not the files.
- **Edits made while undone.** Redo writes back every path the revert moved, over any edit made to that path while the stage was open.
- **Git only.** Other version-control directories are a no-op.
- **Ignored files stay.** `git clean` is not used, so ignored files such as `node_modules` are not deleted on restore.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`dsh-stages.json` holds, per session, the trees an open revert needs: the first-stage tree, extended with every path a stage overwrote, and the tree the moved paths currently match. A first stage drops any record a cleared or committed revert left behind. Retention reads the file in every snapshot directory, so a later process keeps those trees.

</details>
