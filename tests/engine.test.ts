import test from 'node:test';
import assert from 'node:assert/strict';
import { commit, createState } from '../src/engine.ts';
import { validateRngState } from '../src/rng.ts';
import { action, adjacentDamage, randomDamage, rules, scenario } from '../examples/scenario.ts';

test('same initial state and action yield identical full results, including events, triggers, receipts and RNG', () => {
  const initial = scenario(), before = structuredClone(initial);
  const command = action(initial, randomDamage.id, []);
  const next = commit(initial, rules, 'player-a', command);
  assert.deepEqual(next, commit(JSON.parse(JSON.stringify(initial)), rules, 'player-a', JSON.parse(JSON.stringify(command))));
  assert.deepEqual(initial, before);
  assert.equal(next.version, initial.version + 1);
  assert.equal(next.rng.draws, 2);
  assert.equal(next.events.length, 2);
  assert.deepEqual(next.events.map(event => event.targetId), next.rngLog[0].picked);
  assert.equal(next.creatures.find(creature => creature.id === 'left')!.damage, 2);
  assert.equal(next.creatures.find(creature => creature.id === 'right')!.damage, 2);
  assert.deepEqual(next.triggerLog.map(item => item.sourceId), ['left', 'left', 'source', 'source']);
  validateRngState(next);
  const reloaded = JSON.parse(JSON.stringify(next));
  const followUp = action(reloaded, randomDamage.id, []);
  assert.deepEqual(commit(reloaded, rules, 'player-a', followUp), commit(next, rules, 'player-a', followUp));
});

test('action retries apply once; changed retries, stale commands, and invalid envelopes reject atomically', () => {
  const initial = scenario(), command = action(initial);
  const next = commit(initial, rules, 'player-a', command), before = structuredClone(next);
  assert.strictEqual(commit(next, rules, 'player-a', command), next);
  assert.throws(() => commit(next, rules, 'player-a', { ...command, targetIds: ['right'] }), /REQUEST_ID_REUSED/);
  assert.throws(() => commit(next, rules, 'player-a', { ...command, requestId: 'new-id' }), /STATE_STALE/);
  for (const malformed of [null, { ...action(next), targetIds: 'left' }, { ...action(next), secretField: true }])
    assert.throws(() => commit(next, rules, 'player-a', malformed), /INVALID_ACTION/);
  const badRule = { ...adjacentDamage, effect: { kind: 'DAMAGE' as const, amount: -1 } };
  assert.throws(() => commit(next, [badRule], 'player-a', action(next)), /INVALID_RULE/);
  assert.deepEqual(next, before);
});

test('an error after effects begin still rolls back the whole transition', () => {
  const initial = scenario();
  initial.creatures.find(creature => creature.id === 'source')!.enteredPlaySeq = 10;
  const before = structuredClone(initial);
  assert.throws(() => commit(initial, rules, 'player-a', action(initial)), /AMBIGUOUS_TRIGGER_ORDER/);
  assert.deepEqual(initial, before);
  assert.equal(initial.events.length, 0);
});

test('setup rejects invalid references instead of accepting malformed topology or ownership', () => {
  const state = scenario();
  const input = { matchId: state.matchId, players: state.players, lanes: state.lanes, creatures: state.creatures, seed: 42 };
  assert.throws(() => createState({ ...input, creatures: [{ ...input.creatures[0], laneId: 'missing' }] }), /INVALID_SETUP/);
  assert.throws(() => createState({ ...input, players: [{ id: 'same' }, { id: 'same' }] }), /INVALID_SETUP/);
});
