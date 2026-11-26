/**
 * Building blocks of every Firestore document schema (`firestore.ts`: the content documents, `firestore-ops.ts`: the
 * operational ones): the timestamp both Firestore SDKs return, uids and writer identities, hashes and the audit stamp
 * every document carries (M2: "every document audited").
 */
import { z } from 'zod';

import { coded } from './primitives.js';

/** What both Firestore SDKs' `Timestamp` expose (plain getters; the class itself is SDK-specific). */
export interface TimestampLike {
    readonly seconds: number;
    readonly nanoseconds: number;
}

function isTimestampLike(value: unknown): value is TimestampLike {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Partial<TimestampLike>).seconds === 'number' &&
        typeof (value as Partial<TimestampLike>).nanoseconds === 'number'
    );
}

export const timestampSchema = z.custom<TimestampLike>(isTimestampLike, coded('validation.type'));

const MS_PER_SECOND = 1000;
const NS_PER_MS = 1_000_000;

/**
 * A `Date` as a plain timestamp: what handlers write (the Firestore adapter turns it into the SDK's `Timestamp`, which
 * has the same two fields, so a document read back validates with the same schema).
 */
export function timestampFromDate(date: Date): TimestampLike {
    const ms = date.getTime();
    const seconds = Math.floor(ms / MS_PER_SECOND);
    return { seconds, nanoseconds: (ms - seconds * MS_PER_SECOND) * NS_PER_MS };
}

/** The timestamp as a `Date` (millisecond precision, like every `Date`). */
export function timestampToDate(value: TimestampLike): Date {
    return new Date(value.seconds * MS_PER_SECOND + Math.floor(value.nanoseconds / NS_PER_MS));
}

/** A Firebase Auth uid, or a server writer's identity (`system:<writer>`, see {@link systemWriter}). */
export const uidSchema = z.string().min(1).max(128);

/** A lowercase hex SHA-256 digest (image hashes, invitation ids). */
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** The server writers that stamp documents: functions families, the raster pipeline, the bootstrap script. */
export const SYSTEM_WRITERS = [
    'admins',
    /** M4: the assists (the geocoding cache, the AI usage counters). */
    'assist',
    'bootstrap',
    /** M5: `cities.create`, `cities.setLimits`, the memberships on the admins' documents. */
    'cities',
    /** M5: the static export's records (`export.start`, `export.build`). */
    'export',
    'history',
    'imagery',
    /** M4: the notification fan-out (inbox items, push records). */
    'notify',
    'ops',
    'photos',
    'pipeline',
    'publish',
    'setup',
    'telemetry',
] as const;

export type SystemWriter = (typeof SYSTEM_WRITERS)[number];

/** The `updatedBy` of a server write: `system:<writer>`, never a uid (a uid never contains a colon). */
export function systemWriter(writer: SystemWriter): `system:${SystemWriter}` {
    return `system:${writer}`;
}

/**
 * Who last wrote a document, and when. A client write stamps its uid and `serverTimestamp()` (the rules check both);
 * a server writer stamps {@link systemWriter} and its clock, or the admin it acts for (a callable writes the caller's
 * uid). Every Firestore document of the project carries it.
 */
export const stamp = { updatedBy: uidSchema, updatedAt: timestampSchema };
