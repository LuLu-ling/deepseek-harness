/**
 * File-snapshot settings page, node half. The empty apply exists so the
 * plugin appears in the host cordis.yml / Loader; the browser half owns the
 * page through exports["./client"]. The `session-snapshot` entry the page
 * edits is registered by `@lulu-ling/dsh-session-file-snapshot`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
