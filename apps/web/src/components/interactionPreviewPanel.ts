import { GAME_CONFIG, LABOR_LABELS, RESOURCE_LABELS, type CharacterId, type CharacterState, type DayPhase, type GameState } from '@game/shared'

import type { InteractionType } from '@/game/GameWorld'
import { CHARACTER_META } from '@/stores/game'
import { getInteractionPreviewMeta } from '@/render3d/interactionPreviewMeta'

export type PreviewPhaseNodeId = 'dawn' | 'labor' | 'trade' | 'resolve'

export interface PreviewPhaseNode {
  id: PreviewPhaseNodeId
  label: string
  summary: string
  details: string[]
  active: boolean
}

export interface PreviewRuleSection {
  title: string
  lines: string[]
}

export interface PreviewStat {
  label: string
  value: string
  tone?: 'neutral' | 'accent' | 'good' | 'warn'
}

export interface PreviewSection {
  title: string
  note?: string
  stats: PreviewStat[]
}

export interface PreviewDetails {
  kindLabel: string
  title: string
  subtitle: string
  sections: PreviewSection[]
}

interface PreviewPanelContext {
  state: GameState | null
  phase: DayPhase
  interaction: InteractionType
  playerTradeSlots: number
  getFriendship: (charId: CharacterId) => number
  canTradeWithNpc: (charId: CharacterId) => boolean
}

const PHASE_FLOW: Array<{
  id: PreviewPhaseNodeId
  label: string
  summary: string
  details: string[]
  phaseIds: DayPhase[]
}> = [
  {
    id: 'dawn',
    label: 'Dawn',
    summary: 'Prices and events refresh.',
    details: [
      'Merchant prices roll for the new day.',
      'The daily event resolves here — downpour, festival, windfall, cargo spill or famine.',
      `Everyone resets to ${GAME_CONFIG.TRADE_SLOTS_PER_DAY} trade slots.`,
    ],
    phaseIds: ['day_start'],
  },
  {
    id: 'labor',
    label: 'Labor',
    summary: `Spend the mandatory ${LABOR_LABELS.work} / ${LABOR_LABELS.train} action.`,
    details: [
      `${LABOR_LABELS.work} grants +${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake} and +${GAME_CONFIG.GOODS_PER_WORK} ${RESOURCE_LABELS.goods} immediately.`,
      `${LABOR_LABELS.train} grants +${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might} immediately.`,
      'You must finish labor before trading opens.',
    ],
    phaseIds: ['player_labor'],
  },
  {
    id: 'trade',
    label: 'Trade',
    summary: 'Convert resources into deals or coins.',
    details: [
      `Use up to ${GAME_CONFIG.TRADE_SLOTS_PER_DAY} trade slots.`,
      'Sell to the market or negotiate with one nearby resident.',
      'End the turn once your deals are done.',
    ],
    phaseIds: ['player_trade'],
  },
  {
    id: 'resolve',
    label: 'Resolve',
    summary: 'AI, upkeep, and rollover happen here.',
    details: [
      'The other residents take their labor and trade turns.',
      `Night upkeep consumes ${GAME_CONFIG.DAILY_CAKE_COST} ${RESOURCE_LABELS.cake}. ${RESOURCE_LABELS.goods} are not eaten — they are purely for trade.`,
      'The day either advances to the next dawn or ends the run.',
    ],
    phaseIds: ['ai_turns', 'settlement', 'day_end', 'game_over'],
  },
]

const PHASE_OBJECTIVES: Record<DayPhase, string> = {
  day_start: 'Wait for the new day to finish setting prices and resolving the daily event.',
  player_labor: 'Reach the workshop or the martial arts hall and spend your mandatory labor action.',
  player_trade: 'Trade at the market or negotiate with one nearby resident before ending the turn.',
  ai_turns: 'Observe the other residents\' labor and trades. Player input is paused until they finish.',
  settlement: `Night upkeep resolves: everyone eats ${GAME_CONFIG.DAILY_CAKE_COST} ${RESOURCE_LABELS.cake}.`,
  day_end: 'Daily cleanup is finishing before the next dawn begins.',
  game_over: 'The run has ended. Review the outcome or start over.',
}

