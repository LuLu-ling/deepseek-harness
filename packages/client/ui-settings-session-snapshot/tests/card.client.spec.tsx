// @vitest-environment jsdom
/** The file-snapshot page as the Plugins page renders it. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { SnapshotCard, type SnapshotCardProps } from '../src/client/SnapshotCard.tsx'
import type { SnapshotCardState } from '../src/client/snapshot-card-controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof zh) => zh[key]
const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string): SettingsFieldState {
  return { text, overridden: false, invalid: false }
}

function renderCard(view: 'summary' | 'page' = 'page') {
  const store = createSnapshotStore<SnapshotCardState>({
    ...settled,
    historyLimit: field(''),
    diskLimitBytes: field(''),
    maxAgeMs: field(''),
    gcIntervalMs: field(''),
    maxUntrackedBytes: field(''),
  })
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, view, t, useSnapshotCard: bindSnapshotSelector(store) } as SnapshotCardProps
  render(<SnapshotCard {...props} />)
  return actions
}

describe('SnapshotCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderCard('summary')
    expect(screen.getByText(zh.description)).toBeTruthy()
    expect(screen.queryByLabelText(zh.historyLimit)).toBeNull()
  })

  it('shows the five limits and stages an edit instead of writing it', () => {
    const actions = renderCard()
    expect(screen.getByLabelText(zh.historyLimit)).toBeTruthy()
    expect(screen.getByLabelText(zh.diskLimitBytes)).toBeTruthy()
    expect(screen.getByLabelText(zh.maxAgeMs)).toBeTruthy()
    expect(screen.getByLabelText(zh.gcIntervalMs)).toBeTruthy()
    expect(screen.getByLabelText(zh.maxUntrackedBytes)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(zh.historyLimit), { target: { value: '12' } })
    expect(actions.edit).toHaveBeenCalledWith('historyLimit', '12')
    expect(actions.save).not.toHaveBeenCalled()
  })
})
