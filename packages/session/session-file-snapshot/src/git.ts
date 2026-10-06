/**
 * Content-addressed worktree snapshots in a git directory that is not the
 * user's repository.
 * @module @deepseek-ai/dsh-session-snapshot/git
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Untracked files larger than this stay out of the snapshot. */
export const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024

/** One git tree id. */
export type SnapshotId = Branded<'SnapshotId'>

/** Additions and deletions between two snapshots. */
export interface FileDiff {
  readonly path: string
  readonly additions: number
  readonly deletions: number
}

/** Where snapshot git directories live. */
export function snapshotRoot(dataDir: string | undefined): string {
  if (dataDir !== undefined && dataDir !== '') return dataDir
  const home = process.env['DSH_HOME']
  if (home !== undefined && home !== '') return join(home, 'snapshot')
  return join(homedir(), '.dsh', 'snapshot')
}

/**
 * Capture the worktree. Returns undefined when `directory` is not a git checkout.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param maxUntrackedBytes - skip untracked files larger than this. Omitted means no size limit.
 * @returns the tree id, or undefined outside git.
 */
export async function captureTree(
  directory: string,
  dataDir: string,
  maxUntrackedBytes: number | undefined,
): Promise<SnapshotId | undefined> {
  const worktree = await toplevel(directory)
  if (worktree === undefined) return undefined
  return lock(worktree, async () => {
    const env = await ensureGitDir(worktree, dataDir)
    await stage(worktree, env, maxUntrackedBytes)
    const hash = (await git(worktree, ['write-tree'], env)).trim()
    const id = asSnapshot(hash)
    const gitDir = env['GIT_DIR']
    if (gitDir !== undefined) await remember(gitDir, env, id, Date.now())
    return id
  })
}

/**
 * Make the worktree match `snapshot`, including untracked files the snapshot does not contain.
 * @param directory - any path inside the project.
 * @param snapshot - a tree id previously returned by {@link captureTree}.
 * @param dataDir - parent of the isolated git directories.
 * @param maxUntrackedBytes - untracked files larger than this are left in place. Omitted means no size limit.
 */
export async function restoreTree(
  directory: string,
  snapshot: SnapshotId,
  dataDir: string,
  maxUntrackedBytes: number | undefined,
): Promise<void> {
  const worktree = await toplevel(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const env = await ensureGitDir(worktree, dataDir)
    const tree = asSnapshot(snapshot)
    await git(worktree, ['read-tree', tree], env)
    await git(worktree, ['checkout-index', '-a', '-f'], env)
    const listed = await git(worktree, ['ls-tree', '-r', '--name-only', '-z', tree], env)
    const kept = new Set(listed.split('\0').filter(name => name !== ''))
    const others = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], env)
    for (const relative of others.split('\0')) {
      if (relative === '' || kept.has(relative)) continue
      const absolute = join(worktree, relative)
      const info = await stat(absolute).catch((error: unknown) => {
        if (isMissing(error)) return undefined
        throw error
      })
      if (info === undefined || !info.isFile()) continue
      if (maxUntrackedBytes !== undefined && info.size > maxUntrackedBytes) continue
      await rm(absolute, { force: true })
    }
  })
}

/**
 * Make paths that differ between `from` and `to` match `to`.
 * Paths that are the same in both trees are not written.
 * @param directory - any path inside the project.
 * @param from - tree the differing paths are moving away from.
 * @param to - tree those paths should match.
 * @param dataDir - parent of the isolated git directories.
 */
export async function restoreChanged(
  directory: string,
  from: SnapshotId,
  to: SnapshotId,
  dataDir: string,
): Promise<void> {
  const worktree = await toplevel(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const env = await ensureGitDir(worktree, dataDir)
    const text = await git(worktree, [
      'diff', '--name-status', '--no-renames', '-z', asSnapshot(from), asSnapshot(to),
    ], env)
    const fields = text.split('\0')
    if (fields.at(-1) === '') fields.pop()
    const checkout: string[] = []
    const remove: string[] = []
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const status = fields[index]
      const path = fields[index + 1]
      if (status === undefined || path === undefined || path === '') continue
      if (status.startsWith('D')) remove.push(path)
      else checkout.push(path)
    }
    const tree = asSnapshot(to)
    for (let index = 0; index < checkout.length; index += 100) {
      await git(worktree, ['checkout', tree, '--', ...checkout.slice(index, index + 100)], env)
    }
    for (const relative of remove) await rm(join(worktree, relative), { force: true })
  })
}

