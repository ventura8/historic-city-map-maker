/** A city's photo documents and uploads for the `photos.*` tests. */
import { FIRESTORE_PATHS, STORAGE_PATHS, adminDocSchema, photoDocSchema, timestampFromDate, type PhotoDoc } from '@hcm/shared';

import type { FinalizedObject } from '../../src/photos/upload.js';
import type { ContentDeps } from '../publish/fakes.js';

export const CITY = 'bucuresti';
const UID = 'u-admin';

/** A photo as the admin creates it before uploading its file (`processing: 'pending'`). */
function newPhoto(overrides: Partial<PhotoDoc> = {}): PhotoDoc {
    const at = timestampFromDate(new Date('2026-10-12T08:00:00.000Z'));
    return {
        title: { ro: 'Calea Victoriei' },
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.09 },
        published: false,
        processing: 'pending',
        createdAt: at,
        createdBy: UID,
        updatedBy: UID,
        updatedAt: at,
        ...overrides,
    };
}

export async function seedPhoto(deps: ContentDeps, photoId: string, overrides: Partial<PhotoDoc> = {}): Promise<void> {
    const at = timestampFromDate(new Date('2026-10-12T08:00:00.000Z'));
    await deps.documents.set(FIRESTORE_PATHS.admin(UID), adminDocSchema, {
        role: 'admin',
        cities: { [CITY]: 'owner' },
        createdAt: at,
        updatedBy: UID,
        updatedAt: at,
    });
    await deps.documents.set(FIRESTORE_PATHS.photo(CITY, photoId), photoDocSchema, newPhoto(overrides));
}

export async function photo(deps: ContentDeps, photoId: string): Promise<PhotoDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.photo(CITY, photoId), photoDocSchema);
}

/** Puts `bytes` where the admin uploads the photo's file and returns the finalized object the trigger receives. */
export function uploaded(
    deps: ContentDeps,
    photoId: string,
    bytes: Uint8Array,
    options: { name?: string; file?: string } = {},
): FinalizedObject {
    const path = STORAGE_PATHS.photoUpload(CITY, UID, photoId, options.file ?? 'nonce-0001.jpg');
    const metadata = options.name === undefined ? {} : { originalName: options.name };
    deps.blobs.put('private', path, bytes, { contentType: 'image/jpeg', customMetadata: metadata });
    return { name: path, size: String(bytes.length), metadata };
}
