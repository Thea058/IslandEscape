import {
  type GameState,
  type CharacterId,
  type CharacterState,
  type PlayerAction,
  type AIDecision,
  type AITradeDecision,
  type MerchantPrices,
  type DungeonResult,
  type Resources,
  type TradeOffer,
  type DailyEvent,
  ALL_CHARACTERS,
  AI_CHARACTERS,
  GAME_CONFIG,
  RESOURCE_LABELS,
  LABOR_LABELS,
  friendshipKey,
  mulberry32,
} from '@game/shared'
// Log lines are read by the human player, so they name characters the way the
// player sees them (辛仔, You) rather than by machine id (san). The engine's
// internal keys stay untouched by this — only the strings it writes out change.
import { displayNameForPlayer as nameOf } from '../agents/personalities'

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * Coerce arbitrary values into a finite integer. Defends every resource
 * arithmetic site against null/undefined/NaN — without this, `JSON.stringify`
 * turns NaN into null on persistence, which then breaks elimination checks
 * (NaN/null comparisons are always false, so eliminated characters stay
 * "alive" with bogus resources).
 */
function safeNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function safeResources(r: Partial<Resources> | undefined | null): Resources {
  return {
    cake: safeNum(r?.cake),
    goods: safeNum(r?.goods),
    might: safeNum(r?.might),
    coins: safeNum(r?.coins),
  }
}

let seededRng: (() => number) | null = null

/**
 * Point the engine's randomness at a deterministic PRNG, or back to
 * Math.random with null. Module-level by design: this is a single-process
 * toy server, and concurrent games with different seeds are out of scope.
 * Seeding a run also stores the seed on its GameState so it can be replayed.
 */
export function seedRng(seed: number | null): void {
  seededRng = seed === null ? null : mulberry32(seed)
}

function rng(): number {
  return seededRng ? seededRng() : Math.random()
}

function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateMerchantPrices(): MerchantPrices {
  return {
    cakePrice: randInt(GAME_CONFIG.MERCHANT_CAKE_PRICE_RANGE[0], GAME_CONFIG.MERCHANT_CAKE_PRICE_RANGE[1]),
    goodsPrice: randInt(GAME_CONFIG.MERCHANT_GOODS_PRICE_RANGE[0], GAME_CONFIG.MERCHANT_GOODS_PRICE_RANGE[1]),
  }
}

/**
 * Roll a fresh daily event. Roughly a third of days have a non-trivial twist.
 * Calm days dominate the early game so new players have time to learn the
 * basics; famine (the most punishing event) is suppressed for the first
 * few days because new players don't yet have cake buffers.
 */
function rollDailyEvent(day: number): DailyEvent {
  // Day 1-2 are always calm so first-time players can find their feet.
  if (day <= 2) return 'none'
  const r = rng()
  if (r < 0.65) return 'none'
  if (r < 0.73) return 'storm'
  if (r < 0.81) return 'festival'
  if (r < 0.88) return 'windfall'
  if (r < 0.95) return 'cargo_spill'
  // Famine is the deadliest event — only allow it once players have a couple
  // of days of cake stockpiled (Day 4+).
  if (day < 4) return 'cargo_spill'
  return 'famine'
}

function makeCharacter(id: CharacterId): CharacterState {
  return {
    id,
    resources: {
      cake: GAME_CONFIG.STARTING_CAKE,
      goods: GAME_CONFIG.STARTING_GOODS,
      might: GAME_CONFIG.STARTING_MIGHT,
      coins: GAME_CONFIG.STARTING_COINS,
    },
    tradeSlots: GAME_CONFIG.TRADE_SLOTS_PER_DAY,
    alive: true,
    escaped: false,
  }
}

// ---- Initialization ----

