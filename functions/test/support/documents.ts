import { readFileSync } from 'node:fs';

import { validate, type Schema } from '@hcm/shared';

import type { DocumentStore } from '../../src/ports/documents.js';
import { InvalidDocumentError, UpstreamError } from '../../src/ports/errors.js';
import { PortRecorder, promised } from './recorder.js';

/**
 * An in-memory `DocumentStore` that behaves like the Firestore adapter (docs/research/M2-interfaces.md §4): every write
 * is validated with its schema first (`InvalidDocumentError`), so is every read; `create` refuses an existing document
 * (`UpstreamError` `conflict`); a query reads one collection's direct children and splits valid from invalid
 * documents; a transaction buffers its writes, applies them only when `work` resolves, and refuses a read after a
 * write as Firestore does. `contend(n)` makes the next transaction run `work` n extra times first and throw their
 * writes away, which proves a handler's transaction has no side effects outside it. A query that filters or orders on a field
 * `firebase/firestore.indexes.json` exempts from indexing throws as Firestore's `FAILED_PRECONDITION` does (the emulator does
 * not enforce indexes: `layers.delete` on `jobs.params.layerId`, lesson 557).
 */

interface FieldOverride {
    readonly collectionGroup: string;
    readonly fieldPath: string;
    readonly indexes: readonly unknown[];
}

const EXEMPT: readonly FieldOverride[] = (
    JSON.parse(readFileSync(new URL('../../../firebase/firestore.indexes.json', import.meta.url), 'utf8')) as {
        readonly fieldOverrides: readonly FieldOverride[];
    }
).fieldOverrides.filter((override) => override.indexes.length === 0);

function exemptField(collectionPath: string, field: string): boolean {
    const group = collectionPath.split('/').at(-1);
    return EXEMPT.some(
        (override) => override.collectionGroup === group && (field === override.fieldPath || field.startsWith(`${override.fieldPath}.`)),
    );
}

/** Firestore refuses a query on a field without an index; the fake does too. */
function refuseUnindexed(collectionPath: string, options: QueryOptions): void {
    const fields = [...(options.where ?? []).map(([field]) => field), ...(options.orderBy === undefined ? [] : [options.orderBy[0]])];
    const unindexed = fields.find((field) => exemptField(collectionPath, field));
    if (unindexed !== undefined) {
        throw new Error(`9 FAILED_PRECONDITION: the query requires an index for ${collectionPath} and field ${unindexed}`);
    }
}

type QueryOptions = NonNullable<Parameters<DocumentStore['query']>[2]>;
type WhereClause = NonNullable<QueryOptions['where']>[number];
type Transaction = Parameters<Parameters<DocumentStore['transaction']>[0]>[0];
type Method = 'get' | 'create' | 'set' | 'delete' | 'query' | 'count' | 'transaction';

type Write =
    { readonly kind: 'create' | 'set'; readonly path: string; readonly data: unknown } | { readonly kind: 'delete'; readonly path: string };

export interface FakeDocumentStore extends DocumentStore {
    readonly recorder: PortRecorder<Method>;
    /** Every applied write, oldest first (transaction writes when it commits). */
    readonly writes: readonly Write[];
    /** Writes `data` as stored, without validation (seed an invalid document this way). */
    seed(path: string, data: unknown): void;
    /** The stored data at `path` (a copy), or undefined. */
    peek(path: string): unknown;
    /** The paths of the stored documents that start with `prefix`, sorted. */
    paths(prefix?: string): string[];
    /** The next transaction runs `work` `times` extra times, discarding them, before the run that commits. */
    contend(times: number): void;
}

function checked<T>(path: string, schema: Schema<T>, data: unknown): T {
    const result = validate(schema, data);
    if (!result.ok) {
        throw new InvalidDocumentError(path, result.issues);
    }
    return result.value;
}

function fieldOf(data: unknown, field: string): unknown {
    return field
        .split('.')
        .reduce<unknown>(
            (value, key) => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined),
            data,
        );
}

