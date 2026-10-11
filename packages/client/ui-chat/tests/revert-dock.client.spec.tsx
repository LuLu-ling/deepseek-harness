// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { describe, expect, it, vi } from 'vitest'
import { RevertDock, type RevertDockProps } from '../src/client/chat/RevertDock.tsx'
import { zh } from '../src/client/locale.ts'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'

const staged: SessionSnapshot['revert'] = { staged: { atSeq: 2 }, committed: [] }
const t = makeTranslate(zh, commonZh)

function renderDock(restore: RevertDockProps['restore'], clear: RevertDockProps['clear']) {
  return render(
    <RevertDock
      useSession={selector => selector({ revert: staged } as SessionSnapshot)}
      hiddenMessages={() => [
        { seq: 2, text: 'two' },
        { seq: 5, text: 'five' },
      ]}
      restore={restore}
      clear={clear}
      t={t}
    />,
  )
}

describe('RevertDock', () => {
  it('lists hidden messages and restores one or all of them', () => {
    const restore = vi.fn()
    const clear = vi.fn()
    const view = renderDock(restore, clear)
    fireEvent.click(view.getByRole('button', { name: '已撤回 2 条消息 two' }))
    fireEvent.click(view.getAllByRole('button', { name: '恢复这条消息' })[0]!)
    expect(restore).toHaveBeenCalledWith(2)
    fireEvent.click(view.getByRole('button', { name: '全部恢复' }))
    expect(clear).toHaveBeenCalledOnce()
  })

  it('omits restore all when only one message is hidden', () => {
    cleanup()
    const view = render(
      <RevertDock
        useSession={selector => selector({ revert: staged } as SessionSnapshot)}
        hiddenMessages={() => [{ seq: 2, text: 'only' }]}
        restore={vi.fn()}
        clear={vi.fn()}
        t={t}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '已撤回 1 条消息 only' }))
    expect(view.getByRole('button', { name: '恢复这条消息' })).toBeTruthy()
    expect(view.queryByRole('button', { name: '全部恢复' })).toBeNull()
  })
})
