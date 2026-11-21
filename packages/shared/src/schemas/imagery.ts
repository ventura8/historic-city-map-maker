/**
 * The M3 raster work as stored (`docs/research/M3-interfaces.md` §4, §6): a **layer version** is one georeferenced
 * rendition of a scan on its way to a layer (`cities/{city}/layerVersions/{version}`, its id the id of the job that made
 * it), the parameters of each job type, and the steps each job type runs. A layer document exists only once a version
 * is published (or a tileset is linked); until then the version and its job are what the admin sees.
 */
import { z } from 'zod';

import { apiErrorCodeSchema, apiErrorParamsSchema } from '../api/errors.js';
import { layerDeleteParamsSchema } from '../api/layers.js';
import { gcpSuggestionsSchema } from './autogcp.js';
import { archiveReportSchema, archiveSeriesParamsSchema, archiveSourceSchema, helpItemSchema, rightsSchema } from './imagery-archive.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { JOB_MACHINES, type JobType } from './firestore-ops.js';
import { LAYER_TILESET_ORIGINS, USGS_DATASETS } from './firestore.js';
import { cropRingSchema, georefSchema, MAX_SCAN_PIXELS } from './georef.js';
import { calibrationSchema, measuredOutlineSchema } from './imagery-calibration.js';
import { joinReportSchema, joinSourceSchema, layerJoinParamsSchema } from './imagery-join.js';
import { recalibrationSchema } from './imagery-recalibration.js';
import { landsatReportSchema } from './landsat.js';
import {
    boundsRecordSchema,
    coded,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    localizedPartial,
    plainText,
    yearSchema,
    zoomSchema,
} from './primitives.js';
import { SENSORS } from './usgs-scene.js';

/**
 * Where a version stands. `processing`: its job runs; `needs_gcps`: the scan waits for the admin's points
 * (georeferencer); `awaiting_approval`: rendered, waits for Approve (or for a compute-unit choice); `approved`: queued to
 * publish; `publishing`: at Mapbox; `published`: the layer shows it; `rejected`, `superseded` (a newer one was published),
 * `failed`, `cancelled`: ended. M8 (`docs/research/M8-join-interfaces.md`): `joined`: a frame now shown through the published
 * join of its date (`partOf`), its files kept for that join's layer.
 */
export const LAYER_VERSION_STATES = [
    'processing',
    'needs_gcps',
    'awaiting_approval',
    'approved',
    'publishing',
    'published',
    'rejected',
    'superseded',
    'failed',
    'cancelled',
    'joined',
] as const;

export type LayerVersionState = (typeof LAYER_VERSION_STATES)[number];

/** States a version never leaves. */
export const ENDED_VERSION_STATES = ['published', 'rejected', 'superseded', 'failed', 'cancelled', 'joined'] as const;

/**
 * What a version was made from: a USGS scene, an uploaded GeoTIFF, new points on an earlier version, a crop of one, joined frames,
 * M20 (`docs/research/M20-import-local.md` §1.2): a series of a local archive, whose sheets are the parts of one version.
 */
export const VERSION_ORIGINS = ['usgs', 'upload', 'regeoref', 'crop', 'join', 'archive'] as const;

/** The compute-unit guard's three ways out when a publish does not fit the month (security review §3.3). */
export const PUBLISH_CHOICES = ['studio', 'defer', 'pay'] as const;

export type PublishChoice = (typeof PUBLISH_CHOICES)[number];

/**
 * The guard's verdict on a version: it fits, it does not fit the month's compute units, the tileset cap is reached,
 * Mapbox refused its file as too large (`apiError.imagery.sourceTooLarge`: only the free Studio upload is left), or (M5,
 * `docs/research/M5-interfaces.md` §1.8) it fits the project's month but not its city's share (`city-over`).
 */
export const GUARD_VERDICTS = ['within', 'over', 'tileset-limit', 'too-large', 'city-over'] as const;

/** Mapbox's processing precisions, by the tiles' maximum zoom (z ≤ 5, ≤ 10, ≤ 16, above). */
export const MTS_PRECISIONS = ['10m', '1m', '30cm', '1cm'] as const;

export type MtsPrecision = (typeof MTS_PRECISIONS)[number];

/** The scan preview's long side in pixels: what the georeferencer shows (`scan-preview.jpg`). */
export const SCAN_PREVIEW_MAX_PX = 4096;

/** The sharper scan's long side (`scan-tiles.bin`): written when the scan is longer than the preview, fetched once the pane zooms past it. */
export const SCAN_DETAIL_MAX_PX = 16384;