export function buildPreviewPhaseNodes(currentPhase: DayPhase): PreviewPhaseNode[] {
  return PHASE_FLOW.map((phase) => ({
    id: phase.id,
    label: phase.label,
    summary: phase.summary,
    details: phase.details,
    active: phase.phaseIds.includes(currentPhase),
  }))
}

export function buildPreviewRuleSections(state: GameState | null): PreviewRuleSection[] {
  return [
    {
      title: 'Win Condition',
      lines: [
        `Reach ${GAME_CONFIG.WIN_COINS} coins and buy your way out before anyone else.`,
        `Current day: ${state?.day ?? 1}.`,
      ],
    },
    {
      title: 'Daily Loop',
      lines: [
        `Labor first: ${LABOR_LABELS.work} for +${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake} and +${GAME_CONFIG.GOODS_PER_WORK} ${RESOURCE_LABELS.goods}, or ${LABOR_LABELS.train} for +${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might}.`,
        `Then spend up to ${GAME_CONFIG.TRADE_SLOTS_PER_DAY} trade slots with residents or the market.`,
      ],
    },
    {
      title: 'Survival',
      lines: [
        `Every night costs ${GAME_CONFIG.DAILY_CAKE_COST} ${RESOURCE_LABELS.cake}. ${RESOURCE_LABELS.goods} are never eaten.`,
        `If your ${RESOURCE_LABELS.cake} hits 0 during settlement, you are eliminated.`,
      ],
    },
    {
      title: 'Current Market',
      lines: [
        `${RESOURCE_LABELS.cake} price: ${state?.merchantPrices.cakePrice ?? 3} coins.`,
        `${RESOURCE_LABELS.goods} price: ${state?.merchantPrices.goodsPrice ?? 2} coins.`,
      ],
    },
  ]
}

