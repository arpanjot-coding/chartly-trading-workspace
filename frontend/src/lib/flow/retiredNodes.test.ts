import { describe, expect, it } from 'vitest'
import { migrateRetiredNodes } from './retiredNodes'

const node = (type: string, data: Record<string, unknown> = {}) => ({
  id: `n-${type}`,
  type,
  position: { x: 0, y: 0 },
  data,
})

describe('migrateRetiredNodes', () => {
  it('converts a saved telegram alert node to a visible log node', () => {
    const { nodes, migrated } = migrateRetiredNodes([node('telegramAlert', { text: 'hi' })])
    expect(migrated).toBe(true)
    expect(nodes[0].type).toBe('log')
    expect(nodes[0].data.level).toBe('warn')
    expect(String(nodes[0].data.message)).toContain('Telegram alerts were removed')
    expect(nodes[0].id).toBe('n-telegramAlert')
  })

  it('converts a saved whatsapp alert node the same way', () => {
    const { nodes, migrated } = migrateRetiredNodes([node('whatsappAlert')])
    expect(migrated).toBe(true)
    expect(nodes[0].type).toBe('log')
    expect(String(nodes[0].data.message)).toContain('WhatsApp alerts were removed')
  })

  it('leaves current node types untouched', () => {
    const original = [node('start'), node('placeOrder', { symbol: 'EURUSD' }), node('log')]
    const { nodes, migrated } = migrateRetiredNodes(original)
    expect(migrated).toBe(false)
    expect(nodes).toEqual(original)
  })
})
