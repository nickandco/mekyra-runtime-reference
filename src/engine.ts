import { nextId } from './model.ts';
import type { Action, Creature, Lane, Player, Rule, State } from './model.ts';
import { evaluateLegality } from './legality.ts';
import { openDecision, validateAnswer, validateDecisionResponse } from './decisions.ts';
import { collectTriggerBatch, drainTriggers, enqueueTriggerBatch } from './triggers.ts';
import { createRngState, rngSelectIds } from './rng.ts';

export function createState(input: { matchId: string; players: Player[]; lanes: Lane[]; creatures: Creature[]; seed: number }): State {
  const ids = (items: { id: string }[]) => items.every(item => typeof item.id === 'string' && item.id.length) &&
    new Set(items.map(item => item.id)).size === items.length;
  if (!input.matchId || input.players.length !== 2 || !ids(input.players) || !ids(input.lanes) || !ids(input.creatures) ||
      !Number.isSafeInteger(input.seed)) throw Error('INVALID_SETUP');
  if (input.lanes.some(lane => !Number.isSafeInteger(lane.position)) ||
      new Set(input.lanes.map(lane => lane.position)).size !== input.lanes.length) throw Error('INVALID_SETUP');
  for (const creature of input.creatures) {
    if (!input.players.some(player => player.id === creature.ownerId) ||
        !input.players.some(player => player.id === creature.controllerId) ||
        !input.lanes.some(lane => lane.id === creature.laneId) ||
        !Number.isSafeInteger(creature.enteredPlaySeq) || creature.enteredPlaySeq < 0 ||
        !Number.isSafeInteger(creature.health) || creature.health < 1 ||
        !Number.isSafeInteger(creature.damage) || creature.damage < 0 ||
        !ids(creature.triggers.map(trigger => ({ id: trigger.abilityId }))) ||
        creature.triggers.some(trigger => trigger.event !== 'DAMAGE_DEALT' || !Number.isSafeInteger(trigger.index)))
      throw Error('INVALID_SETUP');
  }
  return { ...structuredClone({ matchId: input.matchId, players: input.players, lanes: input.lanes, creatures: input.creatures }),
    activePlayerId: input.players[0].id, version: 1, sequence: 0, rng: createRngState(input.seed), rngLog: [],
    events: [], stack: [], triggerLog: [], accepted: [] };
}

function validateRule(rule: Rule): void {
  if (!rule || !rule.id || !rule.target || !rule.effect || !rule.selection ||
      !['SELF', 'OPPONENT', 'ANY'].includes(rule.target.relation) || typeof rule.target.adjacent !== 'boolean' ||
      !Number.isSafeInteger(rule.target.min) || !Number.isSafeInteger(rule.target.max) ||
      rule.target.min < 0 || rule.target.max < rule.target.min ||
      rule.effect.kind !== 'DAMAGE' || !Number.isSafeInteger(rule.effect.amount) || rule.effect.amount < 0)
    throw Error('INVALID_RULE');
  switch (rule.selection.kind) {
    case 'ACTION': return;
    case 'DECISION':
      if (!['CONTROLLER', 'OPPONENT'].includes(rule.selection.actor)) throw Error('INVALID_RULE');
      return;
    case 'RANDOM':
      if (!Number.isSafeInteger(rule.selection.count) || rule.selection.count < rule.target.min || rule.selection.count > rule.target.max)
        throw Error('INVALID_RULE');
      return;
    default: throw Error('INVALID_RULE');
  }
}

function validateAction(action: unknown): asserts action is Action {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw Error('INVALID_ACTION');
  const a = action as Record<string, unknown>;
  const keys = ['schemaVersion', 'requestId', 'matchId', 'actorPlayerId', 'baseStateVersion', 'sourceId', 'ruleId', 'targetIds'];
  if (Object.keys(a).length !== keys.length || keys.some(key => !Object.hasOwn(a, key)) || a.schemaVersion !== 1 ||
      !Number.isSafeInteger(a.baseStateVersion) ||
      ['requestId', 'matchId', 'actorPlayerId', 'sourceId', 'ruleId'].some(key => typeof a[key] !== 'string' || !a[key]) ||
      !Array.isArray(a.targetIds) || a.targetIds.some(id => typeof id !== 'string' || !id)) throw Error('INVALID_ACTION');
}

function isReplay(state: State, requestId: string, actorId: string, payload: string): boolean {
  const receipt = state.accepted.find(receipt => receipt.requestId === requestId);
  if (!receipt) return false;
  if (receipt.actorId !== actorId || receipt.payload !== payload) throw Error('REQUEST_ID_REUSED');
  return true;
}

function applyEffect(state: State, sourceId: string, controllerId: string, rule: Rule, resolutionId: string, ids: string[]): void {
  const events = ids.map((targetId, index) => {
    const creature = state.creatures.find(creature => creature.id === targetId)!;
    const damage = creature.damage + rule.effect.amount;
    if (!Number.isSafeInteger(damage)) throw Error('DAMAGE_OVERFLOW');
    creature.damage = damage;
    return { eventId: nextId(state, 'event'), kind: 'DAMAGE_DEALT' as const, resolutionId,
      actorPlayerId: controllerId, sourceId, targetId, amount: rule.effect.amount, childOperationIndex: index, siblingSeq: index };
  });
  state.events.push(...events);
  enqueueTriggerBatch(state, collectTriggerBatch(state, events));
  drainTriggers(state);
}

/** actorId is supplied by the trusted host, independently of the wire payload. */
export function commit(state: State, rules: readonly Rule[], actorId: string, command: unknown): State {
  validateAction(command);
  if (command.actorPlayerId !== actorId || command.matchId !== state.matchId) throw Error('INVALID_ACTOR');
  const payload = JSON.stringify(command);
  if (isReplay(state, command.requestId, actorId, payload)) return state;
  if (command.baseStateVersion !== state.version) throw Error('STATE_STALE');
  const matching = rules.filter(rule => rule.id === command.ruleId);
  if (matching.length !== 1) throw Error('UNKNOWN_RULE');
  const rule = matching[0];
  validateRule(rule);
  const legality = evaluateLegality(state, actorId, command.sourceId, rule, command.targetIds);
  if (!legality.legal) throw Error(legality.reasons[0]);
  const next = structuredClone(state);
  next.version++;
  const resolutionId = nextId(next, 'resolution');
  if (rule.selection.kind === 'DECISION') {
    // Empty optional domains finish without creating an unanswerable request.
    if (legality.candidates.length && rule.target.max > 0) openDecision(next, command.sourceId, actorId, rule, resolutionId);
  } else {
    const ids = rule.selection.kind === 'RANDOM' ?
      rngSelectIds(next, legality.candidates, rule.selection.count, { purpose: rule.id }) : command.targetIds;
    applyEffect(next, command.sourceId, actorId, rule, resolutionId, ids);
  }
  next.accepted.push({ requestId: command.requestId, actorId, payload });
  return next;
}

export function respond(state: State, actorId: string, response: unknown): State {
  validateDecisionResponse(response);
  if (response.actorPlayerId !== actorId || response.matchId !== state.matchId) throw Error('NOT_DECISION_ACTOR');
  const payload = JSON.stringify(response);
  if (isReplay(state, response.responseId, actorId, payload)) return state;
  validateAnswer(state, actorId, response);
  const next = structuredClone(state);
  const continuation = next.pending!.continuation;
  next.version++;
  delete next.pending;
  applyEffect(next, continuation.sourceId, continuation.controllerId, continuation.rule, continuation.resolutionId, response.answer.ids);
  next.accepted.push({ requestId: response.responseId, actorId, payload });
  return next;
}
