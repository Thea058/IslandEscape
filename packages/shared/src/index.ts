import { z } from 'zod'

// ============================================================
// Kowloon Walled City — Shared Types
// ============================================================

// ----- Game configuration constants -----

export const GAME_CONFIG = {
  STARTING_CAKE: 5,
  STARTING_GOODS: 0,
  STARTING_MIGHT: 3,
  STARTING_COINS: 0,
  /** 打工 yields both: a little food to survive on, and goods to sell. */
  CAKE_PER_WORK: 1,
  GOODS_PER_WORK: 2,
  /** 学武 yields might, which stage C will spend on forcing trades. */
  MIGHT_PER_TRAINING: 1,
  /** Only cake is eaten overnight — goods are purely a trade commodity. */
  DAILY_CAKE_COST: 1,
  WIN_COINS: 100,
  TRADE_SLOTS_PER_DAY: 2,
  MAX_NEGOTIATION_EXCHANGES: 5,
  FRIENDSHIP_TRADE_BONUS: 5,
  MERCHANT_CAKE_PRICE_RANGE: [2, 6] as const,
  MERCHANT_GOODS_PRICE_RANGE: [1, 4] as const,
  // Dungeon
  PLAYER_MAX_HP: 15,
  BOSS_MAX_HP: 150,
  BASE_BULLET_DAMAGE: 2,
  BASE_BULLET_COOLDOWN: 400,
  BASE_MOVE_SPEED: 160,
  BOSS_BULLET_DAMAGE: 5,
  BOSS_CHARGE_DAMAGE: 6,
  BOSS_CHARGE_SPEED: 300,
  /** Base coin reward for clearing the dungeon. Day-scales additively in resolveDungeon. */
  DUNGEON_COIN_REWARD: 15,
  DUNGEON_RESOURCE_PENALTY: 5,
  XP_PER_ORB: 10,
  XP_THRESHOLDS: [60, 130, 220, 330, 460, 610, 780] as readonly number[],
} as const

// ----- Character & resource types -----

export const CharacterIdSchema = z.enum(['player', 'san', 'shun', 'cyclone', 'simon'])
export type CharacterId = z.infer<typeof CharacterIdSchema>

/**
 * The AI-driven subset of CharacterId, derived from the enum above so the two
 * can never drift apart.
 *
 * Narrower than CharacterId on purpose: prompt building and negotiation only
 * ever run for AI characters, and typing them against this schema turns
 * "forgot the player has no personality" from a runtime `getPersonality('player')`
 * throw into a compile error.
 */
export const AICharacterIdSchema = CharacterIdSchema.exclude(['player'])
export type AICharacterId = z.infer<typeof AICharacterIdSchema>

export const ALL_CHARACTERS: CharacterId[] = ['player', 'san', 'shun', 'cyclone', 'simon']
export const AI_CHARACTERS: AICharacterId[] = ['san', 'shun', 'cyclone', 'simon']

/**
 * Everything a character holds.
 *
 * `might` (武力) lives here rather than on CharacterState because the AI's
 * decision prompt already renders this whole object, and stage C needs NPCs to
 * be able to see each other's might before deciding whether to force a trade.
 */
export const ResourcesSchema = z.object({
  cake: z.number().int(),
  goods: z.number().int(),
  might: z.number().int(),
  coins: z.number().int(),
})
export type Resources = z.infer<typeof ResourcesSchema>

/**
 * Display names, keyed by the machine id.
 *
 * Same decoupling as character ids: the schema key is what the engine and the
 * database speak, the label is what the player and the LLM see. Nothing in the
 * engine should ever branch on a label — `cake` is a biscuit today and could be
 * anything tomorrow, and only this table would change.
 */
export const RESOURCE_LABELS = {
  cake: 'Kong Soh Biscuits',
  goods: 'Goods',
  might: 'Might',
  coins: 'Coins',
} as const satisfies Record<keyof Resources, string>

// ----- Friendship -----

export function friendshipKey(a: CharacterId, b: CharacterId): string {
  return [a, b].sort().join(':')
}

// ----- Night market -----

export const MerchantPricesSchema = z.object({
  cakePrice: z.number().int().min(1),
  goodsPrice: z.number().int().min(1),
})
export type MerchantPrices = z.infer<typeof MerchantPricesSchema>

// ----- Character state -----

export const CharacterStateSchema = z.object({
  id: CharacterIdSchema,
  resources: ResourcesSchema,
  tradeSlots: z.number().int().min(0).max(GAME_CONFIG.TRADE_SLOTS_PER_DAY),
  alive: z.boolean(),
  escaped: z.boolean(),
})
export type CharacterState = z.infer<typeof CharacterStateSchema>

// ----- Trade proposal -----

/**
 * What one side puts on the table. `might` is deliberately absent: 武力 is spent
 * to *force* a trade (stage C), never handed over as part of one.
 */