export function createNewGame(gameId: string, seed?: number | null): GameState {
  if (seed !== undefined) seedRng(seed)
  const characters: Record<string, CharacterState> = {}
  for (const id of ALL_CHARACTERS) {
    characters[id] = makeCharacter(id)
  }

  const friendship: Record<string, number> = {}
  for (let i = 0; i < ALL_CHARACTERS.length; i++) {
    for (let j = i + 1; j < ALL_CHARACTERS.length; j++) {
      friendship[friendshipKey(ALL_CHARACTERS[i], ALL_CHARACTERS[j])] = 0
    }
  }

  return {
    gameId,
    day: 1,
    phase: 'day_start',
    characters,
    friendship,
    merchantPrices: generateMerchantPrices(),
    log: [],
    eliminatedIds: [],
    escapedIds: [],
    winnerId: null,
    aiTurnOrder: [],
    currentAiIndex: 0,
    dungeonState: null,
    playerNpcTradedToday: [],
    playerDungeonUsedToday: false,
    dailyEvent: 'none',
    seed: seed ?? null,
    updatedAt: nowIso(),
  }
}

// ---- Day start ----

export function startDay(state: GameState): GameState {
  const merchantPrices = generateMerchantPrices()
  const dailyEvent = rollDailyEvent(state.day)

  let characters = { ...state.characters }
  for (const id of ALL_CHARACTERS) {
    const c = characters[id]
    if (c && c.alive && !c.escaped) {
      characters[id] = { ...c, tradeSlots: GAME_CONFIG.TRADE_SLOTS_PER_DAY }
    }
  }

  // Windfall event — every alive character receives +2 光酥饼 at dawn.
  if (dailyEvent === 'windfall') {
    for (const id of ALL_CHARACTERS) {
      const c = characters[id]
      if (c && c.alive && !c.escaped) {
        const res = safeResources(c.resources)
        characters[id] = { ...c, resources: { ...res, cake: res.cake + 2 } }
      }
    }
  }

  // Cargo Spill event — the goods counterpart of Windfall: every alive
  // character receives +2 货物 at dawn.
  if (dailyEvent === 'cargo_spill') {
    for (const id of ALL_CHARACTERS) {
      const c = characters[id]
      if (c && c.alive && !c.escaped) {
        const res = safeResources(c.resources)
        characters[id] = { ...c, resources: { ...res, goods: res.goods + 2 } }
      }
    }
  }

  const aliveAI = AI_CHARACTERS.filter(id => {
    const c = characters[id]
    return c && c.alive && !c.escaped
  })
  const aiTurnOrder = shuffleArray(aliveAI)

  const eventLogLines: string[] = []
  if (dailyEvent === 'storm') eventLogLines.push(`⛈️ Downpour — ${LABOR_LABELS.work} yields only 1 ${RESOURCE_LABELS.goods} today.`)
  else if (dailyEvent === 'festival') eventLogLines.push('🎉 Festival — friendship gains doubled today.')
  else if (dailyEvent === 'windfall') eventLogLines.push(`🥮 Windfall — everyone alive received +2 ${RESOURCE_LABELS.cake} at dawn.`)
  else if (dailyEvent === 'cargo_spill') eventLogLines.push(`📦 Cargo Spill — everyone alive received +2 ${RESOURCE_LABELS.goods} at dawn.`)
  else if (dailyEvent === 'famine') eventLogLines.push(`🏜️ Famine — tonight's upkeep costs 2 ${RESOURCE_LABELS.cake}.`)

  return {
    ...state,
    characters,
    merchantPrices,
    phase: 'player_labor',  // Player must labor first
    aiTurnOrder,
    currentAiIndex: 0,
    playerNpcTradedToday: [],
    playerDungeonUsedToday: false,
    dailyEvent,
    log: [
      `--- Day ${state.day} ---`,
      `Market rates: ${RESOURCE_LABELS.cake} ${merchantPrices.cakePrice}c, ${RESOURCE_LABELS.goods} ${merchantPrices.goodsPrice}c`,
      ...eventLogLines,
    ],
    updatedAt: nowIso(),
  }
}

// ---- Player actions ----

