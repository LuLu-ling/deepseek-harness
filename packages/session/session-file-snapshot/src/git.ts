/**
 * Content-addressed worktree snapshots in a git directory that is not the
 * user's repository.
 * @module @lulu-ling/dsh-session-file-snapshot/git
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import type { Dirent, Stats } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

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

/**
 * Trees one open revert depends on. Saved beside the snapshot objects, so a
 * later process can still put the worktree back.
 */
export interface StageRecord {
  /** Worktree captured at the first stage, extended with every path a stage overwrote. */
  readonly outer: SnapshotId
  /** Tree the reverted paths currently match. Absent while they match `outer`. */
  readonly staged?: SnapshotId
}

/** Where snapshot git directories live. */
export function snapshotRoot(dataDir: string | undefined): string {
  if (dataDir !== undefined && dataDir !== '') return dataDir
  const home = process.env['DSH_HOME']
  if (home !== undefined && home !== '') return join(home, 'snapshot')
  return join(homedir(), '.dsh', 'snapshot')
}

/**
 * Repository toplevel that holds `directory`.
 * @param directory - any path.
 * @returns the toplevel, or undefined outside git or when git is not installed.
 */
export async function worktreeRoot(directory: string): Promise<string | undefined> {
  try {
    return (await git(directory, ['rev-parse', '--show-toplevel'], userEnv())).trim()
  } catch (error: unknown) {
    if (error instanceof GitError && (error.missing || /not a git repository/i.test(error.message))) return undefined
    throw error
  }
}

/**
 * Capture the worktree. Returns undefined when `directory` is not a git checkout.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param maxUntrackedBytes - skip untracked files larger than this.
 * @returns the tree id, or undefined outside git.
 */
export async function captureTree(
  directory: string,
  dataDir: string,
  maxUntrackedBytes: number,
): Promise<SnapshotId | undefined> {
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return undefined
  return lock(worktree, async () => {
    const repo = await ensureGitDir(worktree, dataDir)
    await stage(worktree, repo, maxUntrackedBytes)
    const id = asSnapshot((await git(worktree, ['write-tree'], repo.env)).trim())
    await lock(repo.gitDir, () => remember(repo, id, Date.now()))
    return id
  })
}

/**
 * Make the worktree match `snapshot`, including untracked files the snapshot does not contain.
 * @param directory - any path inside the project.
 * @param snapshot - a tree id previously returned by {@link captureTree}.
 * @param dataDir - parent of the isolated git directories.
 * @param maxUntrackedBytes - untracked files larger than this are left in place.
 */
export async function restoreTree(
  directory: string,
  snapshot: SnapshotId,
  dataDir: string,
  maxUntrackedBytes: number,
): Promise<void> {
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const { env } = await ensureGitDir(worktree, dataDir)
    await git(worktree, ['read-tree', asSnapshot(snapshot)], env)
    await git(worktree, ['checkout-index', '-a', '-f'], env)
    // The snapshot index now holds exactly the tree, so every listed path is one the tree lacks.
    const others = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], env)
    for (const relative of nulFields(others)) {
      const info = await lstatOrUndefined(join(worktree, relative))
      if (info?.isFile() !== true || info.size > maxUntrackedBytes) continue
      await rm(join(worktree, relative), { force: true })
    }
  })
}

/**
 * Make paths that differ between `from` and `to` match `to`.
 * Paths that are the same in both trees are not written. Deletions run first,
 * so a file that became a directory, or the reverse, can be written back.
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
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const { env } = await ensureGitDir(worktree, dataDir)
    const rows = await changedPaths(worktree, env, from, to)
    const checkout: string[] = []
    for (const row of rows) {
      if (row.status !== 'D') {
        checkout.push(row.path)
        continue
      }
      const absolute = join(worktree, row.path)
      const info = await lstatOrUndefined(absolute)
      // A directory here holds paths the other tree owns; those are checked out below.
      if (info === undefined || info.isDirectory()) continue
      await rm(absolute, { force: true })
      await removeEmptyParents(worktree, dirname(absolute))
    }
    const tree = asSnapshot(to)
    for (let index = 0; index < checkout.length; index += 100) {
      await git(worktree, ['--literal-pathspecs', 'checkout', tree, '--', ...checkout.slice(index, index + 100)], env)
    }
  })
}

/**
 * Extend `base` with the current bytes of every path `target` has and `base`
 * lacks, so moving the worktree from `base` to `target` overwrites nothing
 * that `base` cannot write back. Paths absent from disk are not added.
 * @param directory - any path inside the project.
 * @param base - tree a later restore returns to.
 * @param target - tree about to be written over the worktree.
 * @param dataDir - parent of the isolated git directories.
 * @returns `base` itself when nothing was missing, else the extended tree.
 */
