#!/usr/bin/env node
/**
 * Point Windows pnpm cmd shims at `bin/pnpm.mjs`.
 *
 * pnpm 12's package bins are extensionless shell placeholders until its install
 * script hardlinks the native executable over them. This workspace denies that
 * script. cmd.exe cannot execute the placeholder, so a package script that
 * calls `pnpm` fails. The Node entry finds the optional `@pnpm/exe` binary.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cmd shim name and the Node entry it must launch. */
const SHIMS = [
  ['pnpm.cmd', 'pnpm.mjs'],
  ['pn.cmd', 'pnpm.mjs'],
  ['pnpx.cmd', 'pnpx.mjs'],
  ['pnx.cmd', 'pnpx.mjs'],
]

/**
 * Rewrite installed Windows pnpm cmd shims so they launch the Node entry.
 * @param root - Repository root that contains `node_modules`.
 * @param platform - Platform to treat as the host. Tests pass this explicitly.
 * @returns Cmd shim paths that were written.
 */
export function linkWindowsPnpmCli(root, platform = process.platform) {
  if (platform !== 'win32') return []
  const written = []
  for (const [command, entry] of SHIMS) {
    const commandPath = join(root, 'node_modules', '.bin', command)
    const entryPath = join(root, 'node_modules', 'pnpm', 'bin', entry)
    if (!existsSync(commandPath) || !existsSync(entryPath)) continue
    const next = `@ECHO off\r\nnode "%~dp0\\..\\pnpm\\bin\\${entry}" %*\r\n`
    if (readFileSync(commandPath, 'utf8') !== next) writeFileSync(commandPath, next)
    written.push(commandPath)
  }
  return written
}

if (import.meta.main) {
  linkWindowsPnpmCli(join(dirname(fileURLToPath(import.meta.url)), '..'))
}
