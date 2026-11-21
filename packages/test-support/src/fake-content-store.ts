/**
 * An in-memory `ContentStore` (`docs/research/M2c-interfaces.md` §2.2, §9.5) for the editors' node tests: documents live
 * in a map by path, listeners get every change at once (synchronously), writes follow the real adapter's rules (a
 * version check refuses a document changed meanwhile, a missing one is `gone`, every write is stamped with `uid` and the
 * fake clock), and each write is recorded. A test can script a write's outcome, make a listener fail, take the store
 * offline (lists answer from the "cache", writes fail `offline`) and set a count. Structural: it satisfies
 * `ContentStore` of `@hcm/admin` without importing it (the test kit sits below the apps).
 */
import { timestampToDate, toValidationIssues, type Schema, type TimestampLike, type ValidationIssue } from '@hcm/shared';

type Data = Readonly<Record<string, unknown>>;
type Operator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';

export interface FakeQuery {
    readonly where?: readonly (readonly [string, Operator, unknown])[];
    readonly orderBy?: readonly (readonly [string, 'asc' | 'desc'])[];
    readonly limit?: number;
    readonly group?: boolean;
}

export interface FakeStored<T> {
    readonly id: string;
    readonly path: string;
    readonly data: T;
    readonly version: string;
    readonly pending: boolean;
}

export interface FakePage<T> {
    readonly docs: readonly FakeStored<T>[];
    readonly invalid: readonly { readonly path: string; readonly issues: readonly ValidationIssue[] }[];
    readonly hasMore: boolean;
    readonly fromCache: boolean;
}

export interface FakeFailure {
    readonly kind: 'denied' | 'unavailable' | 'failed';
    readonly code: string;
}

export type FakeOutcome =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly reason: 'conflict' | 'gone' | 'denied' | 'offline' | 'invalid';
          readonly issues?: readonly ValidationIssue[];
      };

export type FakeBatchWrite =
    | { readonly kind: 'create'; readonly path: string; readonly data: Data; readonly withCreator?: boolean }
    | { readonly kind: 'update'; readonly path: string; readonly fields: Data }
    | { readonly kind: 'delete'; readonly path: string };

/** One write as the store received it (`expected`: the version the caller read). */
export type FakeWrite =
    | { readonly kind: 'update'; readonly path: string; readonly fields: Data; readonly expected: string | null }
    | { readonly kind: 'create'; readonly path: string; readonly data: Data }
    | { readonly kind: 'remove'; readonly path: string; readonly expected: string | null }
    | { readonly kind: 'batch'; readonly writes: readonly FakeBatchWrite[] };

interface Watcher {
    readonly target: string;
    readonly deliver: () => void;
    readonly failed: (failure: FakeFailure) => void;
}

const DEFAULT_LIMIT = 50;

function versionOf(data: Data): string {
    const at = data['updatedAt'] as TimestampLike | undefined;
    return at === undefined ? '' : timestampToDate(at).toISOString();
}

/** The collection a document path belongs to (`cities/x/photos/p` → `cities/x/photos`). */
function parentOf(path: string): string {
    return path.split('/').slice(0, -1).join('/');
}

function isTimestamp(value: unknown): value is TimestampLike {
    return typeof value === 'object' && value !== null && 'seconds' in value;
}

/** How a field sorts: a timestamp by its time, a number as it is, anything else by its text after the numbers. */
function sortKey(value: unknown): readonly [number, string] {
    if (isTimestamp(value)) {
        return [timestampToDate(value).getTime(), ''];
    }
    return typeof value === 'number' ? [value, ''] : [0, String(value)];
}

function compare(a: unknown, b: unknown): number {
    const [leftNumber, leftText] = sortKey(a);
    const [rightNumber, rightText] = sortKey(b);
    return leftNumber - rightNumber || leftText.localeCompare(rightText);
}

const MATCHERS: Readonly<Record<Operator, (field: unknown, value: unknown) => boolean>> = {
    '==': (field, value) => field === value,
    '!=': (field, value) => field !== value,
    '<': (field, value) => compare(field, value) < 0,
    '<=': (field, value) => compare(field, value) <= 0,
    '>': (field, value) => compare(field, value) > 0,
    '>=': (field, value) => compare(field, value) >= 0,
    in: (field, value) => (value as readonly unknown[]).includes(field),
    'not-in': (field, value) => !(value as readonly unknown[]).includes(field),
    'array-contains': (field, value) => Array.isArray(field) && field.includes(value),
};

