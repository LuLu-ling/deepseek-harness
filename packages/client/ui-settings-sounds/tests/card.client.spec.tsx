// @vitest-environment jsdom
/** The sounds page as the Plugins page renders it. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { SoundsCard, type SoundsCardProps } from '../src/client/SoundsCard.tsx'
import type { SoundsCardState } from '../src/client/sounds-card-controller.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const settled: SettingsFormShell = {
  available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false,
}

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

function renderCard(locale: typeof zh, state: Partial<SoundsCardState> = {}, view: 'summary' | 'page' = 'page') {
  const t = (key: keyof typeof zh) => locale[key]
  const store = createSnapshotStore<SoundsCardState>({
    ...settled,
    agent: field('none'),
    permissions: field('none'),
    errors: field('none'),
    ...state,
  })
  const actions = {
    edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn(),
    select: vi.fn(), preview: vi.fn(),
  }
  const props = { ...actions, view, t, useSoundsCard: bindSnapshotSelector(store) } as SoundsCardProps
  render(<SoundsCard {...props} />)
  return actions
}

function row(id: string): Element {
  const element = document.querySelector(`[data-sound-id="${id}"]`)
  if (element === null) throw new Error(`missing sound row ${id}`)
  return element
}

describe('SoundsCard', () => {
  it('shows the summary and three unset triggers', () => {
    renderCard(zh, {}, 'summary')
    expect(document.body.textContent).toBe(zh.description)
    cleanup()

    renderCard(zh)
    for (const name of [zh.agent, zh.permissions, zh.errors] as const) {
      expect(screen.getByRole('button', { name }).textContent).toContain(zh.none)
    }
    expect(screen.getByText(zh.agentHint)).toBeTruthy()
    expect(en.title).toBe('Sound effects')
    expect(en.description).toBe('Sounds for the agent, permissions, and errors.')
    expect(en.agentHint).toBe('Play sound when the agent is complete or needs attention')
    expect(en.permissionsHint).toBe('Play sound when a permission is required')
    expect(en.errorsHint).toBe('Play sound when an error occurs')
    expect(en['alert-01']).toBe(zh['alert-01'])
    expect(en['yup-06']).toBe('Yup 06')
  })

  it('previews on highlight and stages a selection without saving', () => {
    const actions = renderCard(en, { dirty: true })
    fireEvent.click(screen.getByRole('button', { name: en.agent }))
    fireEvent.focus(row('alert-01'))
    fireEvent.pointerEnter(row('alert-01'))
    fireEvent.pointerEnter(row('alert-02'))
    expect(actions.preview).toHaveBeenLastCalledWith('alert-02')
    fireEvent.pointerEnter(row('none'))
    expect(actions.preview).toHaveBeenLastCalledWith('none')
    fireEvent.click(screen.getByRole('menuitem', { name: /Alert 01/ }))
    expect(actions.select).toHaveBeenCalledWith('agent', 'alert-01')
    fireEvent.click(screen.getByRole('button', { name: en.agent }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(actions.save).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.save }))
    expect(actions.save).toHaveBeenCalledOnce()
  })

  it('resets an overridden field and says when the value is not a listed sound', () => {
    const actions = renderCard(zh, { agent: field('alert-01', { overridden: true }) })
    fireEvent.click(screen.getByRole('button', { name: zh.reset }))
    expect(actions.resetField).toHaveBeenCalledWith('agent')
    cleanup()

    renderCard(en, { dirty: true, errors: field('nope-99', { invalid: true }), invalid: true })
    expect(screen.getByText(en.invalid)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.save })).toHaveProperty('disabled', true)
  })

  it('says the plugin is unavailable, and disables the menus while read-only', () => {
    renderCard(en, { available: false })
    expect(screen.getByRole('status').textContent).toBe(en.unavailable)
    cleanup()
    renderCard(en, { writable: false })
    expect(screen.getByRole('status').textContent).toBe(en.readOnly)
    expect(screen.getByRole('button', { name: en.agent })).toHaveProperty('disabled', true)
  })
})
