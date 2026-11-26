/**
 * `ops.tick`'s `exports` step (M5, `docs/research/M5-interfaces.md` §5.3; owner: export): a ready export past its
 * `expiresAt` becomes `expired` and its zip is deleted (the private bucket's lifecycle rule on `exports/` deletes what a
 * missed tick leaves), and an export still queued or building long after its build may run (a crashed task) becomes
 * `failed`, so the city's owners can export again.
 */
import {
    EXPORT_LIMITS,
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityDocSchema,
    cityExportDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type CityExportDoc,
    type TimestampLike,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type ExportsStepDeps = Pick<Ports, 'documents' | 'blobs' | 'log'>;

const MINUTE_MS = 60_000;

/** An open export older than its build's limit plus the queue's delay: its task is gone (as `export.start` sees it). */
const STALE_OPEN_MS = (EXPORT_LIMITS.buildMinutes + 10) * MINUTE_MS;

type Change = Pick<CityExportDoc, 'state'> & Partial<Pick<CityExportDoc, 'error'>>;

const OPEN: ReadonlySet<CityExportDoc['state']> = new Set<CityExportDoc['state']>(['queued', 'building']);

function isPast(time: TimestampLike | undefined, now: Date): boolean {
    return time !== undefined && timestampToDate(time) <= now;
}

/** What the step does to one export now, or null. */
export function exportChange(record: CityExportDoc, now: Date): Change | null {
    if (record.state === 'ready' && isPast(record.expiresAt, now)) {
        return { state: 'expired' };
    }
    if (OPEN.has(record.state) && now.getTime() - timestampToDate(record.createdAt).getTime() >= STALE_OPEN_MS) {
        return { state: 'failed', error: 'apiError.unavailable' };
    }
    return null;
}

async function apply(deps: ExportsStepDeps, cityId: string, stored: StoredDocument<CityExportDoc>, now: Date): Promise<boolean> {
    const change = exportChange(stored.data, now);
    if (change === null) {
        return false;
    }
    await deps.blobs.delete('private', STORAGE_PATHS.cityExport(cityId, stored.id));
    await deps.documents.set(stored.path, cityExportDocSchema, {
        ...stored.data,
        ...change,
        updatedBy: systemWriter('export'),
        updatedAt: timestampFromDate(now),
    });
    return true;
}

async function expireCity(deps: ExportsStepDeps, cityId: string, now: Date): Promise<number> {
    const records = await deps.documents.query(FIRESTORE_PATHS.cityExports(cityId), cityExportDocSchema, {
        where: [['state', 'in', ['queued', 'building', 'ready']]],
    });
    const changed = await Promise.all(records.documents.map((stored) => apply(deps, cityId, stored, now)));
    return changed.filter(Boolean).length;
}

/** Every city's exports (a city document that fails its schema still has exports): returns how many changed. */
export async function expireExports(deps: ExportsStepDeps, now: Date): Promise<number> {
    const cities = await deps.documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    const ids = [...cities.documents, ...cities.invalid].map((city) => city.id);
    const counts = await Promise.all(ids.map((cityId) => expireCity(deps, cityId, now)));
    return counts.reduce((sum, count) => sum + count, 0);
}
