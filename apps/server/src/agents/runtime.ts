import { randomUUID } from 'node:crypto'
import type {
  GameState,
  CharacterId,
  AICharacterId,
  GameSSEEvent,
  NegotiationMessage,
} from '@game/shared'
import { GAME_CONFIG, LABOR_LABELS } from '@game/shared'
import { getAIDecision } from './decision-agent'
import { displayNameForPlayer as nameOf } from './personalities'
import { getNegotiationReply, getAITradeInitiation } from './negotiation-agent'
import { negotiations, sessions } from '../state'
import {
  applyAILabor,
  applyAITrade,
  executePeerTrade,
  settle,
  advanceDay,
} from '../engine/game'

export type SSEBroadcaster = (event: GameSSEEvent) => void

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** How long to pause the AI turn waiting for the player to resolve an NPC-initiated trade. */
const PLAYER_RESPONSE_TIMEOUT_MS = 60_000
/** Polling interval while waiting; the runtime is idle on the JS thread anyway. */
const PLAYER_RESPONSE_POLL_MS = 500

export async function runAITurns(
  state: GameState,
  broadcast: SSEBroadcaster,
  gameId: string,
): Promise<GameState> {
  let current = state

  for (let i = current.currentAiIndex; i < current.aiTurnOrder.length; i++) {
    const charId = current.aiTurnOrder[i]
    const character = current.characters[charId]
    if (!character || !character.alive || character.escaped) {
      continue
    }

    broadcast({ type: 'ai_thinking', characterId: charId })
    broadcast({ type: 'log', message: `${nameOf(charId)}'s turn...` })

    try {
      // Get full decision: labor + trades
      const decision = await getAIDecision(current, charId)

      // Tell the client what this AI is about to do — drives the
      // walk-to-target animation in GameCanvas.vue.
      broadcast({ type: 'ai_decision', characterId: charId, decision })

      // Step 1: Labor (mandatory)
      // LABOR_LABELS, not the raw id — the player reads "chose odd jobs", not
      // "chose work". Same registry the engine logs with.
      broadcast({ type: 'log', message: `${nameOf(charId)} chose ${LABOR_LABELS[decision.labor.labor]}. (${decision.labor.reasoning})` })
      // Give the client a beat to start the walk animation before HUD numbers change.
      await delay(400)
      current = applyAILabor(current, charId, decision.labor.labor)
      broadcast({ type: 'state_update', state: current })

      // Step 2: Trades (up to 2 slots)
      for (const trade of decision.trades) {
        if (trade.action === 'skip') continue

        const char = current.characters[charId]
        if (!char || char.tradeSlots <= 0) break

        // Re-broadcast a per-step decision so the client can animate the AI
        // walking to the trade target (dock for merchant, peer's tile for peer).
        broadcast({
          type: 'ai_decision',
          characterId: charId,
          decision: { subAction: trade.action, target: trade.tradeTarget ?? null },
        })
        await delay(300)

        if (trade.action === 'trade_merchant' && trade.merchantSell) {
          broadcast({ type: 'log', message: `${nameOf(charId)} trades at the night market. (${trade.reasoning})` })
          current = applyAITrade(current, charId, trade)
        }

        if (trade.action === 'trade_peer' && trade.tradeTarget) {
          broadcast({ type: 'log', message: `${nameOf(charId)} wants to trade with ${nameOf(trade.tradeTarget)}. (${trade.reasoning})` })
          if (trade.tradeTarget === 'player') {
            // Special-case: NPC initiates with the human player. Don't run the
            // LLM-vs-LLM auto-loop (it would call getPersonality('player') and
            // throw). Instead, register the conversation and let the player
            // respond via the normal negotiate_reply API.
            current = await initiatePlayerNegotiation(current, charId, broadcast, gameId)
          } else {
            current = await runAINegotiation(current, charId, trade.tradeTarget, broadcast)
          }
          // Deduct trade slot
          current = applyAITrade(current, charId, trade)
        }

        broadcast({ type: 'state_update', state: current })
      }

    } catch (err) {
      console.error(`AI turn failed for ${charId}:`, err)
      // Fallback: the safest action — 打工 always yields food.
      current = applyAILabor(current, charId, 'work')
      broadcast({ type: 'log', message: `${nameOf(charId)} worked (error fallback).` })
    }

    broadcast({ type: 'state_update', state: current })
  }

  // All AI turns done, move to settlement
  current = { ...current, phase: 'settlement' as const }

  // Settlement
  current = settle(current)
  const recentLogs = current.log.slice(-10)
  broadcast({ type: 'settlement', results: recentLogs })

  for (const id of current.eliminatedIds) {
    if (!state.eliminatedIds.includes(id)) {
      broadcast({ type: 'elimination', characterId: id })
    }
  }
  for (const id of current.escapedIds) {
    if (!state.escapedIds.includes(id)) {
      broadcast({ type: 'escape', characterId: id })
    }
  }

  if (current.phase === 'game_over') {
    broadcast({
      type: 'game_over',
      winnerId: current.winnerId,
      reason: current.winnerId ? `${nameOf(current.winnerId)} bought their way out!` : 'All hope is lost.',
    })
    return current
  }

  current = advanceDay(current)
  broadcast({ type: 'day_start', day: current.day, merchantPrices: current.merchantPrices })
  broadcast({ type: 'state_update', state: current })

  return current
}

