// Only a structured checkpoint uses the compaction marker; all other outcomes
// retain the command's complete settlement text.

import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import { CompactionItem } from './CompactionItem.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'

interface CompactionCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  renderMessageImages?: RenderMessageImages
}

/** Render one manual compaction lifecycle without duplicating its checkpoint marker. */
export function CompactionCommandCard({ node, compaction, renderMessageImages, t }: CompactionCommandCardProps) {
  if (compaction !== undefined) {
    return (
      <CompactionItem
        node={compaction}
        title={t('message.compaction.commandTitle')}
        fallbackSummary={node.outcome?.text ?? null}
        {...renderMessageImages === undefined ? {} : { renderMessageImages }}
        t={t}
      />
    )
  }
  if (node.outcome !== null) return <GenericCommandCard node={node} t={t} />
  return <GenericCommandCard node={node} t={t} runningSummary={t('message.compaction.running')} />
}
