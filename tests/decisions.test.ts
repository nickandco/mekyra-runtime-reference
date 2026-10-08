import test from 'node:test';
import assert from 'node:assert/strict';
import { commit, respond } from '../src/engine.ts';
import { action, answer, opponentChoice, rules, scenario } from '../examples/scenario.ts';
import type { State } from '../src/model.ts';

const pause = () => {
  const state = scenario();
  return commit(state, rules, 'player-a', action(state, opponentChoice.id, []));
};

test('pending decision belongs to its actor; stale and forged responses leave all state unchanged', () => {
  const paused = pause(), before = structuredClone(paused), response = answer(paused);
  assert.equal(paused.pending!.request.actorPlayerId, 'player-b');
  assert.throws(() => respond(paused, 'player-a', response), /NOT_DECISION_ACTOR/);
  assert.throws(() => respond(paused, 'player-a', { ...response, actorPlayerId: 'player-a' }), /NOT_DECISION_ACTOR/);
  assert.throws(() => respond(paused, 'player-b', { ...response, matchId: 'another-match' }), /NOT_DECISION_ACTOR/);
  assert.throws(() => respond(paused, 'player-b', { ...response, decisionId: 'older-decision' }), /DECISION_CLOSED/);
  for (const field of ['stateVersion', 'candidateSetVersion'] as const)
    assert.throws(() => respond(paused, 'player-b', { ...response, [field]: response[field] - 1 }), /DECISION_STALE/);
  const advanced = structuredClone(paused); advanced.version++;
  assert.throws(() => respond(advanced, 'player-b', response), /DECISION_STALE/);
  for (const ids of [[], ['left', 'right'], ['left', 'left'], ['distant'], ['missing']])
    assert.throws(() => respond(paused, 'player-b', answer(paused, ids)), /INVALID_SELECTION/);
  for (const malformed of [null, { ...response, answer: { kind: 'CANDIDATES', ids: 'left' } },
    { ...response, answer: { kind: 'CANDIDATES', ids: ['left'], extra: true } },
    { ...response, stateVersion: '2' }, { ...response, inject: true }])
    assert.throws(() => respond(paused, 'player-b', malformed), /INVALID_DECISION_RESPONSE/);
  assert.throws(() => commit(paused, rules, 'player-a', action(paused)), /PENDING_DECISION/);
  assert.deepEqual(paused, before);
});

test('JSON reconnect retains owner and continuation; exact retry is idempotent, conflicting retry rejects', () => {
  const paused = pause();
  const restored: State = JSON.parse(JSON.stringify(paused));
  const response = answer(restored, ['right']);
  const resumed = respond(restored, 'player-b', response);
  assert.deepEqual(resumed, respond(paused, 'player-b', response));
  assert.equal(resumed.pending, undefined);
  assert.equal(resumed.creatures.find(creature => creature.id === 'right')!.damage, 2);
  assert.equal(resumed.creatures.find(creature => creature.id === 'left')!.damage, 0);
  assert.equal(resumed.events.length, 1);
  assert.strictEqual(respond(resumed, 'player-b', response), resumed);
  assert.throws(() => respond(resumed, 'player-b', { ...response, answer: { kind: 'CANDIDATES', ids: ['left'] } }), /REQUEST_ID_REUSED/);
  assert.throws(() => respond(resumed, 'player-b', { ...response, responseId: 'new-response' }), /DECISION_CLOSED/);
  // An old answer cannot consume a later pending decision.
  const second = commit(resumed, rules, 'player-a', action(resumed, opponentChoice.id, []));
  assert.throws(() => respond(second, 'player-b', { ...response, responseId: 'late-response' }), /DECISION_CLOSED/);
});

test('optional empty domains complete without a meaningless pending request', () => {
  const initial = scenario();
  initial.creatures.filter(creature => creature.controllerId === 'player-b').forEach(creature => { creature.damage = creature.health; });
  const optional = { ...opponentChoice, target: { ...opponentChoice.target, min: 0 } };
  const next = commit(initial, [optional], 'player-a', action(initial, optional.id, []));
  assert.equal(next.pending, undefined);
  assert.deepEqual(next.events, []);
  assert.equal(next.version, initial.version + 1);
});

test('a stored offer cannot bypass current target legality', () => {
  const paused = pause();
  // Model trusted host state drift without changing the stored offer.
  paused.creatures.find(creature => creature.id === 'left')!.laneId = 'lane-3';
  const before = structuredClone(paused);
  assert.throws(() => respond(paused, 'player-b', answer(paused)), /TARGET_NOT_LEGAL/);
  assert.deepEqual(paused, before);
});
