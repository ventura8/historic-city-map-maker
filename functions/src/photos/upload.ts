/**
 * `photos.onUpload`, the pure handler (`docs/research/M2-interfaces.md` §3.6; security review §1.5, §4.6): an admin's
 * upload into the private bucket becomes the photo's original, its two public WebP derivatives (content-hashed,
 * immutable, no metadata) and the server-owned fields of its document. Processing is idempotent: the paths derive from
 * the SHA-256, a redelivered event finds its objects and its upload gone.
 */
import { createHash } from 'node:crypto';

import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    IMMUTABLE_CACHE_CONTROL,
    PHOTO_LIMITS,
    STORAGE_PATHS,
    adminDocSchema,
    hasCityRole,
    parsePhotoUploadPath,
    photoDocSchema,
    publicObjectUrl,
    systemWriter,
    timestampFromDate,
    type ApiErrorCode,
    type PhotoContentType,
    type PhotoDoc,
    type PhotoUpload,
    type PhotoVariant,
} from '@hcm/shared';

/** The versions an upload may be for besides the photo's own image (the owner 2026-11-09). */
type PhotoVersionKind = 'improved' | 'colorized';

import type { ExifSummary, ImageInspection } from '../ports/image-processor.js';
import type { Ports } from '../ports/index.js';
import { UpstreamError } from '../ports/errors.js';
import { compact, omit } from '../api/objects.js';
import { exifRecord, suggestionsFrom } from './suggestions.js';

export type PhotoDeps = Pick<Ports, 'log' | 'clock' | 'config' | 'documents' | 'blobs' | 'images'>;

/** The finalized object of the private bucket, as far as the handler reads it (`StorageObjectData`). */
export interface FinalizedObject {
    readonly name: string;
    /** Bytes; Cloud Storage events carry this int64 as a decimal string, whatever the event type says. */
    readonly size: number | string;
    /** Custom metadata: the admin sets `originalName`, the file's name on the admin's computer. */
    readonly metadata: Readonly<Record<string, string>>;
}

/** What became of one upload (logged, and what the tests assert besides the documents and objects). */
export type UploadOutcome = 'ignored' | 'orphan' | 'gone' | 'failed' | 'done';

/**
 * The code of a HEIC/HEIF upload, which the runtime cannot decode (`adapters/image.ts`; `DECISIONS-for-review.md` §20b):
 * its message tells the admin how to export a JPEG instead (CR-M2-30).
 */
const HEIC_ERROR: ApiErrorCode = 'apiError.photo.heicUnsupported';
const UNDECODABLE: ReadonlySet<PhotoContentType> = new Set(['image/heic', 'image/heif']);

/** The fields one processing result replaces; everything else of the document stays as the admin wrote it. */
const SERVER_FIELDS = ['image', 'heldImage', 'exif', 'suggested', 'original', 'processingError', 'duplicateOf', 'replacement'] as const;

const DERIVATIVES: Readonly<Record<PhotoVariant, { readonly longEdge: number; readonly quality: number }>> = {
    web: { longEdge: PHOTO_LIMITS.webLongEdge, quality: PHOTO_LIMITS.webQuality },
    thumb: { longEdge: PHOTO_LIMITS.thumbLongEdge, quality: PHOTO_LIMITS.thumbQuality },
};

/** Why a file was refused: the code the photo records (`apiError.photo.tooLarge` reads its limit from `PHOTO_LIMITS`). */
interface Refusal {
    readonly code: ApiErrorCode;
    readonly duplicateOf?: string;
}

/** An upload the server will not process; recorded on the document, the upload deleted. */
class PhotoRefused extends Error {
    readonly refusal: Refusal;

    constructor(refusal: Refusal) {
        super(refusal.code);
        this.name = 'PhotoRefused';
        this.refusal = refusal;
    }
}

interface Processed {
    /** The public derivatives, or (M13 §2) `heldImage`, the private ones of a photo that waits for review. */
    readonly image?: NonNullable<PhotoDoc['image']>;
    readonly heldImage?: NonNullable<PhotoDoc['heldImage']>;
    readonly original: NonNullable<PhotoDoc['original']>;
    readonly exif: NonNullable<PhotoDoc['exif']>;
    readonly suggested?: NonNullable<PhotoDoc['suggested']>;
}

