/**
 * What the export card shows, pure (M5, `docs/research/M5-interfaces.md` §5.6): the city's latest export as the card
 * reads it (a ready one past its expiry is shown expired before `ops.tick` marks it), whether the signed-in admin owns
 * the city, whether it was ever published, and the USGS scans an export may carry with their size.
 */
import {
    cityRoleOf,
    rasterExportable,
    timestampToDate,
    type AdminDoc,
    type ApiErrorCode,
    type CityExportDoc,
    type ExportState,
    type LayerDoc,
    type LayerVersionDoc,
    type ManifestStateDoc,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { Stored } from '../content/services.js';

export interface ExportRecordItem {
    readonly id: string;
    readonly state: ExportState;
    readonly rasters: boolean;
    readonly bytes: number | null;
    readonly sha256: string | null;
    readonly counts: NonNullable<CityExportDoc['counts']> | null;
    /** ISO: until when the zip can be downloaded. */
    readonly expiresAt: string | null;
    readonly error: { readonly code: ApiErrorCode; readonly params: Readonly<Record<string, string>> } | null;
}

/** The USGS scans an export may carry (`rasterExportable` layers' current COGs) and their total size. */
export interface ExportScans {
    readonly count: number;
    readonly bytes: number;
}

export const NO_SCANS: ExportScans = { count: 0, bytes: 0 };

/** A ready export whose time is up reads as expired at once (its zip goes with the bucket's lifecycle). */
function stateAt(record: CityExportDoc, nowMs: number): ExportState {
    const past = record.expiresAt !== undefined && timestampToDate(record.expiresAt).getTime() <= nowMs;
    return record.state === 'ready' && past ? 'expired' : record.state;
}

function errorOf(record: CityExportDoc): ExportRecordItem['error'] {
    return record.error === undefined ? null : { code: record.error, params: record.errorParams ?? {} };
}

export function exportRecordItem(stored: Stored<CityExportDoc>, nowMs: number): ExportRecordItem {
    const record = stored.data;
    return {
        id: stored.id,
        state: stateAt(record, nowMs),
        rasters: record.rasters,
        bytes: record.bytes ?? null,
        sha256: record.sha256 ?? null,
        counts: record.counts ?? null,
        expiresAt: record.expiresAt === undefined ? null : isoOf(record.expiresAt),
        error: errorOf(record),
    };
}

/** Whether `admin` owns `cityId` (a document without `cities` is from before M5: no role until it is migrated). */
export function ownsCity(admin: AdminDoc | null, cityId: string): boolean {
    return cityRoleOf(admin?.cities, cityId) === 'owner';
}

/** Whether the city has a manifest in the public bucket: its first build wrote one. */
export function wasPublished(state: ManifestStateDoc | null): boolean {
    return state?.url !== undefined;
}

/** The scans of the published USGS layers, from their current versions' COGs. */
export function exportScans(layers: readonly Stored<LayerDoc>[], versions: readonly Stored<LayerVersionDoc>[]): ExportScans {
    const bytesByVersion = new Map(versions.map((version) => [version.id, version.data.output?.cogBytes ?? 0]));
    const sizes = layers
        .filter((layer) => layer.data.published && rasterExportable(layer.data.provenance))
        .map((layer) => bytesByVersion.get(layer.data.currentVersion ?? '') ?? 0)
        .filter((bytes) => bytes > 0);
    return { count: sizes.length, bytes: sizes.reduce((sum, bytes) => sum + bytes, 0) };
}
