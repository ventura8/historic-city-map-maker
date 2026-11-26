import { validate, type Schema, type TimestampLike } from '@hcm/shared';
import {
    Timestamp,
    type DocumentData,
    type DocumentSnapshot,
    type Firestore,
    type Query,
    type Transaction,
} from 'firebase-admin/firestore';

import type { DocumentStore, DocumentTransaction, QueryOptions } from '../ports/documents.js';
import { InvalidDocumentError, UpstreamError } from '../ports/errors.js';

/** The gRPC status Firestore answers a `create` of an existing document with (`ALREADY_EXISTS`). */
const ALREADY_EXISTS = 6;

type Fields = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Fields {
    return typeof value === 'object' && value !== null;
}

function isList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/** The shared `TimestampLike` (a handler's `timestampFromDate`, or a Timestamp read back from Firestore). */
function isTimestampLike(value: unknown): value is TimestampLike {
    return isRecord(value) && typeof value['seconds'] === 'number' && typeof value['nanoseconds'] === 'number';
}

/** A map as zod and the snapshots build it, not an instance of an SDK class (a GeoPoint, a reference). */
function isPlainObject(value: unknown): value is Fields {
    const prototype: unknown = isRecord(value) ? Object.getPrototypeOf(value) : undefined;
    return prototype === Object.prototype || prototype === null;
}

function toFirestoreMap(value: Fields): DocumentData {
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, field]) => (field === undefined ? [] : [[key, toFirestoreValue(field)]])),
    );
}

/**
 * What Firestore stores for a validated value: every `TimestampLike`, at any depth (a history entry's `previous` holds
 * the timestamps of the version it keeps), becomes a Firestore `Timestamp`, so a document read back validates with
 * the same schema; `undefined` fields are left out (an absent optional field), every other value is kept as it is.
 */
function toFirestoreValue(value: unknown): unknown {
    if (isList(value)) {
        return value.map(toFirestoreValue);
    }
    if (isTimestampLike(value)) {
        return new Timestamp(value.seconds, value.nanoseconds);
    }
    return isPlainObject(value) ? toFirestoreMap(value) : value;
}

/** `data` once its schema accepts it: nothing a schema refuses ever reaches Firestore (the Admin SDK skips the rules). */
function checked<T>(path: string, schema: Schema<T>, data: unknown): T {
    const result = validate(schema, data);
    if (!result.ok) {
        throw new InvalidDocumentError(path, result.issues);
    }
    return result.value;
}

/** A Firestore document is a map: a schema of anything else is a programming error, refused before any write. */
function toDocument<T>(path: string, schema: Schema<T>, data: T): DocumentData {
    const value = checked(path, schema, data);
    if (!isPlainObject(value)) {
        throw new TypeError(`${path}: a Firestore document must be an object`);
    }
    return toFirestoreMap(value);
}

function readDocument<T>(snapshot: DocumentSnapshot, schema: Schema<T>): T | undefined {
    return snapshot.exists ? checked(snapshot.ref.path, schema, snapshot.data()) : undefined;
}

/** A `create` (direct or in a transaction) that found the document is an `UpstreamError` `conflict`. */
function rethrowConflict(error: unknown): never {
    if (isRecord(error) && error['code'] === ALREADY_EXISTS) {
        throw new UpstreamError('firestore', 'conflict', { status: 409 });
    }
    throw error;
}

/**
 * A filter's operand is converted as a stored value is (a `TimestampLike` becomes a Firestore `Timestamp`): Firestore
 * compares a range only within one type, so a plain `{seconds, nanoseconds}` map never matched a stored timestamp
 * (CR-M4-11: M3's daily job cap counted nothing on the emulator).
 */
function buildQuery(collection: Query, options: QueryOptions): Query {
    const filtered = (options.where ?? []).reduce<Query>(
        (query, [field, operator, value]) => query.where(field, operator, toFirestoreValue(value)),
        collection,
    );
    const ordered = options.orderBy === undefined ? filtered : filtered.orderBy(options.orderBy[0], options.orderBy[1]);
    return options.limit === undefined ? ordered : ordered.limit(options.limit);
}

/** Runs a synchronous transaction write so that a refused document rejects, as the port promises. */
function settled(write: () => void): Promise<void> {
    return new Promise((resolve) => {
        write();
        resolve();
    });
}

/** Firestore's update time as `worker.step` answers it: `<seconds>.<9-digit nanoseconds>` (M7). */
export function formatUpdateTime(time: { readonly seconds: number; readonly nanoseconds: number }): string {
    return `${String(time.seconds)}.${String(time.nanoseconds).padStart(9, '0')}`;
}

/** The document with its update time, or undefined when there is none (a snapshot that exists always has one). */
function readVersioned<T>(snapshot: DocumentSnapshot, schema: Schema<T>): { data: T; updateTime: string } | undefined {
    const data = readDocument(snapshot, schema);
    return data === undefined || snapshot.updateTime === undefined
        ? undefined
        : { data, updateTime: formatUpdateTime(snapshot.updateTime) };
}

function transactionOf(db: Firestore, transaction: Transaction): DocumentTransaction {
    return {
        get: async (path, schema) => readDocument(await transaction.get(db.doc(path)), schema),
        getVersioned: async (path, schema) => readVersioned(await transaction.get(db.doc(path)), schema),
        create: (path, schema, data) => settled(() => transaction.create(db.doc(path), toDocument(path, schema, data))),
        set: (path, schema, data) => settled(() => transaction.set(db.doc(path), toDocument(path, schema, data))),
        delete: (path) => settled(() => transaction.delete(db.doc(path))),
    };
}

/**
 * The `DocumentStore` port on the Firebase Admin SDK (`docs/research/M2-interfaces.md` §4): every write is validated
 * with its shared zod schema first, every read is validated before a handler sees it (an invalid stored document is an
 * `InvalidDocumentError`, never data), timestamps are stored as Firestore timestamps. Paths are full document or
 * collection paths (`FIRESTORE_PATHS`); a query orders by the document id with the field `__name__`, ascending only
 * (the Firestore emulator refuses descending key scans).
 */
export function createDocumentStore(db: Firestore): DocumentStore {
    return {
        get: async (path, schema) => readDocument(await db.doc(path).get(), schema),
        create: async (path, schema, data) => {
            await db
                .doc(path)
                .create(toDocument(path, schema, data))
                .catch(rethrowConflict);
        },
        set: async (path, schema, data) => {
            await db.doc(path).set(toDocument(path, schema, data));
        },
        delete: async (path) => {
            await db.doc(path).delete();
        },
        query: async (collectionPath, schema, options = {}) => {
            const snapshot = await buildQuery(db.collection(collectionPath), options).get();
            const results = snapshot.docs.map((document) => ({ document, result: validate(schema, document.data()) }));
            return {
                documents: results.flatMap(({ document, result }) =>
                    result.ok ? [{ id: document.id, path: document.ref.path, data: result.value }] : [],
                ),
                invalid: results.flatMap(({ document, result }) =>
                    result.ok ? [] : [{ id: document.id, path: document.ref.path, issues: result.issues }],
                ),
            };
        },
        count: async (collectionPath, where = []) => {
            const snapshot = await buildQuery(db.collection(collectionPath), { where }).count().get();
            return snapshot.data().count;
        },
        transaction: (work) => db.runTransaction((transaction) => work(transactionOf(db, transaction))).catch(rethrowConflict),
    };
}