interface Accepted {
    readonly contentType: PhotoContentType;
    readonly exif: ExifSummary;
}

function refuseUnreadable(error: unknown): never {
    if (error instanceof UpstreamError && error.failure === 'invalid') {
        throw new PhotoRefused({ code: 'apiError.photo.unreadable' });
    }
    throw error;
}

function tooLarge(): PhotoRefused {
    return new PhotoRefused({ code: 'apiError.photo.tooLarge' });
}

/** The sniffed type must be an accepted, decodable photo type, and the pixel count within the limit. */
function accept(inspection: ImageInspection): Accepted {
    const { contentType } = inspection;
    if (contentType === undefined) {
        throw new PhotoRefused({ code: 'apiError.photo.unsupportedType' });
    }
    if (UNDECODABLE.has(contentType)) {
        throw new PhotoRefused({ code: HEIC_ERROR });
    }
    if (inspection.width * inspection.height > PHOTO_LIMITS.maxInputPixels) {
        throw tooLarge();
    }
    return { contentType, exif: inspection.exif };
}

/** The upload's bytes; undefined when it is gone (a redelivered event after the upload was processed and deleted). */
async function readUpload(deps: PhotoDeps, object: FinalizedObject): Promise<Uint8Array | undefined> {
    if (Number(object.size) > PHOTO_LIMITS.maxUploadBytes) {
        throw tooLarge();
    }
    try {
        return await deps.blobs.read('private', object.name);
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'notFound') {
            return undefined;
        }
        throw error;
    }
}

/** Whether the photo being processed came from the old site (it carries a `legacyId`). */
async function isLegacyPhoto(deps: PhotoDeps, upload: PhotoUpload): Promise<boolean> {
    const current = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    return current?.legacyId !== undefined;
}

/**
 * Another photo of the city whose original has the same SHA-256 (S-A08-BAD-DUPLICATE); the photo itself never counts.
 * The old site placed one image at two spots (two legacy records, one file): two legacy photos are never each other's
 * duplicate, so the legacy import keeps both whichever is processed first.
 */
async function refuseDuplicate(deps: PhotoDeps, upload: PhotoUpload, sha256: string): Promise<void> {
    const found = await deps.documents.query(FIRESTORE_PATHS.photos(upload.cityId), photoDocSchema, {
        where: [['original.sha256', '==', sha256]],
        limit: 2,
    });
    const others = [...found.documents, ...found.invalid].filter((document) => document.id !== upload.photoId);
    const [other] = others;
    if (other === undefined) {
        return;
    }
    const legacyPair = found.documents.some((document) => document.id === other.id && document.data.legacyId !== undefined);
    if (!(legacyPair && (await isLegacyPhoto(deps, upload)))) {
        throw new PhotoRefused({ code: 'apiError.photo.duplicate', duplicateOf: other.id });
    }
}

interface Derivative {
    readonly variant: PhotoVariant;
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
}

/** One upload of a known photo, and whether it is held back for review (M13 §2). */
interface KnownUpload {
    readonly upload: PhotoUpload;
    readonly object: FinalizedObject;
    readonly held: boolean;
}

const DECIDED: Refusal = { code: 'apiError.review.alreadyDecided' };

async function byReviewer(deps: PhotoDeps, upload: PhotoUpload): Promise<boolean> {
    const admin = await deps.documents.get(FIRESTORE_PATHS.admin(upload.uid), adminDocSchema);
    return hasCityRole(admin?.cities, upload.cityId, 'moderator');
}

/**
 * M13 §2, §9: whether this upload is held back, read when the trigger runs. A waiting photo's always is. A decided photo takes no
 * more from anyone who is not a reviewer now (the Storage rule let it in while it waited), and a refused one from nobody: it
 * must never get a public address. An older or staff document's goes public, as a reviewer's does.
 */
async function heldBack(deps: PhotoDeps, upload: PhotoUpload, photo: PhotoDoc): Promise<boolean> {
    if (photo.reviewStatus === 'pending') {
        return true;
    }
    if (photo.reviewStatus === 'refused' || !(await byReviewer(deps, upload))) {
        throw new PhotoRefused(DECIDED);
    }
    return false;
}

interface Rendered {
    readonly web: Derivative;
    readonly thumb: Derivative;
    readonly sha256: string;
}