/** ... and its area in pixels (the file's size). */
export const SCAN_DETAIL_MAX_PIXELS = 64_000_000;

/** The sharper scan's JPEG tiles are this long a side: the scan pane decodes only the tiles it shows (a whole 16384 px JPEG is about 1 GiB). */
export const SCAN_TILE_PX = 1024;

const pathSchema = z.string().min(1).max(500);

const sourceSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('usgs'),
        entityId: idSchema,
        dataset: z.enum(USGS_DATASETS),
        sensor: z.enum(SENSORS),
        acquisitionDate: isoDateSchema,
    }),
    z.strictObject({
        kind: z.literal('upload'),
        uploadPath: pathSchema,
        originalName: plainText(255).optional(),
        bytes: z.number().int().min(1),
    }),
    joinSourceSchema,
    archiveSourceSchema,
]);

/** The cropped scan in pixel space: the georeferencer's left pane and the input of every later georeferencing. */
const scanSchema = z.strictObject({
    path: pathSchema,
    width: z.number().int().min(1).max(MAX_SCAN_PIXELS),
    height: z.number().int().min(1).max(MAX_SCAN_PIXELS),
    sha256: sha256Schema,
    previewPath: pathSchema,
    /** Preview pixels per scan pixel (at most 1): a GCP's preview position is `pixel × previewScale`. */
    previewScale: z.number().positive().max(1),
    /** The sharper scan (`scan-tiles.bin`, tiles of `SCAN_TILE_PX`, at most `SCAN_DETAIL_MAX_PX` long; absent on a scan no longer than its preview, or older). */
    detailPath: pathSchema.optional(),
    /** Detail pixels per scan pixel (at most 1). */
    detailScale: z.number().positive().max(1).optional(),
});

/**
 * The reference guard's verdicts (M15, pipeline `agreement.py`): `agreed`, enough clear dates placed for a vote and the chosen
 * one within the bound of their consensus; `unchecked`, too few to outvote one another (the least cloudy was taken);
 * `disputed`, every placed date sits beyond the bound.
 */
export const S2_CHECK_STATUSES = ['agreed', 'unchecked', 'disputed'] as const;

/** One clear set the guard compared: its items (a date's mosaic, or dates across an orbit seam), its offset from the consensus. */
const s2CheckSceneSchema = z.strictObject({
    items: z.array(z.string().max(200)).min(1).max(4),
    date: isoDateSchema,
    cloud: z.number().min(0).max(100),
    /** Ground metres east and north of the consensus; absent when the set could not be read or measured. */
    eastM: z.number().optional(),
    northM: z.number().optional(),
    kept: z.boolean(),
});

/** Which clear sets the guard compared, the bound it rejected beyond, and the one the reference was taken from (`chosen`). */
const s2CheckSchema = z
    .strictObject({
        status: z.enum(S2_CHECK_STATUSES),
        boundM: z.number().positive(),
        chosen: z.number().int().min(0),
        scenes: z.array(s2CheckSceneSchema).min(1).max(5),
    })
    .refine((check) => check.chosen < check.scenes.length, { message: 'chosen names no scene', path: ['chosen'] });

/** The reference rasters the pipeline fetched for the window (OSM data drawn as lines, Sentinel-2 L2A true colour). */
const referenceSchema = z.strictObject({
    bounds: boundsRecordSchema,
    osmPath: pathSchema.optional(),
    s2Path: pathSchema.optional(),
    /** The STAC item the Sentinel-2 window came from, and its date. */
    s2Item: z.string().max(200).optional(),
    s2Date: isoDateSchema.optional(),
    s2Check: s2CheckSchema.optional(),
});

/**
 * M12 (`docs/research/M12-own-tiles.md`): the version's own tiles in the private bucket: one PMTiles archive (256 px WebP with alpha),
 * and the small picture the Work list shows.
 */
export const versionTilesSchema = z.strictObject({
    path: pathSchema,
    bytes: z.number().int().min(1),
    count: z.number().int().min(1),
    sha256: sha256Schema,
    thumbPath: pathSchema,
});

export type VersionTiles = z.infer<typeof versionTilesSchema>;

/**
 * What the render produced: the 8-bit COG Mapbox gets (M12: only for a city that publishes through Mapbox, and every version made
 * before M12), the preview the admin sees, the Studio-sized GeoTIFF, the version's own tiles.
 */