/** An update's `undefined` fields are removed, as the adapter's `deleteField()` removes them (CR-M2c-16). */
function withoutCleared(data: Data): Data {
    return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

/** A field by its path, dotted into maps as Firestore reads it (`rank.score`); undefined when a step is missing. */
function fieldAt(data: Data, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>((value, key) => (typeof value === 'object' && value !== null ? (value as Data)[key] : undefined), data);
}

function matches(data: Data, query: FakeQuery): boolean {
    return (query.where ?? []).every(([field, operator, value]) => MATCHERS[operator](fieldAt(data, field), value));
}

function ordered(entries: [string, Data][], query: FakeQuery): [string, Data][] {
    const order = query.orderBy ?? [];
    return entries.toSorted(([pathA, a], [pathB, b]) => {
        for (const [field, direction] of order) {
            const result = compare(fieldAt(a, field), fieldAt(b, field));
            if (result !== 0) {
                return direction === 'desc' ? -result : result;
            }
        }
        return pathA.localeCompare(pathB);
    });
}

export class FakeContentStore {
    /** The "server": every document by path. */
    readonly docs = new Map<string, Data>();
    readonly writes: FakeWrite[] = [];
    /** Outcomes for the next writes, in order (a scripted failure writes nothing); empty: every write succeeds. */
    readonly outcomes: FakeOutcome[] = [];
    /** Counts by collection path that override the computed ones (null: the count failed). */
    readonly counts = new Map<string, number | null>();
    /** Who stamps the writes (null: signed out, every write is `denied`). */
    uid: string | null = 'admin-uid';
    /** The clock of the stamps, epoch milliseconds (each write moves it one second on). */
    now = Date.UTC(2026, 9, 17, 12, 0, 0);
    #offline = false;
    #ids = 0;
    readonly #watchers = new Set<Watcher>();

    /** Puts a document on the "server" as another admin or a trigger would (listeners hear it). */
    put(path: string, data: Data): void {
        this.docs.set(path, data);
        this.#notify();
    }

    /** Deletes a document as another admin would. */
    drop(path: string): void {
        this.docs.delete(path);
        this.#notify();
    }

    /** A stamp of the fake clock (what the next write would carry). */
    stamp(): { readonly updatedBy: string; readonly updatedAt: TimestampLike } {
        const ms = this.now;
        return { updatedBy: this.uid ?? 'nobody', updatedAt: { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1_000_000 } };
    }

    /** Offline: lists answer from the cache (`fromCache`), writes fail `offline`; back online, lists answer again. */
    setOffline(offline: boolean): void {
        this.#offline = offline;
        this.#notify();
    }

    /** Ends every listener whose path or collection is `target` with `failure` (they are detached). */
    fail(target: string, failure: FakeFailure): void {
        for (const watcher of [...this.#watchers].filter((candidate) => candidate.target === target)) {
            this.#watchers.delete(watcher);
            watcher.failed(failure);
        }
    }

    /** How many listeners are attached (to `target`, or in all). */
    listeners(target?: string): number {
        return [...this.#watchers].filter((watcher) => target === undefined || watcher.target === target).length;
    }

    watchDoc<T>(
        path: string,
        schema: Schema<T>,
        listener: (doc: FakeStored<T> | null) => void,
        failed: (failure: FakeFailure) => void,
    ): () => void {
        const deliver = (): void => {
            const data = this.docs.get(path);
            if (data === undefined) {
                listener(null);
                return;
            }
            const parsed = schema.safeParse(data);
            if (parsed.success) {
                listener(this.#stored(path, parsed.data, data));
            } else {
                failed({ kind: 'failed', code: 'invalid-document' });
            }
        };
        return this.#watch({ target: path, deliver, failed });
    }

    watchQuery<T>(
        collection: string,
        schema: Schema<T>,
        query: FakeQuery,
        listener: (page: FakePage<T>) => void,
        failed: (failure: FakeFailure) => void,
    ): () => void {
        const deliver = (): void => {
            listener(this.#page(collection, schema, query));
        };
        return this.#watch({ target: collection, deliver, failed });
    }

    count(collection: string, query: FakeQuery): Promise<number | null> {
        const set = this.counts.get(collection);
        return Promise.resolve(set === undefined ? this.#entries(collection, query).length : set);
    }

    update(path: string, fields: Data, expected: string | null): Promise<FakeOutcome> {
        this.writes.push({ kind: 'update', path, fields, expected });
        return this.#write(() => {
            const current = this.docs.get(path);
            if (current === undefined) {
                return { ok: false, reason: 'gone' };
            }
            if (expected !== null && versionOf(current) !== expected) {
                return { ok: false, reason: 'conflict' };
            }
            this.docs.set(path, withoutCleared({ ...current, ...fields, ...this.stamp() }));
            return { ok: true };
        });
    }

    create(path: string, data: Data, options: { readonly withCreator?: boolean } = {}): Promise<FakeOutcome> {
        this.writes.push({ kind: 'create', path, data });
        return this.#write(() => {
            if (this.docs.has(path)) {
                return { ok: false, reason: 'conflict' };
            }
            this.docs.set(path, this.#created(data, options.withCreator === true));
            return { ok: true };
        });
    }

    remove(path: string, expected: string | null): Promise<FakeOutcome> {
        this.writes.push({ kind: 'remove', path, expected });
        return this.#write(() => {
            const current = this.docs.get(path);
            if (current === undefined) {
                return { ok: false, reason: 'gone' };
            }
            if (expected !== null && versionOf(current) !== expected) {
                return { ok: false, reason: 'conflict' };
            }
            this.docs.delete(path);
            return { ok: true };
        });
    }

    batch(writes: readonly FakeBatchWrite[]): Promise<FakeOutcome> {
        this.writes.push({ kind: 'batch', writes });
        return this.#write(() => {
            for (const write of writes) {
                this.#apply(write);
            }
            return { ok: true };
        });
    }

    newId(): string {
        this.#ids += 1;
        return `new-${String(this.#ids)}`;
    }

    #watch(watcher: Watcher): () => void {
        this.#watchers.add(watcher);
        watcher.deliver();
        return () => {
            this.#watchers.delete(watcher);
        };
    }

    #notify(): void {
        for (const watcher of [...this.#watchers]) {
            watcher.deliver();
        }
    }

    #stored<T>(path: string, data: T, raw: Data): FakeStored<T> {
        return { id: path.split('/').at(-1) ?? path, path, data, version: versionOf(raw), pending: false };
    }

    #entries(collection: string, query: FakeQuery): [string, Data][] {
        const inCollection = ([path]: [string, Data]): boolean =>
            query.group === true ? parentOf(path).split('/').at(-1) === collection : parentOf(path) === collection;
        return ordered(
            [...this.docs.entries()].filter(inCollection).filter(([, data]) => matches(data, query)),
            query,
        );
    }

    #page<T>(collection: string, schema: Schema<T>, query: FakeQuery): FakePage<T> {
        const limit = query.limit ?? DEFAULT_LIMIT;
        const entries = this.#entries(collection, query).slice(0, limit);
        const docs: FakeStored<T>[] = [];
        const invalid: { readonly path: string; readonly issues: readonly ValidationIssue[] }[] = [];
        for (const [path, data] of entries) {
            const parsed = schema.safeParse(data);
            if (parsed.success) {
                docs.push(this.#stored(path, parsed.data, data));
            } else {
                invalid.push({ path, issues: toValidationIssues(parsed.error.issues) });
            }
        }
        return { docs, invalid, hasMore: entries.length >= limit, fromCache: this.#offline };
    }

    #created(data: Data, withCreator: boolean): Data {
        const stamp = this.stamp();
        const creator = withCreator ? { createdBy: stamp.updatedBy } : {};
        return { ...data, ...stamp, createdAt: stamp.updatedAt, ...creator };
    }

    #apply(write: FakeBatchWrite): void {
        if (write.kind === 'delete') {
            this.docs.delete(write.path);
            return;
        }
        if (write.kind === 'create') {
            this.docs.set(write.path, this.#created(write.data, write.withCreator === true));
            return;
        }
        this.docs.set(write.path, withoutCleared({ ...(this.docs.get(write.path) ?? {}), ...write.fields, ...this.stamp() }));
    }

    async #write(apply: () => FakeOutcome): Promise<FakeOutcome> {
        await Promise.resolve();
        const scripted = this.outcomes.shift();
        const outcome = this.#refusal() ?? (scripted === undefined || scripted.ok ? apply() : scripted);
        if (outcome.ok) {
            this.now += 1000;
            this.#notify();
        }
        return outcome;
    }

    #refusal(): FakeOutcome | null {
        if (this.uid === null) {
            return { ok: false, reason: 'denied' };
        }
        return this.#offline ? { ok: false, reason: 'offline' } : null;
    }
}
