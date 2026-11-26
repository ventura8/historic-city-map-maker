/**
 * The editors' `ContentStore` over the Firestore SDK (`docs/research/M2c-interfaces.md` §2.2, §5.3): documents and
 * queries read live and validated with their shared schema (a document that fails it is never shown as data), every
 * write stamped with the signed-in uid and `serverTimestamp()` (the rules check both), and an update or a removal made
 * in one transaction that refuses a document another admin changed meanwhile (`conflict`) or deleted (`gone`).
 * Firestore's error codes become the port's: `permission-denied` is `denied` (the shell asks `admin.session` again),
 * `unavailable` is `offline` (the draft stays).
 */
import { timestampSchema, timestampToDate, toValidationIssues, type Logger, type Schema, type ValidationIssue } from '@hcm/shared';
import type {
    DocumentData,
    DocumentReference,
    DocumentSnapshot,
    Firestore,
    Query,
    QueryConstraint,
    QuerySnapshot,
    Transaction,
} from 'firebase/firestore';

import type {
    BatchWrite,
    ContentQuery,
    ContentStore,
    Fields,
    Stored,
    StoredPage,
    StoreFailure,
    WriteOutcome,
} from '../content/services.js';
import { PAGE_SIZE } from '../content/services.js';
import type { ContentSdk } from './content-sdk.js';

export interface ContentStoreDeps {
    readonly sdk: ContentSdk;
    readonly firestore: () => Firestore;
    /** The signed-in uid that stamps every write; null refuses the write as `denied`. */
    readonly uid: () => string | null;
    /**
     * Where a document that fails its schema is reported, with the failing fields and their codes (never their values),
     * once per document and set of issues; the page only says it could not be read (finding 62 of 2026-11-02).
     */
    readonly log?: Logger;
}

/** A pending server timestamp reads as the local estimate, so a document just written still validates. */
const READ_OPTIONS = { serverTimestamps: 'estimate' } as const;

const UNAVAILABLE = new Set(['unavailable', 'deadline-exceeded']);

function codeOf(error: unknown): string {
    const code = (error as { readonly code?: unknown } | null)?.code;
    return typeof code === 'string' ? code.replace(/^firestore\//, '') : 'unknown';
}

/** Why a listener stopped, from Firestore's error. */
export function failureOf(error: unknown): StoreFailure {
    const code = codeOf(error);
    if (code === 'permission-denied') {
        return { kind: 'denied', code };
    }
    return { kind: UNAVAILABLE.has(code) ? 'unavailable' : 'failed', code };
}

const WRITE_REASONS: Readonly<Record<string, Exclude<WriteOutcome, { readonly ok: true }>['reason']>> = {
    'permission-denied': 'denied',
    'not-found': 'gone',
    aborted: 'conflict',
    'failed-precondition': 'conflict',
    'invalid-argument': 'invalid',
};

/** A failed write's outcome: anything unknown keeps the draft as if offline (try again). */
export function writeFailureOf(error: unknown): WriteOutcome {
    return { ok: false, reason: WRITE_REASONS[codeOf(error)] ?? 'offline' };
}

/** A document's version: its `updatedAt` as ISO text (`''` without one). */
export function versionOf(data: DocumentData | undefined): string {
    const parsed = timestampSchema.safeParse(data?.['updatedAt']);
    return parsed.success ? timestampToDate(parsed.data).toISOString() : '';
}

/**
 * A value as text that does not depend on the order of a map's keys, nor on its undefined fields, which Firestore leaves
 * out (a create's data against what was read back).
 */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const fields = Object.entries(value)
            .filter(([, inner]) => inner !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, inner]) => [JSON.stringify(key), canonical(inner)].join(':'));
        return `{${fields.join(',')}}`;
    }
    return value === undefined ? 'undefined' : JSON.stringify(value);
}

type Parsed<T> =
    | { readonly ok: true; readonly doc: Stored<T> }
    | { readonly ok: false; readonly path: string; readonly issues: ReturnType<typeof toValidationIssues> };

function parse<T>(snapshot: DocumentSnapshot, schema: Schema<T>): Parsed<T> {
    const data = snapshot.data(READ_OPTIONS) ?? {};
    const result = schema.safeParse(data);
    if (!result.success) {
        return { ok: false, path: snapshot.ref.path, issues: toValidationIssues(result.error.issues) };
    }
    const { id, ref, metadata } = snapshot;
    return { ok: true, doc: { id, path: ref.path, data: result.data, version: versionOf(data), pending: metadata.hasPendingWrites } };
}

