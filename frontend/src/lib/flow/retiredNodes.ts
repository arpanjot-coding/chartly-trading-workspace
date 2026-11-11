/**
 * Migration for node types Chartly has removed.
 *
 * Telegram and WhatsApp alert nodes were deleted with the messaging bots.
 * A workflow saved before that removal still carries those node types, and
 * ReactFlow cannot render an unregistered type: the node would vanish from
 * the canvas without a word. Convert it instead to a visible Log node that
 * says the step no longer sends, so the trader can delete or replace it.
 * The conversion marks the canvas dirty, so the next save persists it.
 */

const RETIRED_NODE_MESSAGES: Readonly<Record<string, string>> = {
  telegramAlert: 'Telegram alerts were removed from Chartly. This step no longer sends.',
  whatsappAlert: 'WhatsApp alerts were removed from Chartly. This step no longer sends.',
}

export interface RetiredNodeMigration<T> {
  nodes: T[]
  migrated: boolean
}

export function migrateRetiredNodes<
  T extends { type?: string; data?: Record<string, unknown> },
>(nodes: readonly T[]): RetiredNodeMigration<T> {
  let migrated = false
  const next = nodes.map((node) => {
    const message = node.type ? RETIRED_NODE_MESSAGES[node.type] : undefined
    if (!message) return node
    migrated = true
    return { ...node, type: 'log', data: { message, level: 'warn' } }
  })
  return { nodes: next, migrated }
}
