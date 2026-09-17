// ============================================================
// Kowloon Walled City — Tile Map Renderer (PixiJS)
// ============================================================

import { Container, Graphics, Text, TextStyle } from 'pixi.js'
import { CITY_MAP, TILE_SIZE, MAP_COLS, MAP_ROWS, type TileType } from './tiles'

// ----- Color Palette -----

// The border was sea until the retheme. Kowloon Walled City was inland, and by
// the 1970s what hemmed it in was not a wall but the sheer mass of its own outer
// buildings — so these are the tones that mass is built from.
//
// Three earlier drafts are worth recording, because all three failed the same way.
// The first stood three tall blocks on a brick base; the second put alleys between
// them; the third cut each tile into a 3x3 grid of rooftops. Read at actual size
// they came out as vertical stripes, then a fence, then a brick lattice — a
// texture every time. The lesson is in the shape of the mistake rather than the
// colouring: a pattern that repeats every 32 pixels *is* a texture, no matter how
// it is painted, and a rooftop only becomes a rooftop once it is closed on all
// four sides AND free to be larger than one tile. That is why the drawing below
// packs the whole border in one pass.
const WALL_ROOF = 0x4a3b33
const WALL_ROOF_MID = 0x574434
const WALL_ROOF_LIT = 0x6a5645
const WALL_ROOF_DARK = 0x382a20
const WALL_ALLEY = 0x1d1713
const WALL_WINDOW = 0xffcc44

/** Rooftop tones, picked from in a hash order so no two tiles come out alike. */
const WALL_ROOF_TONES = [WALL_ROOF_DARK, WALL_ROOF, WALL_ROOF_MID, WALL_ROOF_LIT]

/** Width of the alley left between two rooftops. */
const WALL_ALLEY_W = 1

const COLORS: Record<TileType, number> = {
  wall: WALL_ROOF,
  sand: 0xe8d5a3,
  grass: 0x5b9a3e,
  dojo: 0x6b6b73,
  dock: 0x8b6b42,
  house: 0xa0522d,
  tree: 0x2d6e1e,
  rock: 0x808080,
  // Packed earth — the workshop stands outside the wall now, not on a jetty.
  workshop: 0x6e6455,
  path: 0xc4a96a,
  cave: 0x1a1a2e,
}

export class TileMap {
  public container: Container
  private animFrame = 0
  /** The workshop tiles are the only animated ones left — their crates bob. */
  private animatedTiles: Array<{ g: Graphics; col: number; row: number }> = []

  constructor() {
    this.container = new Container()
    this.container.label = 'tilemap'
    this.buildMap()
  }