/**
 * Both derivatives in memory: every decoding problem shows here, before anything is written. The original is decoded once, for the
 * web derivative; the thumbnail is made from that 2,048 px WebP, already turned upright and without metadata (2026-11-12,
 * reports/resource-audit.md item 10: a second decode of a 200 MP original cost as much CPU again; measured on a 200 MP JPEG, 1.8 to
 * 1.1 CPU-seconds, and on a 200 MP PNG 3.3 to 1.6, peak 321 MB either way, so the function runs at 1 GiB).
 */
async function render(deps: PhotoDeps, bytes: Uint8Array): Promise<readonly [Derivative, Derivative]> {
    const encode = async (variant: PhotoVariant, from: Uint8Array): Promise<Derivative> => ({
        variant,
        ...(await deps.images.webp(from, DERIVATIVES[variant]).catch(refuseUnreadable)),
    });
    const web = await encode('web', bytes);
    return [web, await encode('thumb', web.bytes)];
}

/** One derivative, created once: a redelivered event finds the same content-hashed object (a conflict) and moves on. */
async function store(deps: PhotoDeps, upload: PhotoUpload, sha256: string, derivative: Derivative): Promise<string> {
    const path = STORAGE_PATHS.photoDerivative(upload.cityId, upload.photoId, sha256, derivative.variant);
    await deps.blobs
        .write('public', path, derivative.bytes, {
            contentType: 'image/webp',
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            ifGenerationMatch: 0,
            customMetadata: { [DERIVATIVE_WRITTEN_AT]: deps.clock.now().toISOString() },
        })
        .catch((error: unknown) => {
            if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
                throw error;
            }
        });
    return publicObjectUrl(deps.config.buckets.public, path);
}

/**
 * M13 §2: a pending photo's derivative stays in the private bucket: nothing of it has a public address until `review.decide`
 * moves it, so an uploader cannot host a file by uploading it.
 */
async function hold(deps: PhotoDeps, upload: PhotoUpload, sha256: string, derivative: Derivative): Promise<string> {
    const path = STORAGE_PATHS.reviewHeld(upload.cityId, upload.photoId, sha256, derivative.variant);
    await deps.blobs.write('private', path, derivative.bytes, { contentType: 'image/webp' });
    return path;
}

/** Where the derivatives go: the public bucket, or held back while the photo waits for review. */
async function stored(deps: PhotoDeps, upload: PhotoUpload, held: boolean, rendered: Rendered) {
    const { web, thumb, sha256 } = rendered;
    const size = { sha256, w: web.width, h: web.height };
    return held
        ? {
              image: undefined,
              heldImage: { web: await hold(deps, upload, sha256, web), thumb: await hold(deps, upload, sha256, thumb), ...size },
          }
        : {
              heldImage: undefined,
              image: { web: await store(deps, upload, sha256, web), thumb: await store(deps, upload, sha256, thumb), ...size },
          };
}

async function processBytes(deps: PhotoDeps, known: KnownUpload, bytes: Uint8Array): Promise<Processed> {
    const { upload, object, held } = known;
    const accepted = accept(await deps.images.inspect(bytes).catch(refuseUnreadable));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await refuseDuplicate(deps, upload, sha256);
    const [web, thumb] = await render(deps, bytes);
    const originalPath = STORAGE_PATHS.photoOriginal(upload.cityId, upload.photoId, sha256, accepted.contentType);
    await deps.blobs.copy({ bucket: 'private', path: object.name }, { bucket: 'private', path: originalPath });
    return compact<Processed>({
        ...(await stored(deps, upload, held, { web, thumb, sha256 })),
        original: { path: originalPath, contentType: accepted.contentType, bytes: bytes.length, sha256 },
        exif: exifRecord(accepted.exif),
        suggested: suggestionsFrom(accepted.exif, object.metadata['originalName']),
    });
}

/** Rewrites the photo inside a transaction (the admin may be editing it); a photo deleted meanwhile stays deleted. */
async function updatePhoto(deps: PhotoDeps, upload: PhotoUpload, change: (current: PhotoDoc) => PhotoDoc): Promise<void> {
    const path = FIRESTORE_PATHS.photo(upload.cityId, upload.photoId);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current !== undefined) {
            await transaction.set(path, photoDocSchema, change(current));
        }
    });
}