/** Firestore orders timestamps by time, numbers and strings naturally; this fake needs no more. */
function comparable(value: unknown): unknown {
    if (typeof value === 'object' && value !== null && 'seconds' in value && 'nanoseconds' in value) {
        const { seconds, nanoseconds } = value as { seconds: number; nanoseconds: number };
        return seconds * 1e9 + nanoseconds;
    }
    return value;
}

function compare(left: unknown, right: unknown): number {
    const [a, b] = [comparable(left), comparable(right)];
    if (typeof a === 'number' && typeof b === 'number') {
        return a - b;
    }
    return String(a).localeCompare(String(b));
}

const OPERATORS: Readonly<Record<WhereClause[1], (value: unknown, operand: unknown) => boolean>> = {
    '==': (value, operand) => value !== undefined && compare(value, operand) === 0,
    '!=': (value, operand) => value !== undefined && compare(value, operand) !== 0,
    '<': (value, operand) => value !== undefined && compare(value, operand) < 0,
    '<=': (value, operand) => value !== undefined && compare(value, operand) <= 0,
    '>': (value, operand) => value !== undefined && compare(value, operand) > 0,
    '>=': (value, operand) => value !== undefined && compare(value, operand) >= 0,
    in: (value, operand) => Array.isArray(operand) && operand.some((item) => compare(value, item) === 0),
};

function matches(data: unknown, where: QueryOptions['where']): boolean {
    return (where ?? []).every(([field, operator, operand]) => OPERATORS[operator](fieldOf(data, field), operand));
}

/**
 * Sorted by `orderBy` (ties by document path, as Firestore breaks them), or by path for none or `__name__` ascending.
 * `__name__` descending rejects, as the Firestore emulator does ("does not support descending key scans").
 */
function ordered(entries: [string, unknown][], orderBy: QueryOptions['orderBy']): [string, unknown][] {
    const [field, direction] = orderBy ?? ['__name__', 'asc'];
    const sign = direction === 'asc' ? 1 : -1;
    if (field === '__name__') {
        if (sign < 0) {
            throw new Error('FAILED_PRECONDITION: Firestore does not support descending key scans');
        }
        return entries.sort(([a], [b]) => a.localeCompare(b));
    }
    return entries.sort(([pathA, a], [pathB, b]) => compare(fieldOf(a, field), fieldOf(b, field)) * sign || pathA.localeCompare(pathB));
}

function isChildOf(path: string, collection: string): boolean {
    return path.startsWith(`${collection}/`) && !path.slice(collection.length + 1).includes('/');
}

/** A create or set as the store applies it: validated first; a create of an existing document is a `conflict`. */
function prepared<T>(kind: 'create' | 'set', path: string, schema: Schema<T>, data: T, exists: (path: string) => boolean): Write {
    const value = checked(path, schema, data);
    if (kind === 'create' && exists(path)) {
        throw new UpstreamError('firestore', 'conflict');
    }
    return { kind, path, data: value };
}

/** Each document's update time (M7's compare-and-set), as Firestore's `<seconds>.<nanoseconds>`: every write moves it on. */
function updateClock() {
    const times = new Map<string, number>();
    let tick = 0;
    return {
        touch: (path: string): void => {
            tick += 1;
            times.set(path, tick);
        },
        timeOf: (path: string): string => `${String(1_700_000_000 + (times.get(path) ?? 0))}.000000000`,
    };
}