const outputSchema = z.strictObject({
    cogPath: pathSchema.optional(),
    cogBytes: z.number().int().min(1).optional(),
    cogSha256: sha256Schema.optional(),
    tiles: versionTilesSchema.optional(),
    /** An EPSG:3857 PNG of the warped layer and its bounds: the admin map's image source before any tiles exist. */
    previewPath: pathSchema,
    bounds: boundsRecordSchema,
    minzoom: zoomSchema,
    maxzoom: zoomSchema,
    /** The area of the warped footprint (inside the crop), km²: what the compute-unit estimate reads. */
    areaKm2: z.number().min(0),
    /** A JPEG-compressed GeoTIFF of at most `STUDIO_MAX_BYTES`, for the free Mapbox Studio upload. */
    studioPath: pathSchema.optional(),
    studioBytes: z.number().int().min(1).optional(),
    /** M9: the share of the city's bounds the render holds, alpha over the whole city; the approval and the join's offer read it. */
    coveragePct: z.number().min(0).max(100).optional(),
    /** M9: the alpha's edge over the city's bounds: a USGS render's `bounds` are the whole window, so the join's plan reads this. */
    outline: measuredOutlineSchema.optional(),
});

const estimateSchema = z.strictObject({
    computeUnits: z.number().min(0),
    precision: z.enum(MTS_PRECISIONS),
    areaKm2: z.number().min(0),
    at: timestampSchema,
});

/** The compute-unit guard on this version: its verdict, and the choice an admin made when it did not fit. */
const guardSchema = z.strictObject({
    verdict: z.enum(GUARD_VERDICTS),
    /** Compute units left this month when it was checked. */
    available: z.number(),
    /** About how many US dollars the overage costs (the "Pay about $X" choice). */
    overageUsd: z.number().min(0).optional(),
    choice: z.enum(PUBLISH_CHOICES).optional(),
    chosenBy: uidSchema.optional(),
    chosenAt: timestampSchema.optional(),
    /** A deferred publish runs at this time (the first day of next month, UTC). */
    deferUntil: timestampSchema.optional(),
    checkedAt: timestampSchema,
});

const approvalSchema = z.strictObject({
    /** True when the policy approved it (auto-publish under the threshold); `by` is then `system:imagery`. */
    auto: z.boolean(),
    by: uidSchema,
    at: timestampSchema,
    checkpointRmseM: z.number().min(0).optional(),
    thresholdM: z.number().min(0).optional(),
});

/** M7: how a version reached Mapbox: the Uploads API (no compute units), MTS behind the guard, or the admin's Studio upload. */
export const PUBLISH_PATHS = ['uploads', 'mts', 'studio'] as const;

const mapboxSchema = z.strictObject({
    tilesetId: z.string().max(100),
    sourceId: z.string().max(100).optional(),
    jobId: z.string().max(100).optional(),
    origin: z.enum(LAYER_TILESET_ORIGINS),
    /** km² processed per precision, as the MTS job reports it (`tileset_precisions`): the estimate's calibration. */
    precisions: z.record(z.enum(MTS_PRECISIONS), z.number().min(0)).optional(),
    publishedAt: timestampSchema.optional(),
    /** M7 (`docs/research/M7-local-worker.md` §6): the path that published it. */
    via: z.enum(PUBLISH_PATHS).optional(),
});

/**
 * M12: where a version published without Mapbox lies: the object in the public bucket and its address. `removedAt`: a superseded
 * version's object was deleted after its grace (`imagery.tick`), so nothing may point at it again.
 */
const ownTilesSchema = z.strictObject({
    path: pathSchema,
    url: httpsUrlSchema,
    bytes: z.number().int().min(1),
    publishedAt: timestampSchema,
    removedAt: timestampSchema.optional(),
});

/** The fields a version must carry in each state (beyond the always-required ones). */
const REQUIRED_BY_STATE: Readonly<Record<LayerVersionState, readonly ('scan' | 'georef' | 'output' | 'approval' | 'error')[]>> = {
    processing: [],
    needs_gcps: ['scan'],
    awaiting_approval: ['output'],
    approved: ['output', 'approval'],
    publishing: ['output', 'approval'],
    published: ['output'],
    rejected: [],
    superseded: ['output'],
    failed: ['error'],
    cancelled: [],
    joined: ['output'],
};

/** The states whose tiles exist somewhere: at Mapbox (`mapbox`), or in the public bucket (M12: `own`). */
const TILES_STATES: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'superseded']);

/**
 * M20 (`docs/research/M20-import-local.md` §4): an archive series is many scans, so one waiting for a person has no `scan`; it says why it
 * waits (`help`) instead.
 */
function requiredOf(version: { readonly state: LayerVersionState } & Partial<Record<string, unknown>>): readonly string[] {
    return version['origin'] === 'archive' && version.state === 'needs_gcps' ? ['help'] : REQUIRED_BY_STATE[version.state];
}

