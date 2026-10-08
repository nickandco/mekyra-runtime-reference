import type { RngStateV1, RngDrawLogV1 } from './rng.ts';

export type Player = { id: string };
export type Lane = { id: string; position: number };
export type Trigger = { abilityId: string; index: number; event: 'DAMAGE_DEALT' };
export type Creature = {
  id: string;
  ownerId: string;
  controllerId: string;
  laneId: string;
  enteredPlaySeq: number;
  health: number;
  damage: number;
  triggers: Trigger[];
};
export type Target = {
  relation: 'SELF' | 'OPPONENT' | 'ANY';
  adjacent: boolean;
  min: number;
  max: number;
};
export type Rule = {
  id: string;
  target: Target;
  selection:
    | { kind: 'ACTION' }
    | { kind: 'DECISION'; actor: 'CONTROLLER' | 'OPPONENT' }
    | { kind: 'RANDOM'; count: number };
  effect: { kind: 'DAMAGE'; amount: number };
};
export type Action = {
  schemaVersion: 1;
  requestId: string;
  matchId: string;
  actorPlayerId: string;
  baseStateVersion: number;
  sourceId: string;
  ruleId: string;
  targetIds: string[];
};
export type DecisionInput = {
  kind: 'SELECT_CANDIDATES';
  candidates: { id: string }[];
  min: number;
  max: number;
};
export type DecisionRequest = {
  decisionId: string;
  actorPlayerId: string;
  stateVersion: number;
  candidateSetVersion: number;
  input: DecisionInput;
};
export type DecisionResponse = {
  schemaVersion: 1;
  responseId: string;
  matchId: string;
  decisionId: string;
  actorPlayerId: string;
  stateVersion: number;
  candidateSetVersion: number;
  answer: { kind: 'CANDIDATES'; ids: string[] };
};
export type RuntimeEvent = {
  eventId: string;
  kind: 'DAMAGE_DEALT';
  resolutionId: string;
  actorPlayerId: string;
  sourceId: string;
  targetId: string;
  amount: number;
  childOperationIndex: number;
  siblingSeq: number;
};
export type TriggerCandidate = {
  source: Creature;
  ability: Trigger;
  event: RuntimeEvent;
};
export type State = {
  matchId: string;
  version: number;
  sequence: number;
  players: Player[];
  activePlayerId: string;
  lanes: Lane[];
  creatures: Creature[];
  rng: RngStateV1;
  rngLog: RngDrawLogV1[];
  events: RuntimeEvent[];
  stack: TriggerCandidate[];
  triggerLog: { eventId: string; sourceId: string; controllerId: string; triggerId: string }[];
  pending?: {
    request: DecisionRequest;
    continuation: { sourceId: string; controllerId: string; resolutionId: string; rule: Rule };
  };
  accepted: { requestId: string; actorId: string; payload: string }[];
};

export function nextId(state: State, prefix: string): string {
  return `${prefix}:${++state.sequence}`;
}

export const compareCanonicalId = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;
