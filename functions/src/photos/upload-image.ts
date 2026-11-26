import { createHash } from 'node:crypto';

import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    IMMUTABLE_CACHE_CONTROL,
    PHOTO_LIMITS,
    STORAGE_PATHS,
    photoDocSchema,
    publicObjectUrl,
    type ApiErrorCode,
    type PhotoContentType,
    type PhotoDoc,
    type PhotoUpload,
    type PhotoVariant,
} from '@hcm/shared';

import type { ExifSummary, ImageInspection } from '../ports/image-processor.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { exifRecord, suggestionsFrom } from './suggestions.js';
import { compact } from '../api/objects.js';

type ImageDeps = Pick<Ports, 'clock' | 'config' | 'documents' | 'blobs' | 'images'>;

interface ImageUpload {
    readonly upload: PhotoUpload;
    readonly object: {
        readonly name: string;
        readonly metadata: Readonly<Record<string, string>>;
    };
    readonly held: boolean;
    readonly bytes: Uint8Array;
}

const HEIC_ERROR: ApiErrorCode = 'apiError.photo.heicUnsupported';
const UNDECODABLE: ReadonlySet<PhotoContentType> = new Set(['image/heic', 'image/heif']);
const DERIVATIVES: Readonly<Record<PhotoVariant, { readonly longEdge: number; readonly quality: number }>> = {
    web: { longEdge: PHOTO_LIMITS.webLongEdge, quality: PHOTO_LIMITS.webQuality },
    thumb: { longEdge: PHOTO_LIMITS.thumbLongEdge, quality: PHOTO_LIMITS.thumbQuality },
};

export interface Refusal {
    readonly code: ApiErrorCode;
    readonly duplicateOf?: string;
}

export class PhotoRefused extends Error {
    readonly refusal: Refusal;

    constructor(refusal: Refusal) {
        super(refusal.code);
        this.name = 'PhotoRefused';
        this.refusal = refusal;
    }
}

export interface Processed {
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

interface Derivative {
    readonly variant: PhotoVariant;
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
}

interface Rendered {
    readonly web: Derivative;
    readonly thumb: Derivative;
    readonly sha256: string;
}

export function refuseUnreadable(error: unknown): never {
    if (error instanceof UpstreamError && error.failure === 'invalid') {
        throw new PhotoRefused({ code: 'apiError.photo.unreadable' });
    }
    throw error;
}

export function tooLarge(): PhotoRefused {
    return new PhotoRefused({ code: 'apiError.photo.tooLarge' });
}

export function accept(inspection: ImageInspection): Accepted {
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

async function isLegacyPhoto(deps: ImageDeps, upload: PhotoUpload): Promise<boolean> {
    const current = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    return current?.legacyId !== undefined;
}

async function refuseDuplicate(deps: ImageDeps, upload: PhotoUpload, sha256: string): Promise<void> {
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

export async function render(deps: ImageDeps, bytes: Uint8Array): Promise<readonly [Derivative, Derivative]> {
    const encode = async (variant: PhotoVariant, from: Uint8Array): Promise<Derivative> => ({
        variant,
        ...(await deps.images.webp(from, DERIVATIVES[variant]).catch(refuseUnreadable)),
    });
    const web = await encode('web', bytes);
    return [web, await encode('thumb', web.bytes)];
}

export async function store(deps: ImageDeps, upload: PhotoUpload, sha256: string, derivative: Derivative): Promise<string> {
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

async function hold(deps: ImageDeps, upload: PhotoUpload, sha256: string, derivative: Derivative): Promise<string> {
    const path = STORAGE_PATHS.reviewHeld(upload.cityId, upload.photoId, sha256, derivative.variant);
    await deps.blobs.write('private', path, derivative.bytes, { contentType: 'image/webp' });
    return path;
}

async function stored(deps: ImageDeps, upload: PhotoUpload, held: boolean, rendered: Rendered) {
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

export async function processPhotoBytes(deps: ImageDeps, imageUpload: ImageUpload): Promise<Processed> {
    const { upload, object, held, bytes } = imageUpload;
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