  private buildMap() {
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = CITY_MAP[row]![col]!
        const g = new Graphics()
        g.x = col * TILE_SIZE
        g.y = row * TILE_SIZE

        this.drawTile(g, tile, col, row)
        this.container.addChild(g)

        if (tile === 'workshop') {
          this.animatedTiles.push({ g, col, row })
        }
      }
    }

    // These two cover the whole map rather than a single tile, so they go last.
    this.drawCityWallRegion()
    this.drawGateMarket()
  }

  private drawTile(g: Graphics, tile: TileType, col: number, row: number) {
    const baseColor = COLORS[tile]

    switch (tile) {
      case 'wall':
        // Drawn as a single pass over the whole border instead of tile by tile —
        // see drawCityWallRegion. Nothing to do here, and deliberately no grid
        // line either: a 32px grid over the rooftops would put the tiling back.
        return
      case 'sand':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(baseColor)
        // Sand texture dots
        this.drawSandDots(g)
        break
      case 'grass':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(baseColor)
        this.drawGrassBlades(g, col, row)
        break
      case 'dojo':
        this.drawDojo(g)
        break
      case 'dock':
        this.drawDock(g)
        break
      case 'house':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x5b9a3e) // grass base
        this.drawHouse(g)
        break
      case 'tree':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x5b9a3e) // grass base
        this.drawTree(g)
        break
      case 'rock':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x5b9a3e) // grass base
        this.drawRock(g)
        break
      case 'workshop':
        this.drawWorkshop(g)
        break
      case 'cave':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x5b9a3e) // grass base
        this.drawCave(g)
        break
      case 'path':
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(baseColor)
        this.drawPathTexture(g)
        break
      default:
        g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(baseColor)
    }

    // Grid line (subtle)
    g.rect(0, 0, TILE_SIZE, TILE_SIZE).stroke({ color: 0x000000, alpha: 0.06, width: 0.5 })
  }

  /**
   * 城墙 / 楼群 — the mass of outer buildings that encloses the city.
   *
   * This replaced the sea. It is deliberately static: the old water rippled on a
   * sine wave, and moving sea is precisely the read the retheme had to lose.
   *
   * It runs over the whole border rather than per tile because the thing being
   * drawn is bigger than a tile. The colour comment at the top of this file records
   * the three per-tile versions that failed before this one.
   */
  private drawCityWallRegion() {
    const wall = new Graphics()

    // The packing runs on a finer grid than the map's tiles. On the tile grid the
    // smallest possible rooftop was 32px across, which came out as a handful of
    // huge flat slabs: a rooftop has to be free to be smaller than a tile as well
    // as larger, and 8px is the step that gives that range.
    const SUB = 8
    const perTile = TILE_SIZE / SUB
    const subCols = MAP_COLS * perTile
    const subRows = MAP_ROWS * perTile

    const isWall = (sc: number, sr: number) =>
      CITY_MAP[Math.floor(sr / perTile)]?.[Math.floor(sc / perTile)] === 'wall'

    const claimed = new Set<number>()
    const key = (sc: number, sr: number) => sr * subCols + sc
    const freeRun = (sc: number, sr: number, w: number) => {
      for (let i = 0; i < w; i++) {
        if (!isWall(sc + i, sr) || claimed.has(key(sc + i, sr))) return false
      }
      return true
    }

    let block = 0
    for (let sr = 0; sr < subRows; sr++) {
      for (let sc = 0; sc < subCols; sc++) {
        if (!isWall(sc, sr) || claimed.has(key(sc, sr))) continue

        // Grow right and then down, stopping at a hash-derived size. Packing the
        // region into rectangles this way is what gives the rooftops a range of
        // sizes; the largest span several tiles, which no per-tile pass could do.
        let w = 1
        const maxW = 1 + ((sc * 7 + sr * 13) % 4)
        while (w < maxW && freeRun(sc + w, sr, 1)) w++
        let h = 1
        const maxH = 1 + ((sc * 11 + sr * 5) % 4)
        while (h < maxH && freeRun(sc, sr + h, w)) h++

        for (let j = 0; j < h; j++) {
          for (let i = 0; i < w; i++) claimed.add(key(sc + i, sr + j))
        }

        const x = sc * SUB
        const y = sr * SUB
        // The alley goes down first and the rooftop sits inset inside it, so every
        // block ends in shadow on all four sides. That is the whole reason these
        // read as buildings instead of as patches of colour.
        wall.rect(x, y, w * SUB, h * SUB).fill(WALL_ALLEY)
        wall
          .rect(x + WALL_ALLEY_W, y + WALL_ALLEY_W, w * SUB - WALL_ALLEY_W * 2, h * SUB - WALL_ALLEY_W * 2)
          .fill(WALL_ROOF_TONES[block % WALL_ROOF_TONES.length]!)
        block++
      }
    }

    // Lit windows, scattered across the rooftops. The hash runs on the sub-grid,
    // which is four times finer than the map — so this divisor is roughly four
    // times larger than it looks. At % 7 the border glittered.
    for (let sr = 0; sr < subRows; sr++) {
      for (let sc = 0; sc < subCols; sc++) {
        if (!isWall(sc, sr) || (sc * 31 + sr * 17) % 29 !== 0) continue
        wall.rect(sc * SUB + 3, sr * SUB + 3, 2, 2).fill(WALL_WINDOW)
      }
    }

    this.container.addChild(wall)
  }

  private drawSandDots(g: Graphics) {
    const dots = [[5, 5], [15, 10], [25, 7], [8, 22], [20, 25]]
    for (const [dx, dy] of dots) {
      g.circle(dx!, dy!, 1).fill({ color: 0xd4c090, alpha: 0.6 })
    }
  }

  private drawGrassBlades(g: Graphics, col: number, row: number) {
    // Deterministic pseudo-random based on position
    const seed = (col * 7 + row * 13) % 5
    const blades = [
      [6 + seed, 8],
      [16 + seed, 14],
      [24 - seed, 6],
      [10, 24 + seed],
    ]
    for (const [bx, by] of blades) {
      g.moveTo(bx!, by!).lineTo(bx! - 2, by! - 5).stroke({ color: 0x4a8332, width: 1, alpha: 0.5 })
    }

    // Sprinkle small flowers on roughly 1 in 5 grass tiles for visual variety.
    const decorRoll = (col * 31 + row * 17) % 5
    if (decorRoll === 0) {
      // Yellow flower
      const fx = 8 + (col % 3) * 3
      const fy = 18 + (row % 4)
      g.circle(fx, fy, 1.4).fill(0xffe066)
      g.circle(fx - 2, fy, 0.9).fill({ color: 0xffe066, alpha: 0.85 })
      g.circle(fx + 2, fy, 0.9).fill({ color: 0xffe066, alpha: 0.85 })
      g.circle(fx, fy - 2, 0.9).fill({ color: 0xffe066, alpha: 0.85 })
      g.circle(fx, fy + 2, 0.9).fill({ color: 0xffe066, alpha: 0.85 })
      g.circle(fx, fy, 0.6).fill(0xc8771f)
    } else if (decorRoll === 1) {
      // Red/pink flower
      const fx = 22 - (col % 2) * 3
      const fy = 22 - (row % 3)
      g.circle(fx, fy, 1.2).fill(0xff7099)
      g.circle(fx, fy, 0.5).fill(0xfff0a8)
    } else if (decorRoll === 2) {
      // Mushroom — adds whimsy
      const mx = 24
      const my = 24
      g.rect(mx - 1, my, 2, 3).fill(0xeee2c4)
      g.ellipse(mx, my, 3, 2).fill(0xc04848)
      g.circle(mx - 1, my - 0.5, 0.5).fill(0xfff0d8)
      g.circle(mx + 1, my, 0.4).fill(0xfff0d8)
    }
  }

  /** 武馆 — the training hall. Stone floor rather than crops. */
  private drawDojo(g: Graphics) {
    g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x6b6b73)
    // Flagstones
    for (let i = 0; i < 4; i++) {
      const y = 4 + i * 8
      g.rect(2, y, TILE_SIZE - 4, 6).fill({ color: 0x84848c, alpha: 0.9 })
      g.moveTo(2, y).lineTo(TILE_SIZE - 2, y).stroke({ color: 0x55555c, width: 1, alpha: 0.7 })
    }
  }

  /** A timber platform. There is no water under it any more. */
  private drawDock(g: Graphics) {
    g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(0x8b6b42)
    // Plank lines
    for (let i = 0; i < 4; i++) {
      g.moveTo(0, 8 * i + 4)
        .lineTo(TILE_SIZE, 8 * i + 4)
        .stroke({ color: 0x704a28, width: 1, alpha: 0.4 })
    }
  }

  private drawHouse(g: Graphics) {
    // Walls
    g.rect(6, 10, 20, 18).fill(0xb86e3a)
    // Roof (triangle)
    g.poly([6, 10, 16, 2, 26, 10]).fill(0xcc3333)
    // Door
    g.rect(13, 18, 6, 10).fill(0x5a3320)
    // Window
    g.rect(8, 14, 5, 5).fill(0xffee88)
  }

  private drawTree(g: Graphics) {
    // Trunk
    g.rect(13, 18, 6, 12).fill(0x6b4226)
    // Canopy (layered circles)
    g.circle(16, 14, 10).fill(0x2d8c1e)
    g.circle(12, 12, 7).fill(0x3ba629)
    g.circle(20, 12, 7).fill(0x34961e)
  }

  private drawRock(g: Graphics) {
    // Main rock body
    g.ellipse(16, 18, 12, 10).fill(0x888888)
    g.ellipse(14, 16, 8, 7).fill(0x999999)
    // Highlight
    g.ellipse(12, 14, 4, 3).fill({ color: 0xaaaaaa, alpha: 0.6 })
  }

  /** 工场 — the workshop outside the wall, where 打工 happens. */
  private drawWorkshop(g: Graphics, phase = 0) {
    // Packed earth, not water: the workshop stands on the ground outside the
    // wall, and the crates it stacks are what the player comes here to shift.
    g.rect(0, 0, TILE_SIZE, TILE_SIZE).fill(COLORS.workshop)
    // Crate stack, bobbing gently
    const bob = Math.sin(phase * 1.2) * 1.5
    g.rect(10, 12 + bob, 12, 12).fill({ color: 0xb07a3a, alpha: 0.9 })
    g.moveTo(10, 18 + bob).lineTo(22, 18 + bob).stroke({ color: 0x7a5020, width: 1, alpha: 0.9 })
    g.moveTo(16, 12 + bob).lineTo(16, 24 + bob).stroke({ color: 0x7a5020, width: 1, alpha: 0.9 })
    // Sparkle that pulses — signals "interactable here"
    const sparkle = 0.3 + (Math.sin(phase * 1.7) * 0.5 + 0.5) * 0.5
    g.circle(8, 9, 2).fill({ color: 0xffe0a0, alpha: sparkle })
  }

  private drawCave(g: Graphics) {
    // Dark cave entrance
    g.ellipse(16, 20, 12, 8).fill(0x1a1a2e)
    // Rock arch
    g.poly([2, 20, 2, 8, 6, 4, 12, 2, 18, 2, 24, 4, 28, 8, 28, 20])
      .fill({ color: 0x666666, alpha: 0.0 })
      .stroke({ color: 0x666666, width: 2 })
    // Inner darkness
    g.ellipse(16, 18, 8, 5).fill(0x0d0d1a)
    g.ellipse(16, 17, 4, 3).fill(0x050510)
    // Glowing eyes
    g.circle(12, 16, 2).fill({ color: 0xff4444, alpha: 0.7 })
    g.circle(20, 16, 2).fill({ color: 0xff4444, alpha: 0.7 })
  }

  private drawPathTexture(g: Graphics) {
    // Subtle footprints / worn look
    const dots = [[8, 8], [16, 16], [24, 24], [12, 20], [20, 8]]
    for (const [dx, dy] of dots) {
      g.circle(dx!, dy!, 1.5).fill({ color: 0xb89a5a, alpha: 0.4 })
    }
  }

  /**
   * The market stall that serves the gate tiles.
   *
   * It used to be a sailing yacht — a tall mast and a triangular white sail — which
   * still read as the island long after the retheme had renamed everything around it.
   * A flat cargo platform under a cloth awning says "goods for sale" instead, and the
   * awning and lamp reuse the exact colours of the Night Market preview panel, so the
   * sprite on the map and the model in the panel read as the same stall.
   */
  private drawGateMarket() {
    const stall = new Graphics()
    // Stands on the ground, just above the gate tiles.
    stall.x = 17 * TILE_SIZE
    stall.y = 8 * TILE_SIZE - 8

    // A plain rectangle. A tapered base — narrower at the bottom than at the top —
    // was what made the old cargo hull read as a boat, so both edges are kept the
    // same length and the ends left square.
    stall.rect(0, 22, 32, 10).fill(0x6b3a1f)
    stall.rect(3, 20, 26, 4).fill(0x8b5a2b)

    // Two posts carrying the awning. Same cloth red as the preview panel's.
    stall.rect(4, 2, 2, 20).fill(0x5a3a1a)
    stall.rect(22, 2, 2, 20).fill(0x5a3a1a)
    stall.rect(4, 2, 20, 4).fill(0xc2503f)

    // Cargo stacked under the awning — what this market actually trades in.
    stall.rect(6, 13, 10, 8).fill(0x7b5130)
    stall.rect(7, 6, 8, 7).fill(0x6a4329)
    stall.rect(17, 15, 7, 6).fill(0x6a4329)

    // One lamp, in the same lit-window yellow as the title logo and the panel.
    stall.rect(18, 6, 3, 4).fill(0xffcc44)

    // Label
    const style = new TextStyle({
      fontSize: 9,
      fill: 0xffffff,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      stroke: { color: 0x000000, width: 2 },
    })
    const label = new Text({ text: 'MARKET', style })
    label.anchor.set(0.5, 1)
    label.x = 16
    label.y = -2

    stall.addChild(label)
    this.container.addChild(stall)
  }

  /** Animate the workshop tiles (called each frame) — their crates bob. */
  public update(delta: number) {
    this.animFrame += delta * 0.04
    for (const { g, col, row } of this.animatedTiles) {
      // Per-tile phase offset so neighbouring workshops bob out of sync.
      const phase = this.animFrame + col * 0.55 + row * 0.4
      g.clear()
      this.drawWorkshop(g, phase)
      // Re-apply the subtle grid line (drawTile adds it; we cleared it above).
      g.rect(0, 0, TILE_SIZE, TILE_SIZE).stroke({ color: 0x000000, alpha: 0.06, width: 0.5 })
    }
  }

  public getWidth(): number {
    return MAP_COLS * TILE_SIZE
  }

  public getHeight(): number {
    return MAP_ROWS * TILE_SIZE
  }
}
