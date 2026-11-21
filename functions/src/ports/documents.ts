import type { Schema, ValidationIssue } from '@hcm/shared';

/** A document as a query returns it: its id, its path and its validated data. */
export interface StoredDocument<T> {
    readonly id: string;
    readonly path: string;
    readonly data: T;
}

/** A document a query found but its schema refused (a manifest build skips and flags it, never uses it). */
export interface InvalidDocument {
    readonly id: string;
    readonly path: string;
    readonly issues: readonly ValidationIssue[];
}

type WhereOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';

export interface QueryOptions {
    readonly where?: readonly (readonly [field: string, operator: WhereOperator, value: unknown])[];
    readonly orderBy?: readonly [field: string, direction: 'asc' | 'desc'];
    readonly limit?: number;
}

export interface QueryResult<T> {
    readonly documents: readonly StoredDocument<T>[];
    readonly invalid: readonly InvalidDocument[];
}

/**
 * Reads of a {@link DocumentStore} or a transaction. Every document is validated with the caller's schema (paths and
 * schemas come from `@hcm/shared`: `FIRESTORE_PATHS`, `firestore.ts`, `firestore-ops.ts`).
 */
export interface DocumentReader {
    /** The document at `path`, or undefined when there is none; an invalid one rejects with `InvalidDocumentError`. */
    get<T>(path: string, schema: Schema<T>): Promise<T | undefined>;
}

/**
 * Writes validate `data` with `schema` before anything leaves the process (the Admin SDK bypasses the rules) and
 * reject with `InvalidDocumentError` otherwise. Timestamps are the shared `TimestampLike` (`timestampFromDate`); the
 * adapter stores them as Firestore timestamps. `set` replaces the whole document (handlers read, change, write).
 */
interface DocumentWriter {
    /** Rejects with `UpstreamError` `conflict` when the document exists already. */
    create<T>(path: string, schema: Schema<T>, data: T): Promise<void>;
    set<T>(path: string, schema: Schema<T>, data: T): Promise<void>;
    /** Deleting a missing document is not an error. */
    delete(path: string): Promise<void>;
}

/** A document read with its update time (M7): `<seconds>.<9-digit nanoseconds>`, as Firestore stamps the last write. */
export interface VersionedDocument<T> {
    readonly data: T;
    readonly updateTime: string;
}

/** Firestore's rule: every read of a transaction happens before its first write. */
export interface DocumentTransaction extends DocumentReader, DocumentWriter {
    /**
     * The document with its update time (M7, `worker.step`'s compare-and-set, `docs/research/M7-local-worker.md` §1.3): a
     * later call that finds another update time knows another writer came between; the transaction itself makes the
     * comparison and the write one step. Undefined when there is no document.
     */
    getVersioned<T>(path: string, schema: Schema<T>): Promise<VersionedDocument<T> | undefined>;
}

/**
 * Firestore through the Admin SDK (adapter `functions/src/adapters/documents.ts`; fake: `createFakeDocumentStore` in
 * `functions/test/support/documents.ts`). The single way handlers reach Firestore.
 */
export interface DocumentStore extends DocumentReader, DocumentWriter {
    /** One collection (`FIRESTORE_PATHS.photos(city)`, ...), not a collection group. */
    query<T>(collectionPath: string, schema: Schema<T>, options?: QueryOptions): Promise<QueryResult<T>>;
    /**
     * How many documents of one collection match `where`: an aggregation, billed one read per thousand documents and
     * reading none of them (the inbox's pruning counts before it reads the few it deletes).
     */
    count(collectionPath: string, where?: QueryOptions['where']): Promise<number>;
    /** Runs `work` in a Firestore transaction, retried by the SDK on contention (so `work` must have no side effects). */
    transaction<R>(work: (transaction: DocumentTransaction) => Promise<R>): Promise<R>;
}