/**
 * Summarize `git diff --numstat` from one tree to another.
 * @param directory - any path inside the project.
 * @param from - older tree.
 * @param to - newer tree.
 * @param dataDir - parent of the isolated git directories.
 * @returns one row per changed path.
 */
export async function diffTrees(
  directory: string,
  from: SnapshotId,
  to: SnapshotId,
  dataDir: string,
): Promise<FileDiff[]> {
  const worktree = await toplevel(directory)
  if (worktree === undefined) return []
  return lock(worktree, async () => {
    const env = await ensureGitDir(worktree, dataDir)
    const text = await git(worktree, ['diff', '--numstat', asSnapshot(from), asSnapshot(to)], env)
    return text.split('\n').flatMap((line) => {
      const [additions, deletions, path] = line.split('\t')
      if (path === undefined || additions === undefined || deletions === undefined) return []
      return [{
        path,
        additions: additions === '-' ? 0 : Number(additions),
        deletions: deletions === '-' ? 0 : Number(deletions),
      }]
    })
  })
}

const tails = new Map<string, Promise<void>>()

function lock<T>(worktree: string, job: () => Promise<T>): Promise<T> {
  const previous = tails.get(worktree) ?? Promise.resolve()
  const run = previous.then(job, job)
  tails.set(worktree, run.then(() => undefined, () => undefined))
  return run
}

function userEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env['GIT_DIR']
  delete env['GIT_WORK_TREE']
  return env
}

async function toplevel(directory: string): Promise<string | undefined> {
  try {
    const text = await git(directory, ['rev-parse', '--show-toplevel'], userEnv())
    const found = text.trim()
    return found === '' ? undefined : found
  } catch (error: unknown) {
    if (error instanceof Error && /not a git repository/i.test(error.message)) return undefined
    throw error
  }
}

async function ensureGitDir(worktree: string, dataDir: string): Promise<NodeJS.ProcessEnv> {
  const hash = createHash('sha256').update(worktree).digest('hex').slice(0, 20)
  const gitDir = join(dataDir, hash)
  await mkdir(gitDir, { recursive: true })
  await writeFile(join(gitDir, 'dsh-worktree'), worktree)
  const env = { ...userEnv(), GIT_DIR: gitDir, GIT_WORK_TREE: worktree }
  try {
    await git(worktree, ['rev-parse', '--git-dir'], env)
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error
    await git(worktree, ['init'], env)
    await git(worktree, ['config', 'core.autocrlf', 'false'], env)
  }
  return env
}

async function stage(worktree: string, env: NodeJS.ProcessEnv, maxUntrackedBytes: number | undefined): Promise<void> {
  const large: string[] = []
  if (maxUntrackedBytes !== undefined) {
    const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], userEnv())
    for (const relative of untracked.split('\0')) {
      if (relative === '') continue
      const info = await stat(join(worktree, relative)).catch((error: unknown) => {
        if (isMissing(error)) return undefined
        throw error
      })
      if (info?.isFile() && info.size > maxUntrackedBytes) large.push(relative)
    }
  }
  await git(worktree, ['add', '-A'], env)
  if (large.length > 0) await git(worktree, ['rm', '--cached', '-f', '--ignore-unmatch', '--', ...large], env)
}

