import { createState } from '../src/engine.ts';
import type { Action, DecisionResponse, Rule, State } from '../src/model.ts';

// These minimal rules exercise primitives; they are not a game or a content library.
export const adjacentDamage: Rule = {
  id: 'adjacent-damage',
  target: { relation: 'OPPONENT', adjacent: true, min: 1, max: 1 },
  selection: { kind: 'ACTION' }, effect: { kind: 'DAMAGE', amount: 2 },
};
export const opponentChoice: Rule = {
  ...adjacentDamage, id: 'opponent-choice', selection: { kind: 'DECISION', actor: 'OPPONENT' },
};
export const randomDamage: Rule = {
  ...adjacentDamage, id: 'random-damage', target: { ...adjacentDamage.target, min: 2, max: 2 },
  selection: { kind: 'RANDOM', count: 2 },
};
export const rules = [adjacentDamage, opponentChoice, randomDamage];

export function scenario(seed = 42): State {
  const creature = (id: string, controllerId: string, lane: number, enteredPlaySeq: number) => ({
    id, ownerId: controllerId, controllerId, laneId: `lane-${lane}`, enteredPlaySeq,
    health: 10, damage: 0, triggers: [],
  });
  const state = createState({
    matchId: 'example', seed, players: [{ id: 'player-a' }, { id: 'player-b' }],
    lanes: [0, 1, 2, 3].map(position => ({ id: `lane-${position}`, position })),
    creatures: [creature('source', 'player-a', 1, 20), creature('left', 'player-b', 0, 10),
      creature('right', 'player-b', 2, 30), creature('distant', 'player-b', 3, 40), creature('ally', 'player-a', 2, 50)],
  });
  state.creatures.find(creature => creature.id === 'left')!.triggers = [{ abilityId: 'early-observer', index: 0, event: 'DAMAGE_DEALT' }];
  state.creatures.find(creature => creature.id === 'source')!.triggers = [{ abilityId: 'late-observer', index: 0, event: 'DAMAGE_DEALT' }];
  return state;
}

export function action(state: State, ruleId = adjacentDamage.id, targetIds: string[] = ['left'], requestId = `action-${state.version}`): Action {
  return { schemaVersion: 1, requestId, matchId: state.matchId, actorPlayerId: 'player-a',
    baseStateVersion: state.version, sourceId: 'source', ruleId, targetIds };
}

export function answer(state: State, ids = ['left'], responseId = 'response-1'): DecisionResponse {
  const request = state.pending!.request;
  return { schemaVersion: 1, responseId, matchId: state.matchId, decisionId: request.decisionId,
    actorPlayerId: request.actorPlayerId, stateVersion: request.stateVersion,
    candidateSetVersion: request.candidateSetVersion, answer: { kind: 'CANDIDATES', ids } };
}
