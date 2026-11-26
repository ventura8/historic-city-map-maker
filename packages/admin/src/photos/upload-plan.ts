/**
 * What a chosen file becomes before anything is sent (`docs/research/M2c-interfaces.md` §6.2 steps 1 and 2): the size
 * check of the Storage rules (`PHOTO_LIMITS.maxUploadBytes`), the upload's extension and content type (the rules ask for
 * an image type; what the file really is, the server decides by its bytes), and the new photo document with the sticky
 * fields and the last pin. Pure functions.
 */
import { PHOTO_LIMITS, type AdminContentKey, type ApiErrorCode, type LngLat, type PhotoContentType, type PhotoDoc } from '@hcm/shared';

import { definedSticky, type StickyFields } from './session.js';

/** A file as the page hands it over (a `File`: its name and size are read, its bytes sent). */
export interface PhotoFile {
    readonly name: string;
    readonly size: number;
    readonly data: Blob;
}

/** Megabytes in the size message (60 MiB). */
export const MAX_UPLOAD_MB = PHOTO_LIMITS.maxUploadBytes / (1024 * 1024);

/** The extensions the Storage rules accept, with the content type the upload declares. */
const TYPES: Readonly<Record<string, { readonly ext: string; readonly contentType: PhotoContentType }>> = {
    jpg: { ext: 'jpg', contentType: 'image/jpeg' },
    jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
    png: { ext: 'png', contentType: 'image/png' },
    webp: { ext: 'webp', contentType: 'image/webp' },
    tif: { ext: 'tif', contentType: 'image/tiff' },
    tiff: { ext: 'tif', contentType: 'image/tiff' },
    heic: { ext: 'heic', contentType: 'image/heic' },
    heif: { ext: 'heif', contentType: 'image/heif' },
};

export interface UploadKind {
    readonly ext: string;
    readonly contentType: PhotoContentType;
}

/** Why a file is refused before anything is sent. */
export interface FileRefusal {
    readonly ok: false;
    readonly error: AdminContentKey | ApiErrorCode;
    readonly params?: Readonly<Record<string, string>>;
}

export type FileCheck = { readonly ok: true; readonly kind: UploadKind } | FileRefusal;

function extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Refuses a file before any write: too large for the rules, or a name no photo upload may have. */
export function checkFile(file: PhotoFile): FileCheck {
    if (file.size > PHOTO_LIMITS.maxUploadBytes) {
        return { ok: false, error: 'adminContent.photos.tooBig', params: { size: String(MAX_UPLOAD_MB) } };
    }
    const kind = TYPES[extensionOf(file.name)];
    return kind === undefined ? { ok: false, error: 'apiError.photo.unsupportedType' } : { ok: true, kind };
}

/** The title a new photo starts with: the file name without its extension, until a suggestion replaces it. */
export function titleFromName(name: string, fallback: string): string {
    const dot = name.lastIndexOf('.');
    const base = (dot > 0 ? name.slice(0, dot) : name).replace(/_+/g, ' ').trim();
    return (base === '' ? fallback : base).slice(0, 200).trim();
}

/** The fields a new photo document is created with (the store stamps it and adds `createdAt`, `createdBy`). */
export function newPhotoFields(
    file: PhotoFile,
    photoId: string,
    sticky: StickyFields,
    pin: LngLat | null,
): Omit<PhotoDoc, 'updatedBy' | 'updatedAt' | 'createdAt' | 'createdBy'> {
    return {
        title: { ro: titleFromName(file.name, photoId) },
        ...definedSticky(sticky),
        license: sticky.license ?? 'unknown',
        // M13 §5: no pin, no place: the photo waits for one.
        ...(pin === null ? {} : { location: { lat: pin[1], lng: pin[0] } }),
        published: false,
        processing: 'pending',
    };
}

/**
 * An upload's file name (`UPLOAD_FILE_PATTERN`: 8 to 64 of `[A-Za-z0-9_-]` and the extension): a fresh document id of
 * the store (Storage never overwrites an upload) and a suffix that keeps even a short id long enough.
 */
export function uploadFileName(nonce: string, ext: string): string {
    return `${nonce}-photo.${ext}`;
}

/** The original name kept as the upload's custom metadata (the rules allow 255 characters). */
export function originalName(name: string): string {
    return name.slice(0, 255);
}
