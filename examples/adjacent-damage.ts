import { commit } from '../src/engine.ts';
import { evaluateLegality } from '../src/legality.ts';
import { action, adjacentDamage, rules, scenario } from './scenario.ts';

// Human rule: deal 2 damage to one opposing creature in an adjacent lane.
const initial = scenario();
const command = action(initial);
console.log('Authoritative inspection:', evaluateLegality(initial, 'player-a', 'source', adjacentDamage, command.targetIds));
const next = commit(initial, rules, 'player-a', command);
console.log(JSON.stringify({ version: next.version, events: next.events, triggers: next.triggerLog }, null, 2));
