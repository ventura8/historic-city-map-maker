/**
 * Where the raster work lives in the private bucket (`docs/research/M3-interfaces.md` §4.6): uploads, USGS deliveries,
 * browse copies, a job's scratch files, each layer version's files and the reference cache, with the lifecycle that
 * cleans them. The raster pipeline spells the same paths (`hcm_pipeline.paths`), held equal by
 * `pipeline/tests/contracts/paths.json`. Nothing here is public: a published version's tiles are copied to the public bucket
 * (M12: `STORAGE_PATHS.layerTiles`) or live at Mapbox, previews are read by admins through the Storage SDK or a signed address.
 */
import { USGS_DATASETS } from './firestore.js';
import { CITY_ID_PATTERN } from './paths.js';
import { isId } from './primitives.js';

/** An uploaded raster's name: a client nonce and a TIFF extension (the bytes decide, `imagery.onRasterUpload` sniffs). */
export const RASTER_UPLOAD_FILE_PATTERN = /^[A-Za-z0-9_-]{8,64}\.tiff?$/;

/** The largest raster an admin may upload (`firebase/storage.rules`: under 8 GiB). */
export const RASTER_UPLOAD_MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** A USGS delivery's file name as it arrives (`DS1105-1071DF075.tgz`): letters, digits, `_`, `.`, `-`, no `..`. */
const DELIVERY_FILE = /^\w[\w.-]{0,99}$/;

/** A scratch file of a job (`segments/a.tif`, `fetch.checkpoint.json`): one or two plain segments. */
const WORK_FILE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99})?$/;

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const REFERENCE_KEY = /^[a-f0-9]{8,64}$/;

/** The files of one layer version, by their fixed names. */
export const VERSION_FILES = [
    'scan.tif',
    'scan-preview.jpg',
    'reference-osm.png',
    'reference-s2.jpg',
    'cog.tif',
    'preview.png',
    'studio.tif',
    // M12 (docs/research/M12-own-tiles.md): the version's own tiles, private until it publishes, and the Work list's picture.
    'tiles.pmtiles',
    'thumb.webp',
    /** M15: a proved frame at 5 m on the ground, what a later frame's film ties are measured against (`steps/aligning.py`). */
    'align.tif',
    /** M22 (§4.1): an archive series that waits for a person, its sheets stitched into one picture, the Help calibrate wizard's. */
    'stitched.jpg',
    /** The scan at up to `SCAN_DETAIL_MAX_PX` long as JPEG tiles in one file: the georeferencer's sharper scan (2026-11-12). */
    'scan-tiles.bin',
    /** The tile layout of an archive series (`imagery-tiles.ts`): every sheet and seam, the sheets' thumbnails, the weak seams' strips. */
    'layout.json',
    'thumbs.jpg',
    'seams.jpg',
] as const;

export type VersionFile = (typeof VERSION_FILES)[number];

/** The reference rasters the pipeline caches per city and window. */
export const REFERENCE_KINDS = ['s2', 'osm', 'dem'] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

function segment(value: string, valid: (candidate: string) => boolean): string {
    if (!valid(value) || value.includes('..')) {
        throw new RangeError(`not a valid path segment: ${JSON.stringify(value)}`);
    }
    return value;
}

const matching = (pattern: RegExp) => (value: string) => pattern.test(value);
const city = (cityId: string): string => segment(cityId, matching(CITY_ID_PATTERN));
const id = (value: string): string => segment(value, isId);
const dataset = (value: string): string => segment(value, (name) => (USGS_DATASETS as readonly string[]).includes(name));

