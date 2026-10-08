import test from 'node:test';
import assert from 'node:assert/strict';
import { commit } from '../src/engine.ts';
import { evaluateLegality, legalTargets } from '../src/legality.ts';
import { action, adjacentDamage, rules, scenario } from '../examples/scenario.ts';

test('one legality substrate rejects forged distance, ownership, and selection at commit', () => {
  const state = scenario(), before = structuredClone(state);
  assert.deepEqual(legalTargets(state, 'source', 'player-a', adjacentDamage.target), ['left', 'right']);
  for (const ids of [['distant'], ['ally'], ['missing'], [], ['left', 'left'], ['left', 'right']]) {
    const inspected = evaluateLegality(state, 'player-a', 'source', adjacentDamage, ids);
    assert.equal(inspected.legal, false);
    assert.ok(inspected.reasons.includes('TARGET_NOT_LEGAL'));
    assert.throws(() => commit(state, rules, 'player-a', action(state, adjacentDamage.id, ids)), /TARGET_NOT_LEGAL/);
    assert.deepEqual(state, before);
  }
  assert.throws(() => commit(state, rules, 'player-a', { ...action(state), sourceId: 'left' }), /NOT_SOURCE_CONTROLLER/);
  assert.throws(() => commit(state, rules, 'player-b', action(state)), /INVALID_ACTOR/);
  const next = commit(state, rules, 'player-a', action(state));
  assert.equal(next.creatures.find(creature => creature.id === 'left')!.damage, 2);
  assert.equal(next.creatures.find(creature => creature.id === 'right')!.damage, 0);
  assert.deepEqual(state, before);
});

test('legality inspection is pure and responds to authoritative live state', () => {
  const state = scenario();
  state.creatures.find(creature => creature.id === 'left')!.damage = 10;
  const before = structuredClone(state);
  for (let i = 0; i < 3; i++) assert.deepEqual(legalTargets(state, 'source', 'player-a', adjacentDamage.target), ['right']);
  assert.deepEqual(state, before);
  assert.throws(() => commit(state, rules, 'player-a', action(state)), /TARGET_NOT_LEGAL/);
});