function stamp(deps: PhotoDeps): Pick<PhotoDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: systemWriter('photos'), updatedAt: timestampFromDate(deps.clock.now()) };
}

/** A decision made while this ran wins: held pictures never overwrite a decided photo, whose `image` this would take away. */
async function recordDone(deps: PhotoDeps, upload: PhotoUpload, processed: Processed): Promise<void> {
    await updatePhoto(deps, upload, (current) => {
        if (processed.heldImage !== undefined && current.reviewStatus !== 'pending') {
            throw new PhotoRefused(DECIDED);
        }
        return { ...omit(current, SERVER_FIELDS), ...processed, processing: 'done', ...stamp(deps) };
    });
}

/** The held pictures of a decision that came first have no one to show them to. */
async function recordProcessed(deps: PhotoDeps, upload: PhotoUpload, processed: Processed): Promise<void> {
    try {
        await recordDone(deps, upload, processed);
    } catch (error) {
        if (error instanceof PhotoRefused && processed.heldImage !== undefined) {
            await Promise.all([
                deps.blobs.delete('private', processed.heldImage.web),
                deps.blobs.delete('private', processed.heldImage.thumb),
            ]);
        }
        throw error;
    }
}

/** A photo without an image fails: it has nothing to show, so the manifest leaves it out. */
function failedPhoto(deps: PhotoDeps, current: PhotoDoc, refusal: Refusal): PhotoDoc {
    return {
        ...omit(current, ['processingError', 'duplicateOf']),
        ...compact<Pick<PhotoDoc, 'duplicateOf'>>({ duplicateOf: refusal.duplicateOf }),
        processing: 'failed',
        processingError: refusal.code,
        ...stamp(deps),
    };
}

/**
 * A photo that already has an image keeps it, processed and published as it was, when its replacement is refused
 * (`docs/research/M2c-interfaces.md` §6.4, CR-M2c-4): `replacement` records why, for the admin's editor; failing the
 * photo would take a published photo off the public map.
 */
function refusedReplacement(deps: PhotoDeps, current: PhotoDoc, refusal: Refusal): PhotoDoc {
    const at = timestampFromDate(deps.clock.now());
    return {
        ...omit(current, ['replacement']),
        processing: 'done',
        replacement: compact<NonNullable<PhotoDoc['replacement']>>({ error: refusal.code, at, duplicateOf: refusal.duplicateOf }),
        ...stamp(deps),
    };
}

async function recordFailed(deps: PhotoDeps, upload: PhotoUpload, refusal: Refusal): Promise<void> {
    await updatePhoto(deps, upload, (current) =>
        current.image === undefined ? failedPhoto(deps, current, refusal) : refusedReplacement(deps, current, refusal),
    );
}

/** A failure that is not the file's fault (Storage or Firestore unavailable): retryable with Reprocess, upload kept. */
function unexpected(deps: PhotoDeps, upload: PhotoUpload, error: unknown): Refusal {
    const transient = error instanceof UpstreamError && ['unavailable', 'rateLimited'].includes(error.failure);
    deps.log.error('photo processing failed', { cityId: upload.cityId, photoId: upload.photoId, error: String(error) });
    return { code: transient ? 'apiError.unavailable' : 'apiError.internal' };
}

/** A refused or failed version leaves the photo as it was; `replacement` says why, as for a refused replacement image. */
async function recordVersionFailed(deps: PhotoDeps, upload: PhotoUpload, refusal: Refusal): Promise<void> {
    await updatePhoto(deps, upload, (current) => ({ ...refusedReplacement(deps, current, refusal), processing: current.processing }));
}

interface FailedUpload {
    readonly upload: PhotoUpload;
    readonly object: FinalizedObject;
    readonly version: PhotoVersionKind | undefined;
}

async function recordFailure(deps: PhotoDeps, { upload, object, version }: FailedUpload, error: unknown): Promise<void> {
    const record = version === undefined ? recordFailed : recordVersionFailed;
    if (!(error instanceof PhotoRefused)) {
        await record(deps, upload, unexpected(deps, upload, error));
        return;
    }
    await record(deps, upload, error.refusal);
    await deps.blobs.delete('private', object.name);
    deps.log.info('photo refused', { cityId: upload.cityId, photoId: upload.photoId, code: error.refusal.code });
}

