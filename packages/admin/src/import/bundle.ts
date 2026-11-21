import { isId, photoDocSchema, validate, type PhotoContentType, type PhotoDoc } from '@hcm/shared';
import { z } from 'zod';

/**
 * The legacy Bucharest bundle the admin build ships (`docs/research/M2b-interfaces.md` §3.3 h): `legacy/<city>/photos.json`
 * (the 45 records of `migrateLegacyPhotos`, each `{sourceFile, legacyId?, photo}`) and the originals under
 * `legacy/<city>/originals/`. A record becomes a new photo document with exactly the fields a client may create
 * (`CLIENT_WRITES.photo.create`), validated with `photoDocSchema` before anything is written.
 */

/** What a client writes on create, without the audit stamp (the store adds `updatedBy`, `updatedAt`, `createdBy`, `createdAt`). */
export type LegacyPhotoFields = Omit<PhotoDoc, 'updatedBy' | 'updatedAt' | 'createdBy' | 'createdAt'>;

export interface LegacyRecord {
    /** The photo document id: the record's stable slug. */
    readonly id: string;
    /** The original's file name inside `originals/`. */
    readonly sourceFile: string;
    readonly legacyId?: string;
    readonly fields: LegacyPhotoFields;
}

export interface InvalidRecord {
    /** The record's id when it has a usable one, else `#<index>`. */
    readonly id: string;
}

const SAFE_FILE_NAME = /^(?!\.)[^/\\]{1,255}$/;

const recordSchema = z.object({
    sourceFile: z.string().regex(SAFE_FILE_NAME),
    legacyId: z.string().min(1).max(64).optional(),
    photo: z.looseObject({ id: z.string().refine(isId) }),
});

/** The manifest photo fields a photo document keeps (the rest of the record, such as `image`, is not the client's). */
const COPIED = ['title', 'description', 'year', 'yearEnd', 'dateText', 'author', 'rightsHolder', 'location', 'bearing', 'fov'] as const;

/** A placeholder stamp: the store writes the real one (`serverTimestamp()`, the rules check it); validation needs a shape. */
const STAMP = { updatedBy: 'legacy-import', updatedAt: { seconds: 0, nanoseconds: 0 } };

function fieldsOf(photo: Readonly<Record<string, unknown>>, legacyId: string | undefined): Record<string, unknown> {
    const copied = Object.fromEntries(COPIED.filter((key) => photo[key] !== undefined).map((key) => [key, photo[key]]));
    const links = Array.isArray(photo['links']) && photo['links'].length > 0 ? { links: photo['links'] } : {};
    return {
        ...copied,
        ...links,
        ...(legacyId === undefined ? {} : { legacyId }),
        license: 'permission-legacy',
        rightsReview: true,
        published: false,
        processing: 'pending',
    };
}

/** One record as a photo to create, or the reason it cannot be one. */
export function legacyRecord(raw: unknown, index: number): LegacyRecord | InvalidRecord {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) {
        return { id: `#${String(index)}` };
    }
    const { sourceFile, legacyId, photo } = parsed.data;
    const fields = fieldsOf(photo, legacyId);
    const checked = validate(photoDocSchema, { ...fields, ...STAMP });
    if (!checked.ok) {
        return { id: photo.id };
    }
    return { id: photo.id, sourceFile, ...(legacyId === undefined ? {} : { legacyId }), fields: fields as LegacyPhotoFields };
}

export function isLegacyRecord(record: LegacyRecord | InvalidRecord): record is LegacyRecord {
    return 'fields' in record;
}

const CONTENT_TYPES: Readonly<Record<string, PhotoContentType>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
};

/** The upload's extension and content type from the original's name; undefined for a type the pipeline refuses. */
export function uploadType(sourceFile: string): { readonly extension: string; readonly contentType: PhotoContentType } | undefined {
    const extension = sourceFile.slice(sourceFile.lastIndexOf('.') + 1).toLowerCase();
    const contentType = CONTENT_TYPES[extension];
    return contentType === undefined ? undefined : { extension, contentType };
}

/** A bundle file's URL; `baseUrl` is the admin's absolute base (`document.baseURI` on Hosting). */
export function bundleUrl(baseUrl: string, cityId: string, file: string): string {
    return new URL(`legacy/${cityId}/${file}`, baseUrl).toString();
}

/**
 * How a bundle file's JSON is read: past the copy the browser holds (`no-cache`: asked of Hosting again, a 304 when it
 * did not change). The live finding of 2026-11-08: Hosting answered `legacy/<city>/photos.json` with a day's
 * `max-age`, so after a release grew the bundle from 45 to 57 records the owner's browser kept the 45 for a day and step
 * (h) said every photo was on the map. A copy cached under the old header is refused too, which a header alone cannot do.
 */
export const BUNDLE_READ: RequestInit = { cache: 'no-cache' };

/** A bundle file's JSON as Hosting has it now, or undefined when Hosting does not serve it. */
export async function bundleJson(fetcher: typeof fetch, baseUrl: string, cityId: string, file: string): Promise<unknown> {
    const response = await fetcher(bundleUrl(baseUrl, cityId, file), BUNDLE_READ);
    return response.ok ? ((await response.json()) as unknown) : undefined;
}
