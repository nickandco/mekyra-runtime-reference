# Mekyra Runtime Reference

A small, game-agnostic reference extracted from the deterministic rules engine behind Mekyra.

This is deliberately not the full Mekyra product or the private prototype. It exposes a small set of runtime concepts so the architecture can be inspected publicly. The random stream and replay code are extracted implementation; legality, decisions, transitions, and trigger collection are adapted to a much smaller neutral model. The examples are new, minimal exercises of those primitives.

## 1. What this demonstrates

```text
human rule → structured definition → legality validation
           → deterministic transition → logged/reproducible result
```

For example: “Deal 2 damage to one opposing creature in an adjacent lane.” A typed `Rule` defines the target relation, adjacency, selection cardinality, and damage amount. The runtime executes this definition; it does not interpret the human sentence.

The same legality function supports inspection and the authoritative commit boundary. A second example suspends resolution for a choice owned by the other player, serializes the pending continuation, and resumes after reconnect.

## 2. Architecture

| Module | Responsibility |
| --- | --- |
| [`model.ts`](src/model.ts) | Plain JSON state, rules, actions, decisions, events, and deterministic IDs |
| [`legality.ts`](src/legality.ts) | Pure target enumeration and action validation |
| [`decisions.ts`](src/decisions.ts) | Strict response shape, decision ownership, versions, candidate membership, and continuation |
| [`triggers.ts`](src/triggers.ts) | Complete event-batch collection, deterministic sorting, captured context, reverse stack enqueue |
| [`rng.ts`](src/rng.ts) | Persisted xorshift32 stream, bounded draws, shuffles, set selection, and audit replay |
| [`engine.ts`](src/engine.ts) | Validate intent, copy state, apply effects, drain triggers, record accepted requests |

`commit(state, rules, actorId, command)` and `respond(state, actorId, response)` return the next state without mutating their input. The host supplies trusted state, rule definitions, and an independently authenticated `actorId`. Clients submit intent or an answer, never replacement state or executable rules. Low-level RNG and trigger helpers mutate a working copy and are intended for host/runtime use.

Extraction anchor: private engine commit `88dc339be165faf48ddde6b1e14ac4d5373233f4`. The relevant source areas were `lib/runtime/legality.ts`, `decisions.ts`, `engine.ts`, `triggers.ts`, `rng.ts`, and their runtime tests. The RNG transition, operation algorithms, and audit replay retain the source implementation. The trigger comparator retains its ordering dimensions and binary string comparison; equal entry sequences across eligible sources still fail closed. Host-specific state, metadata, and persistence integration were removed. This repository has its own current history; no private commit history is imported.

## 3. Runtime guarantees represented here

| Represented guarantee | Included evidence |
| --- | --- |
| A submitted target must belong to the authoritative legal set, with valid cardinality and no duplicates | [`legality.test.ts`](tests/legality.test.ts) |
| Only the pending decision's actor can answer; match, decision, state version, and candidate-set version must match | [`decisions.test.ts`](tests/decisions.test.ts) |
| Malformed responses and candidates outside the offer reject before effects; selected targets are checked against current legality again | `decisions.ts`, `decisions.test.ts` |
| JSON round-trips preserve a pending continuation; reconnect and uninterrupted resolution produce identical state | `decisions.test.ts`, [`reconnect-choice.ts`](examples/reconnect-choice.ts) |
| Exact accepted request retries apply no second effect; reused IDs with a changed payload reject | `decisions.test.ts`, [`engine.test.ts`](tests/engine.test.ts) |
| Trigger order is independent of creature/ability insertion order | [`triggers.test.ts`](tests/triggers.test.ts) |
| Same RNG seed/state and operation sequence reproduce draws; set-selection domains are deduplicated and sorted | [`rng.test.ts`](tests/rng.test.ts) |
| RNG audit replay verifies draw windows, operation results, and the final cursor; checkpoint splits reproduce full replay | `rng.test.ts` |
| Same initial state, trusted rules, actor, and action produce identical next state, events, receipts, and RNG | `engine.test.ts` |
| Rejection, including a failure after effects begin on the working copy, leaves the input state unchanged | `engine.test.ts` |

Trigger sorting uses source entry sequence, child-operation index, sibling sequence, binary event ID, ability index, binary ability ID, then binary source ID. Sorted work is pushed in reverse so stack execution preserves that order. Trigger effects here only record resolved observations; this reference does not demonstrate recursive trigger effects.

RNG replay establishes internal consistency of a seed, audit, and cursor. It does not authenticate a snapshot or detect an attacker replacing the entire consistent history. Xorshift32 is for reproducible simulation, not cryptographic randomness. Full states contain RNG internals; a production host must define its own player-facing projection.

## 4. Example rule lifecycle

1. A human rule is represented by the `adjacentDamage` definition in [`scenario.ts`](examples/scenario.ts).
2. `legalTargets` offers `left` and `right`; the distant creature and friendly creature are excluded.
3. The host receives a versioned action selecting `left`. `commit` reruns legality on authoritative state.
4. A working copy receives damage, a causal event, the sorted trigger batch, and an accepted-request receipt. Its state version advances once.
5. Repeating the same input reproduces the full result. Retrying an already accepted request returns the current state without applying damage again.

For player-selected resolution, `opponentChoice` stores a concrete candidate offer and continuation. The initiating player cannot answer the other player's choice. A JSON reload retains the same decision ID, owner, versions, and effect to resume.

```sh
npm run example:damage
npm run example:reconnect
```

## 5. Running the tests

Use Node.js 24 or newer and npm. There are no runtime dependencies. Node's built-in test runner executes TypeScript directly; TypeScript and Node typings are development dependencies pinned by the lockfile.

From a clean checkout, one command installs dependencies, typechecks all source/tests/examples, and runs the tests:

```sh
npm ci && npm run check
```

The tests cover adversarial inputs, full-state equality, reconnect, replay, rollback, and fixed RNG cursor vectors. They do not require an account, external service, or private repository access.

## 6. Relationship to Mekyra

Mekyra's broader product concerns rule authoring and executable structured definitions. The Claude-assisted authoring layer belongs to that product and is not implemented here. This reference starts at a trusted structured rule and makes a bounded portion of the runtime inspectable.

It demonstrates an engine foundation, not the completeness or production readiness of the broader product or private prototype.

## 7. Scope / what is intentionally omitted

- Original game content, card definitions, text, artwork, scans, decks, and rulebook material.
- UI, human-language parsing, model calls, authoring workflows, and a rule compiler.
- Production authentication, transport, databases, revision CAS, deployment, admin tools, and hidden-information projections.
- Full turns, costs, replacement/prevention, modifiers, combat, elimination, teams, and historical snapshot/provenance validation.
- General multiplayer topology: examples use two players sharing a simple linear lane coordinate system. Adjacency is a neutral reference selector, not a port of a complete game board.
- Recursive trigger effects and persistent storage checkpoints. The included checkpoint helper only replays RNG audit segments.

Snapshots and executable definitions are trusted host data. JSON serialization demonstrates continuation portability, not secure persistence. No claims are made about arbitrary client-supplied snapshots, network concurrency, exhaustive rules coverage, or the correctness of omitted subsystems.
