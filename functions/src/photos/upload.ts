/**
 * `photos.onUpload`, the pure handler (`docs/research/M2-interfaces.md` §3.6; security review §1.5, §4.6): an admin's
 * upload into the private bucket becomes the photo's original, its two public WebP derivatives (content-hashed,
 * immutable, no metadata) and the server-owned fields of its document. Processing is idempotent: the paths derive from
 * the SHA-256, a redelivered event finds its objects and its upload gone.
 */
import { createHash } from 'node:crypto';

import {
    FIRESTORE_PATHS,
    PHOTO_LIMITS,
    STORAGE_PATHS,
    adminDocSchema,
    hasCityRole,
    parsePhotoUploadPath,
    photoDocSchema,
    systemWriter,
    timestampFromDate,
    type PhotoDoc,
    type PhotoUpload,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { UpstreamError } from '../ports/errors.js';
import { compact, omit } from '../api/objects.js';
import {
    StaleUpload,
    claimUploadSlot,
    deleteOrphan,
    finishStale,
    isLatestUpload,
    isOlderThanLatest,
    updateIfActive,
    updatePhoto,
    uploadSlot,
    uploadTime,
    type PhotoVersionKind,
    type UploadClaim,
} from './upload-claim.js';
import {
    PhotoRefused,
    accept,
    processPhotoBytes,
    refuseUnreadable,
    render,
    store,
    tooLarge,
    type Processed,
    type Refusal,
} from './upload-image.js';

export type PhotoDeps = Pick<Ports, 'log' | 'clock' | 'config' | 'documents' | 'blobs' | 'images'>;

/** The finalized object of the private bucket, as far as the handler reads it (`StorageObjectData`). */
export interface FinalizedObject {
    readonly name: string;
    /** Bytes; Cloud Storage events carry this int64 as a decimal string, whatever the event type says. */
    readonly size: number | string;
    /** Custom metadata: the admin sets `originalName`, the file's name on the admin's computer. */
    readonly metadata: Readonly<Record<string, string>>;
    /** When Cloud Storage finalized the object (`StorageObjectData.timeCreated`); absent in older synthetic fixtures. */
    readonly timeCreated?: Date | string | undefined;
}

/** What became of one upload (logged, and what the tests assert besides the documents and objects). */
export type UploadOutcome = 'ignored' | 'orphan' | 'gone' | 'stale' | 'failed' | 'done';

/** The fields one processing result replaces; everything else of the document stays as the admin wrote it. */
const SERVER_FIELDS = ['image', 'heldImage', 'exif', 'suggested', 'original', 'processingError', 'duplicateOf', 'replacement'] as const;

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

function stamp(deps: PhotoDeps): Pick<PhotoDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: systemWriter('photos'), updatedAt: timestampFromDate(deps.clock.now()) };
}

function sameHeld(current: PhotoDoc, processed: Processed): boolean {
    return processed.heldImage !== undefined && current.heldImage?.sha256 === processed.heldImage.sha256;
}

/** A decision or a newer upload made while this ran wins: stale or held pictures never overwrite a newer or decided photo. */
async function recordDone(deps: PhotoDeps, upload: PhotoUpload, claim: UploadClaim, processed: Processed): Promise<void> {
    await updatePhoto(deps, upload, (current) => {
        if (!isLatestUpload(current, claim)) {
            throw new StaleUpload(sameHeld(current, processed));
        }
        if (processed.heldImage !== undefined && current.reviewStatus !== 'pending') {
            throw new PhotoRefused(DECIDED);
        }
        return { ...omit(current, SERVER_FIELDS), ...processed, processing: 'done', ...stamp(deps) };
    });
}

function shouldDeleteHeld(error: unknown): boolean {
    return error instanceof PhotoRefused || (error instanceof StaleUpload && !error.keepHeld);
}