export function applyPlayerAction(state: GameState, action: PlayerAction): GameState {
  const player = state.characters.player
  if (!player || !player.alive || player.escaped) {
    throw new Error('Player is not active')
  }

  // Phase: player_labor — must 打工 (work) or 学武 (train)
  if (state.phase === 'player_labor') {
    if (action.type === 'work') {
      const newState = applyWork(state, 'player')
      return { ...newState, phase: 'player_trade', updatedAt: nowIso() }
    }
    if (action.type === 'train') {
      const newState = applyTrain(state, 'player')
      return { ...newState, phase: 'player_trade', updatedAt: nowIso() }
    }
    throw new Error('During labor phase, you must work or train.')
  }

  // Phase: player_trade — use trade slots or end turn
  if (state.phase === 'player_trade') {
    switch (action.type) {
      case 'trade_merchant':
        return applyMerchantTrade(state, 'player', action.sell)
      case 'trade_peer':
      case 'negotiate_reply':
        // Handled at route level
        return state
      case 'enter_dungeon':
        return enterDungeon(state)
      case 'dungeon_result':
        return resolveDungeon(state, action.result)
      case 'leave_dungeon':
        return leaveDungeon(state)
      case 'end_turn':
        return { ...state, phase: 'ai_turns', updatedAt: nowIso() }
      default:
        throw new Error('During trade phase, you can trade or end turn.')
    }
  }

  throw new Error(`Cannot act in phase: ${state.phase}`)
}

// ---- AI decision (labor + trades) ----

export function applyAILabor(state: GameState, charId: CharacterId, labor: 'work' | 'train'): GameState {
  if (labor === 'work') {
    return applyWork(state, charId)
  }
  return applyTrain(state, charId)
}

export function applyAITrade(state: GameState, charId: CharacterId, trade: AITradeDecision): GameState {
  const character = state.characters[charId]
  if (!character || !character.alive || character.escaped) return state

  if (trade.action === 'skip') return state

  if (trade.action === 'trade_merchant' && trade.merchantSell) {
    return applyMerchantTrade(state, charId, trade.merchantSell)
  }

  if (trade.action === 'trade_peer') {
    // LOGIC 3: Verify target is alive and not escaped
    const target = trade.tradeTarget ? state.characters[trade.tradeTarget] : null
    if (!target || !target.alive || target.escaped) return state
    // Deduct trade slot; actual negotiation handled in runtime
    if (character.tradeSlots > 0) {
      return updateCharacter(state, charId, { tradeSlots: character.tradeSlots - 1 })
    }
  }

  return state
}

export function advanceAIIndex(state: GameState): GameState {
  const nextIndex = state.currentAiIndex + 1
  const allDone = nextIndex >= state.aiTurnOrder.length

  return {
    ...state,
    currentAiIndex: nextIndex,
    phase: allDone ? 'settlement' : 'ai_turns',
    updatedAt: nowIso(),
  }
}

// ---- Settlement ----

