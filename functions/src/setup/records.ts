import {
    FIRESTORE_PATHS,
    cityDocSchema,
    setupStatusDocSchema,
    setupStatusReadSchema,
    timestampFromDate,
    type CityDoc,
    type SetupStatusDoc,
    type TimestampLike,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentStore } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

/**
 * Reading and writing the documents the Setup Assistant changes: `setup/status` (one record per area, written whole in
 * a transaction so a save never clobbers another area) and `cities/{city}` (only its server-owned `mapbox` and
 * `analytics`). Every write carries the stamp of who made it (`updatedBy`/`updatedAt`, M2-interfaces §2.2).
 */
/** `setup/status` without its stamp: what a change computes. */
export type SetupStatusFields = Omit<SetupStatusDoc, 'updatedBy' | 'updatedAt'>;

/** Who writes and when: the calling admin's uid (or a `system:` writer) and the handler's clock. */
export interface Stamp {
    readonly updatedBy: string;
    readonly updatedAt: TimestampLike;
}

export function stampOf(updatedBy: string, deps: Pick<Ports, 'clock'>): Stamp {
    return { updatedBy, updatedAt: timestampFromDate(deps.clock.now()) };
}

/** The city, or `apiError.notFound` before anything else happens. */
export async function requireCity(documents: DocumentStore, cityId: string): Promise<CityDoc> {
    const city = await documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    if (city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return city;
}

/**
 * `setup/status` for a writer to build on: each area validated strictly, and one its schema refuses read as absent
 * (`setupStatusReadSchema`), so the write that follows leaves it out instead of every Setup write failing on it.
 */
export function readSetupStatus(reader: Pick<DocumentStore, 'get'>): Promise<SetupStatusDoc | undefined> {
    return reader.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema);
}

type StatusChange = (current: SetupStatusFields) => SetupStatusFields;
type CityChange = (current: CityDoc) => Omit<CityDoc, 'updatedBy' | 'updatedAt'>;

/** Writes `setup/status` as `change` makes it from the current document, stamped, in a transaction. */
export function commitStatus(documents: DocumentStore, stamp: Stamp, change: StatusChange): Promise<SetupStatusDoc> {
    return documents.transaction(async (transaction) => {
        const next: SetupStatusDoc = { ...change((await readSetupStatus(transaction)) ?? {}), ...stamp };
        await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, next);
        return next;
    });
}

/**
 * Writes the city (which must still exist) and `setup/status` together, both stamped, in one transaction: both reads
 * first, as Firestore requires, then both writes. The status change also sees the city as it was before the change.
 */
export function commitCityAndStatus(
    documents: DocumentStore,
    stamp: Stamp,
    cityId: string,
    changes: { readonly city: CityChange; readonly status: (current: SetupStatusFields, city: CityDoc) => SetupStatusFields },
): Promise<{ readonly city: CityDoc; readonly status: SetupStatusDoc }> {
    const path = FIRESTORE_PATHS.city(cityId);
    return documents.transaction(async (transaction) => {
        const city = await transaction.get(path, cityDocSchema);
        const status = (await readSetupStatus(transaction)) ?? {};
        if (city === undefined) {
            throw new ApiError('apiError.notFound');
        }
        const next = { city: { ...changes.city(city), ...stamp }, status: { ...changes.status(status, city), ...stamp } };
        await transaction.set(path, cityDocSchema, next.city);
        await transaction.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, next.status);
        return next;
    });
}

/** `secretsRev` + 1: every instance drops its cached secrets on its next read. */
export function nextSecretsRev(current: SetupStatusFields): number {
    return (current.secretsRev ?? 0) + 1;
}

/** An area without its failure reason, for a check that passed (or a new failure that brings its own). */
export function withoutReason<T extends object>(area: T): Omit<T, 'detail' | 'params'> {
    return Object.fromEntries(Object.entries(area).filter(([key]) => key !== 'detail' && key !== 'params')) as Omit<T, 'detail' | 'params'>;
}

/** States in which an area holds a working (or approved-pending) configuration that a failed attempt must not hide. */
export function holdsConfiguration(area: { readonly state: string } | undefined): boolean {
    return area?.state === 'ok' || area?.state === 'pending';
}

/** `{[key]: value}`, or nothing when the value is undefined (an optional field stays absent, never `undefined`). */
export function defined<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
    return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