function asSnapshot(value: string): SnapshotId {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`snapshot id must be a git tree hash, got "${value}"`)
  return brandString<SnapshotId>(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  execFile('git', args, { cwd, env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim() || error.message}`))
      return
    }
    resolve(stdout)
  })
  return promise
}

/** One retained snapshot tree and the time it was last captured. */
interface RecordedSnapshot {
  readonly id: SnapshotId
  readonly at: number
}

/** Limits for {@link collectSnapshots}. An omitted field is not applied. */
export interface SnapshotRetention {
  /** Maximum trees kept for one worktree. */
  readonly historyLimit?: number
  /** Maximum bytes of the snapshot root. */
  readonly diskLimitBytes?: number
  /** Maximum age in milliseconds. */
  readonly maxAgeMs?: number
  /** Tree ids that an open revert or a remembered turn still needs. */
  readonly pinned?: ReadonlySet<string>
  /** Clock reading used for age. Defaults to `Date.now()`. */
  readonly now?: number
}

const HISTORY_NAME = 'dsh-history.json'
/** Far-future cutoff so a just-written loose object is still eligible. */
const PRUNE_EXPIRE = '2099-01-01'

/**
 * Remember `id` in the worktree's snapshot git directory.
 * Recapturing the same tree refreshes its time.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param id - tree returned by {@link captureTree}.
 * @param at - capture time in epoch milliseconds.
 */
export async function recordSnapshot(directory: string, dataDir: string, id: SnapshotId, at: number): Promise<void> {
  const worktree = await toplevel(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const env = await ensureGitDir(worktree, dataDir)
    const gitDir = env['GIT_DIR']
    if (gitDir === undefined) return
    await lock(gitDir, async () => {
      await remember(gitDir, env, id, at)
    })
  })
}

/**
 * Delete snapshot trees that exceed the configured count, age, or disk limit.
 * A tree listed in `pinned` stays. When every limit is omitted, this returns
 * without reading the snapshot root.
 * @param dataDir - parent of the isolated git directories.
 * @param options - limits and the trees that must stay.
 */
export async function collectSnapshots(dataDir: string, options: SnapshotRetention): Promise<void> {
  if (options.historyLimit === undefined && options.diskLimitBytes === undefined && options.maxAgeMs === undefined) return
  const now = options.now ?? Date.now()
  const pinned = options.pinned ?? new Set<string>()
  const repos = await snapshotRepos(dataDir)
  for (const gitDir of repos) await expireRepo(gitDir, options, pinned, now)
  if (options.diskLimitBytes === undefined) return
  const skipped = new Set<string>()
  while (await directoryBytes(dataDir) > options.diskLimitBytes) {
    const oldest = await oldestUnpinned(repos, pinned)
    if (oldest === undefined || skipped.has(oldest.id)) return
    const dropped = await dropOne(oldest.gitDir, oldest.id, pinned)
    if (!dropped) skipped.add(oldest.id)
  }
}

async function expireRepo(
  gitDir: string,
  options: SnapshotRetention,
  pinned: ReadonlySet<string>,
  now: number,
): Promise<void> {
  await lockSnapshot(gitDir, async () => {
    const sorted = dedupe(await readHistory(gitDir))
    const dropped: RecordedSnapshot[] = []
    const aged: RecordedSnapshot[] = []
    for (const row of sorted) {
      const expired = options.maxAgeMs !== undefined && !pinned.has(row.id) && now - row.at > options.maxAgeMs
      if (expired) dropped.push(row)
      else aged.push(row)
    }
    const kept = [...aged]
    if (options.historyLimit !== undefined) {
      while (kept.length > options.historyLimit) {
        const index = kept.findIndex(row => !pinned.has(row.id))
        if (index < 0) break
        const removed = kept.splice(index, 1)[0]
        if (removed !== undefined) dropped.push(removed)
      }
    }
    if (dropped.length === 0) return
    await writeHistory(gitDir, kept)
    await removeObjects(gitDir, dropped.map(row => row.id))
  })
}

async function dropOne(gitDir: string, id: string, pinned: ReadonlySet<string>): Promise<boolean> {
  return lockSnapshot(gitDir, async () => {
    if (pinned.has(id)) return false
    const records = dedupe(await readHistory(gitDir))
    if (!records.some(row => row.id === id)) return false
    await writeHistory(gitDir, records.filter(row => row.id !== id))
    await removeObjects(gitDir, [id])
    return true
  })
}

async function oldestUnpinned(
  repos: readonly string[],
  pinned: ReadonlySet<string>,
): Promise<{ gitDir: string; id: string } | undefined> {
  let best: { gitDir: string; id: string; at: number } | undefined
  for (const gitDir of repos) {
    for (const row of dedupe(await readHistory(gitDir))) {
      if (pinned.has(row.id)) continue
      if (best === undefined || row.at < best.at) best = { gitDir, id: row.id, at: row.at }
    }
  }
  return best === undefined ? undefined : { gitDir: best.gitDir, id: best.id }
}

async function removeObjects(gitDir: string, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const env = gitDirEnv(gitDir)
  for (const id of ids) await git(gitDir, ['update-ref', '-d', `refs/dsh/${id}`], env)
  await git(gitDir, ['reflog', 'expire', '--expire=now', '--expire-unreachable=now', '--all'], env)
  // The snapshot index is not the user's. Emptying it lets prune delete a tree that was still checked out there.
  await git(gitDir, ['read-tree', '--empty'], env)
  await git(gitDir, ['prune', '--expire', PRUNE_EXPIRE], env)
}

function gitDirEnv(gitDir: string): NodeJS.ProcessEnv {
  return { ...userEnv(), GIT_DIR: gitDir }
}

async function remember(gitDir: string, env: NodeJS.ProcessEnv, id: SnapshotId, at: number): Promise<void> {
  const records = dedupe(await readHistory(gitDir)).filter(row => row.id !== id)
  records.push({ id, at })
  await writeHistory(gitDir, records)
  await git(gitDir, ['update-ref', `refs/dsh/${id}`, id], env)
}

/** Serialize retention with capture. Capture holds the worktree lock, then the git dir. */
async function lockSnapshot<T>(gitDir: string, job: () => Promise<T>): Promise<T> {
  const worktree = await readWorktree(gitDir)
  if (worktree === undefined) return lock(gitDir, job)
  return lock(worktree, () => lock(gitDir, job))
}

async function readWorktree(gitDir: string): Promise<string | undefined> {
  try {
    const text = (await readFile(join(gitDir, 'dsh-worktree'), 'utf8')).trim()
    return text === '' ? undefined : text
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw error
  }
}

async function snapshotRepos(dataDir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dataDir, { withFileTypes: true })
  } catch (error: unknown) {
    if (isMissing(error)) return []
    throw error
  }
  const repos: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const gitDir = join(dataDir, entry.name)
    try {
      await stat(join(gitDir, 'HEAD'))
    } catch (error: unknown) {
      if (isMissing(error)) continue
      throw error
    }
    repos.push(gitDir)
  }
  return repos
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) break
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error: unknown) {
      if (isMissing(error)) continue
      throw error
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) total += (await stat(path)).size
    }
  }
  return total
}

async function readHistory(gitDir: string): Promise<RecordedSnapshot[]> {
  try {
    const text = await readFile(join(gitDir, HISTORY_NAME), 'utf8')
    return parseHistory(text)
  } catch (error: unknown) {
    if (isMissing(error)) return []
    throw error
  }
}

function parseHistory(text: string): RecordedSnapshot[] {
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) return []
  const rows: RecordedSnapshot[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const id = 'id' in item ? item.id : undefined
    const at = 'at' in item ? item.at : undefined
    if (typeof id !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) continue
    if (!/^[0-9a-f]{40}$/.test(id)) continue
    rows.push({ id: asSnapshot(id), at })
  }
  return rows
}

async function writeHistory(gitDir: string, records: readonly RecordedSnapshot[]): Promise<void> {
  const path = join(gitDir, HISTORY_NAME)
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(records))
  await rename(temporary, path)
}

function dedupe(rows: readonly RecordedSnapshot[]): RecordedSnapshot[] {
  const byId = new Map<string, RecordedSnapshot>()
  for (const row of rows) {
    const previous = byId.get(row.id)
    if (previous === undefined || row.at >= previous.at) byId.set(row.id, row)
  }
  return [...byId.values()].sort((left, right) => left.at - right.at)
}