function pageOf<T>(snapshot: QuerySnapshot, schema: Schema<T>, limit: number): StoredPage<T> {
    const parsed = snapshot.docs.map((document) => parse(document, schema));
    return {
        docs: parsed.flatMap((entry) => (entry.ok ? [entry.doc] : [])),
        invalid: parsed.flatMap((entry) => (entry.ok ? [] : [{ path: entry.path, issues: entry.issues }])),
        hasMore: snapshot.size >= limit,
        fromCache: snapshot.metadata.fromCache,
    };
}

/** What a query is made of: the collection (or, with `group`, every collection of that id), the request, the limit. */
interface QueryParts {
    readonly collection: string;
    readonly request: ContentQuery;
    /** Null to count: an aggregation takes no limit. */
    readonly limit: number | null;
}

/** The SDK query of a `ContentQuery`. */
function queryOf(sdk: ContentSdk, db: Firestore, parts: QueryParts): Query {
    const { collection, request, limit } = parts;
    const source = request.group === true ? sdk.collectionGroup(db, collection) : sdk.collection(db, collection);
    const constraints: QueryConstraint[] = [
        ...(request.where ?? []).map(([field, operator, value]) => sdk.where(field, operator, value)),
        ...(request.orderBy ?? []).map(([field, direction]) => sdk.orderBy(field, direction)),
        ...(limit === null ? [] : [sdk.limit(limit)]),
    ];
    return sdk.query(source, ...constraints);
}

type Step = (transaction: Transaction, snapshot: DocumentSnapshot, ref: DocumentReference) => WriteOutcome;

/** An update's fields with every `undefined` value as `deleteField()`: an editor clears an optional field that way (CR-M2c-16). */
function cleared(sdk: ContentSdk, fields: Fields): Fields {
    return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, value === undefined ? sdk.deleteField() : value]));
}

/** The failing fields of a document as one line: `scan.width validation.tooBig; georef.gcps.0.pixel.x validation.tooBig`. */
function failingFields(issues: readonly ValidationIssue[]): string {
    return issues.map((issue) => `${issue.path === '' ? '(document)' : issue.path} ${issue.code}`).join('; ');
}

class FirestoreContentStore implements ContentStore {
    readonly #deps: ContentStoreDeps;
    /** What was reported already (`path|fields`): a live listener delivers the same document again and again. */
    readonly #reported = new Set<string>();

    constructor(deps: ContentStoreDeps) {
        this.#deps = deps;
    }

