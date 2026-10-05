import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionRevertService from '@lulu-ling/dsh-session-revert'
import SessionSnapshotService, { DEFAULT_DISK_LIMIT_BYTES, DEFAULT_GC_INTERVAL_MS, DEFAULT_HISTORY_LIMIT, DEFAULT_MAX_AGE_MS, MAX_UNTRACKED_BYTES } from '@lulu-ling/dsh-session-file-snapshot'

const dirs: string[] = []

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, windowsHide: true })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function gitDirOf(dataDir: string): string {
  const name = readdirSync(dataDir).find(entry => statSync(join(dataDir, entry)).isDirectory())
  if (name === undefined) throw new Error(`no snapshot git dir in ${dataDir}`)
  return join(dataDir, name)
}

function objectExists(dataDir: string, id: string): boolean {
  try {
    execFileSync('git', ['--git-dir', gitDirOf(dataDir), 'cat-file', '-e', id], { windowsHide: true, stdio: 'ignore' })
    return true
  } catch (error: unknown) {
    // cat-file exits non-zero when the object was pruned.
    if (!(error instanceof Error)) throw error
    return false
  }
}

function backdate(dataDir: string, at: number): void {
  const path = join(gitDirOf(dataDir), 'dsh-history.json')
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(parsed)) throw new Error('snapshot history is not a list')
  const next = parsed.map((item) => {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string') {
      throw new Error('snapshot history row is missing id')
    }
    return { id: item.id, at }
  })
  writeFileSync(path, JSON.stringify(next))
}


async function mounted(
  repo: string,
  dataDir: string,
  config: {
    historyLimit?: number
    diskLimitBytes?: number
    maxAgeMs?: number
    gcIntervalMs?: number
    maxUntrackedBytes?: number
  } = {},
): Promise<{ ctx: Context; agent: Agent; snapshots: SessionSnapshotService }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionRevertService)
  await ctx.plugin(SessionSnapshotService, { snapshots: true, dataDir, ...config })
  const session = ctx.sessions.create(SessionId(`snap-${repo.slice(-6)}`), { meta: { cwd: repo } })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    ctx,
    get status(): Agent['status'] { return 'idle' },
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(agent)
  return { ctx, agent, snapshots: ctx.sessionSnapshots }
}