/** A fresh, empty store. */
export function createFakeDocumentStore(): FakeDocumentStore {
    const docs = new Map<string, unknown>();
    const clock = updateClock();
    const writes: Write[] = [];
    const recorder = new PortRecorder<Method>();
    let contention = 0;
    const read = <T>(path: string, schema: Schema<T>): T | undefined => {
        const stored = docs.get(path);
        return stored === undefined ? undefined : checked(path, schema, structuredClone(stored));
    };
    const apply = (write: Write): void => {
        if (write.kind === 'delete') {
            docs.delete(write.path);
        } else {
            docs.set(write.path, structuredClone(write.data));
        }
        clock.touch(write.path);
        writes.push(write);
    };
    /** One run of `work`: reads see the store plus this run's own writes, the writes are returned, not applied. */
    const run = async <R>(
        work: (transaction: Transaction) => Promise<R>,
    ): Promise<{ readonly result: R; readonly pending: readonly Write[] }> => {
        const pending: Write[] = [];
        const exists = (path: string): boolean => {
            const last = pending.findLast((write) => write.path === path);
            return last === undefined ? docs.has(path) : last.kind !== 'delete';
        };
        const transaction: Transaction = {
            get: <T>(path: string, schema: Schema<T>) => {
                if (pending.length > 0) {
                    return Promise.reject(new Error('Firestore transactions require all reads to be executed before all writes.'));
                }
                return Promise.resolve(read(path, schema));
            },
            getVersioned: <T>(path: string, schema: Schema<T>) =>
                transaction.get(path, schema).then((data) => (data === undefined ? undefined : { data, updateTime: clock.timeOf(path) })),
            create: <T>(path: string, schema: Schema<T>, data: T) => {
                pending.push(prepared('create', path, schema, data, exists));
                return Promise.resolve();
            },
            set: <T>(path: string, schema: Schema<T>, data: T) => {
                pending.push(prepared('set', path, schema, data, exists));
                return Promise.resolve();
            },
            delete: (path: string) => {
                pending.push({ kind: 'delete', path });
                return Promise.resolve();
            },
        };
        return { result: await work(transaction), pending };
    };
    return {
        recorder,
        writes,
        get: <T>(path: string, schema: Schema<T>) =>
            promised(() => {
                recorder.enter('get', [path]);
                return read(path, schema);
            }),
        create: <T>(path: string, schema: Schema<T>, data: T) =>
            promised(() => {
                recorder.enter('create', [path, data]);
                apply(prepared('create', path, schema, data, (candidate) => docs.has(candidate)));
            }),
        set: <T>(path: string, schema: Schema<T>, data: T) =>
            promised(() => {
                recorder.enter('set', [path, data]);
                apply(prepared('set', path, schema, data, () => false));
            }),
        delete: (path: string) =>
            promised(() => {
                recorder.enter('delete', [path]);
                apply({ kind: 'delete', path });
            }),
        query: <T>(collectionPath: string, schema: Schema<T>, options: QueryOptions = {}) =>
            promised(() => {
                recorder.enter('query', [collectionPath, options]);
                refuseUnindexed(collectionPath, options);
                const children = [...docs.entries()].filter(
                    ([path, data]) => isChildOf(path, collectionPath) && matches(data, options.where),
                );
                const limited = ordered(children, options.orderBy).slice(0, options.limit ?? children.length);
                const results = limited.map(([path, data]) => ({
                    path,
                    id: String(path.split('/').at(-1)),
                    result: validate(schema, structuredClone(data)),
                }));
                return {
                    documents: results.flatMap(({ path, id, result }) => (result.ok ? [{ id, path, data: result.value }] : [])),
                    invalid: results.flatMap(({ path, id, result }) => (result.ok ? [] : [{ id, path, issues: result.issues }])),
                };
            }),
        count: (collectionPath: string, where?: QueryOptions['where']) =>
            promised(() => {
                recorder.enter('count', [collectionPath, where ?? []]);
                refuseUnindexed(collectionPath, where === undefined ? {} : { where });
                return [...docs.entries()].filter(([path, data]) => isChildOf(path, collectionPath) && matches(data, where)).length;
            }),
        transaction: async <R>(work: (transaction: Transaction) => Promise<R>) => {
            recorder.enter('transaction', []);
            for (; contention > 0; contention -= 1) {
                await run(work);
            }
            const { result, pending } = await run(work);
            pending.forEach(apply);
            return result;
        },
        seed: (path, data) => {
            docs.set(path, structuredClone(data));
            clock.touch(path);
        },
        peek: (path) => (docs.has(path) ? structuredClone(docs.get(path)) : undefined),
        paths: (prefix = '') => [...docs.keys()].filter((path) => path.startsWith(prefix)).sort((a, b) => a.localeCompare(b)),
        contend: (times) => {
            contention = times;
        },
    };
}
