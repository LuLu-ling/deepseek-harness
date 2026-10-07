/**
 * Session directory deletion: the stored header locates the directory, a
 * write lease excludes a concurrent resume, and an unknown or hostile id
 * never leaves the configured root.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SESSION_FORMAT_VERSION, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import {
  SessionAlreadyOwnedError,
  SessionPersistenceNotFoundError,
} from '@deepseek-ai/dsh-session-persistence'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlSessionPersistence from '../src/index.ts'
import { sessionDir } from '../src/format.ts'

const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function meta(id: string, cwd: string): SessionHeader {
  return { version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 1_000, cwd, isSeeded: false }
}

async function freshRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
  dirs.push(root)
  return root
}

async function mount(root: string): Promise<SessionPersistence> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx.sessionPersistence
}

const EVENTS = [
  { type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } },
  { type: 'turn/end', seq: SessionSeq(1), time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
] as const

describe('JsonlSessionPersistence.delete', () => {
  it('removes the whole session directory and rejects an unknown id', async () => {
    const root = await freshRoot()
    const persistence = await mount(root)
    const header = meta('gone', root)
    const handle = await persistence.create(header)
    await handle.append([...EVENTS])
    await handle.close()
    const dir = sessionDir(root, header.cwd, header.id)
    expect(existsSync(dir)).toBe(true)

    await persistence.delete(header.id)

    expect(existsSync(dir)).toBe(false)
    await expect(persistence.stat(header.id)).resolves.toBeUndefined()
    await expect(persistence.delete(SessionId('missing'))).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    expect(existsSync(root)).toBe(true)
  })

  it('rejects delete while a write handle holds the session, and that hold rejects another write open', async () => {
    const root = await freshRoot()
    const persistence = await mount(root)
    const rival = await mount(root)
    const header = meta('held', root)
    const handle = await persistence.create(header)
    await handle.append([...EVENTS])

    await expect(persistence.delete(header.id)).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    await expect(rival.open(header.id, 'write')).rejects.toBeInstanceOf(SessionAlreadyOwnedError)
    expect(existsSync(sessionDir(root, header.cwd, header.id))).toBe(true)

    await handle.close()
    await persistence.delete(header.id)
    expect(existsSync(sessionDir(root, header.cwd, header.id))).toBe(false)
  })

  it('keeps a hostile id inside the root and leaves siblings outside it', async () => {
    const root = await freshRoot()
    const persistence = await mount(root)
    const marker = join(dirname(root), 'dsh-jsonl-delete-outside')
    await writeFile(marker, 'keep')
    dirs.push(marker)
    for (const id of ['..', 'a/b', 'a\\b', '~002E']) {
      await expect(persistence.delete(SessionId(id))).rejects.toBeInstanceOf(SessionPersistenceNotFoundError)
    }
    const hostile = meta('..', root)
    const handle = await persistence.create(hostile)
    await handle.append([...EVENTS])
    await handle.close()
    const dir = sessionDir(root, hostile.cwd, hostile.id)
    expect(dir.startsWith(root)).toBe(true)

    await persistence.delete(hostile.id)

    expect(existsSync(dir)).toBe(false)
    expect(existsSync(root)).toBe(true)
    expect(existsSync(marker)).toBe(true)
  })
})
