<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useGameStore } from '@/stores/game'
import {
  GAME_CONFIG,
  DAILY_EVENT_INFO,
  RESOURCE_LABELS,
  type DailyEvent,
  type Resources,
} from '@game/shared'

const game = useGameStore()

const resources = computed<Resources>(
  () => game.playerState?.resources ?? { cake: 0, goods: 0, might: 0, coins: 0 },
)
const coins = computed(() => resources.value.coins)
const escapeProgress = computed(() => {
  const pct = Math.min(100, Math.round((coins.value / GAME_CONFIG.WIN_COINS) * 100))
  return pct
})

/** One entry per resource, described once — the row, its icon and its colour. */
const RESOURCE_ROWS: ReadonlyArray<{ key: keyof Resources; icon: string; label: string; color: string }> = [
  { key: 'cake', icon: '🥮', label: `${RESOURCE_LABELS.cake} — eaten every night`, color: 'text-amber-300' },
  { key: 'goods', icon: '📦', label: `${RESOURCE_LABELS.goods} — sold to the market`, color: 'text-orange-300' },
  { key: 'might', icon: '👊', label: `${RESOURCE_LABELS.might} — spent to force a trade`, color: 'text-rose-300' },
  { key: 'coins', icon: '🪙', label: `${RESOURCE_LABELS.coins} — ${GAME_CONFIG.WIN_COINS} buys your way out`, color: 'text-yellow-300' },
]

// Pulse animation tokens — bumped on every change to retrigger the CSS
// animation. Keyed by resource so adding a row above needs no extra wiring.
const pulse = reactive<Record<keyof Resources, number>>({ cake: 0, goods: 0, might: 0, coins: 0 })
const tone = reactive<Record<keyof Resources, 'pos' | 'neg' | ''>>({
  cake: '', goods: '', might: '', coins: '',
})

for (const { key } of RESOURCE_ROWS) {
  watch(() => resources.value[key], (newVal, oldVal) => {
    if (oldVal === undefined || newVal === oldVal) return
    pulse[key]++
    tone[key] = newVal > oldVal ? 'pos' : 'neg'
    window.setTimeout(() => { tone[key] = '' }, 600)
  })
}

const phaseLabel = computed(() => {
  switch (game.phase) {
    case 'day_start':
      return 'Dawn'
    case 'player_labor':
      return 'Labor'
    case 'player_trade':
      return 'Trade'
    case 'ai_turns':
      return 'AI Turns'
    case 'settlement':
      return 'Night'
    case 'day_end':
      return 'Day End'
    case 'game_over':
      return 'Game Over'
    default:
      return game.phase
  }
})

const phaseColor = computed(() => {
  switch (game.phase) {
    case 'player_labor':
      return 'bg-emerald-600'
    case 'player_trade':
      return 'bg-emerald-600'
    case 'ai_turns':
      return 'bg-blue-600'
    case 'settlement':
      return 'bg-indigo-700'
    case 'game_over':
      return 'bg-red-700'
    default:
      return 'bg-amber-600'
  }
})

const tradeSlots = computed(() => game.playerTradeSlots)
const merchantCake = computed(() => game.merchantPrices.cakePrice)
const merchantGoods = computed(() => game.merchantPrices.goodsPrice)

const dailyEvent = computed<DailyEvent>(() => game.state?.dailyEvent ?? 'none')
const dailyEventInfo = computed(() => DAILY_EVENT_INFO[dailyEvent.value])
</script>