export function settle(state: GameState): GameState {
  const characters = { ...state.characters }
  const log = [...state.log]
  const eliminatedIds = [...state.eliminatedIds]
  const escapedIds = [...state.escapedIds]
  let winnerId = state.winnerId

  log.push('--- Settlement ---')

  for (const id of ALL_CHARACTERS) {
    const c = characters[id]
    if (!c || !c.alive || c.escaped) continue

    // Coerce defensively — if persistence ever round-tripped a NaN through
    // JSON it'd come back as `null`, and `null - 1 === -1` here would be
    // misleading; better to canonicalize before any arithmetic.
    const safeRes = safeResources(c.resources)
    const safeChar = { ...c, resources: safeRes }

    // Check escape first
    if (safeRes.coins >= GAME_CONFIG.WIN_COINS) {
      characters[id] = { ...safeChar, escaped: true }
      escapedIds.push(id)
      log.push(`${nameOf(id)} reached ${safeRes.coins} ${RESOURCE_LABELS.coins} and bought their way out!`)
      if (id === 'player' && !winnerId) {
        winnerId = id
      }
      continue
    }

    // Consume the nightly cake — the famine event doubles it. 货物 are a trade
    // commodity, not food, so they are never eaten.
    const cakeCost = state.dailyEvent === 'famine'
      ? GAME_CONFIG.DAILY_CAKE_COST * 2
      : GAME_CONFIG.DAILY_CAKE_COST
    const newCake = safeRes.cake - cakeCost

    if (newCake <= 0) {
      characters[id] = {
        ...safeChar,
        resources: { ...safeRes, cake: newCake },
        alive: false,
      }
      eliminatedIds.push(id)
      log.push(`${nameOf(id)} starved to death.`)
    } else {
      characters[id] = {
        ...safeChar,
        resources: { ...safeRes, cake: newCake },
      }
      log.push(
        `${nameOf(id)}: ${RESOURCE_LABELS.cake} ${newCake}, ${RESOURCE_LABELS.goods} ${safeRes.goods}, ` +
        `${RESOURCE_LABELS.might} ${safeRes.might}, ${RESOURCE_LABELS.coins} ${safeRes.coins}`,
      )
    }
  }

  const playerChar = characters.player
  const isGameOver = !playerChar || !playerChar.alive || playerChar.escaped

  return {
    ...state,
    characters,
    log,
    eliminatedIds,
    escapedIds,
    winnerId,
    phase: isGameOver ? 'game_over' : 'day_end',
    updatedAt: nowIso(),
  }
}

// ---- Dungeon ----

export function enterDungeon(state: GameState): GameState {
  const player = state.characters.player
  if (!player) throw new Error('Player not found')
  if (state.dungeonState?.active) throw new Error('Already in dungeon')
  if (state.playerDungeonUsedToday) throw new Error('You have already entered the dungeon today.')
  if (player.tradeSlots <= 0) throw new Error('No trade slots remaining')

  const newState: GameState = {
    ...state,
    characters: {
      ...state.characters,
      player: { ...player, tradeSlots: player.tradeSlots - 1 },
    },
    dungeonState: { active: true },
    playerDungeonUsedToday: true,
    updatedAt: nowIso(),
  }
  return addLog(newState, 'Player entered the dungeon!')
}

export function resolveDungeon(state: GameState, result: DungeonResult): GameState {
  const player = state.characters.player
  if (!player) return state

  let newState: GameState = {
    ...state,
    dungeonState: null,
    updatedAt: nowIso(),
  }

  if (result.win) {
    // Scale coin reward by day so later, harder runs feel worth it.
    // Day 1 → 15 / Day 5 → 31 / Day 10 → 51 / capped at 80.
    const coinReward = Math.min(80, GAME_CONFIG.DUNGEON_COIN_REWARD + Math.max(0, state.day - 1) * 4)
    const updatedPlayer = {
      ...player,
      resources: {
        ...player.resources,
        coins: player.resources.coins + coinReward,
      },
    }
    newState = {
      ...newState,
      characters: { ...newState.characters, player: updatedPlayer },
    }
    newState = addLog(newState, `${nameOf('player')} defeated 噬影! +${coinReward} ${RESOURCE_LABELS.coins}.`)
  } else {
    // Losing the dungeon used to be an instant kill on early days (lose 5 of a
    // resource from a starting pool of 6). Cap the loss so the player keeps at
    // least 1 of each, ensuring they can still survive the upcoming settlement
    // that costs 1 光酥饼.
    const cakeLoss = Math.min(Math.max(0, player.resources.cake - 1), GAME_CONFIG.DUNGEON_RESOURCE_PENALTY)
    const goodsLoss = Math.min(Math.max(0, player.resources.goods - 1), GAME_CONFIG.DUNGEON_RESOURCE_PENALTY)
    const updatedPlayer = {
      ...player,
      resources: {
        ...player.resources,
        cake: player.resources.cake - cakeLoss,
        goods: player.resources.goods - goodsLoss,
      },
    }
    newState = {
      ...newState,
      characters: { ...newState.characters, player: updatedPlayer },
    }
    newState = addLog(
      newState,
      `${nameOf('player')} was defeated! Lost ${cakeLoss} ${RESOURCE_LABELS.cake} and ${goodsLoss} ${RESOURCE_LABELS.goods}.`,
    )
  }

  return newState
}