export async function coverTree(
  directory: string,
  base: SnapshotId,
  target: SnapshotId,
  dataDir: string,
): Promise<SnapshotId> {
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return base
  return lock(worktree, async () => {
    const repo = await ensureGitDir(worktree, dataDir)
    const present: string[] = []
    for (const row of await changedPaths(worktree, repo.env, base, target)) {
      if (row.status !== 'A') continue
      const info = await lstatOrUndefined(join(worktree, row.path))
      if (info !== undefined && (info.isFile() || info.isSymbolicLink())) present.push(row.path)
    }
    if (present.length === 0) return base
    const index = join(repo.gitDir, `dsh-cover.${process.pid}.index`)
    const env = { ...repo.env, GIT_INDEX_FILE: index }
    try {
      await git(worktree, ['read-tree', asSnapshot(base)], env)
      for (let start = 0; start < present.length; start += 100) {
        // `--replace` lets a path that became a directory, or the reverse, replace the old entry.
        await git(worktree, ['update-index', '--add', '--replace', '--', ...present.slice(start, start + 100)], env)
      }
      const id = asSnapshot((await git(worktree, ['write-tree'], env)).trim())
      await lock(repo.gitDir, () => remember(repo, id, Date.now()))
      return id
    } finally {
      await rm(index, { force: true })
    }
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
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return []
  return lock(worktree, async () => {
    const { env } = await ensureGitDir(worktree, dataDir)
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

/** One path from `git diff --name-status`. */
interface ChangedPath {
  /** `A`, `D`, `M`, or `T`. */
  readonly status: string
  readonly path: string
}

async function changedPaths(
  worktree: string,
  env: NodeJS.ProcessEnv,
  from: SnapshotId,
  to: SnapshotId,
): Promise<ChangedPath[]> {
  const fields = nulFields(await git(worktree, [
    'diff', '--name-status', '--no-renames', '-z', asSnapshot(from), asSnapshot(to),
  ], env))
  const rows: ChangedPath[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    // oxlint-disable-next-line typescript/no-non-null-assertion -- the loop bound keeps both fields in range.
    rows.push({ status: fields[index]!.charAt(0), path: fields[index + 1]! })
  }
  return rows
}

/** Remove directories a deletion left empty, stopping below the worktree root. */
async function removeEmptyParents(worktree: string, directory: string): Promise<void> {
  for (let current = directory; current.length > worktree.length && current.startsWith(worktree); current = dirname(current)) {
    try {
      await rmdir(current)
    } catch {
      // A directory that still holds entries, or is already gone, ends the walk.
      return
    }
  }
}

function nulFields(text: string): string[] {
  return text.split('\0').filter(field => field !== '')
}

/** Path facts, or undefined when the path is absent or cannot be read, which every caller treats as absent. */
function lstatOrUndefined(path: string): Promise<Stats | undefined> {
  return lstat(path).catch(() => undefined)
}

const tails = new Map<string, Promise<void>>()

function lock<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve()
  const run = previous.then(job, job)
  tails.set(key, run.then(() => undefined, () => undefined))
  return run
}

/** The user's environment without git redirections, with git messages in English. */
function userEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' }
  delete env['GIT_DIR']
  delete env['GIT_WORK_TREE']
  delete env['GIT_INDEX_FILE']
  delete env['LANGUAGE']
  return env
}

/** One worktree's snapshot git directory and the environment that targets it. */
interface SnapshotRepo {
  readonly gitDir: string
  readonly env: NodeJS.ProcessEnv
}

async function ensureGitDir(worktree: string, dataDir: string): Promise<SnapshotRepo> {
  const gitDir = snapshotGitDir(worktree, dataDir)
  await mkdir(gitDir, { recursive: true })
  await writeFile(join(gitDir, 'dsh-worktree'), worktree)
  const env = { ...userEnv(), GIT_DIR: gitDir, GIT_WORK_TREE: worktree }
  if (await stat(join(gitDir, 'HEAD')).then(() => false, () => true)) {
    await git(worktree, ['init'], env)
    await git(worktree, ['config', 'core.autocrlf', 'false'], env)
  }
  return { gitDir, env }
}

/**
 * Directory that holds one worktree's snapshot objects.
 * The hash is the lookup key shared by capture and by a later process.
 * @param worktree - repository toplevel.
 * @param dataDir - parent of the isolated git directories.
 * @returns the git directory path.
 */
function snapshotGitDir(worktree: string, dataDir: string): string {
  const hash = createHash('sha256').update(worktree).digest('hex').slice(0, 20)
  return join(dataDir, hash)
}

/** The existing snapshot git directory for `directory`, without creating one. */
async function existingGitDir(directory: string, dataDir: string): Promise<{ worktree: string; gitDir: string } | undefined> {
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return undefined
  const gitDir = snapshotGitDir(worktree, dataDir)
  return await stat(join(gitDir, 'HEAD')).then(() => true, () => false) ? { worktree, gitDir } : undefined
}

const TURNS_NAME = 'dsh-turns.json'

/** Binding key for one turn, or for a later step that admitted a human message. */
function turnKey(sessionId: string, turn: number, step: number): string {
  return step <= 1 ? `${sessionId}:${turn}` : `${sessionId}:${turn}:${step}`
}

/**
 * Store which snapshot belongs to one session turn, or to one later step of it.
 * The binding lives in the snapshot git directory, so a later process can restore files.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param sessionId - session that opened the turn.
 * @param turn - turn number from `turn/start`.
 * @param id - tree captured before that turn, or that step, wrote files.
 * @param step - step number when a later step admitted a human message. Omitted means the turn.
 */
export async function recordTurnBinding(
  directory: string,
  dataDir: string,
  sessionId: string,
  turn: number,
  id: SnapshotId,
  step = 1,
): Promise<void> {
  if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('turn must be a non-negative safe integer')
  if (!Number.isSafeInteger(step) || step < 1) throw new Error('step must be a positive safe integer')
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const { gitDir } = await ensureGitDir(worktree, dataDir)
    await lock(gitDir, async () => {
      const turns = await readTurnFile(gitDir)
      turns.set(turnKey(sessionId, turn, step), id)
      await writeJson(join(gitDir, TURNS_NAME), Object.fromEntries(turns))
    })
  })
}

/**
 * Read the snapshot stored for one session turn, or for one later step of it.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param sessionId - session that opened the turn.
 * @param turn - turn number from `turn/start`.
 * @param step - step number of a later step. Omitted means the turn.
 * @returns the tree id, or undefined when the binding or the snapshot directory is absent.
 */
export async function readTurnBinding(
  directory: string,
  dataDir: string,
  sessionId: string,
  turn: number,
  step = 1,
): Promise<SnapshotId | undefined> {
  const found = await existingGitDir(directory, dataDir)
  if (found === undefined) return undefined
  const { worktree, gitDir } = found
  return lock(worktree, () => lock(gitDir, async () => (await readTurnFile(gitDir)).get(turnKey(sessionId, turn, step))))
}

async function readTurnFile(gitDir: string): Promise<Map<string, SnapshotId>> {
  const parsed = await readJson(join(gitDir, TURNS_NAME))
  const turns = new Map<string, SnapshotId>()
  if (!isRecord(parsed)) return turns
  for (const [key, value] of Object.entries(parsed)) {
    if (!isTreeHash(value)) continue
    const turn = Number(key.slice(key.lastIndexOf(':') + 1))
    if (!key.includes(':') || !Number.isSafeInteger(turn) || turn < 0) continue
    turns.set(key, asSnapshot(value))
  }
  return turns
}

const STAGES_NAME = 'dsh-stages.json'

/**
 * Save, or with `undefined` drop, the trees one session's open revert depends on.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param sessionId - session whose revert is open.
 * @param record - trees to keep, or undefined once the revert is cleared or committed.
 */
export async function writeStageRecord(
  directory: string,
  dataDir: string,
  sessionId: string,
  record: StageRecord | undefined,
): Promise<void> {
  const worktree = await worktreeRoot(directory)
  if (worktree === undefined) return
  await lock(worktree, async () => {
    const { gitDir } = await ensureGitDir(worktree, dataDir)
    await lock(gitDir, async () => {
      const records = await readStageFile(gitDir)
      if (record === undefined) {
        if (!records.delete(sessionId)) return
      } else {
        records.set(sessionId, record)
      }
      await writeJson(join(gitDir, STAGES_NAME), Object.fromEntries(records))
    })
  })
}

/**
 * Read the trees one session's open revert depends on.
 * @param directory - any path inside the project.
 * @param dataDir - parent of the isolated git directories.
 * @param sessionId - session whose revert is open.
 * @returns the saved trees, or undefined when none were saved.
 */
export async function readStageRecord(
  directory: string,
  dataDir: string,
  sessionId: string,
): Promise<StageRecord | undefined> {
  const found = await existingGitDir(directory, dataDir)
  if (found === undefined) return undefined
  const { worktree, gitDir } = found
  return lock(worktree, () => lock(gitDir, async () => (await readStageFile(gitDir)).get(sessionId)))
}

async function readStageFile(gitDir: string): Promise<Map<string, StageRecord>> {
  const parsed = await readJson(join(gitDir, STAGES_NAME))
  const records = new Map<string, StageRecord>()
  if (!isRecord(parsed)) return records
  for (const [sessionId, value] of Object.entries(parsed)) {
    if (!isRecord(value) || !isTreeHash(value['outer'])) continue
    const staged = value['staged']
    if (staged !== undefined && !isTreeHash(staged)) continue
    records.set(sessionId, {
      outer: asSnapshot(value['outer']),
      ...staged === undefined ? {} : { staged: asSnapshot(staged) },
    })
  }
  return records
}

/** Tree ids an open revert in this snapshot directory still needs. */
async function stagePins(gitDir: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const record of (await readStageFile(gitDir)).values()) {
    ids.add(record.outer)
    if (record.staged !== undefined) ids.add(record.staged)
  }
  return ids
}