<template>
  <div class="hud-bar">
    <!-- Day & Phase -->
    <div class="hud-section">
      <span class="hud-label">Day</span>
      <span class="hud-value text-amber-200">{{ game.day }}</span>
    </div>

    <div class="hud-section">
      <span :class="['hud-badge', phaseColor]">{{ phaseLabel }}</span>
    </div>

    <!-- Daily event badge — only shows on non-calm days -->
    <div
      v-if="dailyEvent !== 'none'"
      class="hud-section"
      :title="dailyEventInfo.desc"
    >
      <span class="hud-event-badge">
        <span class="hud-event-icon">{{ dailyEventInfo.icon }}</span>
        <span class="hud-event-label">{{ dailyEventInfo.label }}</span>
      </span>
    </div>

    <!-- Divider -->
    <div class="hud-divider" />

    <!-- Resources -->
    <div v-for="row in RESOURCE_ROWS" :key="row.key" class="hud-section" :title="row.label">
      <span class="hud-icon">{{ row.icon }}</span>
      <span
        :key="pulse[row.key]"
        :class="['hud-value', row.color, tone[row.key] && `pulse-${tone[row.key]}`]"
      >{{ resources[row.key] }}</span>
    </div>

    <!-- Divider -->
    <div class="hud-divider" />

    <!-- Trade Slots -->
    <div class="hud-section" title="Trade slots remaining">
      <span class="hud-label">Trades</span>
      <span class="hud-value text-purple-300">{{ tradeSlots }}</span>
    </div>

    <!-- Market Prices -->
    <div class="hud-section" title="Market rates today">
      <span class="hud-label text-[10px]">Market: 🥮{{ merchantCake }}c 📦{{ merchantGoods }}c</span>
    </div>

    <!-- Divider -->
    <div class="hud-divider" />

    <!-- Escape Progress -->
    <div class="hud-section hud-section-wide" :title="`Buy your way out (${GAME_CONFIG.WIN_COINS} ${RESOURCE_LABELS.coins} needed)`">
      <span class="hud-label">Escape</span>
      <div class="escape-bar">
        <div class="escape-fill" :style="{ width: escapeProgress + '%' }" />
        <span class="escape-text">{{ escapeProgress }}%</span>
      </div>
    </div>

    <!-- Status indicators -->
    <div v-if="!game.playerAlive" class="hud-section">
      <span class="hud-badge bg-red-700">ELIMINATED</span>
    </div>
    <div v-else-if="game.playerEscaped" class="hud-section">
      <span class="hud-badge bg-emerald-700">ESCAPED!</span>
    </div>

    <!-- Error message -->
    <Transition name="fade">
      <div v-if="game.errorMessage" class="hud-section">
        <span class="hud-badge bg-red-600">{{ game.errorMessage }}</span>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.hud-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 16px;
  background: linear-gradient(180deg, #1a2a3a 0%, #0f1a2a 100%);
  border-bottom: 2px solid #2a4a5a;
  color: #c8d8e8;
  font-family: monospace;
  font-size: 12px;
  flex-wrap: wrap;
  min-height: 36px;
}

.hud-section {
  display: flex;
  align-items: center;
  gap: 4px;
}

.hud-section-wide {
  flex: 0 0 auto;
  min-width: 140px;
}

.hud-label {
  font-size: 10px;
  text-transform: uppercase;
  color: #7a8a9a;
  letter-spacing: 0.5px;
}

.hud-value {
  font-weight: bold;
  font-size: 14px;
}

.hud-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 1;
  background: #3a4a5a;
}

.hud-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #fff;
}

.hud-divider {
  width: 1px;
  height: 20px;
  background: #3a4a5a;
}

.escape-bar {
  position: relative;
  width: 100px;
  height: 14px;
  background: #2a3a4a;
  border-radius: 3px;
  border: 1px solid #3a5a6a;
  overflow: hidden;
}

.escape-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #4ade80);
  transition: width 0.3s ease;
  border-radius: 2px;
}

.escape-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: bold;
  color: #fff;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
}

.pulse-pos {
  animation: hud-pulse-pos 0.6s ease-out;
}
.pulse-neg {
  animation: hud-pulse-neg 0.6s ease-out;
}

@keyframes hud-pulse-pos {
  0%   { transform: scale(1);    text-shadow: none; }
  20%  { transform: scale(1.6);  text-shadow: 0 0 10px rgba(140, 240, 140, 0.95); color: #b3ffb3; }
  100% { transform: scale(1);    text-shadow: none; }
}

@keyframes hud-pulse-neg {
  0%   { transform: scale(1);    text-shadow: none; }
  20%  { transform: scale(1.4);  text-shadow: 0 0 8px rgba(255, 120, 80, 0.9); color: #ff9a66; }
  100% { transform: scale(1);    text-shadow: none; }
}

.hud-event-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(200, 160, 96, 0.25), rgba(200, 160, 96, 0.08));
  border: 1px solid rgba(200, 160, 96, 0.5);
  cursor: help;
  animation: event-glow 2.4s ease-in-out infinite;
}
.hud-event-icon {
  font-size: 14px;
  line-height: 1;
}
.hud-event-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
  color: #f0d5a3;
  text-transform: uppercase;
}
@keyframes event-glow {
  0%, 100% { box-shadow: 0 0 0 rgba(200, 160, 96, 0); }
  50% { box-shadow: 0 0 8px rgba(200, 160, 96, 0.4); }
}
</style>