describe('session snapshots', () => {
  it('fills count, disk, age, sweep, and untracked defaults', () => {
    const config = SessionSnapshotService.Config({ dataDir: 'x' })
    expect(config.snapshots).toBe(true)
    expect(config.historyLimit.get()).toBe(DEFAULT_HISTORY_LIMIT)
    expect(config.diskLimitBytes.get()).toBe(DEFAULT_DISK_LIMIT_BYTES)
    expect(config.maxAgeMs.get()).toBe(DEFAULT_MAX_AGE_MS)
    expect(config.gcIntervalMs.get()).toBe(DEFAULT_GC_INTERVAL_MS)
    expect(config.maxUntrackedBytes.get()).toBe(MAX_UNTRACKED_BYTES)
  })

  it('returns undefined outside a git checkout and when snapshots are off', async () => {
    const plain = temp('dsh-snap-plain-')
    const data = temp('dsh-snap-data-')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionRevertService)
    await ctx.plugin(SessionSnapshotService, { snapshots: true, dataDir: data })
    await expect(ctx.sessionSnapshots.capture(plain)).resolves.toBeUndefined()

    const repo = temp('dsh-snap-off-')
    gitInit(repo)
    const off = new Context()
    await off.plugin(SessionStore)
    await off.plugin(SessionProjectionRegistry)
    await off.plugin(AgentRegistry)
    await off.plugin(SessionRevertService)
    await off.plugin(SessionSnapshotService, { snapshots: false, dataDir: data })
    await expect(off.sessionSnapshots.capture(repo)).resolves.toBeUndefined()
  })

  it('restores a captured tree and drops an untracked file created after it', async () => {
    const repo = temp('dsh-snap-restore-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionRevertService)
    await ctx.plugin(SessionSnapshotService, { dataDir: data })
    const first = await ctx.sessionSnapshots.capture(repo)
    expect(first).toBeDefined()
    writeFileSync(join(repo, 'a.txt'), 'two\n')
    writeFileSync(join(repo, 'extra.txt'), 'new\n')
    const second = await ctx.sessionSnapshots.capture(repo)
    expect(second).not.toBe(first)
    await ctx.sessionSnapshots.restore(repo, first!)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('one\n')
    expect(() => readFileSync(join(repo, 'extra.txt'), 'utf8')).toThrow(/ENOENT/)
    const diff = await ctx.sessionSnapshots.diff(repo, first!, second!)
    expect(diff.some(row => row.path === 'a.txt' && row.additions > 0)).toBe(true)
  })

  it('does not put an oversized untracked file into the snapshot', async () => {
    const repo = temp('dsh-snap-large-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'one\n')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionRevertService)
    await ctx.plugin(SessionSnapshotService, { dataDir: data, maxUntrackedBytes: MAX_UNTRACKED_BYTES })
    const before = await ctx.sessionSnapshots.capture(repo)
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(MAX_UNTRACKED_BYTES + 1))
    const after = await ctx.sessionSnapshots.capture(repo)
    rmSync(join(repo, 'big.bin'))
    await ctx.sessionSnapshots.restore(repo, after!)
    expect(() => readFileSync(join(repo, 'big.bin'))).toThrow(/ENOENT/)
    expect(before).toBeDefined()
  })

  it('uses the 7-day age and 2 MiB untracked defaults when those fields are omitted', async () => {
    const repo = temp('dsh-snap-defaults-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { snapshots } = await mounted(repo, data)
    const kept = await snapshots.capture(repo)
    writeFileSync(join(repo, 'big.bin'), Buffer.alloc(MAX_UNTRACKED_BYTES + 1))
    const withBig = await snapshots.capture(repo)
    rmSync(join(repo, 'big.bin'))
    await snapshots.restore(repo, withBig!)
    expect(() => readFileSync(join(repo, 'big.bin'))).toThrow(/ENOENT/)
    backdate(data, Date.now() - DEFAULT_MAX_AGE_MS - 1_000)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    await snapshots.capture(repo)
    expect(objectExists(data, kept!)).toBe(false)
  })

  it('undo then redo restores the worktree at each turn boundary', async () => {
    const repo = temp('dsh-snap-chain-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { ctx, agent, snapshots } = await mounted(repo, data)
    const turn1 = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const turn2 = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'C\n')
    const session = agent.session
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 2 })
    const second = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    snapshots.rememberTurn(session.id, 1, turn1!)
    snapshots.rememberTurn(session.id, 2, turn2!)

    await ctx.sessionRevert.stage(agent, second.seq)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('B\n')
    await ctx.sessionRevert.stage(agent, first.seq)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('A\n')
    await ctx.sessionRevert.stage(agent, second.seq)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('B\n')
    await ctx.sessionRevert.clear(agent)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('C\n')
  })

  it('leaves a path untouched when both trees contain the same bytes', async () => {
    const repo = temp('dsh-snap-selective-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    writeFileSync(join(repo, 'same.txt'), 'same\n')
    const { ctx, agent, snapshots } = await mounted(repo, data)
    const turn1 = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const turn2 = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'C\n')
    writeFileSync(join(repo, 'born.txt'), 'new\n')
    const same = join(repo, 'same.txt')
    const stamp = new Date('2020-01-01T00:00:00Z')
    utimesSync(same, stamp, stamp)
    const session = agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 2 })
    const second = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    snapshots.rememberTurn(session.id, 1, turn1!)
    snapshots.rememberTurn(session.id, 2, turn2!)

    await ctx.sessionRevert.stage(agent, second.seq)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('B\n')
    expect(() => readFileSync(join(repo, 'born.txt'), 'utf8')).toThrow(/ENOENT/)
    expect(statSync(same).mtimeMs).toBe(stamp.getTime())
    await ctx.sessionRevert.clear(agent)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('C\n')
    expect(readFileSync(join(repo, 'born.txt'), 'utf8')).toBe('new\n')
    expect(statSync(same).mtimeMs).toBe(stamp.getTime())
  })

  it('drops the oldest tree once historyLimit is exceeded', async () => {
    const repo = temp('dsh-snap-history-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { snapshots } = await mounted(repo, data, { historyLimit: 1 })
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const first = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const second = await snapshots.capture(repo)
    expect(objectExists(data, first!)).toBe(false)
    expect(objectExists(data, second!)).toBe(true)
  })

  it('drops a tree older than maxAgeMs', async () => {
    const repo = temp('dsh-snap-age-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { snapshots } = await mounted(repo, data, { maxAgeMs: 1_000 })
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const id = await snapshots.capture(repo)
    backdate(data, Date.now() - 60_000)
    await snapshots.collect()
    expect(objectExists(data, id!)).toBe(false)
  })

  it('drops the oldest tree when the snapshot root exceeds diskLimitBytes', async () => {
    const repo = temp('dsh-snap-disk-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { snapshots } = await mounted(repo, data, { diskLimitBytes: 1 })
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const first = await snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const second = await snapshots.capture(repo)
    expect(objectExists(data, first!)).toBe(false)
    expect(objectExists(data, second!)).toBe(true)
  })

  it('sweeps on gcIntervalMs', async () => {
    const repo = temp('dsh-snap-gc-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { snapshots } = await mounted(repo, data, { gcIntervalMs: 30, maxAgeMs: 1_000 })
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const id = await snapshots.capture(repo)
    backdate(data, Date.now() - 60_000)
    const { promise, resolve } = Promise.withResolvers()
    setTimeout(resolve, 400)
    await promise
    expect(objectExists(data, id!)).toBe(false)
  })
})
