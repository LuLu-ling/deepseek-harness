// @vitest-environment jsdom
/** Fixed reasoning-level list: empty wires are omitted, filled wires are stored. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelReasoningEfforts } from '../src/client/ModelReasoningEfforts.tsx'
import { en } from '../src/client/locales.ts'

const LEVELS = ['Off', 'Minimal', 'Low', 'Medium', 'High', 'Xhigh', 'Max'] as const

afterEach(cleanup)

describe('ModelReasoningEfforts', () => {
  it('lists every level in selector order and writes nothing until a wire is filled', () => {
    const onChange = vi.fn()
    render(<ModelReasoningEfforts model={{ id: 'm' }} position={1} disabled={false} t={key => en[key]} onChange={onChange} />)
    expect(screen.getByRole('group', { name: `${en.modelReasoning} 1` }).querySelectorAll('select, button')).toHaveLength(0)
    expect(LEVELS.map(level => (screen.getByLabelText(`${level} 1`) as HTMLInputElement).value)).toEqual(LEVELS.map(() => ''))
    expect(screen.getByLabelText('Off 1').getAttribute('title')).toBe(en.modelReasoningEmpty)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('stores only filled wires, in selector order', () => {
    const onChange = vi.fn()
    render(<ModelReasoningEfforts
      model={{ id: 'm', reasoningEfforts: { high: 'think' } }}
      position={1} disabled={false} t={key => en[key]} onChange={onChange}
    />)
    expect((screen.getByLabelText('High 1') as HTMLInputElement).value).toBe('think')
    fireEvent.change(screen.getByLabelText('Minimal 1'), { target: { value: 'low' } })
    expect(onChange).toHaveBeenCalledWith({ id: 'm', reasoningEfforts: { minimal: 'low', high: 'think' } })
  })

  it('treats an empty wire as absent, including a stored null, and drops the field when none remain', () => {
    const onChange = vi.fn()
    render(<ModelReasoningEfforts
      model={{ id: 'm', name: 'kept', reasoningEfforts: { high: 'think', off: null } }}
      position={1} disabled={false} t={key => en[key]} onChange={onChange}
    />)
    expect((screen.getByLabelText('Off 1') as HTMLInputElement).value).toBe('')
    fireEvent.change(screen.getByLabelText('High 1'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ id: 'm', name: 'kept' })
  })
})
