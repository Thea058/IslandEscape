import type { InteractionType } from '@/game/GameWorld'

export interface InteractionPreviewMeta {
  title: string
  subtitle: string
}

export function getInteractionPreviewKey(interaction: InteractionType): string {
  if (!interaction) return 'default'
  if (interaction.kind === 'npc') return `npc:${interaction.characterId}`
  return interaction.kind
}

export function getInteractionPreviewMeta(interaction: InteractionType): InteractionPreviewMeta {
  if (!interaction) {
    return {
      title: 'Back Alleys',
      subtitle: 'Move near a workshop, market stall, or resident to inspect it here.',
    }
  }

  switch (interaction.kind) {
    case 'work':
      return {
        title: 'Workshop',
        subtitle: 'Odd jobs pay in biscuits and goods. The safe way to survive the night.',
      }
    case 'train':
      return {
        title: 'Martial Arts Hall',
        subtitle: 'Practice kung fu. It earns nothing you can sell, but gives you leverage.',
      }
    case 'merchant':
      return {
        title: 'Night Market',
        subtitle: 'Today only. Convert surplus goods into escape money.',
      }
    case 'dungeon':
      return {
        title: 'Boss Dungeon',
        subtitle: 'A boss rules the underworld. Win for coins, lose and pay in resources. One run per day.',
      }
    case 'npc':
      return {
        title: interaction.characterName,
        subtitle: 'Close enough to negotiate, trade, or test their patience.',
      }
  }
}
