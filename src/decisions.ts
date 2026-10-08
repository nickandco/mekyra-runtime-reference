import { nextId } from './model.ts';
import type { DecisionResponse, Rule, State } from './model.ts';
import { legalTargets, validateSelection } from './legality.ts';

/** Strict candidate-response arm extracted from the source wire-shape gate. */
export function validateDecisionResponse(response: unknown): asserts response is DecisionResponse {
  function fail(): never { throw Error('INVALID_DECISION_RESPONSE'); }
  if (!response || typeof response !== 'object' || Array.isArray(response)) fail();
  const r = response as Record<string, unknown>;
  const envelope = ['schemaVersion', 'responseId', 'matchId', 'decisionId', 'actorPlayerId', 'stateVersion', 'candidateSetVersion', 'answer'];
  if (Object.keys(r).some(k => !envelope.includes(k)) || envelope.some(k => !Object.hasOwn(r, k))) fail();
  if (r.schemaVersion !== 1) fail();
  for (const k of ['responseId', 'matchId', 'decisionId', 'actorPlayerId'] as const)
    if (typeof r[k] !== 'string' || !r[k].length) fail();
  if (!Number.isSafeInteger(r.stateVersion) || !Number.isSafeInteger(r.candidateSetVersion)) fail();
  const a = r.answer as Record<string, unknown>;
  if (!a || typeof a !== 'object' || Array.isArray(a)) fail();
  if (Object.keys(a).length !== 2 || !Object.hasOwn(a, 'kind') || !Object.hasOwn(a, 'ids')) fail();
  if (a.kind !== 'CANDIDATES' || !Array.isArray(a.ids) || a.ids.some(id => typeof id !== 'string' || !id.length)) fail();
}

/** Mutates only the engine's private working copy. The whole continuation is JSON data. */
export function openDecision(state: State, sourceId: string, controllerId: string, rule: Rule, resolutionId: string): void {
  if (state.pending) throw Error('DECISION_ALREADY_PENDING');
  if (rule.selection.kind !== 'DECISION') throw Error('INVALID_DECISION_RULE');
  const actorId = rule.selection.actor === 'CONTROLLER' ? controllerId :
    state.players.find(player => player.id !== controllerId)!.id;
  const candidates = legalTargets(state, sourceId, controllerId, rule.target);
  state.pending = {
    request: {
      decisionId: nextId(state, 'decision'), actorPlayerId: actorId,
      stateVersion: state.version, candidateSetVersion: state.version,
      input: { kind: 'SELECT_CANDIDATES', candidates: candidates.map(id => ({ id })),
        min: rule.target.min, max: Math.min(rule.target.max, candidates.length) },
    },
    continuation: { sourceId, controllerId, resolutionId, rule: structuredClone(rule) },
  };
}

export function validateAnswer(state: State, actorId: string, response: DecisionResponse): void {
  const pending = state.pending;
  if (!pending || pending.request.decisionId !== response.decisionId) throw Error('DECISION_CLOSED');
  const request = pending.request;
  if (request.actorPlayerId !== actorId) throw Error('NOT_DECISION_ACTOR');
  if (request.stateVersion !== response.stateVersion || state.version !== response.stateVersion ||
      request.candidateSetVersion !== response.candidateSetVersion) throw Error('DECISION_STALE');
  validateSelection(request.input.candidates.map(candidate => candidate.id), request.input.min, request.input.max, response.answer.ids);
  const continuation = pending.continuation;
  const current = legalTargets(state, continuation.sourceId, continuation.controllerId, continuation.rule.target);
  if (response.answer.ids.some(id => !current.includes(id))) throw Error('TARGET_NOT_LEGAL');
}
