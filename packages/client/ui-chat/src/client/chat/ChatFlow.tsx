/** Ordered Chat rows, local echoes, and running status share the flow slot's parent. */
import { memo, useCallback, useMemo } from 'react'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ChatGroupSeat } from './ChatGroupSeat.tsx'
import { PendingSteeringBubble, PendingSubmissionBubble } from './MessageItem.tsx'
import { chatRenderKey } from './render-entry.ts'
import { collectRetractedTurns, REVERT_CHROME_KINDS } from './revert-visibility.ts'
import { RunningStatus } from './RunningStatus.tsx'

/** Render the flow without adding a DOM parent or changing keyed row positions. */
export const ChatFlow = memo(function ChatFlow({
  entries, pendingInputs, lastInputTurn, deferCollapse,
  useSession, useChat, useChatNode, useChatNodeBottom, useChatNodeProcess, useChatGroup, usePresentation,
  useStore, actions, renderSlot, t, useGroupAction, useGroupHeaderAction,
  cwd, openFile, openSkill, inspectCall, forkAt, revertAt, loadImage, fileMentions,
}: ChatFlowSlotProps) {
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const order = useChat(snapshot => snapshot.order)
  const running = useSession(snapshot => snapshot.running)
  const revert = useSession(snapshot => snapshot.revert)
  const retracted = useMemo(() => collectRetractedTurns(order.flatMap((key) => {
    const node = nodeStore.get(key)
    if (node === undefined) return []
    const location = node.location
    const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
    return [{ kind: node.kind, anchorSeq: node.anchorSeq, turn }]
  }), revert), [order, nodeStore, revert])
  const latestTurnAnchor = useChat((snapshot) => {
    const items = snapshot.navigation.items()
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index]
      if (item === undefined) continue
      const node = snapshot.nodes.get(item.anchorKey)
      if (node === undefined) continue
      const location = node.location
      const turn = location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
      if (turn !== undefined && retracted.has(turn)) continue
      return item.anchorKey
    }
    return undefined
  })
  const runningStartTime = useChatNode(latestTurnAnchor ?? '', (node) => {
    const location = node?.location
    return location?.kind === 'turn' || location?.kind === 'step'
      ? location.turn.status === 'open' ? location.turn.start?.time : undefined
      : undefined
  })
  const renderMessageImages = useCallback<RenderMessageImages>(
    owner => renderSlot('conversation.message.images', { ...owner, loadImage }),
    [loadImage, renderSlot],
  )
  const seatProps = {
    nodeStore, useChatNode, useChatNodeBottom, useChatNodeProcess, usePresentation,
    useStore, actions, renderSlot, t, useGroupAction, deferCollapse,
    cwd, openFile, openSkill, inspectCall, forkAt, revertAt, revert, loadImage, renderMessageImages, fileMentions,
  }
  const rows = entries.map((entry) => {
    switch (entry.kind) {
      case 'node': {
        const node = nodeStore.get(entry.key)
        const location = node?.location
        const turn = location?.kind === 'turn' || location?.kind === 'step' ? location.turn.turn : undefined
        if (node !== undefined && turn !== undefined && retracted.has(turn)
          && REVERT_CHROME_KINDS[node.kind] === true) return null
        return <ChatNodeSeat {...seatProps} key={chatRenderKey(entry)} nodeKey={entry.key}
          {...entry.groupPart === undefined ? {} : { groupPart: entry.groupPart }} />
      }
      case 'group':
        return <ChatGroupSeat {...seatProps} key={chatRenderKey(entry)} groupKey={entry.key}
          useChatGroup={useChatGroup} useGroupHeaderAction={useGroupHeaderAction} />
      default:
        return assertNever(entry)
    }
  })
  const pendingRows = pendingInputs.map(item => 'requestId' in item ? (
    <PendingSubmissionBubble key={item.requestId} submission={item}
      renderMessageImages={renderMessageImages} t={t} />
  ) : (
    <PendingSteeringBubble key={item.id} content={item.content}
      renderMessageImages={renderMessageImages} t={t} />
  ))
  const tail = entries.at(-1)
  const node = tail?.kind === 'node' ? nodeStore.get(tail.key) : undefined
  // An empty opening control follows one local transcript echo, never steering.
  // All rows share this keyed list so inserting the control keeps the echo mounted.
  if (node?.kind === 'turn-process' && node.location.kind === 'turn'
    && node.location.turn.status === 'open' && node.location.turn.turn !== lastInputTurn) {
    const index = pendingInputs.findIndex(item => 'requestId' in item && item.placement === 'transcript')
    if (index !== -1) rows.splice(rows.length - 1, 0, ...pendingRows.splice(index, 1))
  }
  return [...rows, ...pendingRows, ...running ? [<RunningStatus key="running" startTime={runningStartTime} t={t} />] : []]
})
