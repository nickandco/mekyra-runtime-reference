import { compareCanonicalId } from './model.ts';
import type { RuntimeEvent, State, TriggerCandidate } from './model.ts';

/** Source comparator retained: entry sequence, causal event, ability identity. */
function compareCandidates(left: TriggerCandidate, right: TriggerCandidate): number {
  return left.source.enteredPlaySeq - right.source.enteredPlaySeq ||
    left.event.childOperationIndex - right.event.childOperationIndex ||
    left.event.siblingSeq - right.event.siblingSeq ||
    compareCanonicalId(left.event.eventId, right.event.eventId) ||
    left.ability.index - right.ability.index ||
    compareCanonicalId(left.ability.abilityId, right.ability.abilityId) ||
    compareCanonicalId(left.source.id, right.source.id);
}

/** Collect the complete parent effect batch before enqueuing any work. */
export function collectTriggerBatch(state: State, events: readonly RuntimeEvent[]): TriggerCandidate[] {
  const candidates: TriggerCandidate[] = [];
  for (const event of events) for (const source of state.creatures) {
    if (source.damage >= source.health) continue;
    for (const ability of source.triggers) if (ability.event === event.kind)
      candidates.push(structuredClone({ source, ability, event }));
  }
  // The source deliberately rejects this unresolved ordering case as well.
  const sourcesBySequence = new Map<number, Set<string>>();
  for (const candidate of candidates) {
    const ids = sourcesBySequence.get(candidate.source.enteredPlaySeq) ?? new Set<string>();
    ids.add(candidate.source.id);
    sourcesBySequence.set(candidate.source.enteredPlaySeq, ids);
  }
  if ([...sourcesBySequence.values()].some(ids => ids.size > 1)) throw Error('AMBIGUOUS_TRIGGER_ORDER');
  return candidates.sort(compareCandidates);
}

export function enqueueTriggerBatch(state: State, candidates: readonly TriggerCandidate[]): void {
  for (const candidate of [...candidates].reverse()) state.stack.push(structuredClone(candidate));
}

/** This reference limits trigger effects to recording a resolved observation. */
export function drainTriggers(state: State): void {
  while (state.stack.length) {
    const candidate = state.stack.pop()!;
    state.triggerLog.push({ eventId: candidate.event.eventId, sourceId: candidate.source.id,
      controllerId: candidate.source.controllerId, triggerId: candidate.ability.abilityId });
  }
}
