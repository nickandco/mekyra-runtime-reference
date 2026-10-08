import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTriggerBatch, drainTriggers, enqueueTriggerBatch } from '../src/triggers.ts';
import { scenario } from '../examples/scenario.ts';
import type { RuntimeEvent } from '../src/model.ts';

const events: RuntimeEvent[] = [1, 0].map(index => ({ eventId: `event-${index}`, kind: 'DAMAGE_DEALT',
  resolutionId: 'resolution', actorPlayerId: 'player-a', sourceId: 'source', targetId: 'right', amount: 1,
  childOperationIndex: index, siblingSeq: index }));

test('full batch sorts by entry, causal event, and binary ability id independent of insertion order', () => {
  const state = scenario();
  state.creatures.find(creature => creature.id === 'source')!.triggers = [
    { abilityId: 'a', index: 1, event: 'DAMAGE_DEALT' }, { abilityId: 'B', index: 1, event: 'DAMAGE_DEALT' },
  ];
  // Expected contract: older source first; each source sees event 0 before 1;
  // equal ability indexes compare binary ids, so uppercase B precedes lowercase a.
  const expected = ['left/event-0/early-observer', 'left/event-1/early-observer',
    'source/event-0/B', 'source/event-0/a', 'source/event-1/B', 'source/event-1/a'];
  for (let i = 0; i < 4; i++) {
    state.creatures.reverse(); state.creatures.forEach(creature => creature.triggers.reverse());
    const batch = collectTriggerBatch(state, [...events].reverse());
    assert.deepEqual(batch.map(candidate => `${candidate.source.id}/${candidate.event.eventId}/${candidate.ability.abilityId}`), expected);
    const work = structuredClone(state);
    enqueueTriggerBatch(work, batch);
    drainTriggers(work);
    assert.deepEqual(work.triggerLog.map(item => `${item.sourceId}/${item.eventId}/${item.triggerId}`), expected);
  }
});

test('enqueue captures source/controller and survives JSON reload; ambiguous entry ties fail closed', () => {
  const state = scenario();
  enqueueTriggerBatch(state, collectTriggerBatch(state, [events[0]]));
  state.creatures.find(creature => creature.id === 'left')!.controllerId = 'player-a';
  const restored = JSON.parse(JSON.stringify(state));
  drainTriggers(restored);
  assert.equal(restored.triggerLog[0].controllerId, 'player-b');
  assert.deepEqual(restored.stack, []);
  const tied = scenario();
  tied.creatures.find(creature => creature.id === 'source')!.enteredPlaySeq = 10;
  assert.throws(() => collectTriggerBatch(tied, events), /AMBIGUOUS_TRIGGER_ORDER/);
});
