<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import { GAME_CONFIG, LABOR_LABELS, RESOURCE_LABELS } from '@game/shared'
import type { InteractionType } from '@/game/GameWorld'

const props = defineProps<{
  interaction: InteractionType
}>()

const game = useGameStore()

const promptText = computed(() => {
  if (!props.interaction) return ''
  const isLabor = game.phase === 'player_labor'
  const isTrade = game.phase === 'player_trade'

  switch (props.interaction.kind) {
    case 'npc':
      return isTrade
        ? `Press E to talk to ${props.interaction.characterName}`
        : `(Trade phase only) ${props.interaction.characterName}`
    case 'work':
      return isLabor
        ? `Press E for ${LABOR_LABELS.work} (+${GAME_CONFIG.CAKE_PER_WORK} ${RESOURCE_LABELS.cake}, +${GAME_CONFIG.GOODS_PER_WORK} ${RESOURCE_LABELS.goods})`
        : '(Already labored today)'
    case 'train':
      return isLabor
        ? `Press E to ${LABOR_LABELS.train} (+${GAME_CONFIG.MIGHT_PER_TRAINING} ${RESOURCE_LABELS.might})`
        : '(Already labored today)'
    case 'merchant':
      return isTrade
        ? 'Press E to trade at the market'
        : '(Trade phase only)'
    case 'dungeon':
      return isTrade
        ? 'Press E to enter the dungeon (costs 1 trade slot)'
        : '(Trade phase only)'
    default:
      return ''
  }
})

const promptIcon = computed(() => {
  if (!props.interaction) return ''
  switch (props.interaction.kind) {
    case 'npc':
      return 'NPC'
    case 'work':
      return 'WORK'
    case 'train':
      return 'TRAIN'
    case 'merchant':
      return 'MARKET'
    case 'dungeon':
      return 'CAVE'
    default:
      return ''
  }
})
</script>

<template>
  <Transition name="prompt">
    <div v-if="interaction" class="interaction-prompt">
      <span class="prompt-icon">{{ promptIcon }}</span>
      <span class="prompt-text">{{ promptText }}</span>
      <span class="prompt-key">[E]</span>
    </div>
  </Transition>
</template>

<style scoped>
.interaction-prompt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid #4a6a8a;
  border-radius: 6px;
  color: #e0e8f0;
  font-family: monospace;
  font-size: 12px;
  backdrop-filter: blur(4px);
}

.prompt-icon {
  background: #3a5a7a;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: bold;
  color: #a0c0e0;
}

.prompt-text {
  color: #c8d8e8;
}

.prompt-key {
  background: #5a7a3a;
  color: #c0e0a0;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: bold;
}

.prompt-enter-active {
  transition: all 0.2s ease-out;
}
.prompt-leave-active {
  transition: all 0.15s ease-in;
}
.prompt-enter-from,
.prompt-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