function hasStateFields(version: { readonly state: LayerVersionState } & Partial<Record<string, unknown>>): boolean {
    const tilesKnown = !TILES_STATES.has(version.state) || version['mapbox'] !== undefined || version['own'] !== undefined;
    return tilesKnown && requiredOf(version).every((field) => version[field] !== undefined);
}

/**
 * A layer version's fields, without the rule of which ones each state needs: what `layerVersionReadSchema` keeps of a record the full schema
 * refuses (`legacy-reads.ts`).
 */
export const layerVersionFieldsSchema = z.strictObject({
    /** The layer it renders: an existing one (re-georeference, crop, replace) or the id reserved at Import. */
    layerId: idSchema,
    /** The job that made it; the version's id is the same. */
    jobId: idSchema,
    origin: z.enum(VERSION_ORIGINS),
    /** The version whose scan it reuses (`regeoref`, `crop`). */
    basedOn: idSchema.optional(),
    state: z.enum(LAYER_VERSION_STATES),
    source: sourceSchema.optional(),
    /** What a new layer gets at its first publish. */
    label: localizedPartial(200),
    year: yearSchema,
    date: isoDateSchema.optional(),
    sensor: z.enum(SENSORS).optional(),
    scan: scanSchema.optional(),
    reference: referenceSchema.optional(),
    georef: georefSchema.optional(),
    /** M9: how `locate` found the frame and what proved it, or why nothing did (`georef` adds its own figures). */
    calibration: calibrationSchema.optional(),
    /** M4: the matcher's pairs below the confidence, for the georeferencer's Accept (never in the fit until saved). */
    suggestions: gcpSuggestionsSchema.optional(),
    crop: cropRingSchema.optional(),
    output: outputSchema.optional(),
    estimate: estimateSchema.optional(),
    guard: guardSchema.optional(),
    approval: approvalSchema.optional(),
    mapbox: mapboxSchema.optional(),
    /** M12: published from the project's own bucket, no Mapbox involved. */
    own: ownTilesSchema.optional(),
    /** Finding 56: the Cloud Run job each phase of its making ran on (`download`: fetch and extract; `process`: the rest). */
    machines: z.strictObject({ download: z.enum(JOB_MACHINES).optional(), process: z.enum(JOB_MACHINES).optional() }).optional(),
    error: z.strictObject({ code: apiErrorCodeSchema, params: apiErrorParamsSchema.optional() }).optional(),
    /** M8: the join version that holds this frame while it is live; a stale one (the join ended) is ignored. */
    partOf: idSchema.optional(),
    /** M16: a recalibration of the version it is `basedOn`, with the two fits measured on the same checks. */
    recalibration: recalibrationSchema.optional(),
    /**
     * M16 (§5): the Refine or Snap started from this version while it waits for approval. A second start, or a Save, finds that job
     * unfinished in its transaction and is `apiError.layers.busy`; a stale one (the refine ended) is ignored.
     */
    refining: idSchema.optional(),
    /** M8: what the join measured; a join version has no `scan` and no `georef` (`georefSchema` means one scan's pixels). */
    join: joinReportSchema.optional(),
    /** M20 (§4): what the placement of an archive series measured; such a version has no `scan` and no `georef`. */
    archive: archiveReportSchema.optional(),
    /** M25: what `warp` measured of a Landsat scene (its shift against Sentinel-2, the city's cloud); such a version has no `georef`. */
    landsat: landsatReportSchema.optional(),
    /** M20 (§7): the series' rights; nothing publishes the version until they allow it (`rightsAllowPublish`). */
    rights: rightsSchema.optional(),
    /** The owner's standing rule (2026-11-09): why it waits for a person, for the shared "Help calibrate" queue. */
    help: helpItemSchema.optional(),
    createdBy: uidSchema,
    createdAt: timestampSchema,
    ...stamp,
});

/** `cities/{city}/layerVersions/{version}`: written by the imagery callables, the pipeline and the publisher only. */
export const layerVersionDocSchema = layerVersionFieldsSchema.refine(hasStateFields, coded('validation.required', ['state']));

export type LayerVersionDoc = z.infer<typeof layerVersionDocSchema>;

/** `usgs-import`: the scene to fetch (the layer is the job's `layerId`). */
export const usgsImportParamsSchema = z.strictObject({ entityId: idSchema, dataset: z.enum(USGS_DATASETS), sensor: z.enum(SENSORS) });