/** An upload read, with the photo it is for. */
interface Received {
    readonly upload: PhotoUpload;
    readonly object: FinalizedObject;
    readonly photo: PhotoDoc;
    readonly bytes: Uint8Array;
}

/** The photo's own image: its derivatives public, or held back while the photo waits for review. */
async function processImage(deps: PhotoDeps, { upload, object, photo, bytes }: Received): Promise<void> {
    const held = await heldBack(deps, upload, photo);
    await recordProcessed(deps, upload, await processBytes(deps, { upload, object, held }, bytes));
    deps.log.info('photo processed', { cityId: upload.cityId, photoId: upload.photoId, held });
}

/** The improved or colorized version a file is for (the upload's custom metadata `version`); undefined: the photo's own image. */
export function versionOf(metadata: Readonly<Record<string, string>>): PhotoVersionKind | undefined {
    const value = metadata['version'];
    return value === 'improved' || value === 'colorized' ? value : undefined;
}

/**
 * The owner 2026-11-09: an improved or colorized version, from a reviewer only and never of a photo that waits for review
 * (nothing of a pending photo gets a public address). Its derivatives are public and content-hashed as the image's; no
 * duplicate check (a version is the same photo by design) and no EXIF suggestions; the photo's own image, its processing
 * and its publication stay as they are.
 */
async function processVersion(deps: PhotoDeps, { upload, object, photo, bytes }: Received, kind: PhotoVersionKind): Promise<void> {
    if (photo.reviewStatus === 'pending' || !(await byReviewer(deps, upload))) {
        throw new PhotoRefused({ code: 'apiError.photo.versionNotAllowed' });
    }
    const accepted = accept(await deps.images.inspect(bytes).catch(refuseUnreadable));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [web, thumb] = await render(deps, bytes);
    const originalPath = STORAGE_PATHS.photoOriginal(upload.cityId, upload.photoId, sha256, accepted.contentType);
    await deps.blobs.copy({ bucket: 'private', path: object.name }, { bucket: 'private', path: originalPath });
    const image = {
        web: await store(deps, upload, sha256, web),
        thumb: await store(deps, upload, sha256, thumb),
        sha256,
        w: web.width,
        h: web.height,
    };
    const original = { path: originalPath, contentType: accepted.contentType, bytes: bytes.length, sha256 };
    await updatePhoto(deps, upload, (current) => ({
        ...omit(current, ['replacement']),
        versions: { ...current.versions, [kind]: { image, original } },
        ...stamp(deps),
    }));
    deps.log.info('photo version processed', { cityId: upload.cityId, photoId: upload.photoId, version: kind });
}

async function processKnownUpload(deps: PhotoDeps, upload: PhotoUpload, object: FinalizedObject, photo: PhotoDoc): Promise<UploadOutcome> {
    const version = versionOf(object.metadata);
    try {
        const bytes = await readUpload(deps, object);
        if (bytes === undefined) {
            return 'gone';
        }
        const received = { upload, object, photo, bytes };
        await (version === undefined ? processImage(deps, received) : processVersion(deps, received, version));
    } catch (error) {
        await recordFailure(deps, { upload, object, version }, error);
        return 'failed';
    }
    await deps.blobs.delete('private', object.name);
    return 'done';
}

/**
 * Processes one finalized object of the private bucket: anything but `uploads/photos/{city}/{uid}/{photo}/{file}` is
 * ignored, an upload without its photo document is deleted, a refused file is recorded on the document
 * (`processing: 'failed'`, `processingError`, `duplicateOf`; for a photo that already has an image, a replacement, only
 * `replacement`: CR-M2c-4) and deleted, a processed one sets `image`, `exif`, `suggested`, `original` and
 * `processing: 'done'` and removes `replacement` (stamped `system:photos`) and is deleted.
 */
export async function processPhotoUpload(deps: PhotoDeps, object: FinalizedObject): Promise<UploadOutcome> {
    const upload = parsePhotoUploadPath(object.name);
    if (upload === undefined) {
        deps.log.debug('not a photo upload', { name: object.name });
        return 'ignored';
    }
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    if (photo === undefined) {
        await deps.blobs.delete('private', object.name);
        deps.log.warn('upload without its photo document deleted', { cityId: upload.cityId, photoId: upload.photoId });
        return 'orphan';
    }
    return processKnownUpload(deps, upload, object, photo);
}
