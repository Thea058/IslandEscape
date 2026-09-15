import { describe, expect, it } from 'vitest'

import { getInteractionPreviewKey, getInteractionPreviewMeta } from '@/render3d/interactionPreviewMeta'

describe('interaction preview metadata', () => {
  it('returns the default preview state', () => {
    expect(getInteractionPreviewKey(null)).toBe('default')
    expect(getInteractionPreviewMeta(null).title).toBe('Back Alleys')
  })

  it('maps direct resource interactions', () => {
    expect(getInteractionPreviewKey({ kind: 'work' })).toBe('work')
    expect(getInteractionPreviewMeta({ kind: 'train' }).title).toBe('Martial Arts Hall')
    expect(getInteractionPreviewMeta({ kind: 'merchant' }).title).toBe('Night Market')
  })

  it('includes npc identity in the preview key and label', () => {
    const interaction = { kind: 'npc', characterId: 'san', characterName: 'San' } as const

    expect(getInteractionPreviewKey(interaction)).toBe('npc:san')
    expect(getInteractionPreviewMeta(interaction).title).toBe('San')
  })
})