/** Every raster object path of the private bucket. */
export const RASTER_PATHS = {
    /** Written by the admin client (Storage rules: own uid, under 8 GiB); `{upload}` is the job id the trigger creates. */
    upload: (cityId: string, uid: string, uploadId: string, fileName: string) =>
        [
            'uploads/rasters',
            city(cityId),
            segment(uid, matching(UID_PATTERN)),
            id(uploadId),
            segment(fileName, matching(RASTER_UPLOAD_FILE_PATTERN)),
        ].join('/'),
    /** A USGS delivery, shared by every city that imports the scene (deleted by `locate` once the crop exists; lifecycle: 7 days). */
    usgsRaw: (datasetName: string, entityId: string, fileName: string) =>
        ['usgs-raw', dataset(datasetName), id(entityId), segment(fileName, matching(DELIVERY_FILE))].join('/'),
    /** The browse copy the admin previews (kept: a few hundred KB per scene). */
    browse: (datasetName: string, entityId: string) => `usgs-browse/${dataset(datasetName)}/${id(entityId)}.jpg`,
    /** A job's scratch files: segments, the stitched frame, checkpoints (lifecycle: 14 days). */
    work: (cityId: string, jobId: string, name: string) => ['work', city(cityId), id(jobId), segment(name, matching(WORK_FILE))].join('/'),
    /** One of a layer version's files (kept while the version is current or pending; ended versions are swept). */
    version: (cityId: string, layerId: string, versionId: string, file: VersionFile) =>
        ['rasters', city(cityId), id(layerId), id(versionId), file].join('/'),
    /** The reference cache: a Sentinel-2 window or a surface model (GeoTIFF), or OSM features (GeoJSON), by window key (lifecycle: 90 days). */
    reference: (cityId: string, kind: ReferenceKind, key: string) =>
        `reference/${city(cityId)}/${kind}/${segment(key, matching(REFERENCE_KEY))}.${kind === 'osm' ? 'geojson' : 'tif'}`,
} as const;

/** Where a version's own tiles lie: the archive and the picture, each a path a document records. */
export interface VersionTilesPaths {
    readonly path: string;
    readonly thumbPath: string;
}

/**
 * M12: true when a version's recorded tiles are its own files, in its own folder under their fixed names. A path a document holds is
 * written by a worker, so the server copies, signs or deletes only these (a path into another city's or version's folder grants nothing).
 */
export function isOwnTiles(cityId: string, layerId: string, versionId: string, tiles: VersionTilesPaths): boolean {
    const file = (name: VersionFile): string => ['rasters', cityId, layerId, versionId, name].join('/');
    return tiles.path === file('tiles.pmtiles') && tiles.thumbPath === file('thumb.webp');
}

/**
 * The private bucket's lifecycle (the provisioner's `bucket-lifecycle` item applies it): age in days after which an
 * object under each prefix is deleted.
 */
export const PRIVATE_BUCKET_LIFECYCLE: readonly { readonly prefix: string; readonly days: number }[] = [
    { prefix: 'tmp/', days: 1 },
    { prefix: 'uploads/', days: 7 },
    // A dismissal or a rejection deletes its job's folder at once (`functions/src/imagery/work-files.ts`): this is the backstop.
    { prefix: 'work/', days: 14 },
    // M7 (docs/research/M7-local-worker.md §5): `locate` deletes the delivery once the city's crop exists; this is the backstop.
    { prefix: 'usgs-raw/', days: 7 },
    { prefix: 'reference/', days: 90 },
    // M5 (CR-M5-8): a city's static export, `EXPORT_LIMITS.ttlDays` after it was built (its record says expired by then).
    { prefix: 'exports/', days: 7 },
];

/** The parts of a raster upload's path (the `imagery.onRasterUpload` trigger reads them from the object's name). */
export interface RasterUpload {
    readonly cityId: string;
    readonly uid: string;
    readonly uploadId: string;
    readonly fileName: string;
}

function validRasterUpload(upload: RasterUpload): boolean {
    return [
        CITY_ID_PATTERN.test(upload.cityId),
        UID_PATTERN.test(upload.uid),
        isId(upload.uploadId),
        RASTER_UPLOAD_FILE_PATTERN.test(upload.fileName),
    ].every(Boolean);
}

type Sextet = readonly [string, string, string, string, string, string];

function isSextet(parts: readonly string[]): parts is Sextet {
    return parts.length === 6;
}

function uploadOf([uploads, rasters, cityId, uid, uploadId, fileName]: Sextet): RasterUpload | undefined {
    const upload = { cityId, uid, uploadId, fileName };
    return uploads === 'uploads' && rasters === 'rasters' && validRasterUpload(upload) ? upload : undefined;
}

/** The raster upload at `path`, or undefined for any other object. */
export function parseRasterUploadPath(path: string): RasterUpload | undefined {
    const parts = path.split('/');
    return isSextet(parts) ? uploadOf(parts) : undefined;
}
