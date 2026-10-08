import { compareCanonicalId } from './model.ts';
import type { Rule, State, Target } from './model.ts';

/** Shared by inspection, authoritative commit, and decision production. */
export function legalTargets(state: State, sourceId: string, actorId: string, target: Target): string[] {
  const source = state.creatures.find(creature => creature.id === sourceId);
  if (!source || source.controllerId !== actorId || source.damage >= source.health) return [];
  const lane = state.lanes.find(candidate => candidate.id === source.laneId);
  return state.creatures.filter(creature => {
    if (creature.damage >= creature.health) return false;
    if (target.relation === 'SELF' && creature.controllerId !== actorId) return false;
    if (target.relation === 'OPPONENT' && creature.controllerId === actorId) return false;
    if (target.adjacent) {
      const other = state.lanes.find(candidate => candidate.id === creature.laneId);
      if (!lane || !other || Math.abs(lane.position - other.position) !== 1) return false;
    }
    return true;
  }).map(creature => creature.id).sort(compareCanonicalId);
}

export function validateSelection(candidates: readonly string[], min: number, max: number, ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length || ids.length < min || ids.length > max ||
      ids.some(id => !candidates.includes(id))) throw Error('INVALID_SELECTION');
}

export function evaluateLegality(state: State, actorId: string, sourceId: string, rule: Rule, ids: string[]): {
  legal: boolean; reasons: string[]; candidates: string[];
} {
  const reasons: string[] = [];
  if (!state.players.some(player => player.id === actorId)) reasons.push('UNKNOWN_ACTOR');
  if (actorId !== state.activePlayerId) reasons.push('NOT_ACTIVE_PLAYER');
  if (state.pending) reasons.push('PENDING_DECISION');
  if (state.stack.length) reasons.push('STACK_NOT_EMPTY');
  const source = state.creatures.find(creature => creature.id === sourceId);
  if (!source || source.damage >= source.health) reasons.push('INVALID_SOURCE');
  else if (source.controllerId !== actorId) reasons.push('NOT_SOURCE_CONTROLLER');
  const candidates = legalTargets(state, sourceId, actorId, rule.target);
  if (rule.selection.kind === 'ACTION') {
    try { validateSelection(candidates, rule.target.min, rule.target.max, ids); }
    catch { reasons.push('TARGET_NOT_LEGAL'); }
  } else {
    if (ids.length) reasons.push('UNEXPECTED_TARGETS');
    const count = rule.selection.kind === 'RANDOM' ? rule.selection.count : rule.target.min;
    if (candidates.length < count) reasons.push('INSUFFICIENT_TARGETS');
  }
  return { legal: reasons.length === 0, reasons, candidates };
}