export function buildPreviewDetails(context: PreviewPanelContext): PreviewDetails {
  const meta = getInteractionPreviewMeta(context.interaction)
  const player = context.state?.characters.player ?? null

  if (!context.interaction) {
    return {
      kindLabel: 'Survey',
      title: meta.title,
      subtitle: meta.subtitle,
      sections: [
        {
          title: 'Current Objective',
          note: PHASE_OBJECTIVES[context.phase],
          stats: [
            { label: 'Phase', value: getPhaseLabel(context.phase), tone: 'accent' },
            { label: 'Trade Slots', value: String(context.playerTradeSlots) },
            { label: 'Coins to Escape', value: formatCoinsToEscape(player), tone: 'good' },
          ],
        },
        {
          title: 'Supplies',
          stats: buildResourceStats(player),
        },
      ],
    }
  }

  switch (context.interaction.kind) {
    case 'work':
      return {
        kindLabel: 'Resource Node',
        title: meta.title,
        subtitle: meta.subtitle,
        sections: [
          {
            title: 'Yield',
            note: `${LABOR_LABELS.work} pays immediately in both food and merchandise.`,
            stats: [
              {
                label: 'Phase Gate',
                value: context.phase === 'player_labor' ? 'Available now' : 'Labor already spent',
                tone: context.phase === 'player_labor' ? 'good' : 'warn',
              },
              {
                label: 'Output',
                value: `+${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake}, +${GAME_CONFIG.GOODS_PER_WORK} ${RESOURCE_LABELS.goods}`,
                tone: 'good',
              },
              { label: 'Action Cost', value: 'Uses today\'s labor action' },
              { label: 'Night Upkeep', value: `${GAME_CONFIG.DAILY_CAKE_COST} ${RESOURCE_LABELS.cake}`, tone: 'accent' },
            ],
          },
          {
            title: 'Your Supplies',
            stats: buildResourceStats(player),
          },
          ...buildFutureInteractionSections(context.interaction, context.state),
        ],
      }

    case 'train':
      return {
        kindLabel: 'Training Node',
        title: meta.title,
        subtitle: meta.subtitle,
        sections: [
          {
            title: 'Yield',
            note: `${LABOR_LABELS.train} trades food income for ${RESOURCE_LABELS.might} — the leverage you need once deals stop being voluntary.`,
            stats: [
              {
                label: 'Phase Gate',
                value: context.phase === 'player_labor' ? 'Available now' : 'Labor already spent',
                tone: context.phase === 'player_labor' ? 'good' : 'warn',
              },
              { label: 'Output', value: `+${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might}`, tone: 'good' },
              { label: 'Action Cost', value: 'Uses today\'s labor action' },
              { label: 'No Sale Value', value: `Earns no ${RESOURCE_LABELS.goods} to sell`, tone: 'warn' },
            ],
          },
          {
            title: 'Your Supplies',
            stats: buildResourceStats(player),
          },
          ...buildFutureInteractionSections(context.interaction, context.state),
        ],
      }

    case 'merchant': {
      const prices = context.state?.merchantPrices
      const playerCake = player?.resources.cake ?? 0
      const playerGoods = player?.resources.goods ?? 0
      const projectedCoins = prices
        ? playerCake * prices.cakePrice + playerGoods * prices.goodsPrice
        : 0

      return {
        kindLabel: 'Trader',
        title: meta.title,
        subtitle: meta.subtitle,
        sections: [
          {
            title: 'Market Rates',
            note: 'The night market is the only direct path from goods into coins.',
            stats: [
              {
                label: 'Phase Gate',
                value: context.phase === 'player_trade' ? 'Open now' : 'Trade phase only',
                tone: context.phase === 'player_trade' ? 'good' : 'warn',
              },
              { label: `${RESOURCE_LABELS.cake} Price`, value: `${prices?.cakePrice ?? 0} coins` },
              { label: `${RESOURCE_LABELS.goods} Price`, value: `${prices?.goodsPrice ?? 0} coins` },
              { label: 'Trade Slots Left', value: String(context.playerTradeSlots) },
              { label: 'All-In Sale Value', value: `${projectedCoins} coins`, tone: 'accent' },
            ],
          },
          {
            title: 'Your Inventory',
            stats: buildResourceStats(player),
          },
          ...buildFutureInteractionSections(context.interaction, context.state),
        ],
      }
    }

    case 'npc': {
      const target = context.state?.characters[context.interaction.characterId] ?? null
      const personality = CHARACTER_META[context.interaction.characterId]?.personality ?? 'Unknown'
      const canTrade = canTradeWithNpc(context, target, context.interaction.characterId)

      return {
        kindLabel: 'Resident',
        title: meta.title,
        subtitle: meta.subtitle,
        sections: [
          {
            title: 'Profile',
            note: 'All currently known NPC values surface here. Extend future interaction-specific values in the helper.',
            stats: [
              { label: 'Personality', value: personality },
              { label: 'Status', value: formatCharacterStatus(target), tone: statusTone(target) },
              { label: 'Friendship', value: String(context.getFriendship(context.interaction.characterId)), tone: 'accent' },
              {
                label: 'Trade Access',
                value: canTrade.label,
                tone: canTrade.tone,
              },
              { label: 'Trade Slots', value: String(target?.tradeSlots ?? 0) },
            ],
          },
          {
            title: 'Resources',
            stats: buildResourceStats(target),
          },
          {
            title: 'Leverage',
            note: `${RESOURCE_LABELS.might} decides who can force a trade rather than ask for one.`,
            stats: [
              { label: RESOURCE_LABELS.might, value: String(target?.resources.might ?? 0), tone: 'accent' },
            ],
          },
          ...buildFutureInteractionSections(context.interaction, context.state),
        ],
      }
    }

    case 'dungeon': {
      const usedToday = context.state?.playerDungeonUsedToday === true
      const inTradePhase = context.phase === 'player_trade'
      const hasSlots = context.playerTradeSlots > 0

      let runStatus: { label: string; tone: PreviewStat['tone'] }
      if (usedToday) runStatus = { label: 'Already entered today', tone: 'warn' }
      else if (!inTradePhase) runStatus = { label: 'Trade phase only', tone: 'warn' }
      else if (!hasSlots) runStatus = { label: 'No trade slots', tone: 'warn' }
      else runStatus = { label: 'Ready to enter', tone: 'good' }

      return {
        kindLabel: 'Boss Dungeon',
        title: meta.title,
        subtitle: meta.subtitle,
        sections: [
          {
            title: 'Run Conditions',
            note: 'A boss guards the cave. Win for coins, lose and pay in resources. One run per day.',
            stats: [
              { label: 'Status', value: runStatus.label, tone: runStatus.tone },
              { label: 'Cost', value: '1 trade slot' },
              { label: 'Phase Gate', value: inTradePhase ? 'Open now' : 'Trade phase only', tone: inTradePhase ? 'good' : 'warn' },
              { label: 'Trade Slots Left', value: String(context.playerTradeSlots) },
            ],
          },
          {
            title: 'Outcomes',
            stats: [
              { label: 'Win Reward', value: `+${GAME_CONFIG.DUNGEON_COIN_REWARD} coins`, tone: 'good' },
              { label: 'Loss Penalty', value: `-${GAME_CONFIG.DUNGEON_RESOURCE_PENALTY} ${RESOURCE_LABELS.cake} & ${RESOURCE_LABELS.goods}`, tone: 'warn' },
              { label: 'Boss HP', value: String(GAME_CONFIG.BOSS_MAX_HP), tone: 'accent' },
              { label: 'Player HP', value: String(GAME_CONFIG.PLAYER_MAX_HP) },
            ],
          },
          {
            title: 'Your Supplies',
            stats: buildResourceStats(player),
          },
          ...buildFutureInteractionSections(context.interaction, context.state),
        ],
      }
    }
  }
}