export function leaveDungeon(state: GameState): GameState {
  return {
    ...state,
    dungeonState: null,
    updatedAt: nowIso(),
  }
}

// ---- Advance day ----

export function advanceDay(state: GameState): GameState {
  if (state.phase === 'game_over') return state
  return startDay({ ...state, day: state.day + 1, log: [] })
}

// ---- Helpers ----

/**
 * 打工 — the survival action. Yields both food and something to sell, which is
 * what makes it the safe default: you can never work yourself into starvation,
 * only into a slow grind.
 */
export function applyWork(state: GameState, charId: CharacterId): GameState {
  const c = state.characters[charId]
  if (!c) return state

  const res = safeResources(c.resources)
  // Downpour halves the goods haul. Cake is deliberately left alone — cutting
  // both at once would turn one bad roll into a death sentence.
  const yieldGoods = state.dailyEvent === 'storm'
    ? Math.max(1, Math.floor(GAME_CONFIG.GOODS_PER_WORK / 2))
    : GAME_CONFIG.GOODS_PER_WORK
  const newState = updateCharacter(state, charId, {
    resources: {
      ...res,
      cake: res.cake + GAME_CONFIG.CAKE_PER_WORK,
      goods: res.goods + yieldGoods,
    },
  })
  const note = state.dailyEvent === 'storm' ? ` (downpour — only +${yieldGoods} ${RESOURCE_LABELS.goods})` : ''
  return addLog(
    newState,
    `${nameOf(charId)} chose ${LABOR_LABELS.work}: +${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake}, ` +
    `+${yieldGoods} ${RESOURCE_LABELS.goods}${note}.`,
  )
}

/**
 * 学武 — the investment action. Yields nothing you can eat today, but 武力 is
 * what stage C will spend on forcing a trade through.
 */
export function applyTrain(state: GameState, charId: CharacterId): GameState {
  const c = state.characters[charId]
  if (!c) return state

  const res = safeResources(c.resources)
  const newState = updateCharacter(state, charId, {
    resources: { ...res, might: res.might + GAME_CONFIG.MIGHT_PER_TRAINING },
  })
  return addLog(
    newState,
    `${nameOf(charId)} chose ${LABOR_LABELS.train}: +${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might}.`,
  )
}

export function applyMerchantTrade(
  state: GameState,
  charId: CharacterId,
  sell: { cake: number; goods: number },
): GameState {
  const c = state.characters[charId]
  if (!c) return state
  if (c.tradeSlots <= 0) {
    return addLog(state, `${nameOf(charId)} has no trade slots remaining.`)
  }
  // Coerce: AI decision JSON occasionally arrives with null/undefined fields.
  const res = safeResources(c.resources)
  const sellCake = safeNum(sell.cake)
  const sellGoods = safeNum(sell.goods)
  if (sellCake > res.cake || sellGoods > res.goods) {
    return addLog(state, `${nameOf(charId)} does not have enough resources to sell.`)
  }
  if (sellCake === 0 && sellGoods === 0) {
    return addLog(state, `${nameOf(charId)} tried to sell nothing to the merchant.`)
  }

  const coinsGained = sellCake * state.merchantPrices.cakePrice + sellGoods * state.merchantPrices.goodsPrice

  const newState = updateCharacter(state, charId, {
    resources: {
      ...res,
      cake: res.cake - sellCake,
      goods: res.goods - sellGoods,
      coins: res.coins + coinsGained,
    },
    tradeSlots: c.tradeSlots - 1,
  })

  const parts: string[] = []
  if (sellCake > 0) parts.push(`${sellCake} ${RESOURCE_LABELS.cake}`)
  if (sellGoods > 0) parts.push(`${sellGoods} ${RESOURCE_LABELS.goods}`)

  return addLog(
    newState,
    `${nameOf(charId)} sold ${parts.join(' and ')} to the merchant for ${coinsGained} ${RESOURCE_LABELS.coins}.`,
  )
}

