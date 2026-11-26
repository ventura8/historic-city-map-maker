import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    jobDocSchema,
    layerDocSchema,
    parseRasterUploadPath,
    rasterUploadMetadataSchema,
    timestampFromDate,
    uploadLabelFor,
    uploadYearOf,
    validate,
    type ApiErrorCode,
    type LayerDoc,
    type RasterUpload,
    type RasterUploadMetadata,
} from '@hcm/shared';
import { onObjectFinalized, type StorageEvent } from 'firebase-functions/storage';
import type { CloudFunction } from 'firebase-functions/v2';

import { ApiError } from '../api/api-error.js';
import { runAs } from '../global-options.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { refuseBusyLayer, refuseNewRasterJob } from './limits.js';
import { isTiff } from './magic.js';
import { IMAGERY_WRITER, pickDefined, stampOf } from './records.js';
import { createWork, reserveLayerId, type NewWork } from './versions.js';

/**
 * `imagery.onRasterUpload` (Storage finalize on the private bucket; `docs/research/M3-interfaces.md` §8.1; S-A14-*): an
 * admin's GeoTIFF under `uploads/rasters/{city}/{uid}/{upload}/` becomes a `geotiff-import` job whose id is the upload
 * id, so the page watches `jobs/{upload}`. The bytes decide, never the name: a file that does not start like a TIFF
 * fails its job with `apiError.imagery.notTiff` and is deleted (S-A14-BAD-SNIFFED-NOT-TIFF). A replacement (metadata
 * `layerId`) keeps the layer's label and year and marks the layer's pending version; a new upload reserves a layer id
 * from its file name. A redelivered event finds the job created and does nothing.
 */
export type RasterUploadDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'reader' | 'blobs'>;

interface Uploaded {
    readonly name: string;
    readonly size: number;
    readonly metadata: Readonly<Record<string, string>>;
}

/** The first bytes the sniff reads (a TIFF header needs four). */
const SNIFF_BYTES = 16;

interface Plan {
    readonly layerId: string;
    readonly label: LayerDoc['label'];
    readonly year: number;
    readonly replaces: boolean;
    /** Where the job runs when the city's choice is `local` (`Placement`). */
    readonly runOn?: 'local';
}

/** Why an upload is refused: an error code and the parameters its text names (`{count}` of an invalid request). */
interface Refusal {
    readonly code: ApiErrorCode;
    readonly params?: Readonly<Record<string, string>> | undefined;
}

/** The job's error: the code, and its parameters when the text needs them (the page fills them in, CR-M3-35 f). */
function jobErrorOf(refusal: Refusal): { code: ApiErrorCode; message: string; params?: Readonly<Record<string, string>> } {
    const { code, params } = refusal;
    return params === undefined ? { code, message: code } : { code, message: code, params };
}

/** A refused upload: its job is created `failed` with the reason (the page reads it there), and the file deleted. */
async function refuse(deps: RasterUploadDeps, upload: RasterUpload, uploaded: Uploaded, refusal: Refusal): Promise<void> {
    const { code } = refusal;
    const now = timestampFromDate(deps.clock.now());
    const job = {
        type: 'geotiff-import' as const,
        status: 'failed' as const,
        params: { uploadPath: uploaded.name, replaces: uploaded.metadata['layerId'] !== undefined },
        createdBy: upload.uid,
        createdAt: now,
        finishedAt: now,
        versionId: upload.uploadId,
        error: jobErrorOf(refusal),
        ...stampOf(IMAGERY_WRITER, deps.clock.now()),
    };
    await deps.documents.create(FIRESTORE_PATHS.job(upload.cityId, upload.uploadId), jobDocSchema, job).catch((error: unknown) => {
        deps.log.warn('refused raster upload not recorded', { cityId: upload.cityId, uploadId: upload.uploadId, error: String(error) });
    });
    await deps.blobs.delete('private', uploaded.name);
    deps.log.warn('raster upload refused', { cityId: upload.cityId, uploadId: upload.uploadId, code });
}