export const TradeOfferSchema = z.object({
  cake: z.number().int().min(0).default(0),
  goods: z.number().int().min(0).default(0),
  coins: z.number().int().min(0).default(0),
})
export type TradeOffer = z.infer<typeof TradeOfferSchema>

export const TradeProposalSchema = z.object({
  from: CharacterIdSchema,
  to: CharacterIdSchema,
  offer: TradeOfferSchema,
  request: TradeOfferSchema,
})
export type TradeProposal = z.infer<typeof TradeProposalSchema>

// ----- AI decision (structured output from LLM) -----

/**
 * The two labor actions (step 1: mandatory).
 *
 * `work` = odd jobs (+cake, +goods) and `train` = practice kung fu (+might). The
 * ids describe the mechanic, not the fiction's nouns, so re-theming the setting
 * again would not touch the engine.
 */
export const LABOR_ACTIONS = ['work', 'train'] as const
export type LaborAction = (typeof LABOR_ACTIONS)[number]

/** Display names, same key/label split as RESOURCE_LABELS. */
export const LABOR_LABELS = {
  work: 'odd jobs',
  train: 'practice kung fu',
} as const satisfies Record<LaborAction, string>

export const AILaborDecisionSchema = z.object({
  labor: z.enum(LABOR_ACTIONS),
  reasoning: z.string(),
})
export type AILaborDecision = z.infer<typeof AILaborDecisionSchema>

// AI trade action (step 2: per trade slot, optional)
export const AITradeDecisionSchema = z.object({
  action: z.enum(['trade_merchant', 'trade_peer', 'skip']),
  merchantSell: z.object({
    cake: z.number().int().min(0).default(0),
    goods: z.number().int().min(0).default(0),
  }).optional(),
  tradeTarget: CharacterIdSchema.optional(),
  reasoning: z.string(),
})
export type AITradeDecision = z.infer<typeof AITradeDecisionSchema>

// Combined AI turn (labor + up to 2 trades)
export const AIDecisionSchema = z.object({
  labor: AILaborDecisionSchema,
  trades: z.array(AITradeDecisionSchema).max(2),
})
export type AIDecision = z.infer<typeof AIDecisionSchema>

// ----- Negotiation message -----

export const NegotiationMessageSchema = z.object({
  speaker: CharacterIdSchema,
  text: z.string(),
  proposal: TradeProposalSchema.optional(),
  accept: z.boolean().optional(),
})
export type NegotiationMessage = z.infer<typeof NegotiationMessageSchema>

// ----- Dungeon -----

export const DungeonResultSchema = z.object({
  win: z.boolean(),
  damageDealt: z.number().int(),
  damageTaken: z.number().int(),
  cardsCollected: z.number().int(),
})
export type DungeonResult = z.infer<typeof DungeonResultSchema>

export const DungeonStateSchema = z.object({
  active: z.boolean(),
})
export type DungeonState = z.infer<typeof DungeonStateSchema>

// ----- Day phase -----

export const DayPhaseSchema = z.enum([
  'day_start',
  'player_labor',      // player must choose work (打工) or train (学武)
  'player_trade',      // player uses 2 trade slots (optional, can end early)
  'ai_turns',          // each AI: labor first, then trade
  'settlement',
  'day_end',
  'game_over',
])
export type DayPhase = z.infer<typeof DayPhaseSchema>

// ----- Daily random events -----

export const DailyEventSchema = z.enum([
  'none',
  'storm',         // 打工 yields only 1 goods today (halved)
  'festival',      // friendship gains doubled on peer trades
  'windfall',      // every alive character gains +2 cake at dawn
  'cargo_spill',   // every alive character gains +2 goods at dawn
  'famine',        // night upkeep costs 2 cake instead of 1
])
export type DailyEvent = z.infer<typeof DailyEventSchema>

export const DAILY_EVENT_INFO: Record<DailyEvent, { label: string; icon: string; desc: string }> = {
  none: {
    label: 'Calm day',
    icon: '☀️',
    desc: 'A normal day in the walled city. Standard rules apply.',
  },
  storm: {
    label: 'Downpour',
    icon: '⛈️',
    desc: 'The alleys flood — 打工 yields only 1 货物 today (instead of 2).',
  },
  festival: {
    label: 'Festival',
    icon: '🎉',
    desc: 'A festive mood — friendship gained from peer trades is doubled today.',
  },
  windfall: {
    label: 'Windfall',
    icon: '🥮',
    desc: 'A crate of 光酥饼 fell off a truck — every alive character gained +2 at dawn.',
  },
  cargo_spill: {
    label: 'Cargo Spill',
    icon: '📦',
    desc: 'A smuggler\'s stash was abandoned — every alive character gained +2 货物 at dawn.',
  },
  famine: {
    label: 'Famine',
    icon: '🏜️',
    desc: 'The stalls are bare — tonight\'s upkeep costs 2 光酥饼 instead of 1.',
  },
}

