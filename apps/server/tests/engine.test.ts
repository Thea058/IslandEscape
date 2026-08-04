import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNewGame, seedRng, startDay } from '../src/engine/game'

describe('startDay daily events', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('bumper crop gives every alive character +2 wheat at dawn', () => {
    // 0.9 lands in the bumper_crop band of rollDailyEvent for day >= 3.
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const game = { ...createNewGame('g1'), day: 3 }
    const wheatBefore = Object.fromEntries(
      Object.entries(game.characters).map(([id, c]) => [id, c.resources.wheat]),
    )

    const next = startDay(game)

    expect(next.dailyEvent).toBe('bumper_crop')
    for (const [id, c] of Object.entries(next.characters)) {
      if (c.alive && !c.escaped) {
        expect(c.resources.wheat).toBe(wheatBefore[id] + 2)
      }
    }
    expect(next.log.some((line) => line.includes('Bumper Crop'))).toBe(true)
  })

  it('lucky catch still gives +2 fish (unchanged sibling event)', () => {
    // 0.85 lands in the lucky_catch band for day >= 3.
    vi.spyOn(Math, 'random').mockReturnValue(0.85)
    const game = { ...createNewGame('g2'), day: 3 }
    const fishBefore = Object.fromEntries(
      Object.entries(game.characters).map(([id, c]) => [id, c.resources.fish]),
    )

    const next = startDay(game)

    expect(next.dailyEvent).toBe('lucky_catch')
    for (const [id, c] of Object.entries(next.characters)) {
      if (c.alive && !c.escaped) {
        expect(c.resources.fish).toBe(fishBefore[id] + 2)
      }
    }
  })
})


describe('seeded runs', () => {
  afterEach(() => {
    seedRng(null)
  })

  it('the same seed reproduces an identical first day', () => {
    const a = startDay(createNewGame('a', 42))
    const b = startDay(createNewGame('b', 42))

    expect(a.merchantPrices).toEqual(b.merchantPrices)
    expect(a.aiTurnOrder).toEqual(b.aiTurnOrder)
    expect(a.dailyEvent).toBe(b.dailyEvent)
  })

  it('different seeds diverge', () => {
    // single-day prices can legitimately collide in their small ranges, so
    // compare a multi-day series: two different seeds must part ways somewhere
    let a = startDay(createNewGame('a', 42))
    let b = startDay(createNewGame('b', 1337))
    const seriesA: number[] = []
    const seriesB: number[] = []
    for (let day = 0; day < 5; day++) {
      a = startDay(a)
      b = startDay(b)
      seriesA.push(a.merchantPrices.fishPrice, a.merchantPrices.wheatPrice)
      seriesB.push(b.merchantPrices.fishPrice, b.merchantPrices.wheatPrice)
    }

    expect(seriesA).not.toEqual(seriesB)
  })

  it('the seed rides on the game state for replay', () => {
    expect(createNewGame('a', 42).seed).toBe(42)
    expect(createNewGame('b').seed).toBeNull()
  })
})