/** The held pictures of a decision or a newer upload that came first have no one to show them to. */
async function recordProcessed(deps: PhotoDeps, upload: PhotoUpload, claim: UploadClaim, processed: Processed): Promise<void> {
    try {
        await recordDone(deps, upload, claim, processed);
    } catch (error) {
        if (processed.heldImage !== undefined && shouldDeleteHeld(error)) {
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

/** A failure that is not the file's fault (Storage or Firestore unavailable): retryable with Reprocess, upload kept. */
function unexpected(deps: PhotoDeps, upload: PhotoUpload, error: unknown): Refusal {
    const transient = error instanceof UpstreamError && ['unavailable', 'rateLimited'].includes(error.failure);
    deps.log.error('photo processing failed', { cityId: upload.cityId, photoId: upload.photoId, error: String(error) });
    return { code: transient ? 'apiError.unavailable' : 'apiError.internal' };
}

interface FailedUpload {
    readonly upload: PhotoUpload;
    readonly object: FinalizedObject;
    readonly version: PhotoVersionKind | undefined;
    readonly claim: UploadClaim;
}

function applyFailure(deps: PhotoDeps, version: PhotoVersionKind | undefined, refusal: Refusal): (current: PhotoDoc) => PhotoDoc {
    if (version !== undefined) {
        return (current) => ({ ...refusedReplacement(deps, current, refusal), processing: current.processing });
    }
    return (current) => (current.image === undefined ? failedPhoto(deps, current, refusal) : refusedReplacement(deps, current, refusal));
}

function failureRefusal(deps: PhotoDeps, failed: FailedUpload, error: unknown): Refusal {
    return error instanceof PhotoRefused ? error.refusal : unexpected(deps, failed.upload, error);
}

async function completeFailure(deps: PhotoDeps, failed: FailedUpload, error: unknown, applied: boolean): Promise<'failed' | 'stale'> {
    if (!applied) {
        return finishStale(deps, failed.upload, failed.claim);
    }
    if (error instanceof PhotoRefused) {
        await deps.blobs.delete('private', failed.object.name);
        deps.log.info('photo refused', { cityId: failed.upload.cityId, photoId: failed.upload.photoId, code: error.refusal.code });
    }
    return 'failed';
}

async function recordUnclaimedFailure(deps: PhotoDeps, failed: FailedUpload, error: unknown): Promise<'failed' | 'stale'> {
    const refusal = failureRefusal(deps, failed, error);
    const stale = (current: PhotoDoc) => isOlderThanLatest(current, failed.claim);
    const applied = await updateIfActive(deps, failed.upload, stale, applyFailure(deps, failed.version, refusal));
    return completeFailure(deps, failed, error, applied);
}

async function recordClaimedFailure(deps: PhotoDeps, failed: FailedUpload, error: unknown): Promise<'failed' | 'stale'> {
    const refusal = failureRefusal(deps, failed, error);
    const stale = (current: PhotoDoc) => !isLatestUpload(current, failed.claim);
    const applied = await updateIfActive(deps, failed.upload, stale, applyFailure(deps, failed.version, refusal));
    return completeFailure(deps, failed, error, applied);
}

/** An upload read, authorized and claimed, ready to process. */
interface Received {
    readonly upload: PhotoUpload;
    readonly object: FinalizedObject;
    readonly claim: UploadClaim;
    readonly held: boolean;
    readonly bytes: Uint8Array;
}

/** The photo's own image: its derivatives public, or held back while the photo waits for review. */
async function processImage(deps: PhotoDeps, { upload, object, claim, held, bytes }: Received): Promise<void> {
    await recordProcessed(deps, upload, claim, await processPhotoBytes(deps, { upload, object, held, bytes }));
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
async function processVersion(deps: PhotoDeps, { upload, object, claim, bytes }: Received, kind: PhotoVersionKind): Promise<void> {
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
    await updatePhoto(deps, upload, (current) => {
        if (!isLatestUpload(current, claim)) {
            throw new StaleUpload();
        }
        return {
            ...omit(current, ['replacement']),
            versions: { ...current.versions, [kind]: { image, original } },
            ...stamp(deps),
        };
    });
    deps.log.info('photo version processed', { cityId: upload.cityId, photoId: upload.photoId, version: kind });
}

async function authorize(deps: PhotoDeps, upload: PhotoUpload, photo: PhotoDoc, version: PhotoVersionKind | undefined): Promise<boolean> {
    if (version === undefined) {
        return heldBack(deps, upload, photo);
    }
    if (photo.reviewStatus === 'pending' || !(await byReviewer(deps, upload))) {
        throw new PhotoRefused({ code: 'apiError.photo.versionNotAllowed' });
    }
    return false;
}

async function finishClaimedUpload(deps: PhotoDeps, failed: FailedUpload, held: boolean, bytes: Uint8Array): Promise<UploadOutcome> {
    const { upload, object, version, claim } = failed;
    const received = { upload, object, claim, held, bytes };
    try {
        await (version === undefined ? processImage(deps, received) : processVersion(deps, received, version));
        await deps.blobs.delete('private', object.name);
        return 'done';
    } catch (error) {
        return await (error instanceof StaleUpload ? finishStale(deps, upload, claim) : recordClaimedFailure(deps, failed, error));
    }
}

function finishUnclaimed(deps: PhotoDeps, failed: FailedUpload, status: 'stale' | 'orphan'): Promise<'stale' | 'orphan'> {
    return status === 'stale' ? finishStale(deps, failed.upload, failed.claim) : deleteOrphan(deps, failed.upload, failed.object.name);
}

async function claimUpload(
    deps: PhotoDeps,
    failed: FailedUpload,
    photo: PhotoDoc,
): Promise<{ readonly bytes: Uint8Array; readonly held: boolean } | UploadOutcome> {
    try {
        const bytes = await readUpload(deps, failed.object);
        if (bytes === undefined) {
            return 'gone';
        }
        const held = await authorize(deps, failed.upload, photo, failed.version);
        const status = await claimUploadSlot(deps, failed.upload, failed.claim);
        if (status === 'claimed') {
            return { bytes, held };
        }
        return await finishUnclaimed(deps, failed, status);
    } catch (error) {
        return await recordUnclaimedFailure(deps, failed, error);
    }
}

async function processKnownUpload(deps: PhotoDeps, upload: PhotoUpload, object: FinalizedObject, photo: PhotoDoc): Promise<UploadOutcome> {
    const version = versionOf(object.metadata);
    const claim: UploadClaim = { slot: uploadSlot(version), id: object.name, at: uploadTime(deps, object.timeCreated) };
    if (isOlderThanLatest(photo, claim)) {
        return finishStale(deps, upload, claim);
    }
    const failed = { upload, object, version, claim };
    const claimed = await claimUpload(deps, failed, photo);
    return typeof claimed === 'string' ? claimed : finishClaimedUpload(deps, failed, claimed.held, claimed.bytes);
}

/**
 * Processes one finalized object of the private bucket: anything but `uploads/photos/{city}/{uid}/{photo}/{file}` is
 * ignored, an upload without its photo document is deleted, an upload superseded by a newer one for the same slot is
 * deleted without modifying the photo, a refused file is recorded on the document (`processing: 'failed'`,
 * `processingError`, `duplicateOf`; for a photo that already has an image, a replacement, only `replacement`:
 * CR-M2c-4) and deleted, a processed one sets `image`, `exif`, `suggested`, `original` and `processing: 'done'` and
 * removes `replacement` (stamped `system:photos`) and is deleted.
 */
export async function processPhotoUpload(deps: PhotoDeps, object: FinalizedObject): Promise<UploadOutcome> {
    const upload = parsePhotoUploadPath(object.name);
    if (upload === undefined) {
        deps.log.debug('not a photo upload', { name: object.name });
        return 'ignored';
    }
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    return photo === undefined ? deleteOrphan(deps, upload, object.name) : processKnownUpload(deps, upload, object, photo);
}