// ----- Full game state -----

/**
 * Deterministic PRNG (mulberry32). Tiny, dependency-free, and good enough for
 * game logic: given the same seed it produces the same sequence, which is
 * what makes a run replayable.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const GameStateSchema = z.object({
  gameId: z.string(),
  day: z.number().int().min(1),
  phase: DayPhaseSchema,
  characters: z.record(CharacterIdSchema, CharacterStateSchema),
  friendship: z.record(z.string(), z.number()),
  merchantPrices: MerchantPricesSchema,
  log: z.array(z.string()),
  eliminatedIds: z.array(CharacterIdSchema),
  escapedIds: z.array(CharacterIdSchema),
  winnerId: CharacterIdSchema.nullable(),
  aiTurnOrder: z.array(AICharacterIdSchema),
  currentAiIndex: z.number().int(),
  dungeonState: DungeonStateSchema.nullable().default(null),
  /** NPCs the player has traded with today (prevents duplicate trades) */
  playerNpcTradedToday: z.array(CharacterIdSchema),
  /** True if the player has already entered the dungeon today (one run per day). */
  playerDungeonUsedToday: z.boolean().default(false),
  /** A random per-day modifier (storm, festival, drought, …) for variety. */
  dailyEvent: DailyEventSchema.default('none'),
  /** Seed the run was created with; null means unseeded (non-deterministic). */
  seed: z.number().int().nullable().default(null),
  updatedAt: z.string().datetime(),
})
export type GameState = z.infer<typeof GameStateSchema>

// ----- Player action (what the frontend sends) -----

export const PlayerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('work') }),
  z.object({ type: z.literal('train') }),
  z.object({
    type: z.literal('trade_merchant'),
    // No `coins` here on purpose — the merchant only buys goods, it doesn't
    // buy back its own money.
    sell: z.object({
      cake: z.number().int().min(0).default(0),
      goods: z.number().int().min(0).default(0),
    }),
  }),
  z.object({
    type: z.literal('trade_peer'),
    // A peer trade always has an NPC counterparty — the player cannot trade
    // with themselves, so this rejects 'player' at the validation boundary
    // rather than letting it reach the negotiation code.
    target: AICharacterIdSchema,
    message: z.string().min(1),
    /** Optional structured proposal that pairs with the free-form message. */
    proposal: TradeProposalSchema.optional(),
  }),
  z.object({
    type: z.literal('negotiate_reply'),
    conversationId: z.string(),
    message: z.string().min(1),
    accept: z.boolean().optional(),
    /** Optional structured proposal that pairs with the free-form message. */
    proposal: TradeProposalSchema.optional(),
  }),
  z.object({ type: z.literal('end_turn') }),
  z.object({ type: z.literal('enter_dungeon') }),
  z.object({ type: z.literal('dungeon_result'), result: DungeonResultSchema }),
  z.object({ type: z.literal('leave_dungeon') }),
])
export type PlayerAction = z.infer<typeof PlayerActionSchema>

// ----- SSE event types -----

export const GameSSEEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state_update'), state: GameStateSchema }),
  z.object({ type: z.literal('ai_thinking'), characterId: CharacterIdSchema }),
  z.object({ type: z.literal('ai_decision'), characterId: CharacterIdSchema, decision: z.unknown() }),
  z.object({ type: z.literal('negotiation'), message: NegotiationMessageSchema }),
  z.object({
    type: z.literal('npc_initiates_negotiation'),
    initiatorId: CharacterIdSchema,
    conversationId: z.string(),
    message: NegotiationMessageSchema,
  }),
  z.object({ type: z.literal('trade_result'), success: z.boolean(), from: CharacterIdSchema, to: CharacterIdSchema, summary: z.string() }),
  z.object({ type: z.literal('settlement'), results: z.array(z.string()) }),
  z.object({ type: z.literal('elimination'), characterId: CharacterIdSchema }),
  z.object({ type: z.literal('escape'), characterId: CharacterIdSchema }),
  z.object({ type: z.literal('game_over'), winnerId: CharacterIdSchema.nullable(), reason: z.string() }),
  z.object({ type: z.literal('day_start'), day: z.number(), merchantPrices: MerchantPricesSchema }),
  z.object({ type: z.literal('log'), message: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('dungeon_event'), message: z.string() }),
])
export type GameSSEEvent = z.infer<typeof GameSSEEventSchema>

// ----- Save slot (reused from existing pattern) -----

export const SaveSlotSummarySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  day: z.number().int().min(0),
  updatedAt: z.string().datetime(),
})
export type SaveSlotSummary = z.infer<typeof SaveSlotSummarySchema>

// ----- API error (keep existing) -----

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