function buildResourceStats(character: CharacterState | null): PreviewStat[] {
  return [
    { label: RESOURCE_LABELS.cake, value: String(character?.resources.cake ?? 0) },
    { label: RESOURCE_LABELS.goods, value: String(character?.resources.goods ?? 0) },
    { label: RESOURCE_LABELS.might, value: String(character?.resources.might ?? 0) },
    { label: RESOURCE_LABELS.coins, value: String(character?.resources.coins ?? 0), tone: 'good' },
  ]
}

function canTradeWithNpc(
  context: PreviewPanelContext,
  target: CharacterState | null,
  npcId: CharacterId,
) {
  if (!target || !target.alive || target.escaped) {
    return { label: 'Unavailable', tone: 'warn' as const }
  }

  if (context.phase !== 'player_trade') {
    return { label: 'Trade phase only', tone: 'warn' as const }
  }

  if (context.playerTradeSlots <= 0) {
    return { label: 'No trade slots left', tone: 'warn' as const }
  }

  if (!context.canTradeWithNpc(npcId)) {
    return { label: 'Already traded today', tone: 'warn' as const }
  }

  return { label: 'Ready to negotiate', tone: 'good' as const }
}

function formatCharacterStatus(character: CharacterState | null): string {
  if (!character) return 'Unknown'
  if (character.escaped) return 'Escaped'
  if (!character.alive) return 'Eliminated'
  return 'Active'
}

function statusTone(character: CharacterState | null): PreviewStat['tone'] {
  if (!character) return 'warn'
  if (character.escaped) return 'accent'
  if (!character.alive) return 'warn'
  return 'good'
}

function formatCoinsToEscape(player: CharacterState | null): string {
  const coins = player?.resources.coins ?? 0
  return `${Math.max(GAME_CONFIG.WIN_COINS - coins, 0)} remaining`
}

function getPhaseLabel(phase: DayPhase): string {
  switch (phase) {
    case 'day_start':
      return 'Dawn'
    case 'player_labor':
      return 'Labor'
    case 'player_trade':
      return 'Trade'
    case 'ai_turns':
    case 'settlement':
    case 'day_end':
      return 'Resolve'
    case 'game_over':
      return 'Game Over'
  }
}

function buildFutureInteractionSections(_interaction: InteractionType, _state: GameState | null): PreviewSection[] {
  // Future interaction-specific hooks belong here so new map objects can add
  // parameter blocks without rewriting the panel component or base switch.
  return []
}
