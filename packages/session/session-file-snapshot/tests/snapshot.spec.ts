import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { createInboxStub, mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionRevertService from '@lulu-ling/dsh-session-revert'
import SessionSnapshotService, { DEFAULT_DISK_LIMIT_BYTES, DEFAULT_GC_INTERVAL_MS, DEFAULT_HISTORY_LIMIT, DEFAULT_MAX_AGE_MS, MAX_UNTRACKED_BYTES } from '@lulu-ling/dsh-session-file-snapshot'
import { homedir } from 'node:os'
import { symlinkSync } from 'node:fs'
import {
  captureTree, collectSnapshots, coverTree, diffTrees, readStageRecord, readTurnBinding, recordTurnBinding,
  restoreChanged, snapshotRoot, writeStageRecord,
} from '@lulu-ling/dsh-session-file-snapshot/src/git.ts'
import type { SnapshotId } from '@lulu-ling/dsh-session-file-snapshot'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    watcher: { kind: 'watcher' } & ContextFormed
  }
}

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
  const next = parsed.map((item: unknown) => {
    const id: unknown = typeof item === 'object' && item !== null ? Reflect.get(item, 'id') : undefined
    if (typeof id !== 'string') throw new Error('snapshot history row is missing id')
    return { id, at }
  })
  writeFileSync(path, JSON.stringify(next))
}


