import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { linkWindowsPnpmCli } from './link-windows-pnpm-cli.mjs'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-pnpm-shim-'))
  directories.push(root)
  await mkdir(join(root, 'node_modules', '.bin'), { recursive: true })
  await mkdir(join(root, 'node_modules', 'pnpm', 'bin'), { recursive: true })
  await writeFile(join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '')
  await writeFile(join(root, 'node_modules', 'pnpm', 'bin', 'pnpx.mjs'), '')
  await writeFile(join(root, 'node_modules', '.bin', 'pnpm.cmd'), 'broken\r\n')
  await writeFile(join(root, 'node_modules', '.bin', 'pnpx.cmd'), 'broken\r\n')
  return root
}

describe('Windows pnpm cmd shims', () => {
  it('leaves shims untouched on other platforms', async () => {
    const root = await fixture()
    expect(linkWindowsPnpmCli(root, 'linux')).toEqual([])
    expect(await readFile(join(root, 'node_modules', '.bin', 'pnpm.cmd'), 'utf8')).toBe('broken\r\n')
  })

  it('points cmd shims at the Node entry and leaves a matching shim in place', async () => {
    const root = await fixture()
    const pnpmCmd = join(root, 'node_modules', '.bin', 'pnpm.cmd')
    const expected = '@ECHO off\r\nnode "%~dp0\\..\\pnpm\\bin\\pnpm.mjs" %*\r\n'
    expect(linkWindowsPnpmCli(root, 'win32')).toEqual([
      pnpmCmd,
      join(root, 'node_modules', '.bin', 'pnpx.cmd'),
    ])
    expect(await readFile(pnpmCmd, 'utf8')).toBe(expected)
    expect(await readFile(join(root, 'node_modules', '.bin', 'pnpx.cmd'), 'utf8')).toBe(
      '@ECHO off\r\nnode "%~dp0\\..\\pnpm\\bin\\pnpx.mjs" %*\r\n',
    )
    await writeFile(pnpmCmd, 'stale\r\n')
    linkWindowsPnpmCli(root, 'win32')
    expect(await readFile(pnpmCmd, 'utf8')).toBe(expected)
  })
})
