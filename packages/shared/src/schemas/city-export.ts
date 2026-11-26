/**
 * The static export of a city (M5, behaviours A53 and V28; `docs/research/M5-interfaces.md` §5): a zip the city owner
 * downloads that serves the city from any static host with no Firebase at all. It holds the starter kit's page with
 * the engine beside it (no CDN), the published manifest as `city.json` with relative photo addresses and without the
 * project's analytics ids, the photos' public files, a README and the list of photos licensed for this map only, and,
 * when asked, the scans of the layers whose rights allow it (USGS frames: public domain). Layers keep their tile
 * references. `export.build` writes the zip to the private bucket; `export.download` answers a short-lived signed URL.
 */
import { z } from 'zod';

import { apiErrorCodeSchema, apiErrorParamsSchema } from '../api/errors.js';
import { releaseVersionSchema } from './engine-release.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import type { PhotoVariant } from './paths.js';
import { isId } from './primitives.js';

/**
 * Where an export stands: `queued` (the task is enqueued), `building` (the zip is being written), `ready` (it can be
 * downloaded until `expiresAt`), `failed` (with its `error`), `expired` (the object went with the bucket's lifecycle).
 */
export const EXPORT_STATES = ['queued', 'building', 'ready', 'failed', 'expired'] as const;

export type ExportState = (typeof EXPORT_STATES)[number];

/** An export in one of these blocks another of the same city (`apiError.export.busy`). */
export const OPEN_EXPORT_STATES = ['queued', 'building'] as const satisfies readonly ExportState[];

/**
 * `maxBytes` stays under 2 GiB, so the zip needs no ZIP64 records; `ttlDays` is the private bucket's lifecycle rule
 * on `exports/`; the signed download address lives `downloadUrlMinutes`, and an export is signed at most
 * `downloadsPerDay` times a UTC day (each address can be shared, and the project pays the egress: `docs/LESSONS.md`
 * 246); a city may export `perDayDefault` times a day unless its limits say otherwise (at most `perDayMax`); a build
 * that runs longer than `buildMinutes` fails.
 */
export const EXPORT_LIMITS = {
    maxBytes: 2_000_000_000,
    ttlDays: 7,
    downloadUrlMinutes: 15,
    downloadsPerDay: 10,
    perDayDefault: 3,
    perDayMax: 10,
    buildMinutes: 30,
} as const;

/** Photo licences granted for the city's own map only: exported (it is the owner's archive), listed in `RIGHTS.md`. */
export const RESTRICTED_LICENSES = ['permission', 'permission-legacy'] as const;

/** The fixed files and folders of an export, relative to its root (§5.1 of the contract). */
export const EXPORT_LAYOUT = {
    page: 'index.html',
    manifest: 'city.json',
    readme: 'README.md',
    rights: 'RIGHTS.md',
    engineFolder: 'engine',
    photosFolder: 'photos',
    rastersFolder: 'rasters',
    /** M12: a layer's own tiles travel as they are served. */
    tilesFolder: 'tiles',
} as const;

function exportId(value: string): string {
    if (!isId(value)) {
        throw new RangeError(`not an id: ${JSON.stringify(value)}`);
    }
    return value;
}

/** `photos/<photo>/<variant>.webp`: where an exported photo's public file goes, and what `city.json` names. */
export function exportPhotoPath(photoId: string, variant: PhotoVariant, version?: 'improved' | 'colorized'): string {
    const prefix = version === undefined ? '' : version + '-';
    return `${EXPORT_LAYOUT.photosFolder}/${exportId(photoId)}/${prefix}${variant}.webp`;
}

/** `rasters/<layer>.tif`: where a layer's Cloud-Optimized GeoTIFF goes when its rights allow it. */
export function exportRasterPath(layerId: string): string {
    return `${EXPORT_LAYOUT.rastersFolder}/${exportId(layerId)}.tif`;
}

/** M12: `tiles/<layer>.pmtiles`: a layer's own archive when its rights allow it; the export's `city.json` names it relatively. */
export function exportTilesPath(layerId: string): string {
    return `${EXPORT_LAYOUT.tilesFolder}/${exportId(layerId)}.pmtiles`;
}

/** The name the download carries: `<city>-<YYYY-MM-DD>.zip` (the UTC day the export was made). */
export const EXPORT_FILE_NAME_PATTERN = /^[a-z0-9-]{2,32}-\d{4}-\d{2}-\d{2}\.zip$/;

export function exportFileName(cityId: string, madeAt: Date): string {
    return `${cityId}-${madeAt.toISOString().slice(0, 10)}.zip`;
}

/**
 * Whether a layer's scan may travel in an export: only a USGS frame (declassified imagery is in the public domain). An
 * uploaded GeoTIFF or a linked tileset says nothing about its rights, so only its tile reference is exported.
 */
export function rasterExportable(provenance: { readonly usgsEntityId?: string | undefined } | undefined): boolean {
    return provenance?.usgsEntityId !== undefined;
}

/** The photos licensed for this map only (`RESTRICTED_LICENSES`), in manifest order: `RIGHTS.md` lists them. */
export function restrictedPhotoIds(photos: readonly { readonly id: string; readonly license: string }[]): string[] {
    return photos.filter((photo) => (RESTRICTED_LICENSES as readonly string[]).includes(photo.license)).map((photo) => photo.id);
}

const countSchema = z.number().int().min(0).max(100_000);

/** `cities/{city}/exports/{exportId}`: written by `export.start` and `export.build` only (no client rule writes it). */
export const cityExportDocSchema = z.strictObject({
    state: z.enum(EXPORT_STATES),
    /** The city owner who asked. */
    requestedBy: uidSchema,
    /** The layers' scans were asked for (`rasterExportable` ones only). */
    rasters: z.boolean(),
    /** The engine release the zip carries (`ENGINE_VERSION` of the deployed functions' build). */
    engineVersion: releaseVersionSchema,
    createdAt: timestampSchema,
    startedAt: timestampSchema.optional(),
    finishedAt: timestampSchema.optional(),
    /** When the zip goes (`EXPORT_LIMITS.ttlDays` after `finishedAt`). */
    expiresAt: timestampSchema.optional(),
    bytes: z.number().int().min(0).max(EXPORT_LIMITS.maxBytes).optional(),
    /** SHA-256 of the whole zip, shown on the card so a copy can be checked. */
    sha256: sha256Schema.optional(),
    counts: z
        .strictObject({
            photos: countSchema,
            restrictedPhotos: countSchema,
            layers: countSchema,
            rasters: countSchema,
            pois: countSchema,
        })
        .optional(),
    error: apiErrorCodeSchema.optional(),
    /** The parameters of `error`'s message (`apiError.export.tooLarge`: the size the export would have had, and the limit). */
    errorParams: apiErrorParamsSchema.optional(),
    /** How many addresses `export.download` signed on `day` (UTC, `YYYY-MM-DD`): at most `EXPORT_LIMITS.downloadsPerDay`. */
    downloads: z
        .strictObject({
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            count: z.number().int().min(1).max(EXPORT_LIMITS.downloadsPerDay),
        })
        .optional(),
    ...stamp,
});

export type CityExportDoc = z.infer<typeof cityExportDocSchema>;
