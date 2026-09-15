import { describe, expect, it } from 'vitest'

import type { GameState } from '@game/shared'
import {
  buildPreviewDetails,
  buildPreviewPhaseNodes,
  buildPreviewRuleSections,
} from '@/components/interactionPreviewPanel'

const baseState: GameState = {
  gameId: 'game-1',
  day: 4,
  phase: 'player_trade',
  characters: {
    player: {
      id: 'player',
      resources: { cake: 7, goods: 5, might: 2, coins: 12 },
      tradeSlots: 2,
      alive: true,
      escaped: false,
    },
    san: {
      id: 'san',
      resources: { cake: 8, goods: 3, might: 1, coins: 10 },
      tradeSlots: 1,
      alive: true,
      escaped: false,
    },
    shun: {
      id: 'shun',
      resources: { cake: 3, goods: 9, might: 0, coins: 16 },
      tradeSlots: 2,
      alive: true,
      escaped: false,
    },
    cyclone: {
      id: 'cyclone',
      resources: { cake: 5, goods: 11, might: 4, coins: 7 },
      tradeSlots: 2,
      alive: true,
      escaped: false,
    },
    simon: {
      id: 'simon',
      resources: { cake: 2, goods: 4, might: 0, coins: 18 },
      tradeSlots: 0,
      alive: false,
      escaped: false,
    },
  },
  // Keys are alphabetical — `friendshipKey` sorts before joining.
  friendship: {
    'player:san': 12,
    'player:shun': 5,
    'cyclone:player': 22,
    'player:simon': 1,
    'san:shun': 0,
    'cyclone:san': 0,
    'san:simon': 0,
    'cyclone:shun': 0,
    'shun:simon': 0,
    'cyclone:simon': 0,
  },
  merchantPrices: { cakePrice: 5, goodsPrice: 3 },
  log: [],
  eliminatedIds: ['simon'],
  escapedIds: [],
  winnerId: null,
  aiTurnOrder: ['san', 'shun', 'cyclone', 'simon'],
  currentAiIndex: 0,
  playerNpcTradedToday: ['shun'],
  dungeonState: null,
  playerDungeonUsedToday: false,
  dailyEvent: 'none',
  seed: null,
  updatedAt: '2026-05-24T00:00:00.000Z',
}

describe('interaction preview panel data', () => {
  it('highlights exactly one active phase node', () => {
    const nodes = buildPreviewPhaseNodes('player_trade')
    const active = nodes.filter((node) => node.active)

    expect(nodes).toHaveLength(4)
    expect(active).toHaveLength(1)
    expect(active[0]?.label).toBe('Trade')
  })

  it('merges ai and later phases into resolve', () => {
    const nodes = buildPreviewPhaseNodes('ai_turns')
    const active = nodes.find((node) => node.active)

    expect(active?.label).toBe('Resolve')
  })

  it('includes current market values in the rules popover data', () => {
    const rules = buildPreviewRuleSections(baseState)
    const market = rules.find((section) => section.title === 'Current Market')

    expect(market?.lines).toContain('Kong Soh Biscuits price: 5 coins.')
    expect(market?.lines).toContain('Goods price: 3 coins.')
  })

  it('builds detailed npc stats from current state', () => {
    const details = buildPreviewDetails({
      state: baseState,
      phase: 'player_trade',
      interaction: { kind: 'npc', characterId: 'cyclone', characterName: 'Cyclone' },
      playerTradeSlots: 2,
      getFriendship: () => 22,
      canTradeWithNpc: () => true,
    })

    expect(details.kindLabel).toBe('Resident')
    expect(details.sections[0]?.stats.some((stat) => stat.label === 'Friendship' && stat.value === '22')).toBe(true)
    expect(details.sections[1]?.stats.some((stat) => stat.label === 'Goods' && stat.value === '11')).toBe(true)
    expect(details.sections[2]?.stats.some((stat) => stat.label === 'Might' && stat.value === '4')).toBe(true)
  })

  it('shows training specifics for the martial arts hall', () => {
    const details = buildPreviewDetails({
      state: baseState,
      phase: 'player_labor',
      interaction: { kind: 'train' },
      playerTradeSlots: 2,
      getFriendship: () => 0,
      canTradeWithNpc: () => false,
    })

    expect(details.title).toBe('Martial Arts Hall')
    expect(details.sections[0]?.stats.some((stat) => stat.label === 'Output' && stat.value === '+1 Might')).toBe(true)
  })
})