async function readJson(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isMissing(error)) return undefined
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    // A torn or hand-edited file reads as empty instead of blocking every capture.
    return undefined
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, JSON.stringify(value))
  await rename(temporary, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTreeHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value)
}

async function stage(worktree: string, repo: SnapshotRepo, maxUntrackedBytes: number): Promise<void> {
  const large: string[] = []
  const untracked = await git(worktree, ['ls-files', '--others', '--exclude-standard', '-z'], userEnv())
  for (const relative of nulFields(untracked)) {
    const info = await lstatOrUndefined(join(worktree, relative))
    if (info?.isFile() === true && info.size > maxUntrackedBytes) large.push(relative)
  }
  if (large.length === 0) {
    await git(worktree, ['add', '-A'], repo.env)
    return
  }
  // Excluding the oversized paths keeps their bytes out of the object store entirely.
  const pathspecs = join(repo.gitDir, `dsh-add.${process.pid}.pathspec`)
  await writeFile(pathspecs, ['.', ...large.map(path => `:(exclude,literal)${path}`)].join('\0'))
  try {
    await git(worktree, ['add', '-A', `--pathspec-from-file=${pathspecs}`, '--pathspec-file-nul'], repo.env)
  } finally {
    await rm(pathspecs, { force: true })
  }
  // A path that was small at an earlier capture may still sit in the snapshot index.
  for (let start = 0; start < large.length; start += 100) {
    await git(worktree, [
      '--literal-pathspecs', 'rm', '--cached', '-q', '-f', '--ignore-unmatch', '--', ...large.slice(start, start + 100),
    ], repo.env)
  }
}

