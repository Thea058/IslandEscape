import { RESOURCE_LABELS, type Resources, type TradeOffer } from '@game/shared'

const RESOURCE_KEYS = Object.keys(RESOURCE_LABELS) as (keyof Resources)[]

/**
 * Render a resource bundle for an LLM prompt.
 *
 * Every entry pairs the Chinese label the model should *reason* about with the
 * machine key it must *write back* in JSON — `Kong Soh Biscuits [cake]=5`. The model reads
 * prose in the game's fiction but emits keys the engine understands, which is
 * the same read/write split as character names (see `llmFacingName`).
 *
 * Deriving the key list from `RESOURCE_LABELS` means adding a resource shows up
 * in every prompt automatically, and no prompt can silently forget one.
 */
export function formatResources(r: Resources): string {
  return RESOURCE_KEYS.map(k => `${RESOURCE_LABELS[k]} [${k}]=${r[k]}`).join(', ')
}

/** Same read/write split, for one side of a trade offer. */
export function formatOffer(o: TradeOffer): string {
  const parts: string[] = []
  if (o.cake) parts.push(`${o.cake} ${RESOURCE_LABELS.cake}`)
  if (o.goods) parts.push(`${o.goods} ${RESOURCE_LABELS.goods}`)
  if (o.coins) parts.push(`${o.coins} ${RESOURCE_LABELS.coins}`)
  return parts.length === 0 ? 'nothing' : parts.join(', ')
}
