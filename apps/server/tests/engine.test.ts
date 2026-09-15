import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNewGame, seedRng, startDay } from '../src/engine/game'

describe('startDay daily events', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cargo spill gives every alive character +2 goods at dawn', () => {
    // 0.9 lands in the cargo_spill band of rollDailyEvent for day >= 3.
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    const game = { ...createNewGame('g1'), day: 3 }
    const goodsBefore = Object.fromEntries(
      Object.entries(game.characters).map(([id, c]) => [id, c.resources.goods]),
    )

    const next = startDay(game)

    expect(next.dailyEvent).toBe('cargo_spill')
    for (const [id, c] of Object.entries(next.characters)) {
      if (c.alive && !c.escaped) {
        expect(c.resources.goods).toBe(goodsBefore[id] + 2)
      }
    }
    expect(next.log.some((line) => line.includes('Cargo Spill'))).toBe(true)
  })

  it('windfall still gives +2 cake (unchanged sibling event)', () => {
    // 0.85 lands in the windfall band for day >= 3.
    vi.spyOn(Math, 'random').mockReturnValue(0.85)
    const game = { ...createNewGame('g2'), day: 3 }
    const cakeBefore = Object.fromEntries(
      Object.entries(game.characters).map(([id, c]) => [id, c.resources.cake]),
    )

    const next = startDay(game)

    expect(next.dailyEvent).toBe('windfall')
    for (const [id, c] of Object.entries(next.characters)) {
      if (c.alive && !c.escaped) {
        expect(c.resources.cake).toBe(cakeBefore[id] + 2)
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
      seriesA.push(a.merchantPrices.cakePrice, a.merchantPrices.goodsPrice)
      seriesB.push(b.merchantPrices.cakePrice, b.merchantPrices.goodsPrice)
    }

    expect(seriesA).not.toEqual(seriesB)
  })

  it('the seed rides on the game state for replay', () => {
    expect(createNewGame('a', 42).seed).toBe(42)
    expect(createNewGame('b').seed).toBeNull()
  })
})