function asSnapshot(value: string): SnapshotId {
  if (!isTreeHash(value)) throw new Error(`snapshot id must be a git tree hash, got ${JSON.stringify(value)}`)
  return brandString<SnapshotId>(value)
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

/** A failed git invocation. `missing` is true when the git executable was not found. */
class GitError extends Error {
  override readonly name = 'GitError'

  constructor(message: string, readonly missing: boolean, options: ErrorOptions) {
    super(message, options)
  }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const failed = (detail: string, error: unknown, missing: boolean): void => {
    reject(new GitError(`git ${args.join(' ')} failed: ${detail}`, missing, { cause: error }))
  }
  try {
    execFile('git', args, { cwd, env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) failed(stderr.trim() || error.message, error, error.code === 'ENOENT')
      else resolve(stdout)
    })
  } catch (error: unknown) {
    // Spawn reports errors other than a missing executable, such as a cwd that is a file, by throwing.
    failed(String(error), error, false)
  }
  return promise
}

/** One retained snapshot tree and the time it was last captured. */
interface RecordedSnapshot {
  readonly id: SnapshotId
  readonly at: number
}

/** Limits for {@link collectSnapshots}. */
export interface SnapshotRetention {
  /** Maximum trees kept for one worktree. */
  readonly historyLimit: number
  /** Maximum bytes of the snapshot root. */
  readonly diskLimitBytes: number
  /** Maximum age in milliseconds. */
  readonly maxAgeMs: number
  /** Tree ids an operation in this process still needs. Saved open reverts are always kept. */
  readonly pinned: ReadonlySet<string>
  /** Clock reading used for age. */
  readonly now: number
}

