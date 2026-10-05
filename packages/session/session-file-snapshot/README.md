---
description: "Capture a git worktree into an isolated snapshot and restore it when a session revert moves."
kind: "package-reference"
---

# @lulu-ling/dsh-session-file-snapshot

English | [中文](README.zh.md)

## Summary

This package captures the session working tree into a git directory under the data directory, separate from the user's repository. The first pre-step of a turn records that tree. Staging a revert rewrites only the paths that differ between the tree captured at the first stage and the tree of the turn that contains the boundary. Clearing the stage writes those paths back. A directory that is not a git checkout, and `snapshots: false`, both capture nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

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

`historyLimit`, `diskLimitBytes`, `maxAgeMs`, `gcIntervalMs`, and `maxUntrackedBytes` are live and default to `100`, `5368709120` (5 GiB), `604800000` (7 days), `3600000` (1 hour), and `2097152` (2 MiB). `historyLimit` is how many trees one worktree keeps. `diskLimitBytes` is the maximum size, in bytes, of the snapshot root. `maxAgeMs` is how many milliseconds a tree is kept. `gcIntervalMs` is how many milliseconds pass between sweeps. `maxUntrackedBytes` is the largest untracked file, in bytes, that enters a tree. A sweep also runs after every capture. A tree an open revert is using stays. A remembered turn does not. The Plugins page lists the same five fields as **File snapshots** in the Official group. Saving applies on the next capture or sweep.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **Turn granularity.** One snapshot is taken at the first pre-step, not at each step.
- **Git only.** Other version-control directories are a no-op.
- **Ignored files stay.** `git clean` is not used, so ignored files such as `node_modules` are not deleted on restore.
