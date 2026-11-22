/**
 * Per-slot upload ordering for `photos.onUpload`: stores the latest finalized upload per target slot (`image`,
 * `improved`, `colorized`) on the photo document and checks inside each commit transaction that the finalized object
 * still matches that upload, so an older upload finishing late never overwrites a newer image or version.
 */
import { FIRESTORE_PATHS, photoDocSchema, timestampFromDate, timestampToDate, type PhotoDoc, type PhotoUpload } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

/** The versions an upload may be for besides the photo's own image (the owner 2026-11-09). */
export type PhotoVersionKind = 'improved' | 'colorized';

/** The independent upload slots of one photo document. */
export type UploadSlot = 'image' | PhotoVersionKind;

export interface UploadClaim {
    readonly slot: UploadSlot;
    /** The finalized object path (`STORAGE_PATHS.photoUpload`). */
    readonly id: string;
    /** When Cloud Storage finalized the object (`timeCreated`, or the handler's clock when absent). */
    readonly at: Date;
}

type SlotEntry = NonNullable<NonNullable<PhotoDoc['latestUploads']>[UploadSlot]>;
type ClaimDeps = Pick<Ports, 'log' | 'documents' | 'blobs'>;

/** Thrown inside a commit transaction when a newer upload already claimed the same slot. */
export class StaleUpload extends Error {
    readonly keepHeld: boolean;

    constructor(keepHeld = false) {
        super('stale photo upload');
        this.name = 'StaleUpload';
        this.keepHeld = keepHeld;
    }
}

export function uploadSlot(version: PhotoVersionKind | undefined): UploadSlot {
    return version ?? 'image';
}

export function uploadTime(deps: Pick<Ports, 'clock'>, timeCreated: Date | string | undefined): Date {
    if (timeCreated === undefined) {
        return deps.clock.now();
    }
    const parsed = timeCreated instanceof Date ? timeCreated : new Date(timeCreated);
    return Number.isNaN(parsed.getTime()) ? deps.clock.now() : parsed;
}

function entryOf(photo: PhotoDoc, slot: UploadSlot): SlotEntry | undefined {
    return photo.latestUploads?.[slot];
}

/** True when a different, strictly newer finalized upload already claimed this slot. */
export function isOlderThanLatest(photo: PhotoDoc, claim: UploadClaim): boolean {
    const latest = entryOf(photo, claim.slot);
    return latest !== undefined && latest.upload !== claim.id && claim.at.getTime() < timestampToDate(latest.at).getTime();
}

/** True when `claim` is the latest recorded upload for its slot on `photo`. */
export function isLatestUpload(photo: PhotoDoc, claim: UploadClaim): boolean {
    return entryOf(photo, claim.slot)?.upload === claim.id;
}

/** Rewrites the photo inside a transaction (the admin may be editing it); a photo deleted meanwhile stays deleted. */
export async function updatePhoto(
    deps: Pick<Ports, 'documents'>,
    upload: PhotoUpload,
    change: (current: PhotoDoc) => PhotoDoc,
): Promise<void> {
    const path = FIRESTORE_PATHS.photo(upload.cityId, upload.photoId);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current !== undefined) {
            await transaction.set(path, photoDocSchema, change(current));
        }
    });
}

/** Applies a failure inside a transaction only while `isStale` is false; returns false when superseded. */
export async function updateIfActive(
    deps: Pick<Ports, 'documents'>,
    upload: PhotoUpload,
    isStale: (current: PhotoDoc) => boolean,
    change: (current: PhotoDoc) => PhotoDoc,
): Promise<boolean> {
    const path = FIRESTORE_PATHS.photo(upload.cityId, upload.photoId);
    return deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current === undefined) {
            return true;
        }
        if (isStale(current)) {
            return false;
        }
        await transaction.set(path, photoDocSchema, change(current));
        return true;
    });
}

/**
 * Transactionally records `claim` as the latest upload for its slot unless a strictly newer upload already holds it.
 * Preserves `updatedBy` and `updatedAt` so live replacement listeners do not mistake a claim for a finished write.
 */
export async function claimUploadSlot(
    deps: Pick<Ports, 'documents'>,
    upload: PhotoUpload,
    claim: UploadClaim,
): Promise<'claimed' | 'stale' | 'orphan'> {
    const path = FIRESTORE_PATHS.photo(upload.cityId, upload.photoId);
    return deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current === undefined) {
            return 'orphan';
        }
        if (isOlderThanLatest(current, claim)) {
            return 'stale';
        }
        const entry: SlotEntry = { upload: claim.id, at: timestampFromDate(claim.at) };
        await transaction.set(path, photoDocSchema, {
            ...current,
            latestUploads: { ...current.latestUploads, [claim.slot]: entry },
        });
        return 'claimed';
    });
}

export async function finishStale(deps: ClaimDeps, upload: PhotoUpload, claim: UploadClaim): Promise<'stale'> {
    await deps.blobs.delete('private', claim.id);
    deps.log.info('stale photo upload skipped', { cityId: upload.cityId, photoId: upload.photoId, slot: claim.slot });
    return 'stale';
}

export async function deleteOrphan(deps: ClaimDeps, upload: PhotoUpload, name: string): Promise<'orphan'> {
    await deps.blobs.delete('private', name);
    deps.log.warn('upload without its photo document deleted', { cityId: upload.cityId, photoId: upload.photoId });
    return 'orphan';
}
