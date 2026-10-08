/** Extracted xorshift32 operations and audit replay; host-specific metadata removed.
 * Deterministic simulation only. This stream is not cryptographically secure. */
import type { State } from './model.ts';
import { nextId } from './model.ts';
export type RngStateV1 = {
    seed: number;
    cursor: number;
    draws: number;
};
export type RngDrawOpV1 = 'INT' | 'SHUFFLE' | 'SELECT';
export type RngDrawLogV1 = {
    rngEventId: string;
    seq: number;
    op: RngDrawOpV1;
    purpose: string;
    resolutionId?: string;
    sourceAbilityId?: string;
    sourceInstanceId?: string;
    n?: number;
    result?: number;
    domain?: string[];
    count?: number;
    picked?: string[];
    drawsBefore: number;
    drawsAfter: number;
    stateVersion: number;
};
export type RngOperationMeta = {
    purpose: string;
};
export function createRngState(seed: number): RngStateV1 {
    const normalized = (seed >>> 0) || 1;
    return { seed: normalized, cursor: normalized, draws: 0 };
}
function stepXorshift32(x: number): number {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return x >>> 0;
}
function draw(s: State): number {
    s.rng.cursor = stepXorshift32(s.rng.cursor);
    s.rng.draws++;
    return s.rng.cursor / 4294967296;
}
const canonicalDomain = (ids: string[]) => [...new Set(ids)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
const arrEq = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
type OpRecord = {
    op: 'INT';
    n: number;
    result: number;
} | {
    op: 'SHUFFLE';
    domain: string[];
    picked: string[];
} | {
    op: 'SELECT';
    domain: string[];
    count: number;
    picked: string[];
};
function record(s: State, meta: RngOperationMeta, drawsBefore: number, op: OpRecord): void {
    s.rngLog.push({
        rngEventId: nextId(s, 'rng'), seq: s.rngLog.length, purpose: meta.purpose,
        ...op,
        drawsBefore, drawsAfter: s.rng.draws, stateVersion: s.version,
    });
}
export function rngInt(s: State, n: number, meta: RngOperationMeta): number {
    if (!Number.isInteger(n) || n < 1)
        throw Error('INVALID_RNG_DOMAIN');
    const before = s.rng.draws, value = Math.floor(draw(s) * n);
    record(s, meta, before, { op: 'INT', n, result: value });
    return value;
}
export function rngShuffle(s: State, items: string[], meta: RngOperationMeta): string[] {
    const out = [...items], before = s.rng.draws;
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(draw(s) * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    record(s, meta, before, { op: 'SHUFFLE', domain: [...items], picked: [...out] });
    return out;
}
export function rngSelectIds(s: State, domain: string[], count: number, meta: RngOperationMeta): string[] {
    const canonical = canonicalDomain(domain);
    if (!Number.isInteger(count) || count < 0 || count > canonical.length)
        throw Error('INVALID_RNG_DOMAIN');
    const before = s.rng.draws, pool = [...canonical], picked: string[] = [];
    for (let i = 0; i < count; i++)
        picked.push(pool.splice(Math.floor(draw(s) * pool.length), 1)[0]);
    record(s, meta, before, { op: 'SELECT', domain: canonical, count, picked });
    return picked;
}
const strArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0);
export type RngCheckpointV1 = {
    algorithm: 'XORSHIFT32_V1';
    seed: number;
    cursor: number;
    draws: number;
    nextSeq: number;
};
export const initialRngCheckpoint = (seed: number): RngCheckpointV1 => ({ algorithm: 'XORSHIFT32_V1', seed, cursor: seed, draws: 0, nextSeq: 0 });
export function advanceRngCheckpoint(checkpoint: RngCheckpointV1, log: readonly RngDrawLogV1[]): RngCheckpointV1 {
    function fail(): never { throw Error('INVALID_RNG_STATE'); }
    if (!checkpoint || checkpoint.algorithm !== 'XORSHIFT32_V1' || !Number.isSafeInteger(checkpoint.nextSeq) || checkpoint.nextSeq < 0)
        fail();
    for (const v of [checkpoint.seed, checkpoint.cursor, checkpoint.draws])
        if (!Number.isInteger(v) || v < 0 || (v >>> 0) !== v)
            fail();
    if (checkpoint.seed < 1 || checkpoint.cursor < 1)
        fail();
    if (!Array.isArray(log))
        fail();
    const seen = new Set<string>();
    let expected = checkpoint.draws, cursor = checkpoint.cursor;
    const step = () => { cursor = stepXorshift32(cursor); expected++; return cursor / 4294967296; };
    for (let i = 0; i < log.length; i++) {
        const e = log[i];
        if (!e || typeof e !== 'object' || Array.isArray(e))
            fail();
        if (Object.keys(e).some(k => !['rngEventId', 'seq', 'op', 'purpose', 'resolutionId', 'sourceAbilityId', 'sourceInstanceId', 'n', 'result', 'domain', 'count', 'picked', 'drawsBefore', 'drawsAfter', 'stateVersion'].includes(k)))
            fail();
        if (typeof e.rngEventId !== 'string' || !e.rngEventId || seen.has(e.rngEventId))
            fail();
        seen.add(e.rngEventId);
        if (e.seq !== checkpoint.nextSeq + i || typeof e.purpose !== 'string' || !e.purpose)
            fail();
        for (const k of ['resolutionId', 'sourceAbilityId', 'sourceInstanceId'] as const)
            if (e[k] !== undefined && (typeof e[k] !== 'string' || !(e[k] as string)))
                fail();
        if (!Number.isInteger(e.drawsBefore) || e.drawsBefore !== expected)
            fail();
        if (!Number.isInteger(e.stateVersion) || e.stateVersion < 1)
            fail();
        if (e.op === 'INT') {
            const n = e.n, result = e.result;
            if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || typeof result !== 'number' || !Number.isInteger(result) || result < 0 || result >= n)
                fail();
            if (e.domain !== undefined || e.count !== undefined || e.picked !== undefined)
                fail();
            if (Math.floor(step() * n) !== result)
                fail();
        }
        else if (e.op === 'SHUFFLE') {
            if (!strArray(e.domain) || !strArray(e.picked) || e.n !== undefined || e.count !== undefined || e.result !== undefined)
                fail();
            const out = [...e.domain];
            for (let j = out.length - 1; j > 0; j--) {
                const k = Math.floor(step() * (j + 1));
                [out[j], out[k]] = [out[k], out[j]];
            }
            if (!arrEq(out, e.picked))
                fail();
        }
        else if (e.op === 'SELECT') {
            const domain = e.domain, picked = e.picked, count = e.count;
            if (!strArray(domain) || !strArray(picked) || typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > domain.length || picked.length !== count || e.n !== undefined || e.result !== undefined)
                fail();
            if (!arrEq(domain, canonicalDomain(domain)))
                fail();
            if (new Set(picked).size !== picked.length || picked.some(id => !domain.includes(id)))
                fail();
            const pool = [...domain], expect: string[] = [];
            for (let j = 0; j < count; j++)
                expect.push(pool.splice(Math.floor(step() * pool.length), 1)[0]);
            if (!arrEq(expect, picked))
                fail();
        }
        else
            fail();
        if (!Number.isInteger(e.drawsAfter) || e.drawsAfter !== expected)
            fail();
    }
    return { algorithm: 'XORSHIFT32_V1', seed: checkpoint.seed, cursor, draws: expected, nextSeq: checkpoint.nextSeq + log.length };
}
export function validateRngState(state: State): void {
    const rng = state.rng, log = state.rngLog;
    if (!rng || typeof rng !== 'object' || Array.isArray(rng) || Object.keys(rng).some(k => !['seed', 'cursor', 'draws'].includes(k)))
        throw Error('INVALID_RNG_STATE');
    const end = advanceRngCheckpoint(initialRngCheckpoint(rng.seed), log);
    if (end.draws !== rng.draws || end.cursor !== rng.cursor)
        throw Error('INVALID_RNG_STATE');
}