/** `geotiff-import`: the uploaded file; `replaces` when it replaces the image of the job's existing layer. */
export const geotiffImportParamsSchema = z.strictObject({
    uploadPath: pathSchema,
    originalName: plainText(255).optional(),
    replaces: z.boolean(),
});

/** `regeoref`: the version whose scan it renders again; the points and the crop are in its own version document. */
export const regeorefParamsSchema = z.strictObject({ basedOn: idSchema });

/** `republish`: an approved version to publish again (after a Mapbox failure, or a deferral). */
export const republishParamsSchema = z.strictObject({ versionId: idSchema });

/** M12: `layer-tiles`: the version, rendered before M12 and so without tiles, to make them for from its COG. */
export const layerTilesParamsSchema = z.strictObject({ versionId: idSchema });

/** The `params` schema of each job type: the dispatcher and the pipeline refuse a job whose params fail it. */
export const JOB_PARAMS_SCHEMAS: Readonly<Record<JobType, z.ZodType>> = {
    'usgs-import': usgsImportParamsSchema,
    'geotiff-import': geotiffImportParamsSchema,
    regeoref: regeorefParamsSchema,
    republish: republishParamsSchema,
    'layer-delete': layerDeleteParamsSchema,
    'layer-join': layerJoinParamsSchema,
    'layer-tiles': layerTilesParamsSchema,
    'archive-series': archiveSeriesParamsSchema,
};

/** The steps the raster pipeline runs (`pipeline/src/hcm_pipeline/steps/<step>.py`), in this order when a type has them. */
export const PIPELINE_STEPS = [
    // M20 (docs/research/M20-import-local.md §4): an archive series' originals checked on the owner's computer.
    'gather',
    'fetch',
    'extract',
    'stitch',
    'inspect',
    'locate',
    // M20: an archive series placed by the path of its class, or parked for points with a one-line reason.
    'place',
    'reference',
    'georef',
    'align',
    'merge',
    'warp',
    'export',
    // M12: the version's own tiles (a publish step is already called `tiles`: MTS at work).
    'pyramid',
    'register',
] as const;

/**
 * An import's download phase (finding 56 of 2026-11-01): network-bound steps the small `fetch` job runs; the job is then
 * queued again and its processing runs on `std` (or `xl`). A job a larger machine runs from the start runs both phases.
 */
export const DOWNLOAD_STEPS = ['fetch', 'extract'] as const;

/** The steps the publisher runs (functions, `imagery.publish`), after approval. */
export const PUBLISH_STEPS = ['guard', 'upload', 'publish', 'tiles', 'finalize'] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type PublishStep = (typeof PUBLISH_STEPS)[number];
export type JobStep = PipelineStep | PublishStep | 'delete';

/** Each job type's steps in order: the keys of the job's `steps`, which the Jobs page lists. */
export const JOB_STEPS: Readonly<Record<JobType, readonly JobStep[]>> = {
    'usgs-import': [
        'fetch',
        'extract',
        'stitch',
        'locate',
        'reference',
        'georef',
        'warp',
        'export',
        'pyramid',
        'register',
        ...PUBLISH_STEPS,
    ],
    'geotiff-import': ['inspect', 'reference', 'georef', 'warp', 'export', 'pyramid', 'register', ...PUBLISH_STEPS],
    regeoref: ['georef', 'warp', 'export', 'pyramid', 'register', ...PUBLISH_STEPS],
    republish: [...PUBLISH_STEPS],
    'layer-delete': ['delete'],
    // M8: `merge` writes the same `warped.tif` a `warp` does, so `export` and `register` run unchanged.
    'layer-join': ['align', 'merge', 'export', 'pyramid', 'register', ...PUBLISH_STEPS],
    // M12: tiles for a version rendered before them; the version keeps its state, whatever this job does.
    'layer-tiles': ['pyramid'],
    // M20 (§4): the originals never leave the computer; `place` writes the `warped.tif` the shared tail reads.
    'archive-series': ['gather', 'place', 'export', 'pyramid', 'register', ...PUBLISH_STEPS],
};

/** M12: the job types that work beside a version and never decide its state: their failure or cancellation leaves it where it stands. */
export const SIDE_JOB_TYPES: readonly JobType[] = ['layer-tiles'];

export function isSideJob(type: JobType): boolean {
    return SIDE_JOB_TYPES.includes(type);
}

/** True for the job types the Cloud Run pipeline runs (the others run in functions). */
export function runsOnPipeline(type: JobType): boolean {
    return JOB_STEPS[type].some((step) => (PIPELINE_STEPS as readonly string[]).includes(step));
}