export function executePeerTrade(
  state: GameState,
  from: CharacterId,
  to: CharacterId,
  offer: TradeOffer,
  request: TradeOffer,
): GameState {
  const cFrom = state.characters[from]
  const cTo = state.characters[to]
  if (!cFrom || !cTo) return state

  // Coerce in case persistence or LLM output ever introduced null/NaN.
  const fromRes = safeResources(cFrom.resources)
  const toRes = safeResources(cTo.resources)
  const o = {
    cake: safeNum(offer.cake),
    goods: safeNum(offer.goods),
    coins: safeNum(offer.coins),
  }
  const r = {
    cake: safeNum(request.cake),
    goods: safeNum(request.goods),
    coins: safeNum(request.coins),
  }

  // Validate that both parties have enough resources
  if (fromRes.cake < o.cake ||
      fromRes.goods < o.goods ||
      fromRes.coins < o.coins ||
      toRes.cake < r.cake ||
      toRes.goods < r.goods ||
      toRes.coins < r.coins) {
    return addLog(state, `Trade rejected: insufficient resources.`)
  }

  // Validate that resulting resources are non-negative
  const newFromCake = fromRes.cake - o.cake + r.cake
  const newFromGoods = fromRes.goods - o.goods + r.goods
  const newFromCoins = fromRes.coins - o.coins + r.coins
  const newToCake = toRes.cake + o.cake - r.cake
  const newToGoods = toRes.goods + o.goods - r.goods
  const newToCoins = toRes.coins + o.coins - r.coins

  if (newFromCake < 0 || newFromGoods < 0 || newFromCoins < 0 ||
      newToCake < 0 || newToGoods < 0 || newToCoins < 0) {
    return addLog(state, `Trade rejected: would result in negative resources.`)
  }

  // `might` is carried through untouched — 武力 is never part of a deal, it is
  // what you spend when there is no deal to be had (stage C).
  const newFrom = {
    ...cFrom,
    resources: {
      cake: newFromCake,
      goods: newFromGoods,
      might: fromRes.might,
      coins: newFromCoins,
    },
  }
  const newTo = {
    ...cTo,
    resources: {
      cake: newToCake,
      goods: newToGoods,
      might: toRes.might,
      coins: newToCoins,
    },
  }

  const fKey = friendshipKey(from, to)
  const newFriendship = { ...state.friendship }
  // Festival event: peer trades give double friendship bonus today.
  const friendshipMul = state.dailyEvent === 'festival' ? 2 : 1
  const bonus = GAME_CONFIG.FRIENDSHIP_TRADE_BONUS * friendshipMul
  newFriendship[fKey] = (newFriendship[fKey] || 0) + bonus

  const characters = { ...state.characters, [from]: newFrom, [to]: newTo }
  const newState = { ...state, characters, friendship: newFriendship, updatedAt: nowIso() }
  const festivalNote = state.dailyEvent === 'festival' ? ' (festival 2×)' : ''
  return addLog(newState, `${nameOf(from)} traded with ${nameOf(to)}. Friendship +${bonus}${festivalNote}.`)
}

function updateCharacter(state: GameState, charId: CharacterId, patch: Partial<CharacterState>): GameState {
  const c = state.characters[charId]
  if (!c) return state
  return {
    ...state,
    characters: { ...state.characters, [charId]: { ...c, ...patch } },
    updatedAt: nowIso(),
  }
}

function addLog(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] }
}
