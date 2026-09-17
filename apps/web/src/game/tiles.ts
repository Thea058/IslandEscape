// ============================================================
// Kowloon Walled City — Tile Map Data & Types
// ============================================================

import type { CharacterId } from '@game/shared'

export type TileType =
  | 'wall'
  | 'sand'
  | 'grass'
  | 'dojo'
  | 'dock'
  | 'house'
  | 'tree'
  | 'rock'
  | 'workshop'
  | 'path'
  | 'cave'

export const TILE_SIZE = 32
export const MAP_COLS = 20
export const MAP_ROWS = 15

/** Whether a character can walk on this tile */
export function isWalkable(tile: TileType): boolean {
  switch (tile) {
    case 'wall':
    case 'house':
    case 'tree':
    case 'rock':
    case 'cave':
      return false
    default:
      return true
  }
}

/**
 * Whether a tile is interactable and what type.
 *
 * The returned kind is the same id the labor action uses (`work` / `train`),
 * so the interaction menu can offer the matching action without a translation
 * table in between.
 */
export function getInteraction(tile: TileType): string | null {
  switch (tile) {
    case 'workshop':
      return 'work'
    case 'dojo':
      return 'train'
    case 'dock':
      return 'merchant'
    case 'cave':
      return 'dungeon'
    default:
      return null
  }
}

// W = wall, S = sand, G = grass, F = dojo (武馆), D = dock,
// H = house, T = tree, R = rock, X = workshop (工场), P = path
const MAP_KEY: Record<string, TileType> = {
  W: 'wall',
  S: 'sand',
  G: 'grass',
  F: 'dojo',
  D: 'dock',
  H: 'house',
  T: 'tree',
  R: 'rock',
  X: 'workshop',
  P: 'path',
  C: 'cave',
}

// 20 columns x 15 rows Walled City map. The map data is unchanged from the
// island build — the same border cells now hold tenement blocks instead of sea,
// which is why no spawn point or walking route had to be re-checked.
const MAP_RAW: string[] = [
  'WWWWWWWWWWWWWWWWWWWW', // row 0
  'WWWWSSSSSSSSSSSSWWWW', // row 1
  'WWSSSGCTTGGGRGSSWWWW', // row 2
  'WWSSGGGPGGGGGGSSWWWW', // row 3
  'WWSGGHPPHGGRGGSSWWWW', // row 4
  'WWSGGPPPPPGGGGXSWWWW', // row 5
  'WWSGGPGHPGGGGGSSWWWW', // row 6
  'WSSGGPGGPGGFFFGSWWWW', // row 7
  'WSXGGPGGPGGFFFGSSWWW', // row 8
  'WSSGGPGGPGGFFFGSDDWW', // row 9
  'WWSGGPPPPPGGGGSDDWWW', // row 10
  'WWSSGTRGGGTRGSSSSWWW', // row 11
  'WWWSSSSSSSSSSSSSWWWW', // row 12
  'WWWWWWSSSSSSWWWWWWWW', // row 13
  'WWWWWWWWWWWWWWWWWWWW', // row 14
]

export const CITY_MAP: TileType[][] = MAP_RAW.map((row) =>
  row.split('').map((ch) => MAP_KEY[ch] ?? 'wall'),
)

/** Get tile at grid position, or wall if out of bounds */
export function getTile(col: number, row: number): TileType {
  if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return 'wall'
  return CITY_MAP[row]![col]!
}

// ----- Named Locations for Characters -----

export interface MapPosition {
  col: number
  row: number
}

/**
 * Starting positions for all characters.
 *
 * Keyed by CharacterId rather than `string`: with a loose key the lookup in
 * GameWorld silently falls back to one shared tile, stacking every NPC on top
 * of each other instead of reporting a missing entry.
 */
export const CHARACTER_POSITIONS: Record<CharacterId, MapPosition> = {
  player: { col: 7, row: 5 },
  san: { col: 5, row: 4 },
  shun: { col: 12, row: 8 },
  cyclone: { col: 8, row: 7 },
  simon: { col: 10, row: 10 },
}

/** Important locations on the map */
export const LOCATIONS = {
  street_center: { col: 7, row: 6 },
  dock: { col: 16, row: 9 },
  workshop_1: { col: 18, row: 5 },
  workshop_2: { col: 1, row: 8 },
  dojo: { col: 13, row: 8 },
  market: { col: 17, row: 9 },
  dungeon: { col: 6, row: 2 },
} as const

/**
 * Find the nearest tile of a given type to a starting position. Manhattan
 * distance, brute-force scan — fine at 20×15. Returns null if not found.
 */
export function findNearestTile(
  fromCol: number,
  fromRow: number,
  type: TileType,
): MapPosition | null {
  let best: MapPosition | null = null
  let bestDist = Infinity
  for (let r = 0; r < MAP_ROWS; r++) {
    for (let c = 0; c < MAP_COLS; c++) {
      if (getTile(c, r) !== type) continue
      const d = Math.abs(c - fromCol) + Math.abs(r - fromRow)
      if (d < bestDist) {
        bestDist = d
        best = { col: c, row: r }
      }
    }
  }
  return best
}

/**
 * Resolve where an AI should walk for a given action, picking the closest
 * matching tile from `(fromCol, fromRow)`. Falls back to the legacy hardcoded
 * `LOCATIONS` if no matching tile exists in the map data.
 */
export function getActionTarget(
  action: string,
  fromCol = 7,
  fromRow = 6,
): MapPosition {
  // `action` is a labor or trade id ('work' | 'train' | 'trade_merchant' | …)
  switch (action) {
    case 'work':
      return findNearestTile(fromCol, fromRow, 'workshop') ?? LOCATIONS.workshop_1
    case 'train':
      return findNearestTile(fromCol, fromRow, 'dojo') ?? LOCATIONS.dojo
    case 'trade_merchant':
      return findNearestTile(fromCol, fromRow, 'dock') ?? LOCATIONS.dock
    default:
      return LOCATIONS.street_center
  }
}
