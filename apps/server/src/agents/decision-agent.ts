import {
  type GameState,
  type CharacterId,
  type AICharacterId,
  type AIDecision,
  type AILaborDecision,
  type AITradeDecision,
  AI_CHARACTERS,
  friendshipKey,
  GAME_CONFIG,
  RESOURCE_LABELS,
  LABOR_LABELS,
} from '@game/shared'
import { getPersonality, llmFacingName } from './personalities'
import { formatResources } from './format'
import { chatJSON } from './llm'

function buildGameContext(state: GameState, charId: AICharacterId): string {
  const me = state.characters[charId]
  if (!me) return 'You are eliminated.'

  const lines: string[] = []
  lines.push(`Day ${state.day}. You are ${getPersonality(charId).name}.`)
  lines.push(`Your resources: ${formatResources(me.resources)}`)
  lines.push(`Trade slots remaining today: ${me.tradeSlots}`)
  lines.push(`Market rates today: ${RESOURCE_LABELS.cake}=${state.merchantPrices.cakePrice} coins each, ${RESOURCE_LABELS.goods}=${state.merchantPrices.goodsPrice} coins each`)
  lines.push('')

  lines.push('Other characters in the walled city (id in brackets — use the id when you act):')
  for (const otherId of [...AI_CHARACTERS, 'player' as CharacterId]) {
    if (otherId === charId) continue
    const other = state.characters[otherId]
    const label = `${llmFacingName(otherId)} [${otherId}]`
    if (!other || !other.alive || other.escaped) {
      if (other?.escaped) lines.push(`  - ${label}: ESCAPED`)
      else if (other && !other.alive) lines.push(`  - ${label}: ELIMINATED`)
      continue
    }
    const fKey = friendshipKey(charId, otherId)
    const friendship = state.friendship[fKey] || 0
    lines.push(`  - ${label}: ${formatResources(other.resources)} (friendship: ${friendship})`)
  }

  lines.push('')
  lines.push(`Goal: reach ${GAME_CONFIG.WIN_COINS} coins to buy your way out of the walled city.`)
  lines.push(`Every night you eat 1 ${RESOURCE_LABELS.cake}. If you have none left, you starve.`)

  return lines.join('\n')
}

const FULL_DECISION_PROMPT = `You are an AI character in a survival trading game called Kowloon Walled City.
Each turn you MUST do two things in order:
1. LABOR: choose either "work" (${LABOR_LABELS.work} — +${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake} and +${GAME_CONFIG.GOODS_PER_WORK} ${RESOURCE_LABELS.goods} instantly) or "train" (${LABOR_LABELS.train} — +${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might} instantly)
2. TRADE: you have 2 trade slots. For each slot, choose to trade with the merchant, negotiate with another character, or skip.

{PERSONALITY}

Respond with a JSON object. Keep every "reasoning" field to ONE short sentence (max ~15 words) — long reasoning will get truncated and break the response.
{
  "labor": {
    "labor": "work" or "train",
    "reasoning": "short reason"
  },
  "trades": [
    {
      "action": "trade_merchant" or "trade_peer" or "skip",
      "merchantSell": { "cake": 0, "goods": 0 },
      "tradeTarget": "the target's id (the value in brackets), e.g. \\"shun\\"",
      "reasoning": "short reason"
    },
    {
      "action": "skip",
      "reasoning": "short reason"
    }
  ]
}

The keys "cake", "goods", "coins", "might" are always the exact keys in your JSON — never write the display names you see in the text.

Rules:
- LABOR is mandatory. You must choose work or train.
- "tradeTarget" MUST be the id in brackets from the character list (e.g. "shun"), never the display name.
- TRADES array should have exactly 2 entries (one per trade slot).
- You can only sell resources you actually have.
- Don't sell so much that you'll starve tonight (keep at least 2 cake after all trades).
- "might" is a personal stat, not merchandise — it can never appear in merchantSell or a peer offer.
- Consider friendship, market prices, who has what you need.
- If someone is close to buying their way out (high coins), you might want to avoid helping them.
- High friendship means better deals and more trust.
- Keep reasoning terse — one short sentence each, no flowery prose.`

export async function getAIDecision(
  state: GameState,
  charId: AICharacterId,
): Promise<AIDecision> {
  const personality = getPersonality(charId)
  const context = buildGameContext(state, charId)
  const systemPrompt = FULL_DECISION_PROMPT.replace('{PERSONALITY}', personality.systemPrompt)

  try {
    const raw = await chatJSON<Record<string, unknown>>(systemPrompt, context)

    // Parse labor. Anything that isn't exactly "train" falls back to "work" —
    // an unrecognised value from the model must never cost a character its life.
    const laborRaw = raw.labor as Record<string, unknown> | undefined
    const labor: AILaborDecision = {
      labor: laborRaw?.labor === 'train' ? 'train' : 'work',
      reasoning: (laborRaw?.reasoning as string) || 'AI decided.',
    }

    // Parse trades
    const tradesRaw = (raw.trades as Record<string, unknown>[]) || []
    const trades: AITradeDecision[] = tradesRaw.slice(0, 2).map(t => {
      const action = t.action as string
      if (action === 'trade_merchant') {
        return {
          action: 'trade_merchant' as const,
          merchantSell: t.merchantSell as { cake: number; goods: number } | undefined,
          reasoning: (t.reasoning as string) || '',
        }
      }
      if (action === 'trade_peer') {
        return {
          action: 'trade_peer' as const,
          tradeTarget: t.tradeTarget as CharacterId | undefined,
          reasoning: (t.reasoning as string) || '',
        }
      }
      return {
        action: 'skip' as const,
        reasoning: (t.reasoning as string) || 'No trade this slot.',
      }
    })

    // Pad to 2 trades if needed
    while (trades.length < 2) {
      trades.push({ action: 'skip', reasoning: 'No trade.' })
    }

    return { labor, trades }
  } catch (err) {
    console.error(`AI decision failed for ${charId}:`, err)
    return {
      labor: { labor: 'work', reasoning: 'Error fallback: working.' },
      trades: [
        { action: 'skip', reasoning: 'Error fallback.' },
        { action: 'skip', reasoning: 'Error fallback.' },
      ],
    }
  }
}