const HISTORY_NAME = 'dsh-history.json'
/** Far-future cutoff so a just-written loose object is still eligible. */
const PRUNE_EXPIRE = '2099-01-01'

/**
 * Delete snapshot trees that exceed the configured count, age, or disk limit.
 * A tree listed in `pinned`, or saved for an open revert, stays.
 * @param dataDir - parent of the isolated git directories.
 * @param options - limits and the trees that must stay.
 */
export async function collectSnapshots(dataDir: string, options: SnapshotRetention): Promise<void> {
  const repos = await snapshotRepos(dataDir)
  for (const gitDir of repos) await expireRepo(gitDir, options)
  // Each pass drops one history row, so the loop ends once only pinned trees remain.
  while (await directoryBytes(dataDir) > options.diskLimitBytes) {
    const oldest = await oldestUnpinned(repos, options.pinned)
    if (oldest === undefined) return
    await dropOne(oldest.gitDir, oldest.id)
  }
}

/** Process pins plus the trees saved open reverts in `gitDir` depend on. */
async function repoPins(gitDir: string, pinned: ReadonlySet<string>): Promise<ReadonlySet<string>> {
  const saved = await stagePins(gitDir)
  if (saved.size === 0) return pinned
  for (const id of pinned) saved.add(id)
  return saved
}

async function expireRepo(gitDir: string, options: SnapshotRetention): Promise<void> {
  await lockSnapshot(gitDir, async () => {
    const pinned = await repoPins(gitDir, options.pinned)
    const dropped: RecordedSnapshot[] = []
    const kept: RecordedSnapshot[] = []
    for (const row of dedupe(await readHistory(gitDir))) {
      if (!pinned.has(row.id) && options.now - row.at > options.maxAgeMs) dropped.push(row)
      else kept.push(row)
    }
    while (kept.length > options.historyLimit) {
      const index = kept.findIndex(row => !pinned.has(row.id))
      if (index < 0) break
      dropped.push(...kept.splice(index, 1))
    }
    if (dropped.length === 0) return
    await writeHistory(gitDir, kept)
    await removeObjects(gitDir, dropped.map(row => row.id))
  })
}

