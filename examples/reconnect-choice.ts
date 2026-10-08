import assert from 'node:assert/strict';
import { commit, respond } from '../src/engine.ts';
import { action, answer, opponentChoice, rules, scenario } from './scenario.ts';
import type { State } from '../src/model.ts';

// The acting player initiates; the other player owns the target choice.
const initial = scenario();
const paused = commit(initial, rules, 'player-a', action(initial, opponentChoice.id, []));
console.log('Pending choice:', paused.pending!.request);
// In a real host, this snapshot comes from trusted storage, not from a client.
const restored: State = JSON.parse(JSON.stringify(paused));
const response = answer(restored);
assert.throws(() => respond(restored, 'player-a', response), /NOT_DECISION_ACTOR/);
const resumed = respond(restored, 'player-b', response);
assert.deepEqual(resumed, respond(paused, 'player-b', response));
assert.strictEqual(respond(resumed, 'player-b', response), resumed);
console.log('Reconnect matched uninterrupted resolution; exact retry applied no second effect.');