/** A replacement: the layer must exist and be free; the version keeps its label and year. */
async function replacementPlan(deps: RasterUploadDeps, upload: RasterUpload, layerId: string): Promise<Plan> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(upload.cityId, layerId), layerDocSchema);
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    await refuseBusyLayer(deps.documents, upload.cityId, layerId);
    return { layerId, label: layer.label, year: layer.year, replaces: true };
}

/** A new layer: the label and year from the file name and the upload dialog's Year field. */
async function newLayerPlan(deps: RasterUploadDeps, upload: RasterUpload, metadata: RasterUploadMetadata): Promise<Plan> {
    const year = uploadYearOf(metadata.year, metadata.originalName);
    if (year === undefined) {
        // One problem: no year in the dialog nor in the file's name.
        throw new ApiError('apiError.invalidRequest', { count: '1' });
    }
    const label = uploadLabelFor(metadata.originalName, upload.uploadId);
    const layerId = await reserveLayerId(deps.documents, upload.cityId, label.ro);
    return { layerId, label, year, replaces: false };
}

async function planOf(deps: RasterUploadDeps, upload: RasterUpload, metadata: RasterUploadMetadata): Promise<Plan> {
    if ((await deps.documents.get(FIRESTORE_PATHS.city(upload.cityId), cityDocSchema)) === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const placement = await refuseNewRasterJob(deps.documents, deps.clock.now(), upload.cityId);
    const plan = await (metadata.layerId === undefined
        ? newLayerPlan(deps, upload, metadata)
        : replacementPlan(deps, upload, metadata.layerId));
    return { ...plan, ...placement };
}

/** An upload that passed the sniff, with its custom metadata. */
interface Incoming {
    readonly upload: RasterUpload;
    readonly uploaded: Uploaded;
    readonly metadata: RasterUploadMetadata;
}

/** The job, its version and (for a replacement) the layer's pending version, in one transaction. */
async function createImport(deps: RasterUploadDeps, incoming: Incoming, plan: Plan): Promise<void> {
    const { upload, uploaded, metadata } = incoming;
    const now = deps.clock.now();
    const originalName = metadata.originalName === undefined ? {} : { originalName: metadata.originalName };
    const work: NewWork = {
        cityId: upload.cityId,
        jobId: upload.uploadId,
        type: 'geotiff-import',
        params: { uploadPath: uploaded.name, ...originalName, replaces: plan.replaces },
        layerId: plan.layerId,
        createdBy: upload.uid,
        now,
        ...pickDefined(plan, ['runOn']),
    };
    await deps.documents.transaction(async (transaction) => {
        const layer = plan.replaces ? await replacedLayer(transaction, upload, plan) : undefined;
        await createWork(transaction, work, {
            origin: 'upload',
            source: { kind: 'upload', uploadPath: uploaded.name, ...originalName, bytes: Math.max(1, uploaded.size) },
            label: plan.label,
            year: plan.year,
        });
        if (layer !== undefined) {
            const layerPath = FIRESTORE_PATHS.layer(upload.cityId, plan.layerId);
            await transaction.set(layerPath, layerDocSchema, { ...layer, pendingVersion: upload.uploadId, ...stampOf(upload.uid, now) });
        }
    });
}

/**
 * A replacement's layer, read again in the transaction that creates the job (CR-M3-47): two Replace uploads that both
 * passed the busy check before either wrote are told apart here, the second refused as `apiError.layers.busy`.
 */
async function replacedLayer(transaction: DocumentTransaction, upload: RasterUpload, plan: Plan): Promise<LayerDoc> {
    const layer = await transaction.get(FIRESTORE_PATHS.layer(upload.cityId, plan.layerId), layerDocSchema);
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (layer.pendingVersion !== undefined) {
        throw new ApiError('apiError.layers.busy');
    }
    return layer;
}

/** What a refused upload's job records: an `ApiError`'s code and parameters, anything else is internal. */
function refusalOf(error: unknown): Refusal {
    return error instanceof ApiError ? { code: error.code, params: error.params } : { code: 'apiError.internal' };
}

/** A job created meanwhile by a redelivered event. */
function isConflict(error: unknown): boolean {
    return error instanceof UpstreamError && error.failure === 'conflict';
}

/** The custom metadata keys the upload dialog writes (`rasterUploadMetadataSchema`). */
const UPLOAD_METADATA_KEYS = ['originalName', 'year', 'layerId'] as const;

/**
 * The dialog's own keys of an object's custom metadata. Storage adds its own (the Firebase SDK's
 * `firebaseStorageDownloadTokens`, in the emulator as in production), which the strict schema would refuse (CR-M3-32).
 */
export function uploadMetadataOf(metadata: Readonly<Record<string, string>>): Record<string, string> {
    return Object.fromEntries(UPLOAD_METADATA_KEYS.flatMap((key) => (metadata[key] === undefined ? [] : [[key, metadata[key]]])));
}

/** The metadata of an upload whose bytes are a TIFF; anything else is refused (and undefined). */
async function sniffed(deps: RasterUploadDeps, upload: RasterUpload, uploaded: Uploaded): Promise<RasterUploadMetadata | undefined> {
    const metadata = validate(rasterUploadMetadataSchema, uploadMetadataOf(uploaded.metadata));
    if (!metadata.ok) {
        await refuse(deps, upload, uploaded, { code: 'apiError.invalidRequest', params: { count: String(metadata.issues.length) } });
        return undefined;
    }
    if (!isTiff(await deps.reader.range('private', uploaded.name, 0, SNIFF_BYTES))) {
        await refuse(deps, upload, uploaded, { code: 'apiError.imagery.notTiff' });
        return undefined;
    }
    return metadata.value;
}

async function importUpload(deps: RasterUploadDeps, incoming: Incoming): Promise<void> {
    try {
        await createImport(deps, incoming, await planOf(deps, incoming.upload, incoming.metadata));
        deps.log.info('raster upload queued', { cityId: incoming.upload.cityId, uploadId: incoming.upload.uploadId });
    } catch (error) {
        if (!isConflict(error)) {
            await refuse(deps, incoming.upload, incoming.uploaded, refusalOf(error));
        }
    }
}

async function jobExists(deps: RasterUploadDeps, upload: RasterUpload): Promise<boolean> {
    return (await deps.documents.get(FIRESTORE_PATHS.job(upload.cityId, upload.uploadId), jobDocSchema)) !== undefined;
}

/** Handles one finalized object of the private bucket (everything but a raster upload is ignored). */
export async function processRasterUpload(deps: RasterUploadDeps, uploaded: Uploaded): Promise<void> {
    const upload = parseRasterUploadPath(uploaded.name);
    if (upload === undefined || (await jobExists(deps, upload))) {
        return;
    }
    const metadata = await sniffed(deps, upload, uploaded);
    if (metadata !== undefined) {
        await importUpload(deps, { upload, uploaded, metadata });
    }
}

/**
 * `imagery-onRasterUpload`: Storage finalize on the private bucket (named when `bucket` is given), 256 MiB (the default; 512
 * until 2026-11-12: it reads a file's first bytes and writes two documents, `docs/research/M7-local-worker.md` §4.6), one
 * upload at a time per instance, five instances; no automatic retry (a refusal is recorded on the job).
 */
export function onRasterUploadFunction(getDeps: () => RasterUploadDeps, bucket?: string): CloudFunction<StorageEvent> {
    const options = {
        concurrency: 1,
        maxInstances: 5,
        timeoutSeconds: 120,
        retry: false,
        ...runAs('imagery.onRasterUpload'),
    } as const;
    return onObjectFinalized(bucket === undefined ? options : { ...options, bucket }, async (event) => {
        const { name, metadata } = event.data;
        // The runtime delivers the size as an int64 string, whatever the type says.
        const size: unknown = event.data.size;
        await processRasterUpload(getDeps(), { name, size: Number(size), metadata: metadata ?? {} });
    });
}