/** Drop one tree. Dropping a tree another sweep already removed only rewrites the history. */
async function dropOne(gitDir: string, id: string): Promise<void> {
  await lockSnapshot(gitDir, async () => {
    await writeHistory(gitDir, dedupe(await readHistory(gitDir)).filter(row => row.id !== id))
    await removeObjects(gitDir, [id])
  })
}

async function oldestUnpinned(
  repos: readonly string[],
  globalPins: ReadonlySet<string>,
): Promise<{ gitDir: string; id: string } | undefined> {
  let best: { gitDir: string; id: string; at: number } | undefined
  for (const gitDir of repos) {
    const pinned = await repoPins(gitDir, globalPins)
    for (const row of dedupe(await readHistory(gitDir))) {
      if (pinned.has(row.id)) continue
      if (best === undefined || row.at < best.at) best = { gitDir, id: row.id, at: row.at }
    }
  }
  return best === undefined ? undefined : { gitDir: best.gitDir, id: best.id }
}

async function removeObjects(gitDir: string, ids: readonly string[]): Promise<void> {
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

/** Add `id` to the history and give it a ref. Recapturing a tree refreshes its time. The caller holds the git dir lock. */
async function remember(repo: SnapshotRepo, id: SnapshotId, at: number): Promise<void> {
  const records = dedupe(await readHistory(repo.gitDir)).filter(row => row.id !== id)
  records.push({ id, at })
  await writeHistory(repo.gitDir, records)
  await git(repo.gitDir, ['update-ref', `refs/dsh/${id}`, id], repo.env)
}

/**
 * Serialize retention with capture. Capture holds the worktree lock, then the git dir.
 * A git dir whose worktree file is missing or empty is keyed by itself.
 */
async function lockSnapshot(gitDir: string, job: () => Promise<void>): Promise<void> {
  const worktree = await readFile(join(gitDir, 'dsh-worktree'), 'utf8').then(text => text.trim(), () => '')
  await lock(worktree || `${gitDir}#worktree`, () => lock(gitDir, job))
}

/** Directory entries, or none when the directory is absent or unreadable. */
function entriesOf(directory: string): Promise<Dirent[]> {
  return readdir(directory, { withFileTypes: true }).catch(() => [])
}

async function snapshotRepos(dataDir: string): Promise<string[]> {
  const repos: string[] = []
  for (const entry of await entriesOf(dataDir)) {
    if (!entry.isDirectory()) continue
    const gitDir = join(dataDir, entry.name)
    if (await stat(join(gitDir, 'HEAD')).then(() => true, () => false)) repos.push(gitDir)
  }
  return repos
}

async function directoryBytes(root: string): Promise<number> {
  let total = 0
  const pending = [root]
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    const entries = await entriesOf(current)
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      // A file another process prunes mid-walk fails this sweep; the next one retries.
      else total += (await lstat(path)).size
    }
  }
  return total
}

async function readHistory(gitDir: string): Promise<RecordedSnapshot[]> {
  const parsed = await readJson(join(gitDir, HISTORY_NAME))
  if (!Array.isArray(parsed)) return []
  const rows: RecordedSnapshot[] = []
  for (const item of parsed) {
    if (!isRecord(item)) continue
    const { id, at } = item
    if (!isTreeHash(id) || typeof at !== 'number' || !Number.isFinite(at)) continue
    rows.push({ id: asSnapshot(id), at })
  }
  return rows
}

async function writeHistory(gitDir: string, records: readonly RecordedSnapshot[]): Promise<void> {
  await writeJson(join(gitDir, HISTORY_NAME), records)
}

function dedupe(rows: readonly RecordedSnapshot[]): RecordedSnapshot[] {
  const byId = new Map<string, RecordedSnapshot>()
  for (const row of rows) {
    const previous = byId.get(row.id)
    if (previous === undefined || row.at >= previous.at) byId.set(row.id, row)
  }
  return [...byId.values()].sort((left, right) => left.at - right.at)
}
