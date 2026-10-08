import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceRngCheckpoint, createRngState, initialRngCheckpoint, rngInt, rngSelectIds, rngShuffle, validateRngState } from '../src/rng.ts';
import { scenario } from '../examples/scenario.ts';

test('xorshift32 known cursor values and persisted stream reproduce integer, shuffle, and selection draws', () => {
  const state = scenario();
  // Fixed xorshift32 (13,17,5) vectors, not generated from this implementation.
  for (const cursor of [11355432, 2836018348, 476557059]) {
    rngInt(state, 1000, { purpose: 'vector' });
    assert.equal(state.rng.cursor, cursor);
  }
  const restored = JSON.parse(JSON.stringify(state));
  const input = ['c', 'a', 'b', 'd'];
  assert.deepEqual(rngShuffle(state, input, { purpose: 'shuffle' }), rngShuffle(restored, input, { purpose: 'shuffle' }));
  assert.deepEqual(input, ['c', 'a', 'b', 'd']);
  const picked = rngSelectIds(state, ['c', 'b', 'a', 'a'], 2, { purpose: 'selection' });
  assert.deepEqual(picked, rngSelectIds(restored, ['a', 'c', 'b'], 2, { purpose: 'selection' }));
  assert.equal(new Set(picked).size, 2);
  assert.deepEqual(state.rngLog.at(-1)!.domain, ['a', 'b', 'c']);
  assert.deepEqual(state, restored);
  validateRngState(state);
  assert.deepEqual(createRngState(0), createRngState(1));
});

test('audit replay binds windows, outcomes and final cursor; checkpoint splits reproduce full replay', () => {
  const state = scenario();
  rngInt(state, 1000, { purpose: 'integer' });
  rngShuffle(state, ['a', 'b', 'c'], { purpose: 'shuffle' });
  rngSelectIds(state, ['a', 'b', 'c'], 2, { purpose: 'selection' });
  const full = advanceRngCheckpoint(initialRngCheckpoint(state.rng.seed), state.rngLog);
  for (let split = 0; split <= state.rngLog.length; split++) {
    const prefix = advanceRngCheckpoint(initialRngCheckpoint(state.rng.seed), state.rngLog.slice(0, split));
    assert.deepEqual(advanceRngCheckpoint(prefix, state.rngLog.slice(split)), full);
  }
  const mutations = [
    (s: typeof state) => { s.rng.cursor ^= 1; },
    (s: typeof state) => { s.rng.draws++; },
    (s: typeof state) => { s.rngLog[0].result = (s.rngLog[0].result! + 1) % 1000; },
    (s: typeof state) => { s.rngLog[1].drawsBefore++; },
    (s: typeof state) => { s.rngLog[1].picked!.reverse(); },
    (s: typeof state) => { s.rngLog[2].domain!.reverse(); },
    (s: typeof state) => { s.rngLog.pop(); },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(state); mutate(forged);
    assert.throws(() => validateRngState(forged), /INVALID_RNG_STATE/);
  }
  const before = structuredClone(state);
  assert.throws(() => rngSelectIds(state, ['a'], 2, { purpose: 'invalid' }), /INVALID_RNG_DOMAIN/);
  assert.deepEqual(state, before);
});
