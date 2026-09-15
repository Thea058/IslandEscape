# Kowloon Walled City — Developer Guide

This document explains the codebase architecture, how each part works, and how to make changes. Read this before touching any code.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How the Game Loop Works](#2-how-the-game-loop-works)
3. [Shared Types](#3-shared-types)
4. [Game Engine](#4-game-engine)
5. [AI Agent System](#5-ai-agent-system)
6. [API & SSE](#6-api--sse)
7. [Frontend Architecture](#7-frontend-architecture)
8. [PixiJS Game Rendering](#8-pixijs-game-rendering)
9. [Vue UI Components](#9-vue-ui-components)
10. [State Management](#10-state-management)
11. [Configuration & Environment](#11-configuration--environment)
12. [Common Tasks](#12-common-tasks)
13. [Known Issues & TODOs](#13-known-issues--todos)

---

## 1. Architecture Overview

```
Browser (Vue + PixiJS)                   Server (Fastify + Node)
┌────────────────────────┐               ┌──────────────────────────┐
│                        │               │                          │
│  PixiJS Canvas         │   REST API    │  Game Engine             │
│  (tile map, characters,│ ◄──────────► │  (pure function state    │
│   movement, dungeon)   │               │   machine, no side       │
│                        │   POST        │   effects)               │
│  Vue Overlays          │  /action ──► │                          │
│  (HUD, dialogue panel, │               │  AI Agents               │
│   action menu, log)    │   SSE         │  (DeepSeek LLM calls     │
│                        │ ◄──────────  │   for decisions &        │
│  Pinia Store           │  /stream      │   negotiations)          │
│  (single source of     │               │                          │
│   truth for Vue)       │               │  SQLite (Drizzle)        │
│                        │               │  (game state persistence)│
└────────────────────────┘               └──────────────────────────┘
```

**Key principle**: the server is the source of truth. The frontend never modifies game state directly — it sends actions to the server and receives updated state back.

**Data flow**:

1. Player presses a key → PixiJS InputManager detects it → emits event to Vue
2. Vue component calls `game.submitAction(...)` → POST to `/api/games/:id/action`
3. Server validates the action against a Zod schema → updates `GameState` via engine functions → returns the new state
4. Frontend updates the Pinia store → Vue reactivity updates HUD, PixiJS reads the store for rendering
5. During AI turns, the server pushes events over SSE → the frontend receives them in real time

---

## 2. How the Game Loop Works

Each in-game day has this exact sequence:

```
DAY START                      (startDay)
  │
  ├── Roll a random daily event (rollDailyEvent) — always 'none' on days 1-2
  ├── Generate fresh night-market prices
  ├── windfall / cargo_spill grant every alive character +2 at dawn
  ├── Reset everyone's trade slots to 2
  ├── Clear playerNpcTradedToday and playerDungeonUsedToday
  └── Shuffle the AI turn order
  │
  ▼
PLAYER LABOR                   (phase: "player_labor")
  │
  ├── Player MUST choose: work (+1 cake, +2 goods) or train (+1 might)
  │   This is mandatory — you cannot skip it
  │   Any other action throws "During labor phase, you must work or train."
  │
  ▼
PLAYER TRADE                   (phase: "player_trade")
  │
  ├── Player has 2 trade slots:
  │   ├── Sell to the night market (cake/goods → coins at today's prices)
  │   ├── Negotiate with a resident (natural language, max 5 exchanges)
  │   ├── Enter the dungeon (costs 1 slot, once per day)
  │   └── Skip (just end turn)
  │
  ├── Player clicks "End Turn" → phase becomes "ai_turns"
  │
  ▼
AI TURNS                       (phase: "ai_turns")
  │
  ├── For each AI in the shuffled order:
  │   ├── LLM returns: labor (work or train) + exactly 2 trade decisions
  │   ├── Labor is applied immediately
  │   ├── For each trade:
  │   │   ├── trade_merchant → sell resources at market prices
  │   │   ├── trade_peer → full LLM-vs-LLM negotiation
  │   │   │   └── if the target is the PLAYER, the loop BLOCKS until the
  │   │   │       player answers or the 60s timeout expires
  │   │   └── skip → do nothing
  │   ├── On any error: fall back to work (the one action that always feeds you)
  │   └── All actions broadcast via SSE to the frontend
  │
  ▼
SETTLEMENT                     (phase: "settlement")
  │
  ├── Escape is checked FIRST: coins >= 100 → escaped, and if it's the player,
  │   winnerId is set
  ├── Everyone else eats 1 cake (2 during a famine)
  ├── Anyone left with cake <= 0 → ELIMINATED
  ├── If the player is eliminated or escaped → phase becomes "game_over"
  │
  ▼
DAY END → advanceDay() clears the log, increments the day, calls startDay()
```

Note that elimination is `newCake <= 0`, not `< 0` — a character holding exactly 1 cake on a normal night ends the night at 0 and dies.

---

## 3. Shared Types

**File**: `packages/shared/src/index.ts`

This is the single source of truth for ALL types used by both server and frontend. Everything is defined with Zod schemas, which gives us:

- Runtime validation (the server validates incoming requests)
- TypeScript types (auto-inferred from schemas)
- One contract shared by web and server

### Machine ids vs display names

The most important convention in this codebase. Storage keys are stable, lowercase, English ids; the words the player and the LLM read live in registries:

```typescript
export const RESOURCE_LABELS = {
  cake: 'Kong Soh Biscuits',
  goods: 'Goods',
  might: 'Might',
  coins: 'Coins',
} as const satisfies Record<keyof Resources, string>

export const LABOR_ACTIONS = ['work', 'train'] as const
export const LABOR_LABELS = {
  work: 'odd jobs',
  train: 'practice kung fu',
} as const satisfies Record<LaborAction, string>
```

Two rules follow from this, and breaking either one is how bugs get in:

1. **Nothing in the engine branches on a label.** `cake` is a biscuit today; re-theming the setting should touch the registry and the art, nothing else.
2. **Anything that renders or parses a resource name reads the registry.** That includes the client's log-parsing regexes — see `DaySummaryModal.vue`, which builds its pattern from `RESOURCE_LABELS` so client and server cannot drift.

`satisfies Record<...>` is doing real work here: it's what makes `pnpm typecheck` fail when a registry is missing a key.

### Key types

| Type | What it is |
|------|-----------|
| `CharacterId` | `'player' \| 'san' \| 'shun' \| 'cyclone' \| 'simon'` |
| `AICharacterId` | `CharacterId` minus `'player'`, derived via `.exclude()` so the two can't drift |
| `Resources` | `{ cake, goods, might, coins }` — all integers |
| `CharacterState` | One character: resources, trade slots, alive, escaped |
| `GameState` | The whole game: characters, friendship, market prices, phase, day, log, daily event, seed |
| `PlayerAction` | Discriminated union — see below |
| `AIDecision` | What the LLM returns: `{ labor: {labor, reasoning}, trades: [...] }` |
| `NegotiationMessage` | One message in a trade dialogue: speaker, text, optional proposal, accept |
| `GameSSEEvent` | Events pushed from server to frontend via SSE |
| `DayPhase` | `'day_start' \| 'player_labor' \| 'player_trade' \| 'ai_turns' \| 'settlement' \| 'day_end' \| 'game_over'` |
| `DailyEvent` | `'none' \| 'storm' \| 'festival' \| 'windfall' \| 'cargo_spill' \| 'famine'` |
| `GAME_CONFIG` | All tunable numbers (starting resources, yields, costs, prices, thresholds) |

`PlayerAction` is a discriminated union on `type`:

```
work | train | trade_merchant | trade_peer | negotiate_reply
     | end_turn | enter_dungeon | dungeon_result | leave_dungeon
```

`trade_peer` validates its `target` against `AICharacterIdSchema`, so "trade with yourself" is rejected at the API boundary rather than reaching the negotiation code.

### Friendship

Friendship between two characters is a `Record<string, number>` keyed by `friendshipKey(a, b)` — the two ids sorted alphabetically and joined with `:`. Example: `"player:san" → 15`.

Sorting inside `friendshipKey` is what makes the key identical no matter which character you ask from.

### If you need to add a new resource or mechanic

1. Add it to the relevant schema in `packages/shared/src/index.ts`
2. Run `pnpm typecheck` — TypeScript will list every file that needs updating

That second step is not a formality. `Record<CharacterId, X>` and `Record<keyof Resources, X>` turn a half-finished rename into a compile error; `Record<string, X>` does not, and the failure mode there is silent (see the note on `AI_PERSONALITIES` in §5).

---

## 4. Game Engine

**File**: `apps/server/src/engine/game.ts`

The game engine is a **pure-function state machine**. Every function takes a `GameState` and returns a new `GameState`. No mutations. No side effects. No I/O.

```typescript
// Every engine function looks like this:
function doSomething(state: GameState, ...args): GameState {
  // validate
  // compute new state
  return { ...state, /* changes */ }
}
```

### Deterministic randomness

Nothing calls `Math.random()` directly. The engine draws from `rng()`, which points at either a seeded `mulberry32` PRNG or `Math.random`:

```typescript
export function seedRng(seed: number | null): void   // null = non-deterministic
```

`createNewGame(gameId, seed)` calls this and stores the seed on the `GameState`, which is what makes a run replayable: same seed + same player actions = same market prices, same daily events, same NPC decisions.

Note the module-level design: `seededRng` is a single module-scoped variable, so concurrent games with different seeds are explicitly out of scope. This is a single-process toy server.

### Key functions

| Function | What it does |
|----------|-------------|
| `createNewGame(gameId, seed?)` | Initial state: 5 characters, starting resources, day 1, all friendship pairs initialized to 0 |
| `startDay(state)` | Rolls the daily event, generates market prices, applies dawn grants, resets trade slots, shuffles the AI order, sets phase to `player_labor` |
| `applyPlayerAction(state, action)` | The player's entry point — dispatches on phase and action type |
| `applyAILabor(state, charId, 'work'\|'train')` | Applies one AI's labor choice |
| `applyAITrade(state, charId, trade)` | Applies one AI's trade action (peer negotiation is handled in `runtime.ts`) |
| `advanceAIIndex(state)` | Moves to the next AI; transitions to `settlement` when all are done |
| `settle(state)` | Escape checks, nightly upkeep, eliminations, game-over detection |
| `advanceDay(state)` | Increments the day, clears the log, calls `startDay()` |
| `enterDungeon` / `resolveDungeon` / `leaveDungeon` | The dungeon lifecycle — entry costs a trade slot |
| `executePeerTrade(state, from, to, offer, request)` | Validates both sides can pay, swaps resources, adds friendship |

### Helper functions

| Function | What it does |
|----------|-------------|
| `applyWork(state, charId)` | +1 cake, +2 goods (goods halved by `storm`) |
| `applyTrain(state, charId)` | +1 might |
| `applyMerchantTrade(state, charId, sell)` | Validates holdings, calculates coins, deducts a trade slot |
| `updateCharacter(state, charId, patch)` | Immutable single-character update |
| `addLog(state, message)` | Appends a log line |

### Defensive coercion — `safeNum` / `safeResources`

Every place that does resource arithmetic runs its inputs through `safeResources()` first. This is not paranoia: LLM output routinely arrives with `null` or missing fields, and `5 - null` is `5` while `5 - undefined` is `NaN`. `NaN` then serializes to `null` through `JSON.stringify`, and since every comparison against `NaN` is false, a character with `NaN` cake would survive starvation forever.

### Daily events

`rollDailyEvent(day)` returns `'none'` on days 1-2 and roughly a third of days after that. Each event is applied in exactly one place:

| Event | Effect |
|-------|--------|
| `storm` | `applyWork` yields 1 goods instead of 2. Cake is deliberately untouched — halving both would turn one bad roll into a death sentence |
| `festival` | `executePeerTrade` doubles the friendship bonus |
| `windfall` | `startDay` grants +2 cake to everyone alive |
| `cargo_spill` | `startDay` grants +2 goods to everyone alive |
| `famine` | `settle` charges 2 cake instead of 1. Suppressed before day 4 |

### How to change game balance

Edit `GAME_CONFIG` in `packages/shared/src/index.ts`:

```typescript
export const GAME_CONFIG = {
  STARTING_CAKE: 5,
  STARTING_GOODS: 0,
  STARTING_MIGHT: 3,
  STARTING_COINS: 0,
  CAKE_PER_WORK: 1,          // odd jobs yield
  GOODS_PER_WORK: 2,
  MIGHT_PER_TRAINING: 1,     // kung fu practice yields
  DAILY_CAKE_COST: 1,        // eaten each night; famine doubles it
  WIN_COINS: 100,            // need this many coins to buy your way out
  TRADE_SLOTS_PER_DAY: 2,
  MAX_NEGOTIATION_EXCHANGES: 5,
  FRIENDSHIP_TRADE_BONUS: 5,
  MERCHANT_CAKE_PRICE_RANGE: [2, 6],   // random each day
  MERCHANT_GOODS_PRICE_RANGE: [1, 4],
  // Dungeon
  PLAYER_MAX_HP: 15, BOSS_MAX_HP: 150,
  DUNGEON_COIN_REWARD: 15,   // scales +4/day, capped at 80 in resolveDungeon
  DUNGEON_RESOURCE_PENALTY: 5,
  // ...
}
```

---

## 5. AI Agent System

**Files**: `apps/server/src/agents/`

### personalities.ts

Defines the 4 AI characters. Each has `name`, `description`, `systemPrompt`, and `traits`. The `systemPrompt` is what actually makes 辛仔 hoard and 阿信 gamble — it is injected into every LLM call for that character.

Two name functions live here, and the split matters:

| Function | Returns for `player` | Used by |
|----------|---------------------|---------|
| `displayNameForPlayer(id)` | `'You'` | Server log lines the human reads |
| `llmFacingName(id)` | `'the player'` | LLM prompts, where the player is a third party |

`AI_PERSONALITIES` is typed `Record<AICharacterId, Personality>`, **not** `Record<string, Personality>`. With a loose key, a stale id left behind by a rename compiles fine and only fails at runtime — where `getPersonality` throws, `getAIDecision` swallows it into a generic "fell back to work" decision, and the symptom (every NPC working, nobody trading) looks nothing like the cause (one outdated object key).

**To add a new character**: add an entry to `AI_PERSONALITIES`, add the ID to `CharacterIdSchema` and `AI_CHARACTERS` in shared types, then add a starting position in `apps/web/src/game/tiles.ts`.

### format.ts

Renders resource bundles for prompts, and encodes the read/write split:

```
Your resources: Kong Soh Biscuits [cake]=5, Goods [goods]=2, ...
```

The model *reads* the display name and *writes back* the machine key. The key list is derived from `RESOURCE_LABELS` with `Object.keys`, so adding a resource shows up in every prompt automatically and no prompt can silently forget one.

### llm.ts

Low-level LLM client. Talks to any OpenAI-compatible endpoint using plain `fetch` — there is no SDK dependency.

- `chatJSON<T>(systemPrompt, userMessage)` — structured output. Used by both agents.
- `chatText(systemPrompt, messages)` — plain-text reply. **Currently unused** (see §13).

Design notes worth knowing before you touch it:

- **`response_format: { type: 'json_object' }` is requested, but not trusted.** Some OpenRouter providers reject it, so a 400 mentioning `response_format` triggers one retry without JSON mode rather than an error.
- **JSON is extracted by brace-balancing, not regex.** `extractJsonObject` walks the response from the first `{` and counts braces while tracking string state, so a `}` inside a quoted dialogue line doesn't truncate the object. Markdown fences are unwrapped first.
- **Two attempts, then an empty object.** The retry re-prompts with a stricter "reply ONLY with valid JSON" message and a higher `max_tokens`, because the most common failure is truncation.
- **`max_tokens: 8000` baseline** because DeepSeek reasoning models (R1, V4-flash) can burn 3-5k tokens on `reasoning_content` before emitting any `content`. If you see "empty content but reasoning_content present" in the logs, that's the model running out of budget mid-thought — switch to a non-reasoning model like `deepseek/deepseek-chat`.

### decision-agent.ts

Called once per AI per turn. Builds a context block (the character's resources, every other character's resources and friendship, today's market rates, the goal) and asks for:

```json
{
  "labor": { "labor": "work", "reasoning": "I need cake to survive tonight" },
  "trades": [
    { "action": "trade_merchant", "merchantSell": { "cake": 0, "goods": 2 }, "reasoning": "Good price today" },
    { "action": "trade_peer", "tradeTarget": "cyclone", "reasoning": "He has goods I need" }
  ]
}
```

The prompt tells the model to write reasoning as one short sentence, because long reasoning gets truncated and breaks the JSON.

**Parse defensively, in the direction of survival**: anything that isn't exactly `"train"` falls back to `work`, and the trades array is padded to exactly 2 entries with `skip`. An unrecognised value from the model must never cost a character its life.

### negotiation-agent.ts

Handles trade dialogue. Two entry points:

- `getAITradeInitiation(state, charId, targetId)` — opening offer
- `getNegotiationReply(state, charId, partnerId, history)` — a reply in an ongoing conversation

Both return `{ text, offer?, request?, accept?, reject? }` and are constrained to one of three actions: **accept** the partner's concrete offer as-is, **counter** with different numbers, or **reject**. The prompt explicitly forbids mirroring the partner's proposal back at them, which models otherwise do.

`sanitizeOffer` coerces whatever the model produced into non-negative integers, and `offerIsMeaningful` drops all-zero "ghost" proposals so they don't clutter the chat.

The `charId` parameter is typed `AICharacterId` — the speaker is always an AI, since the human player replies through the HTTP action path. `partnerId` stays a plain `CharacterId`, because the player can be the counterparty.

### runtime.ts

Orchestrates the full AI turn sequence:

```
for each AI in shuffled order:
  1. broadcast "ai_thinking" SSE event
  2. call getAIDecision() → labor + 2 trades
  3. broadcast "ai_decision" (drives the client's walk-to-target animation)
  4. apply labor, with a 400ms pause so the animation starts first
  5. for each trade:
     - trade_merchant → apply directly
     - trade_peer     → full negotiation (or block for the player, below)
     - emit SSE events at every step
  6. on error → fall back to work

then: settle → broadcast eliminations/escapes → game_over
      or advanceDay and start the next day
```

**NPC-initiated trades with the human** take a different path (`initiatePlayerNegotiation`). The AI cannot negotiate with the player through the LLM loop — `getPersonality('player')` would throw. Instead the runtime opens the conversation, registers it in the shared `negotiations` map, broadcasts `npc_initiates_negotiation` so the client pops the dialogue panel, and then **blocks the turn loop** polling every 500ms until the player accepts/rejects or a 60-second timeout fires and the NPC walks away.

Two details there are load-bearing:

- It bails early if a negotiation is already in flight, so an NPC can't clobber a chat the player started.
- After the wait it re-reads state from `sessions.get(gameId)` rather than returning its own local `current` — otherwise the next iteration would clobber the trade the player just completed.

### LLM cost

Each AI turn = 1 decision call + 0-2 trade calls. Each negotiation = 2-5 calls. With 4 AIs, one day costs roughly 4-20 LLM calls. At DeepSeek pricing via OpenRouter, a full game costs well under $0.10.

---

## 6. API & SSE

**File**: `apps/server/src/routes/game.ts`

### Endpoints

| Endpoint | Method | What it does |
|----------|--------|-------------|
| `/api/games` | POST | Create a new game. Optional body `{ seed }`. Returns `{ gameId, state }` |
| `/api/games/:id/replay` | POST | New game with the same seed as an existing one |
| `/api/games/:id` | GET | Get current `GameState` (session first, then SQLite) |
| `/api/games/:id/action` | POST | Submit a `PlayerAction`. Body is the action JSON |
| `/api/games/:id/stream` | GET | SSE stream — stays open and pushes events |

### Player action flow

```
POST /api/games/:id/action  { type: "work" }
  → applyPlayerAction(state, action)
  → phase changes from "player_labor" to "player_trade"
  → returns { state }

POST /api/games/:id/action  { type: "end_turn" }
  → phase changes to "ai_turns"
  → awaits runAITurns() with an SSE broadcaster
  → AI events stream to the frontend as they happen
  → when done, the phase is either "game_over" or the next day's "player_labor"
```

### Negotiation flow (player-initiated)

```
POST /action  { type: "trade_peer", target: "san", message: "I'll give 3 goods for 6 coins" }
  → deducts 1 trade slot from the player
  → calls the LLM for 辛仔's reply
  → returns { state, negotiation: { conversationId, messages: [playerMsg, npcReply] } }

POST /action  { type: "negotiate_reply", conversationId: "...", message: "How about 8 coins?" }
  → appends the player message
  → calls the LLM for the counter
  → returns the updated message list

POST /action  { type: "negotiate_reply", ..., accept: true }
  → executes the latest NPC proposal (not the player's own)
  → returns { state, negotiationDone: true }
```

The `accept: true` path has one non-obvious rule: if the NPC agreed but the player never put concrete numbers on the table, the `accept` flag is stripped from the stored message so the UI doesn't show a phantom "Accepted" tag with nothing behind it.

### SSE events

| Event type | When | Data |
|-----------|------|------|
| `state_update` | After any state change | Full `GameState` |
| `ai_thinking` | An AI starts its turn | `{ characterId }` |
| `ai_decision` | An AI made a decision | `{ characterId, decision }` — also re-emitted per trade step to drive walk animations |
| `log` | Anytime | `{ message }` — human-readable log line |
| `negotiation` | Any negotiation step | `{ message: NegotiationMessage }` |
| `npc_initiates_negotiation` | An NPC wants to trade with you | `{ initiatorId, conversationId, message }` |
| `trade_result` | Trade completed/failed | `{ success, from, to, summary }` |
| `settlement` | Night phase | `{ results: string[] }` — the last 10 log lines |
| `elimination` | A character starved | `{ characterId }` |
| `escape` | A character reached 100 coins | `{ characterId }` |
| `game_over` | Game ended | `{ winnerId, reason }` |
| `day_start` | New day begins | `{ day, merchantPrices }` |
| `dungeon_event` | During a dungeon run | `{ message }` |
| `error` | Something failed | `{ message }` |

### State management

**File**: `apps/server/src/state.ts`

Active games live in an in-memory `Map<string, GameSession>`. Each session holds `gameId`, `state`, and `sseClients` (the set of connected SSE response objects). `broadcastSSE(gameId, event)` writes `data: {...}\n\n` to every connected client and drops any client whose write throws.

A second map, `negotiations`, holds the live negotiation per game — shared between the HTTP routes (player-initiated) and the AI runtime (NPC-initiated), which is why the runtime can block on it.

Games are also persisted to SQLite after every state change, so they survive a restart and can be re-fetched by id.

---

## 7. Frontend Architecture

```
apps/web/src/
├── game/                  # PixiJS layer (renders the city + the dungeon)
│   ├── tiles.ts           # Map data: 20x15 grid of tile types + named locations
│   ├── TileMap.ts         # Draws all tiles programmatically
│   ├── Character.ts       # Character sprite with animation
│   ├── InputManager.ts    # WASD + E + skill keys
│   ├── GameWorld.ts       # Orchestrates map + characters + interactions
│   ├── GameRenderer.ts    # Creates the PixiJS Application, mounts the canvas
│   └── dungeon/           # Self-contained bullet-hell mode
│       ├── DungeonArena.ts, Boss.ts, Bullet.ts, Minion.ts
│       ├── PlayerCombat.ts, XPOrb.ts, Effects.ts
│       ├── CardSystem.ts  # 15 upgrade cards, pick 1 of 3
│       └── AudioManager.ts
│
├── render3d/              # Three.js preview panel
│   ├── InteractionPreviewRenderer.ts
│   ├── interactionPreviewMeta.ts     # titles/subtitles per interaction
│   └── interactionPreviewModels.ts   # one procedural model per interaction
│
├── components/            # Vue UI overlays
│   ├── GameCanvas.vue     # Wrapper: mounts PixiJS, bridges events to Vue
│   ├── HUD.vue            # Top bar: day, phase, resources, prices, escape %
│   ├── ActionMenu.vue     # Context menu when pressing E (phase-aware)
│   ├── DialoguePanel.vue  # Negotiation sidebar
│   ├── InteractionPrompt.vue
│   ├── InteractionPreview3D.vue
│   ├── PhaseHint.vue, TutorialModal.vue, ResourceToasts.vue
│   ├── DaySummaryModal.vue # Night summary, parsed from settlement log lines
│   ├── EventLog.vue       # Bottom log
│   └── interactionPreviewPanel.ts # Pure logic for the 3D preview's side panel
│
├── stores/game.ts         # Pinia store: game state + SSE + API calls
├── composables/useApi.ts  # Typed fetch wrappers
├── App.vue                # Title screen or game screen
├── main.ts                # Vue bootstrap
└── styles.css             # Global styles + CSS variables
```

### How PixiJS and Vue interact

- **PixiJS** handles rendering: the tile map, character sprites, movement animation, and the entire dungeon mode
- **Vue** handles all UI text, buttons, forms, dialogue, the HUD, and the event log

They communicate three ways:

1. **GameCanvas.vue** mounts the PixiJS canvas, listens to game-world events, and emits them to the parent
2. **The Pinia store** — PixiJS reads game state from the store; Vue writes to it via API calls
3. **Events** — `GameWorld` emits `interaction-change`, `action-menu`, and `player-moved`

The canvas is a rendering surface, not a source of truth. If the two ever disagree, the store wins.

---

## 8. PixiJS Game Rendering

### tiles.ts

The city map is a 20x15 grid. Each cell has a tile type:

```typescript
type TileType =
  | 'water' | 'sand' | 'grass' | 'path'      // ground
  | 'house' | 'tree' | 'rock'                // scenery
  | 'workshop' | 'dojo' | 'dock' | 'cave'    // interactable
```

`MAP_RAW` is the layout in single-character form (`W` water, `X` workshop, `F` dojo, `D` dock, `C` cave, …) so the map is editable as ASCII art; `MAP_KEY` expands it into `CITY_MAP`. `getTile(col, row)` returns `'water'` out of bounds, which keeps pathfinding from having to bounds-check.

The interactable tiles are the interesting ones — `getInteraction(tile)` returns the action id directly:

| Tile | `getInteraction` | Meaning |
|------|-----------------|---------|
| `workshop` | `'work'` | Where odd jobs happen |
| `dojo` | `'train'` | Where kung fu is practiced |
| `dock` | `'merchant'` | The night market |
| `cave` | `'dungeon'` | The boss dungeon |

Returning the same id the labor action uses means the interaction menu can offer the matching action without a translation table in between.

`CHARACTER_POSITIONS` is typed `Record<CharacterId, MapPosition>` on purpose: with a loose `string` key, a missing entry silently falls back to one shared tile and stacks every NPC on top of each other instead of reporting the problem.

`getActionTarget(action, fromCol, fromRow)` resolves where an AI should walk for a given action, using `findNearestTile` (Manhattan distance, brute-force scan — fine at this size).

### TileMap.ts

Draws every tile with PixiJS `Graphics` — colored rectangles and simple shapes:

- Water: blue with wave animation
- Grass: green, sand: tan, path: grey flagstone
- Dojo: darker roof, workshop: crates, dock: the market stall
- Trees: green circles on brown trunks

All art is **programmatic** — no image files. If you want sprite sheets later, replace the `Graphics` drawing calls with `Sprite` loading.

### Character.ts

Each character is a small pixel figure: head, colored body (the shirt color distinguishes them), a name label above, smooth interpolation between tiles when walking, a thinking indicator during AI turns, and a greyed-out state when eliminated.

### GameWorld.ts

The main orchestrator. It owns the tile map layer, all character sprites, player movement (walkability checks and nearby-interactable detection), interaction detection, AI walk animation, floating text effects, and the night overlay.

It emits `interaction-change`, `action-menu`, and `player-moved` to Vue.

### InputManager.ts

Keyboard handling: WASD/arrows for movement (ignored while typing in an input field), E/Space to interact, plus the dungeon's `skill_flash` and `skill_ultimate`.

### GameRenderer.ts

Creates the PixiJS `Application` and mounts the canvas. It also owns the dungeon transition — `enterDungeonMode(dayLevel)` and `exitDungeonMode()` swap the whole scene, and dungeon events are surfaced through `onDungeonEvent(callback)`.

---

## 9. Vue UI Components

### GameCanvas.vue

Wraps the PixiJS canvas. On mount it creates the `GameRenderer`, initializes the world with character positions, watches the store for phase changes (to enable/disable input), watches SSE events to animate AI decisions, and forwards world events to App.vue.

The `ai_decision` handler is worth reading if you touch animations: it maps the decision to a walk target via `getActionTarget`, plays the move, then shows a floating reward icon. It renders **icons, not labels** — "Kong Soh Biscuits" does not fit over a sprite's head.

### HUD.vue

Top bar, fully reactive. Shows the day, a phase badge (color-coded), all four resources, trade slots remaining, today's market prices, the active daily event, and the escape progress bar. The resource rows are built from `RESOURCE_LABELS` and `GAME_CONFIG.WIN_COINS` rather than hardcoded.

### ActionMenu.vue

Phase-aware popup when pressing E near something:

- `player_labor` + workshop → "odd jobs (+1 Kong Soh Biscuits, +2 Goods)"
- `player_labor` + dojo → "practice kung fu (+1 Might)"
- `player_labor` + anything else → "You must labor first!"
- `player_trade` + resident → open the negotiation panel
- `player_trade` + dock → sell interface (quantity inputs, live price calculation)
- `player_trade` + cave → enter the dungeon (once per day)

### DialoguePanel.vue

Sidebar for negotiation. Contains the message history, a quick-trade template (Buy/Sell + amount + resource + price), a free-form text input, Accept/Reject buttons, and an exchange counter. The first message sends `trade_peer`; subsequent ones send `negotiate_reply`.

### InteractionPrompt.vue

The "Press E to…" prompt, phase-aware — it shows "(Already labored today)" or "(Trade phase only)" when the action isn't available.

### DaySummaryModal.vue

The night summary. This one parses the settlement log lines the server emitted, so it's the clearest example of the registry rule from §3:

```typescript
const STATE_LINE = new RegExp(
  `^(.+?): ${RESOURCE_LABELS.cake} (-?\\d+), ${RESOURCE_LABELS.goods} (-?\\d+), ` +
  `${RESOURCE_LABELS.might} (-?\\d+), ${RESOURCE_LABELS.coins} (-?\\d+)$`,
)
```

The pattern is **built from the registry**, not hand-copied. The previous version hardcoded the names; when the resources were renamed the regex silently stopped matching and the modal rendered empty rows with no error anywhere.

It also needs `ID_BY_NAME`, because log lines name characters the way the player sees them (`辛仔`, `You`) while the rest of the component keys on the machine id.

### EventLog.vue

Collapsible bottom panel, fed from two sources: `game.state.log` (engine lines) and `game.events` (SSE). Colour-coded — yellow for day headers, blue for AI actions, purple for dialogue, green for successful trades, red for failures and eliminations.

### TutorialModal.vue, PhaseHint.vue, ResourceToasts.vue

The tutorial (shown once, tracked under a `kowloon-walled-city:tutorial-seen` localStorage key), the persistent phase guidance line, and the floating "+1 🥮" toasts.

---

## 10. State Management

**File**: `apps/web/src/stores/game.ts`

One Pinia store holds everything:

```typescript
// Core state
gameId             // current game ID (null = title screen)
state              // full GameState from the server
events             // array of all SSE events received
isLoading          // true during API calls
activeNegotiation  // current negotiation state, if any
negotiationPending // set while awaiting an LLM reply over HTTP
thinkingCharacter  // which AI is currently "thinking"

// Map / interaction state (the PixiJS ↔ Vue bridge)
currentInteraction, showActionMenu, showDialoguePanel, dialogueTarget

// Dungeon state
dungeonMode, showCardPicker, pendingCards, dungeonStats, dungeonResult
```

`CHARACTER_META` also lives here — name, personality label, and emoji per character id. `characterMeta(id)` is the tolerant lookup used at the boundary where unvalidated strings enter the UI (a key from `Object.keys()`, or a name parsed out of a server log line); it falls back to rendering the raw id rather than throwing.

### Actions

- `newGame()` — POST `/api/games`, connect SSE
- `submitAction(action)` — POST `/api/games/:id/action`, handle negotiation responses
- `connectSSE()` / `disconnectSSE()` — manage the `EventSource` with auto-reconnect
- `openNegotiation(target, convId)` / `closeNegotiation()`

### SSE handling

`connectSSE()` opens an `EventSource` to `/api/games/:id/stream`. Each message is parsed, pushed onto `events` (which is what EventLog and DaySummaryModal read), and passed to `handleSSEEvent()` to update store state.

The `events` array is append-only and is **the** trigger for several watchers — `DaySummaryModal` watches its length and pops when the newest event is a `settlement`.

---

## 11. Configuration & Environment

### .env file

```
OPENAI_API_KEY=<key>                          # Required
OPENAI_BASE_URL=https://openrouter.ai/api/v1  # Any OpenAI-compatible endpoint
OPENAI_MODEL=deepseek/deepseek-chat
DB_FILE_NAME=file:local.db
HOST=127.0.0.1
PORT=8787
LOG_LEVEL=info
```

Parsed and validated by Zod in `apps/server/src/env.ts`, which also loads the **root** `.env` (not a per-package one) and skips overriding under `NODE_ENV=test` / `VITEST=true` so tests control their own environment.

### Changing LLM provider

Just change `.env`:

- **OpenRouter**: `OPENAI_BASE_URL=https://openrouter.ai/api/v1`, model like `deepseek/deepseek-chat`
- **OpenAI direct**: drop `OPENAI_BASE_URL`, model like `gpt-4.1-nano`
- **Local Ollama**: `OPENAI_BASE_URL=http://localhost:11434/v1`, model like `deepseek-r1:7b`
- **DeepSeek direct**: `OPENAI_BASE_URL=https://api.deepseek.com/v1`, model like `deepseek-chat`

Avoid reasoning models for the NPCs unless you raise the token budget — see the `reasoning_content` note in §5.

### Vite proxy

`apps/web/vite.config.ts` proxies `/api` to `http://127.0.0.1:8787` in dev, so the frontend never needs to know the server URL.

### Production

`pnpm build && pnpm start` serves the API and the built web app from the same Fastify process. `app.ts` registers `@fastify/static` on `apps/web/dist` only if `index.html` exists, and the not-found handler falls back to `index.html` for non-`/api/` paths.

---

## 12. Common Tasks

### Add a new resource type

1. Add the field to `ResourcesSchema` in `packages/shared/src/index.ts`
2. Add its display name to `RESOURCE_LABELS` (the `satisfies` clause will fail until you do)
3. Add a starting value to `GAME_CONFIG` and to `makeCharacter()` in `engine/game.ts`
4. Handle it in `safeResources()` and in `settle()` if it's consumed nightly
5. Mention it in the prompts if the AI should reason about it — `formatResources` picks it up automatically
6. Add it to the HUD rows and `buildResourceStats` in `interactionPreviewPanel.ts`
7. Run `pnpm typecheck` to find anything you missed

### Add a new NPC

1. Add the ID to `CharacterIdSchema` and `AI_CHARACTERS` in shared types
2. Add a personality in `apps/server/src/agents/personalities.ts` (`AI_PERSONALITIES` is keyed by the type, so this is enforced)
3. Add a starting position in `apps/web/src/game/tiles.ts` (`CHARACTER_POSITIONS` is likewise typed)
4. Add meta (name, emoji, personality label) in `apps/web/src/stores/game.ts` (`CHARACTER_META`)
5. Add a shirt color in `apps/web/src/game/Character.ts`

### Change the map

Edit `MAP_RAW` in `apps/web/src/game/tiles.ts` — a 20x15 array of characters. Keep walkable areas connected and character positions on walkable tiles. `isWalkable()` decides what's passable; `findNearestTile` will locate any interactable you add without further wiring.

### Add a random event

The system already exists — extend it rather than building a parallel one:

1. Add the variant to `DailyEventSchema` and to `DAILY_EVENT_INFO` (label, icon, description) in shared types
2. Add its probability to `rollDailyEvent()` in `engine/game.ts`
3. Apply its effect in exactly one place — `startDay` for dawn grants, `applyWork` / `executePeerTrade` / `settle` for rule changes
4. Emit a log line in `startDay` so the player learns why the rules changed

### Run tests

```bash
pnpm test          # all tests
pnpm test:unit     # unit only
pnpm test:e2e      # Playwright
pnpm typecheck     # all packages
```

### Build for production

```bash
pnpm build
# Web artifact: apps/web/dist/
# Server artifact: apps/server/dist/
```

⚠️ **The server builds with `tsconfig.build.json`, not `tsconfig.json`.** The
plain config deliberately includes `tests/**/*.ts` so that `pnpm typecheck`
checks the test files too — but `tsc` *emits* everything it includes, so
building with it writes compiled copies into `dist/tests/`, vitest collects
both copies, the suite runs twice, and the second run dies in `beforeAll` on a
10s hook timeout fighting the first one for the SQLite file. If you ever
repoint `build` at `tsconfig.json`, that failure comes back.

---

## 13. Known Issues & TODOs

### Correctness / design gaps

- [ ] **Might has no sink.** `train` produces it and `executePeerTrade` explicitly carries it through untouched, but nothing spends it. Forcing a trade with Might is the next mechanic, and until it exists the fourth resource is dead weight.
- [ ] **The boss has two names.** `resolveDungeon` logs `噬影` while `App.vue`'s HUD labels the fight "Giant Crab". Pick one.
- [ ] **`chatText` in `llm.ts` is dead code** — negotiation uses `chatJSON` for everything. Either delete it or move the free-form dialogue onto it.

### Leftover island art (the retheme is incomplete visually)

- [ ] `TileMap.ts` still draws a **sailboat** (hull, mast, sail) on the market tile, labelled "MARKET"
- [ ] `interactionPreviewModels.ts` still has `addPalm` and a sandy-island default preview
- [ ] `AudioManager.ts` still calls its track id `'island'` (`ISLAND_MELODY`, `startIslandBGM`)
- [ ] Several source comments still describe the sea and the island (`TileMap.ts`, `GameWorld.ts`, `PlayerCombat.ts`)
- [ ] The five screenshots in `docs/screenshots/` still show the original island build

### Operational

- [ ] **AI turns take 15-30 seconds.** Four sequential LLM calls. The independent AIs could be parallelised, but that would change the turn order guarantees the settlement relies on.
- [ ] **SSE reconnection after a server hot-reload sometimes fails** — refresh the page.
- [ ] **No save/load UI.** The `saves` table exists in `db/schema.ts` and games are persisted to `games`, but no route exposes loading an old game except by id.
- [ ] Action-menu button clicks occasionally don't register (PixiJS canvas intercepting pointer events). `pointer-events: none` is applied when the menu is open, but it needs more testing.

### Feature ideas

- [ ] Sound effects beyond the dungeon
- [ ] Real pixel-art sprites instead of programmatic drawing
- [ ] Mobile touch support
- [ ] Multiplayer (multiple human players)
- [ ] A difficulty curve across the early and late game
- [ ] Long-term NPC memory across days — the biggest lever on how "alive" they feel

---

## File-by-File Reference

| File | Purpose |
|------|---------|
| `packages/shared/src/index.ts` | All Zod schemas, `GAME_CONFIG`, `RESOURCE_LABELS`, `LABOR_LABELS`, `mulberry32` |
| `apps/server/src/index.ts` | Server entry point |
| `apps/server/src/app.ts` | Fastify setup, routes, static web serving |
| `apps/server/src/env.ts` | Environment parsing (Zod) |
| `apps/server/src/state.ts` | In-memory sessions, live negotiations, SSE broadcast |
| `apps/server/src/db/schema.ts` | Drizzle tables (`saves`, `games`) |
| `apps/server/src/db/client.ts` | libSQL client + schema init |
| `apps/server/src/engine/game.ts` | Pure-function game state machine |
| `apps/server/src/agents/personalities.ts` | AI characters + the two name functions |
| `apps/server/src/agents/format.ts` | Prompt rendering for resources and offers |
| `apps/server/src/agents/llm.ts` | OpenAI-compatible client, JSON extraction, retries |
| `apps/server/src/agents/decision-agent.ts` | Per-turn AI decision (labor + trades) |
| `apps/server/src/agents/negotiation-agent.ts` | Trade dialogue |
| `apps/server/src/agents/runtime.ts` | Orchestrates the AI turn sequence |
| `apps/server/src/routes/game.ts` | REST + SSE endpoints |
| `apps/web/src/App.vue` | Main layout (title screen / game screen) |
| `apps/web/src/stores/game.ts` | Pinia state management + `CHARACTER_META` |
| `apps/web/src/composables/useApi.ts` | API fetch helpers |
| `apps/web/src/game/tiles.ts` | Map layout, tile semantics, character positions |
| `apps/web/src/game/TileMap.ts` | PixiJS tile renderer |
| `apps/web/src/game/Character.ts` | PixiJS character sprite |
| `apps/web/src/game/InputManager.ts` | Keyboard input |
| `apps/web/src/game/GameWorld.ts` | PixiJS world orchestrator |
| `apps/web/src/game/GameRenderer.ts` | PixiJS application setup + dungeon scene swap |
| `apps/web/src/game/dungeon/CardSystem.ts` | The 15 upgrade cards |
| `apps/web/src/game/dungeon/Boss.ts` | Bullet-hell boss state machine |
| `apps/web/src/render3d/interactionPreviewModels.ts` | Procedural 3D model per interaction |
| `apps/web/src/render3d/interactionPreviewMeta.ts` | Titles and subtitles for the preview |
| `apps/web/src/components/GameCanvas.vue` | PixiJS ↔ Vue bridge |
| `apps/web/src/components/HUD.vue` | Top status bar |
| `apps/web/src/components/ActionMenu.vue` | Interaction context menu |
| `apps/web/src/components/DialoguePanel.vue` | Negotiation sidebar |
| `apps/web/src/components/DaySummaryModal.vue` | Night summary (parses settlement logs) |
| `apps/web/src/components/EventLog.vue` | Bottom event log |
| `apps/web/src/components/interactionPreviewPanel.ts` | Preview side-panel logic |
