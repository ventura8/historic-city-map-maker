/** Fields of a photo the documents' fixtures share: a decided review (M13) and the improved and colorized versions. */
import { STORAGE_PATHS, publicObjectUrl, type PhotoVariant } from '@hcm/shared';

import { past, type Data } from './world.js';

const SHA = 'cd'.repeat(32);

/** The hash of every test photo's own image (the documents' own `SHA`). */
const PHOTO_SHA = 'ab'.repeat(32);

/** The public address of one derivative of a photo's own image. */
export function derivative(cityId: string, photoId: string, variant: PhotoVariant): string {
    return publicObjectUrl('demo-hcm-public', STORAGE_PATHS.photoDerivative(cityId, photoId, PHOTO_SHA, variant));
}

/** M13: what a decided item carries, server-owned but for the credit. */
export function reviewedFields(reviewer: string): Data {
    return { reviewStatus: 'approved', reviewNote: 'Bună.', reviewedBy: reviewer, reviewedAt: past() };
}

/** An improved or colorized version as `photos.onUpload` writes it (the owner 2026-11-09), the same for every test photo. */
export function photoVersion(): Data {
    const derivative = (variant: string): string => publicObjectUrl('demo-hcm-public', `photos/versions/v1/cdcdcdcd/${variant}.webp`);
    return {
        image: { web: derivative('web'), thumb: derivative('thumb'), sha256: SHA, w: 2048, h: 1536 },
        original: {
            path: STORAGE_PATHS.photoOriginal('versions', 'v1', SHA, 'image/jpeg'),
            contentType: 'image/jpeg',
            bytes: 1,
            sha256: SHA,
        },
    };
}

/** The server document's versions and the admin's credits. */
export function versionFields(): Data {
    return {
        versions: { improved: photoVersion(), colorized: photoVersion() },
        versionCredits: { improved: 'Ana Pop', colorized: 'Atelierul' },
    };
}

/** The edits: every credit at its limit, and a reviewer's removal of the colorized version (never a new or changed one). */
export function versionEdits(): Data {
    return { versionCredits: { improved: 'x'.repeat(200), colorized: 'Atelierul' }, versions: { improved: photoVersion() } };
}