/** AI-vs-AI talks only — the player path is `initiatePlayerNegotiation` below. */
async function runAINegotiation(
  current: GameState,
  initiator: AICharacterId,
  target: AICharacterId,
  broadcast: SSEBroadcaster,
): Promise<GameState> {
  const targetChar = current.characters[target]
  if (!targetChar || !targetChar.alive || targetChar.escaped) return current

  const history: NegotiationMessage[] = []

  const opening = await getAITradeInitiation(current, initiator, target)
  const openingMsg: NegotiationMessage = {
    speaker: initiator,
    text: opening.text,
    proposal: opening.offer && opening.request
      ? { from: initiator, to: target, offer: opening.offer, request: opening.request }
      : undefined,
  }
  history.push(openingMsg)
  broadcast({ type: 'negotiation', message: openingMsg })

  let currentSpeaker = target
  let tradeAccepted = false

  for (let exchange = 1; exchange < GAME_CONFIG.MAX_NEGOTIATION_EXCHANGES; exchange++) {
    const partner = currentSpeaker === target ? initiator : target
    const reply = await getNegotiationReply(current, currentSpeaker, partner, history)

    const replyMsg: NegotiationMessage = {
      speaker: currentSpeaker,
      text: reply.text,
      proposal: reply.offer && reply.request
        ? { from: currentSpeaker, to: partner, offer: reply.offer, request: reply.request }
        : undefined,
      accept: reply.accept,
    }
    history.push(replyMsg)
    broadcast({ type: 'negotiation', message: replyMsg })

    if (reply.accept) { tradeAccepted = true; break }
    if (reply.reject) break

    currentSpeaker = currentSpeaker === target ? initiator : target
  }

  if (tradeAccepted) {
    const lastProposal = [...history].reverse().find(m => m.proposal)?.proposal
    if (lastProposal) {
      const newState = executePeerTrade(current, lastProposal.from, lastProposal.to, lastProposal.offer, lastProposal.request)
      broadcast({ type: 'trade_result', success: true, from: lastProposal.from, to: lastProposal.to, summary: `Trade completed between ${nameOf(lastProposal.from)} and ${nameOf(lastProposal.to)}` })
      return newState
    }
  }

  broadcast({ type: 'trade_result', success: false, from: initiator, to: target, summary: `Negotiation between ${nameOf(initiator)} and ${nameOf(target)} failed.` })
  return current
}

/**
 * NPC initiates a negotiation with the human player.
 *
 * Generates an opening proposal, registers the conversation in the shared
 * `negotiations` map, broadcasts an SSE event so the client can pop the
 * dialogue panel, then **blocks the AI turn loop** until the player resolves
 * (accept / reject) or the wait times out. After resolution we re-read the
 * authoritative state from the session so any player-side mutations
 * (executePeerTrade, etc.) are picked up by the rest of `runAITurns`.
 */
async function initiatePlayerNegotiation(
  current: GameState,
  initiator: AICharacterId,
  broadcast: SSEBroadcaster,
  gameId: string,
): Promise<GameState> {
  // Skip if a negotiation is already in flight for this game — we don't want
  // to clobber a player-initiated chat with another NPC.
  if (negotiations.has(gameId)) return current

  const player = current.characters.player
  if (!player || !player.alive || player.escaped) return current

  // Don't pester the player with the same NPC twice in one day.
  if (current.playerNpcTradedToday.includes(initiator)) return current

  let opening
  try {
    opening = await getAITradeInitiation(current, initiator, 'player')
  } catch (err) {
    console.error(`[ai-init-player] ${initiator} failed to generate opening:`, err)
    return current
  }

  const proposal = opening.offer && opening.request
    ? { from: initiator, to: 'player' as CharacterId, offer: opening.offer, request: opening.request }
    : undefined

  const openingMsg: NegotiationMessage = {
    speaker: initiator,
    text: opening.text,
    proposal,
  }

  const conversationId = randomUUID()
  negotiations.set(gameId, {
    conversationId,
    target: initiator,
    messages: [openingMsg],
  })

  broadcast({
    type: 'npc_initiates_negotiation',
    initiatorId: initiator,
    conversationId,
    message: openingMsg,
  })
  broadcast({ type: 'negotiation', message: openingMsg })
  broadcast({
    type: 'log',
    message: `${nameOf(initiator)} is waiting for your response...`,
  })

  // === Block until the player resolves or we time out ===
  const start = Date.now()
  while (negotiations.has(gameId)) {
    if (Date.now() - start > PLAYER_RESPONSE_TIMEOUT_MS) {
      // Player ignored the offer — NPC walks away. Clean up state and notify.
      negotiations.delete(gameId)
      broadcast({
        type: 'trade_result',
        success: false,
        from: initiator,
        to: 'player',
        summary: `${nameOf(initiator)} got tired of waiting and walked away.`,
      })
      broadcast({ type: 'log', message: `${nameOf(initiator)} walked away (timed out).` })
      break
    }
    await delay(PLAYER_RESPONSE_POLL_MS)
  }

  // Pick up any state mutations the player's accept/reject made on session.state
  // — without this, the next runAITurns iteration would clobber the player's
  // trade with our stale local `current`.
  const session = sessions.get(gameId)
  return session?.state ?? current
}
