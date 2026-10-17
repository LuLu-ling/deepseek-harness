/**
 * Rewrite installed Windows pnpm cmd shims so they launch the Node entry.
 * @param root - Repository root that contains `node_modules`.
 * @param platform - Platform to treat as the host. Tests pass this explicitly.
 * @returns Cmd shim paths that were written.
 */
export function linkWindowsPnpmCli(root: string, platform?: NodeJS.Platform): string[]