    watchDoc<T>(path: string, schema: Schema<T>, listener: (doc: Stored<T> | null) => void, failed: (failure: StoreFailure) => void) {
        return this.#deps.sdk.onSnapshot(
            this.#ref(path),
            // With metadata changes: a cached copy that fails its schema waits for the server's answer (`#deliver`).
            { includeMetadataChanges: true },
            {
                next: (snapshot: DocumentSnapshot) => {
                    this.#deliver(snapshot, schema, listener, failed);
                },
                error: (error: unknown) => {
                    failed(failureOf(error));
                },
            },
        );
    }

    /** The port's five arguments, taken as one tuple (the limit on parameters, ESLint `max-params`). */
    watchQuery<T>(
        ...[collection, schema, request, listener, failed]: [
            collection: string,
            schema: Schema<T>,
            request: ContentQuery,
            listener: (page: StoredPage<T>) => void,
            failed: (failure: StoreFailure) => void,
        ]
    ) {
        const { sdk, firestore } = this.#deps;
        const limit = request.limit ?? PAGE_SIZE;
        return sdk.onSnapshot(
            queryOf(sdk, firestore(), { collection, request, limit }),
            { includeMetadataChanges: true },
            {
                next: (snapshot: QuerySnapshot) => {
                    const page = pageOf(snapshot, schema, limit);
                    page.invalid.forEach(({ path, issues }) => {
                        this.#report(path, issues);
                    });
                    listener(page);
                },
                error: (error: unknown) => {
                    failed(failureOf(error));
                },
            },
        );
    }

    async count(collection: string, request: ContentQuery): Promise<number | null> {
        const { sdk, firestore } = this.#deps;
        try {
            const snapshot = await sdk.getCountFromServer(queryOf(sdk, firestore(), { collection, request, limit: null }));
            return snapshot.data().count;
        } catch {
            return null;
        }
    }

    update(path: string, fields: Fields, expected: string | null): Promise<WriteOutcome> {
        return this.#transact(path, (transaction, snapshot, ref) => {
            if (!snapshot.exists()) {
                return { ok: false, reason: 'gone' };
            }
            if (expected !== null && versionOf(snapshot.data(READ_OPTIONS)) !== expected) {
                return { ok: false, reason: 'conflict' };
            }
            transaction.update(ref, { ...cleared(this.#deps.sdk, fields), ...this.#stamp() });
            return { ok: true };
        });
    }

    create(path: string, data: Fields, options: { readonly withCreator?: boolean } = {}): Promise<WriteOutcome> {
        return this.#transact(path, (transaction, snapshot, ref) => {
            if (snapshot.exists()) {
                return this.#ownCreate(snapshot, data) ? { ok: true } : { ok: false, reason: 'conflict' };
            }
            transaction.set(ref, { ...data, ...this.#creation(options.withCreator === true) });
            return { ok: true };
        });
    }

    remove(path: string, expected: string | null): Promise<WriteOutcome> {
        return this.#transact(path, (transaction, snapshot, ref) => {
            if (!snapshot.exists()) {
                return { ok: false, reason: 'gone' };
            }
            if (expected !== null && versionOf(snapshot.data(READ_OPTIONS)) !== expected) {
                return { ok: false, reason: 'conflict' };
            }
            transaction.delete(ref);
            return { ok: true };
        });
    }

    async batch(writes: readonly BatchWrite[]): Promise<WriteOutcome> {
        if (this.#deps.uid() === null) {
            return { ok: false, reason: 'denied' };
        }
        const batch = this.#deps.sdk.writeBatch(this.#deps.firestore());
        for (const write of writes) {
            this.#add(batch, write);
        }
        try {
            await batch.commit();
            return { ok: true };
        } catch (error) {
            return writeFailureOf(error);
        }
    }

    newId(): string {
        const { sdk, firestore } = this.#deps;
        return sdk.doc(sdk.collection(firestore(), 'ids')).id;
    }

    #ref(path: string): DocumentReference {
        return this.#deps.sdk.doc(this.#deps.firestore(), path);
    }

    #deliver<T>(
        snapshot: DocumentSnapshot,
        schema: Schema<T>,
        listener: (doc: Stored<T> | null) => void,
        failed: (failure: StoreFailure) => void,
    ): void {
        if (!snapshot.exists()) {
            listener(null);
            return;
        }
        const parsed = parse(snapshot, schema);
        if (parsed.ok) {
            listener(parsed.doc);
        } else if (!snapshot.metadata.fromCache) {
            // Only the server's copy fails the read: a failure ends the listener, so a cached copy of a document repaired
            // since would otherwise fail every Try again, and the server's answer would never be heard.
            this.#report(parsed.path, parsed.issues);
            failed({ kind: 'failed', code: 'invalid-document' });
        }
    }

    /** A document that failed its schema, logged with its failing fields once (`ContentStoreDeps.log`). */
    #report(path: string, issues: readonly ValidationIssue[]): void {
        const fields = failingFields(issues);
        const key = `${path}|${fields}`;
        if (this.#deps.log === undefined || this.#reported.has(key)) {
            return;
        }
        this.#reported.add(key);
        this.#deps.log.warn('a document does not match its schema and is not shown', { path, fields });
    }

    /**
     * A document that holds what this create writes, stamped by this admin: the create's own earlier attempt, whose commit
     * landed although its answer said otherwise (the transaction then runs again and finds it: `docs/LESSONS.md` 117).
     */
    #ownCreate(snapshot: DocumentSnapshot, data: Fields): boolean {
        const stored = snapshot.data(READ_OPTIONS) ?? {};
        const same = Object.entries(data).every(([key, value]) => canonical(stored[key]) === canonical(value));
        return same && stored['updatedBy'] === this.#deps.uid();
    }

    #stamp(): Fields {
        return { updatedBy: this.#deps.uid(), updatedAt: this.#deps.sdk.serverTimestamp() };
    }

    #creation(withCreator: boolean): Fields {
        const stamp = this.#stamp();
        return withCreator
            ? { ...stamp, createdAt: stamp['updatedAt'], createdBy: stamp['updatedBy'] }
            : { ...stamp, createdAt: stamp['updatedAt'] };
    }

    #add(batch: ReturnType<ContentSdk['writeBatch']>, write: BatchWrite): void {
        const ref = this.#ref(write.path);
        if (write.kind === 'delete') {
            batch.delete(ref);
            return;
        }
        if (write.kind === 'create') {
            batch.set(ref, { ...write.data, ...this.#creation(write.withCreator === true) });
            return;
        }
        batch.update(ref, { ...cleared(this.#deps.sdk, write.fields), ...this.#stamp() });
    }

    async #transact(path: string, step: Step): Promise<WriteOutcome> {
        if (this.#deps.uid() === null) {
            return { ok: false, reason: 'denied' };
        }
        const ref = this.#ref(path);
        try {
            return await this.#deps.sdk.runTransaction(this.#deps.firestore(), async (transaction) =>
                step(transaction, await transaction.get(ref), ref),
            );
        } catch (error) {
            return writeFailureOf(error);
        }
    }
}

export function contentStore(deps: ContentStoreDeps): ContentStore {
    return new FirestoreContentStore(deps);
}
