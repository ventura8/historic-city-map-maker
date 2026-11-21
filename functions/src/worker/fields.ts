/**
 * Documents as they travel to and from a worker (`docs/research/M7-local-worker.md` §2.4): JSON, with every timestamp as
 * `{seconds, nanoseconds}` and a removed field as `{"__hcmDelete": true}` (`WORKER_DELETE_FIELD`), and an update merged
 * into the stored document the way Firestore's `update` does: each dotted field path set (maps made on the way), each
 * removal applied. Field names are plain identifiers, so no path can reach an object's prototype.
 */
import { WORKER_DELETE_FIELD } from '@hcm/shared';

type Fields = Readonly<Record<string, unknown>>;

const NANOS_PER_SECOND = 1_000_000_000;
/** One segment of a field path: what the pipeline writes (`steps.fetch.bytes`, `lease.until`, `machines.download`). */
const SEGMENT = /^[A-Za-z0-9_-]{1,100}$/;
/** Names that would reach `Object.prototype` (refused even though `SEGMENT` already excludes most). */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `{seconds, nanoseconds}` pair (the shared `TimestampLike`, or a Firestore `Timestamp` read back). */
function isTimestampLike(value: unknown): value is { readonly seconds: number; readonly nanoseconds: number } {
    return isRecord(value) && typeof value['seconds'] === 'number' && typeof value['nanoseconds'] === 'number';
}

/** A document as the worker gets it: every timestamp a plain `{seconds, nanoseconds}`, at any depth. */
export function toWire(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(toWire);
    }
    if (isTimestampLike(value)) {
        return { seconds: value.seconds, nanoseconds: value.nanoseconds };
    }
    return isRecord(value) ? Object.fromEntries(Object.entries(value).map(([key, field]) => [key, toWire(field)])) : value;
}

/** True for the removal marker `{"__hcmDelete": true}`. */
function isDeletion(value: unknown): boolean {
    return isRecord(value) && value[WORKER_DELETE_FIELD] === true && Object.keys(value).length === 1;
}

function validTimestamp(value: { readonly seconds: number; readonly nanoseconds: number }): boolean {
    return (
        Number.isSafeInteger(value.seconds) &&
        Number.isInteger(value.nanoseconds) &&
        value.nanoseconds >= 0 &&
        value.nanoseconds < NANOS_PER_SECOND
    );
}

/**
 * True when a value from a worker can be stored: every timestamp whole and in range (Firestore's `Timestamp` refuses
 * anything else), and no removal marker inside a value (only a field's own value may remove it).
 */
export function storable(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.every(storable);
    }
    if (!isRecord(value)) {
        return true;
    }
    if (WORKER_DELETE_FIELD in value) {
        return false;
    }
    return isTimestampLike(value) ? validTimestamp(value) : Object.values(value).every(storable);
}

/** A field's new value from a worker: the removal marker, or a storable value. */
export function storableChange(value: unknown): boolean {
    return isDeletion(value) || storable(value);
}

/** A field path: one plain name at least (`status`, `steps.fetch.bytes`). */
type FieldPath = readonly [string, ...string[]];

function nonEmpty(segments: readonly string[]): segments is FieldPath {
    return segments.length > 0;
}

/** A dotted path's segments (`a.b.c` → `a`, `b`, `c`). */
function split(path: string): FieldPath {
    const dot = path.indexOf('.');
    return dot < 0 ? [path] : [path.slice(0, dot), ...path.slice(dot + 1).split('.')];
}

/** The segments of a dotted field path, or undefined when one is not a plain name. */
function segmentsOf(path: string): FieldPath | undefined {
    const segments = split(path);
    return segments.every((segment) => SEGMENT.test(segment) && !FORBIDDEN.has(segment)) ? segments : undefined;
}

/** One change of an update: the field's path and its value (the removal marker removes it). */
export type FieldChange = readonly [path: FieldPath, value: unknown];

/** An update's fields as changes, or undefined when one key is not a plain dotted path. */
export function changesOf(fields: Fields): FieldChange[] | undefined {
    const changes = Object.entries(fields).map(([path, value]) => [segmentsOf(path), value] as const);
    return changes.every((change): change is FieldChange => change[0] !== undefined) ? changes : undefined;
}

function without(target: Fields, key: string): Fields {
    return Object.fromEntries(Object.entries(target).filter(([name]) => name !== key));
}

/** `target` with the field at `path` set to `value`, making maps on the way (replacing a value that is not one). */
function setAt(target: Fields, [head, ...rest]: FieldPath, value: unknown): Fields {
    if (!nonEmpty(rest)) {
        return { ...target, [head]: value };
    }
    const child = target[head];
    return { ...target, [head]: setAt(isRecord(child) ? child : {}, rest, value) };
}

/** `target` without the field at `path` (a path that does not exist removes nothing, as in Firestore). */
function removeAt(target: Fields, [head, ...rest]: FieldPath): Fields {
    if (!nonEmpty(rest)) {
        return without(target, head);
    }
    const child = target[head];
    return isRecord(child) ? { ...target, [head]: removeAt(child, rest) } : target;
}

/** `document` with `changes` applied in order (Firestore's `update`): each field set, or removed by the removal marker. */
export function applyFields(document: Fields, changes: readonly FieldChange[]): Fields {
    return changes.reduce<Fields>(
        (merged, [path, value]) => (isDeletion(value) ? removeAt(merged, path) : setAt(merged, path, value)),
        document,
    );
}