async function mounted(
  repo: string,
  dataDir: string,
  config: {
    snapshots?: boolean
    historyLimit?: number
    diskLimitBytes?: number
    maxAgeMs?: number
    gcIntervalMs?: number
    maxUntrackedBytes?: number
  } = {},
  cwd: string | null = repo,
): Promise<{ ctx: Context; agent: Agent; snapshots: SessionSnapshotService }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionRevertService)
  await ctx.plugin(SessionSnapshotService, { snapshots: true, dataDir, ...config })
  const session = ctx.sessions.create(SessionId(`snap-${repo.slice(-6)}`), cwd === null ? {} : { meta: { cwd } })
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox: createInboxStub(),
    model: { current: () => undefined, select: () => {} },
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

  it('restores a turn from the snapshot directory after the process map is gone', async () => {
    const repo = temp('dsh-snap-restart-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const first = await mounted(repo, data)
    const turn1 = await first.snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const turn2 = await first.snapshots.capture(repo)
    writeFileSync(join(repo, 'a.txt'), 'C\n')
    await recordTurnBinding(repo, data, first.agent.session.id, 1, turn1!)
    await recordTurnBinding(repo, data, first.agent.session.id, 2, turn2!)

    const second = await mounted(repo, data)
    const session = second.agent.session
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'one' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    session.append('turn/start', { turn: 2 })
    const boundary = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await second.ctx.sessionRevert.stage(second.agent, boundary.seq)
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('B\n')
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

/** Append one turn per text, each opened by `turn/start`, and return the user-message seqs. */
function turns(session: Agent['session'], ...texts: string[]): SessionSeq[] {
  return texts.map((text, index) => {
    session.append('turn/start', { turn: index + 1 })
    return session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
  })
}

function read(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '<missing>'
}

/** Capture one tree per content of `a.txt`, bind each to its turn, and leave `last` on disk. */
async function boundTurns(
  repo: string,
  data: string,
  snapshots: SessionSnapshotService,
  sessionId: SessionId,
  contents: readonly string[],
  last: string,
): Promise<SnapshotId[]> {
  const ids: SnapshotId[] = []
  for (const [index, content] of contents.entries()) {
    writeFileSync(join(repo, 'a.txt'), content)
    const id = await snapshots.capture(repo)
    ids.push(id!)
    await recordTurnBinding(repo, data, sessionId, index + 1, id!)
  }
  writeFileSync(join(repo, 'a.txt'), last)
  return ids
}

function warnings(ctx: Context) {
  return vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
}

describe('session snapshot restore', () => {
  it('keeps undo and redo working after a restart while a revert is open', async () => {
    const repo = temp('dsh-snap-reopen-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const before = await mounted(repo, data)
    await boundTurns(repo, data, before.snapshots, before.agent.session.id, ['A\n', 'B\n'], 'C\n')
    const [, second] = turns(before.agent.session, 'one', 'two')
    await before.ctx.sessionRevert.stage(before.agent, second!)
    expect(read(join(repo, 'a.txt'))).toBe('B\n')
    await expect(before.snapshots.collect()).resolves.toBeUndefined()

    const after = await mounted(repo, data)
    const [first, again] = turns(after.agent.session, 'one', 'two')
    after.agent.session.append('session/revert/staged', { atSeq: again! })
    await after.ctx.sessionRevert.stage(after.agent, first!)
    expect(read(join(repo, 'a.txt'))).toBe('A\n')

    const later = await mounted(repo, data, { historyLimit: 1 })
    turns(later.agent.session, 'one', 'two')
    later.agent.session.append('session/revert/staged', { atSeq: first! })
    // A sweep in a later process keeps the saved trees even with a history of one.
    writeFileSync(join(repo, 'unrelated.txt'), 'x\n')
    await later.snapshots.capture(repo)
    rmSync(join(repo, 'unrelated.txt'))
    await later.ctx.sessionRevert.clear(later.agent)
    expect(read(join(repo, 'a.txt'))).toBe('C\n')
    await expect(readStageRecord(repo, data, later.agent.session.id)).resolves.toBeUndefined()
  })

  it('writes back an untracked file that outgrew maxUntrackedBytes during the turn', async () => {
    const repo = temp('dsh-snap-grown-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'data.log'), 'small')
    const { ctx, agent, snapshots } = await mounted(repo, data, { maxUntrackedBytes: 10 })
    const turn1 = await snapshots.capture(repo)
    writeFileSync(join(repo, 'data.log'), 'x'.repeat(50))
    snapshots.rememberTurn(agent.session.id, 1, turn1!)
    const [first] = turns(agent.session, 'one')
    await ctx.sessionRevert.stage(agent, first!)
    expect(read(join(repo, 'data.log'))).toBe('small')
    await ctx.sessionRevert.clear(agent)
    expect(read(join(repo, 'data.log'))).toBe('x'.repeat(50))
  })

  it('swaps a file and a directory in both directions', async () => {
    const repo = temp('dsh-snap-swap-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'p'), 'file\n')
    const { ctx, agent, snapshots } = await mounted(repo, data)
    const turn1 = await snapshots.capture(repo)
    rmSync(join(repo, 'p'))
    mkdirSync(join(repo, 'p', 'deep'), { recursive: true })
    writeFileSync(join(repo, 'p', 'deep', 'q.txt'), 'nested\n')
    snapshots.rememberTurn(agent.session.id, 1, turn1!)
    const [first] = turns(agent.session, 'one')
    await ctx.sessionRevert.stage(agent, first!)
    expect(read(join(repo, 'p'))).toBe('file\n')
    await ctx.sessionRevert.clear(agent)
    expect(read(join(repo, 'p', 'deep', 'q.txt'))).toBe('nested\n')
  })

  it('restores the step that admitted a steering message, not the whole turn', async () => {
    const repo = temp('dsh-snap-steer-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'start\n')
    const { ctx, agent } = await mounted(repo, data)
    const session = agent.session
    const step = async (turn: number, index: number, kind: 'user' | 'watcher') => {
      const source = kind === 'user' ? { kind: 'user' as const } : { kind: 'watcher' as const }
      const message = createUserMessage({ content: [{ type: 'text', text: `${turn}.${index}` }], source })
      await ctx.waterfall('agent/pre-step', {
        agent, messages: [message], modelSelection: { provider: 'test', model: 'test' },
        turn, step: index, signal: new AbortController().signal,
      }, async () => ({ kind: 'enter' as const, messages: [message] }))
      session.append('step/start', { turn, step: index })
      return session.append('user/message', message, { surfaceOp: 'append' }).seq
    }
    session.append('turn/start', { turn: 1 })
    await step(1, 1, 'user')
    writeFileSync(join(repo, 'a.txt'), 'after step 1\n')
    const notice = await step(1, 2, 'watcher')
    writeFileSync(join(repo, 'a.txt'), 'after step 2\n')
    const steering = await step(1, 3, 'user')
    writeFileSync(join(repo, 'a.txt'), 'after step 3\n')

    await ctx.sessionRevert.stage(agent, steering)
    expect(read(join(repo, 'a.txt'))).toBe('after step 2\n')
    // A step that admitted no human message has no capture of its own, so the turn's applies.
    await ctx.sessionRevert.stage(agent, notice)
    expect(read(join(repo, 'a.txt'))).toBe('start\n')
    await ctx.sessionRevert.clear(agent)
    expect(read(join(repo, 'a.txt'))).toBe('after step 3\n')
  })

  it('still moves the messages in a non-git folder when git speaks another language', async () => {
    const plain = temp('dsh-snap-locale-')
    const data = temp('dsh-snap-data-')
    const saved = { LANG: process.env['LANG'], LC_ALL: process.env['LC_ALL'], LANGUAGE: process.env['LANGUAGE'] }
    Object.assign(process.env, { LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8', LANGUAGE: 'zh_CN' })
    try {
      const { ctx, agent } = await mounted(plain, data)
      const log = warnings(ctx)
      const [first] = turns(agent.session, 'one')
      await expect(ctx.sessionRevert.stage(agent, first!)).resolves.toEqual({ atSeq: first, changed: true })
      await expect(ctx.sessionRevert.clear(agent)).resolves.toEqual({ cleared: true })
      expect(log).not.toHaveBeenCalled()
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
    }
  })

  it('treats a missing git executable as no checkout and an unopenable path as a failure', async () => {
    const repo = temp('dsh-snap-nogit-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { snapshots } = await mounted(repo, data)
    const path = process.env['PATH']
    process.env['PATH'] = join(repo, 'no-such-bin')
    try {
      await expect(snapshots.capture(repo)).resolves.toBeUndefined()
    } finally {
      process.env['PATH'] = path
    }
    writeFileSync(join(repo, 'plain.txt'), 'x\n')
    await expect(snapshots.capture(join(repo, 'plain.txt'))).rejects.toThrow(/git rev-parse --show-toplevel failed/)
  })

  it('warns and keeps the turn going when capture fails before it', async () => {
    const repo = temp('dsh-snap-capture-fail-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'plain.txt'), 'x\n')
    const { ctx, agent } = await mounted(repo, data, {}, join(repo, 'plain.txt'))
    const log = warnings(ctx)
    const decision = await ctx.waterfall('agent/pre-step', {
      agent, messages: [], modelSelection: { provider: 'test', model: 'test' },
      turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages: [] }))
    expect(decision).toEqual({ kind: 'enter', messages: [] })
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/capture before turn 1 failed/))
  })

  it('warns instead of guessing when an open revert has no saved worktree', async () => {
    const repo = temp('dsh-snap-lost-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const before = await mounted(repo, data)
    await boundTurns(repo, data, before.snapshots, before.agent.session.id, ['A\n', 'B\n'], 'C\n')
    const [, second] = turns(before.agent.session, 'one', 'two')
    await before.ctx.sessionRevert.stage(before.agent, second!)
    await writeStageRecord(repo, data, before.agent.session.id, undefined)

    const after = await mounted(repo, data)
    const log = warnings(after.ctx)
    const [first, again] = turns(after.agent.session, 'one', 'two')
    after.agent.session.append('session/revert/staged', { atSeq: again! })
    await after.ctx.sessionRevert.stage(after.agent, first!)
    await after.ctx.sessionRevert.clear(after.agent)
    expect(read(join(repo, 'a.txt'))).toBe('B\n')
    expect(log).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no saved worktree/))
  })

  it('puts the worktree back when the boundary moves to a turn without a snapshot', async () => {
    const repo = temp('dsh-snap-unbound-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { ctx, agent, snapshots } = await mounted(repo, data)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    snapshots.rememberTurn(agent.session.id, 2, (await snapshots.capture(repo))!)
    writeFileSync(join(repo, 'a.txt'), 'C\n')
    const log = warnings(ctx)
    const [first, second] = turns(agent.session, 'one', 'two')
    await ctx.sessionRevert.stage(agent, second!)
    expect(read(join(repo, 'a.txt'))).toBe('B\n')
    await ctx.sessionRevert.stage(agent, first!)
    expect(read(join(repo, 'a.txt'))).toBe('C\n')
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no snapshot was captured for the turn/))
    await expect(snapshots.collect()).resolves.toBeUndefined()
    await ctx.sessionRevert.clear(agent)
    expect(read(join(repo, 'a.txt'))).toBe('C\n')
  })

  it('leaves files alone when the boundary moves within the same snapshot', async () => {
    const repo = temp('dsh-snap-same-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { ctx, agent, snapshots } = await mounted(repo, data)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    snapshots.rememberTurn(agent.session.id, 1, (await snapshots.capture(repo))!)
    writeFileSync(join(repo, 'a.txt'), 'B\n')
    const [first] = turns(agent.session, 'one')
    const queued = agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    await ctx.sessionRevert.stage(agent, queued)
    writeFileSync(join(repo, 'a.txt'), 'edited while undone\n')
    await ctx.sessionRevert.stage(agent, first!)
    expect(read(join(repo, 'a.txt'))).toBe('edited while undone\n')
  })

  it('warns and still moves the messages when a snapshot tree is gone', async () => {
    const repo = temp('dsh-snap-gone-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { ctx, agent, snapshots } = await mounted(repo, data)
    snapshots.rememberTurn(agent.session.id, 1, '0'.repeat(40) as SnapshotId)
    const log = warnings(ctx)
    const [first] = turns(agent.session, 'one')
    await expect(ctx.sessionRevert.stage(agent, first!)).resolves.toMatchObject({ changed: true })
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/moving files for the revert failed/))
    expect(read(join(repo, 'a.txt'))).toBe('A\n')

    const record = await readStageRecord(repo, data, agent.session.id)
    await writeStageRecord(repo, data, agent.session.id, { outer: record!.outer, staged: '0'.repeat(40) as SnapshotId })
    const fresh = await mounted(repo, data)
    const freshLog = warnings(fresh.ctx)
    const [again] = turns(fresh.agent.session, 'one')
    fresh.agent.session.append('session/revert/staged', { atSeq: again! })
    await expect(fresh.ctx.sessionRevert.clear(fresh.agent)).resolves.toEqual({ cleared: true })
    expect(freshLog).toHaveBeenCalledWith(expect.stringMatching(/restoring files for the redo failed/))
    await expect(readStageRecord(repo, data, agent.session.id)).resolves.toBeUndefined()
  })

  it('drops the saved revert on commit and warns when it cannot', async () => {
    const repo = temp('dsh-snap-commit-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { ctx, agent, snapshots } = await mounted(repo, data)
    await boundTurns(repo, data, snapshots, agent.session.id, ['A\n'], 'B\n')
    const [first] = turns(agent.session, 'one')
    await ctx.sessionRevert.stage(agent, first!)
    await ctx.sessionRevert.commit(agent)
    await expect(readStageRecord(repo, data, agent.session.id)).resolves.toBeUndefined()
    expect(read(join(repo, 'a.txt'))).toBe('A\n')

    agent.session.append('turn/start', { turn: 2 })
    const next = agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'two' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    await ctx.sessionRevert.stage(agent, next)
    const stages = join(gitDirOf(data), 'dsh-stages.json')
    rmSync(stages)
    mkdirSync(stages)
    const log = warnings(ctx)
    await ctx.sessionRevert.commit(agent)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/dropping the saved revert failed/))
  })

  it('does nothing for files when snapshots are off or the session has no folder', async () => {
    const repo = temp('dsh-snap-inert-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    for (const [config, cwd] of [[{ snapshots: false }, repo], [{}, null]] as const) {
      const { ctx, agent, snapshots } = await mounted(repo, data, config, cwd)
      const [first] = turns(agent.session, 'one')
      await ctx.waterfall('agent/pre-step', {
        agent, messages: [], modelSelection: { provider: 'test', model: 'test' },
        turn: 1, step: 1, signal: new AbortController().signal,
      }, async () => ({ kind: 'enter' as const, messages: [] }))
      await ctx.sessionRevert.stage(agent, first!)
      await ctx.sessionRevert.clear(agent)
      await ctx.sessionRevert.stage(agent, first!)
      await ctx.sessionRevert.commit(agent)
      await expect(snapshots.collect()).resolves.toBeUndefined()
      if (config.snapshots === false) {
        const none = '0'.repeat(40) as SnapshotId
        await expect(snapshots.capture(repo)).resolves.toBeUndefined()
        await expect(snapshots.restore(repo, none)).resolves.toBeUndefined()
        await expect(snapshots.diff(repo, none, none)).resolves.toEqual([])
      }
    }
    expect(read(join(repo, 'a.txt'))).toBe('A\n')
    expect(readdirSync(data)).toEqual([])
  })

  it('warns when a timed sweep fails', async () => {
    const repo = temp('dsh-snap-sweep-fail-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { ctx, snapshots } = await mounted(repo, data, { gcIntervalMs: 20 })
    await snapshots.capture(repo)
    const history = join(gitDirOf(data), 'dsh-history.json')
    rmSync(history)
    mkdirSync(history)
    const log = warnings(ctx)
    await vi.waitFor(() => { expect(log).toHaveBeenCalledWith(expect.stringMatching(/snapshot sweep failed/)) })
  })

  it('skips unreadable or foreign rows in the saved files', async () => {
    const repo = temp('dsh-snap-rows-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { snapshots } = await mounted(repo, data)
    const id = (await snapshots.capture(repo))!
    const gitDir = gitDirOf(data)
    writeFileSync(join(gitDir, 'dsh-turns.json'), JSON.stringify({ 's:1': id, 's:x': id, nocolon: id, 's:2': 'nothex', 's:-1': id }))
    writeFileSync(join(gitDir, 'dsh-stages.json'), JSON.stringify({ a: { outer: id, staged: 'bad' }, b: 'bad', c: { outer: id } }))
    await expect(readTurnBinding(repo, data, 's', 1)).resolves.toBe(id)
    await expect(readTurnBinding(repo, data, 's', 2)).resolves.toBeUndefined()
    await expect(readStageRecord(repo, data, 'a')).resolves.toBeUndefined()
    await expect(readStageRecord(repo, data, 'c')).resolves.toEqual({ outer: id })
    writeFileSync(join(gitDir, 'dsh-turns.json'), '{torn')
    writeFileSync(join(gitDir, 'dsh-stages.json'), '[]')
    writeFileSync(join(gitDir, 'dsh-history.json'), JSON.stringify([{ id, at: 1 }, null, { id: 'bad', at: 1 }, { id, at: 'x' }]))
    await expect(readTurnBinding(repo, data, 's', 1)).resolves.toBeUndefined()
    await expect(readStageRecord(repo, data, 'c')).resolves.toBeUndefined()
    await expect(snapshots.collect()).resolves.toBeUndefined()
    await expect(recordTurnBinding(repo, data, 's', -1, id)).rejects.toThrow(/turn must be/)
    await expect(recordTurnBinding(repo, data, 's', 1, id, 0)).rejects.toThrow(/step must be/)
  })

  it('answers the plain helpers outside a git checkout', async () => {
    const plain = temp('dsh-snap-helpers-')
    const data = temp('dsh-snap-data-')
    const id = '0'.repeat(40) as SnapshotId
    await expect(coverTree(plain, id, id, data)).resolves.toBe(id)
    await expect(restoreChanged(plain, id, id, data)).resolves.toBeUndefined()
    await expect(diffTrees(plain, id, id, data)).resolves.toEqual([])
    await expect(readStageRecord(plain, data, 's')).resolves.toBeUndefined()
    await expect(writeStageRecord(plain, data, 's', { outer: id })).resolves.toBeUndefined()
    await expect(recordTurnBinding(plain, data, 's', 1, id)).resolves.toBeUndefined()
    await expect(readTurnBinding(plain, data, 's', 1)).resolves.toBeUndefined()
    const repo = temp('dsh-snap-helpers-git-')
    gitInit(repo)
    await expect(readTurnBinding(repo, data, 's', 1)).resolves.toBeUndefined()
    expect(readdirSync(data)).toEqual([])
  })
})

describe('session snapshot edges', () => {
  it('resolves the snapshot root from the config, DSH_HOME, or the home directory', () => {
    const saved = process.env['DSH_HOME']
    try {
      expect(snapshotRoot('/explicit')).toBe('/explicit')
      process.env['DSH_HOME'] = '/dsh-home'
      expect(snapshotRoot('')).toBe(join('/dsh-home', 'snapshot'))
      delete process.env['DSH_HOME']
      expect(snapshotRoot(undefined)).toBe(join(homedir(), '.dsh', 'snapshot'))
    } finally {
      if (saved === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = saved
    }
  })

  it('restores a whole tree around links, oversized files, and folders outside git', async () => {
    const repo = temp('dsh-snap-whole-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { snapshots } = await mounted(repo, data, { maxUntrackedBytes: 10 })
    const id = (await snapshots.capture(repo))!
    writeFileSync(join(repo, 'big.bin'), 'x'.repeat(50))
    symlinkSync('a.txt', join(repo, 'link'))
    writeFileSync(join(repo, 'small.txt'), 'new\n')
    await snapshots.restore(repo, id)
    expect(read(join(repo, 'big.bin'))).toBe('x'.repeat(50))
    expect(existsSync(join(repo, 'link'))).toBe(true)
    expect(read(join(repo, 'small.txt'))).toBe('<missing>')
    await expect(snapshots.restore(temp('dsh-snap-plain-'), id)).resolves.toBeUndefined()
  })

  it('leaves paths the user removed or replaced while a revert was open', async () => {
    const repo = temp('dsh-snap-tolerate-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    mkdirSync(join(repo, 'dir'))
    writeFileSync(join(repo, 'dir', 'keep.txt'), 'keep\n')
    const before = (await captureTree(repo, data, 1024))!
    writeFileSync(join(repo, 'dir', 'gone.txt'), 'gone\n')
    writeFileSync(join(repo, 'swapped'), 'file\n')
    writeFileSync(join(repo, 'deleted.txt'), 'x\n')
    const after = (await captureTree(repo, data, 1024))!
    rmSync(join(repo, 'deleted.txt'))
    rmSync(join(repo, 'swapped'))
    mkdirSync(join(repo, 'swapped'))
    writeFileSync(join(repo, 'swapped', 'mine.txt'), 'mine\n')
    await restoreChanged(repo, after, before, data)
    expect(read(join(repo, 'dir', 'gone.txt'))).toBe('<missing>')
    expect(read(join(repo, 'dir', 'keep.txt'))).toBe('keep\n')
    expect(read(join(repo, 'swapped', 'mine.txt'))).toBe('mine\n')
    await expect(restoreChanged(repo, 'bad' as SnapshotId, before, data)).rejects.toThrow(/snapshot id must be a git tree hash/)
  })

  it('backs up a file that replaced a directory entry before a stage overwrites it', async () => {
    const repo = temp('dsh-snap-cover-df-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'p'), 'file\n')
    const base = (await captureTree(repo, data, 1024))!
    rmSync(join(repo, 'p'))
    mkdirSync(join(repo, 'p'))
    writeFileSync(join(repo, 'p', 'q.txt'), 'target\n')
    const target = (await captureTree(repo, data, 1024))!
    writeFileSync(join(repo, 'p', 'q.txt'), 'mine\n')
    const covered = await coverTree(repo, base, target, data)
    const show = (spec: string) => execFileSync('git', ['--git-dir', gitDirOf(data), 'show', spec], { encoding: 'utf8' })
    expect(show(`${covered}:p/q.txt`)).toBe('mine\n')
    await expect(coverTree(repo, covered, target, data)).resolves.toBe(covered)
  })

  it('counts a binary change without line totals', async () => {
    const repo = temp('dsh-snap-binary-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 1, 2, 0]))
    const { snapshots } = await mounted(repo, data)
    const first = (await snapshots.capture(repo))!
    writeFileSync(join(repo, 'blob.bin'), Buffer.from([0, 3, 4, 0, 5]))
    const second = (await snapshots.capture(repo))!
    await expect(snapshots.diff(repo, first, second)).resolves.toEqual([{ path: 'blob.bin', additions: 0, deletions: 0 }])
  })

  it('drops the oldest unpinned trees across worktrees until the disk limit holds', async () => {
    const data = temp('dsh-snap-data-')
    const ids: SnapshotId[] = []
    for (const name of ['one-', 'two-']) {
      const repo = temp(`dsh-snap-disk-${name}`)
      gitInit(repo)
      for (const content of ['A\n', 'B\n']) {
        writeFileSync(join(repo, 'a.txt'), `${name}${content}`)
        ids.push((await captureTree(repo, data, 1024))!)
      }
    }
    writeFileSync(join(data, 'stray.txt'), 'not a repo\n')
    mkdirSync(join(data, 'not-a-repo'))
    const orphan = join(data, 'orphan')
    mkdirSync(orphan)
    execFileSync('git', ['init', '--bare', '-q', orphan])
    writeFileSync(join(orphan, 'dsh-history.json'), JSON.stringify([{ id: ids[0], at: 1 }, { id: ids[0], at: 0 }]))
    const keep = ids.at(-1)!
    await collectSnapshots(data, {
      historyLimit: 100, diskLimitBytes: 1, maxAgeMs: Number.MAX_SAFE_INTEGER, pinned: new Set([keep]), now: Date.now(),
    })
    expect(ids.map(id => objectExistsIn(data, id))).toEqual([false, false, false, true])
    await expect(collectSnapshots(join(data, 'absent'), {
      historyLimit: 1, diskLimitBytes: 1, maxAgeMs: 1, pinned: new Set(), now: Date.now(),
    })).resolves.toBeUndefined()
  })

  it('re-arms the sweep only when its interval changes and stops it on dispose', async () => {
    const repo = temp('dsh-snap-rearm-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const { ctx, snapshots } = await mounted(repo, data, { gcIntervalMs: 60_000 })
    const timer: unknown = Reflect.get(snapshots, 'sweepTimer')
    ctx.emit('loader/volatile-update', [])
    expect(Reflect.get(snapshots, 'sweepTimer') as unknown).toBe(timer)
    await ctx.fiber.dispose()
    expect(Reflect.get(snapshots, 'sweepTimer') as unknown).toBeUndefined()
  })

  it('warns when the boundary seq precedes every turn', async () => {
    const repo = temp('dsh-snap-turnless-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    writeFileSync(join(repo, 'a.txt'), 'A\n')
    const { ctx, agent } = await mounted(repo, data)
    const log = warnings(ctx)
    const seq = agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'before any turn' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' }).seq
    agent.session.append('step/start', { turn: 1, step: 2 })
    await ctx.sessionRevert.stage(agent, seq)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no snapshot was captured/))
  })
})

/** Whether `id` is still in any snapshot git dir under `dataDir`. */
function objectExistsIn(dataDir: string, id: string): boolean {
  return readdirSync(dataDir).some((name) => {
    try {
      execFileSync('git', ['--git-dir', join(dataDir, name), 'cat-file', '-e', id], { windowsHide: true, stdio: 'ignore' })
      return true
    } catch {
      // cat-file exits non-zero when the object is absent from this dir.
      return false
    }
  })
}

/** A model whose every request first writes the file, as a tool call would. */
class WritingAdapter extends LlmAdapter {
  requests = 0

  constructor(private readonly write: (request: number) => void) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  override async * stream(): AsyncIterable<StreamChunk> {
    this.requests += 1
    this.write(this.requests)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `done ${this.requests}` } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

describe('session snapshots in a running agent loop', () => {
  it('undoes and redoes the files of real turns, and a new prompt freezes the undo', async () => {
    const repo = temp('dsh-snap-loop-')
    const data = temp('dsh-snap-data-')
    gitInit(repo)
    const file = join(repo, 'a.txt')
    writeFileSync(file, 'start\n')
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SessionRevertService)
    await ctx.plugin(SessionSnapshotService, { dataDir: data })
    ctx.llm.registerAdapter(['writer'], new WritingAdapter((request) => { writeFileSync(file, `turn ${request}\n`) }))
    const agent = await ctx.agentLoop.create(SessionId('snapshot-loop'), { provider: 'writer', model: 'writer' }, { cwd: repo })
    const prompt = async (text: string) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    await prompt('one')
    await prompt('two')
    expect(read(file)).toBe('turn 2\n')
    const prompts = agent.session.snapshotEvents().flatMap(event =>
      event.type === 'user/message' && event.data.source.kind === 'user' ? [event.seq] : [])
    expect(prompts).toHaveLength(2)

    await ctx.sessionRevert.stage(agent, prompts[1]!)
    expect(read(file)).toBe('turn 1\n')
    await ctx.sessionRevert.stage(agent, prompts[0]!)
    expect(read(file)).toBe('start\n')
    await ctx.sessionRevert.clear(agent)
    expect(read(file)).toBe('turn 2\n')

    await ctx.sessionRevert.stage(agent, prompts[1]!)
    expect(read(file)).toBe('turn 1\n')
    await prompt('three')
    expect(ctx.sessionProjections.snapshot(agent.session).values.revert?.staged).toBeNull()
    expect(read(file)).toBe('turn 3\n')
    await expect(readStageRecord(repo, data, agent.session.id)).resolves.toBeUndefined()
    await ctx.fiber.dispose()
  }, 60_000)
})
