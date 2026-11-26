/**
 * Field comparison of stored documents (`docs/research/M2-interfaces.md` §2.2): a history entry's `changedFields` and
 * a revert's `restoredFields` are the top-level keys whose values differ. Values compare as Firestore stores them:
 * timestamps by their instant (a Firestore `Timestamp` equals the plain `TimestampLike` a handler wrote), maps and
 * lists by content, everything else with `Object.is`.
 */
import type { TimestampLike } from '@hcm/shared';

export type Fields = Readonly<Record<string, unknown>>;

type Kind = 'timestamp' | 'list' | 'map' | 'scalar';

function isRecord(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null;
}

function isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

export function isTimestampLike(value: unknown): value is TimestampLike {
    return isRecord(value) && typeof value['seconds'] === 'number' && typeof value['nanoseconds'] === 'number';
}

function kindOf(value: unknown): Kind {
    if (isTimestampLike(value)) {
        return 'timestamp';
    }
    if (isList(value)) {
        return 'list';
    }
    return isRecord(value) ? 'map' : 'scalar';
}

function sameInstant(a: unknown, b: unknown): boolean {
    return isTimestampLike(a) && isTimestampLike(b) && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
}

function sameList(a: unknown, b: unknown): boolean {
    return isList(a) && isList(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
}

function sameMap(a: unknown, b: unknown): boolean {
    return isRecord(a) && isRecord(b) && changedKeys(a, b).length === 0;
}

const SAME: Readonly<Record<Kind, (a: unknown, b: unknown) => boolean>> = {
    timestamp: sameInstant,
    list: sameList,
    map: sameMap,
    scalar: Object.is,
};

/** Two stored values are the same (an absent field equals `undefined`). */
export function sameValue(a: unknown, b: unknown): boolean {
    const kind = kindOf(a);
    return kind === kindOf(b) && SAME[kind](a, b);
}

/** The top-level keys whose values differ between two versions of a document, sorted. */
export function changedKeys(before: Fields, after: Fields): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter((key) => !sameValue(before[key], after[key]))
        .sort((a, b) => a.localeCompare(b));
}
