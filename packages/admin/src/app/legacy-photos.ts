/**
 * The legacy import's store (google-clients' `LegacyPhotoStore`, `packages/admin/src/import/legacy-import.ts`; CR-M2b-15)
 * over the shell's Firestore and Storage ports: the photo documents of a city and the private bucket's upload path. Every
 * write carries the stamp the rules check (`updatedBy` = the signed-in admin, `updatedAt` = `serverTimestamp()`, and on a
 * create `createdBy` and `createdAt` too), so a write is never refused for a missing stamp.
 */
import { FIRESTORE_PATHS, isApiErrorCode } from '@hcm/shared';
import { z } from 'zod';

import type { DocumentData, FirebasePorts } from '../firebase/ports.js';
import type { LegacyFixStore, PhotoPlace, PlaceHistory } from '../import/legacy-fixes.js';
import type { LegacyPhotoStore, PhotoHistory, PhotoState } from '../import/legacy-import.js';

const PROCESSING: ReadonlySet<string> = new Set(['pending', 'done', 'failed']);

function isProcessing(value: unknown): value is PhotoState['processing'] {
    return typeof value === 'string' && PROCESSING.has(value);
}

/** What the import reads of a photo document (an unknown processing state counts as pending). */
export function photoStateOf(data: DocumentData | null): PhotoState | null {
    if (data === null) {
        return null;
    }
    const raw = data['processing'];
    const processing = isProcessing(raw) ? raw : 'pending';
    const error = data['processingError'];
    return {
        processing,
        hasImage: 'image' in data,
        published: data['published'] === true,
        ...(isApiErrorCode(error) ? { processingError: error } : {}),
    };
}

function wasPublished(entry: DocumentData): boolean {
    const previous = entry['previous'];
    return typeof previous === 'object' && previous !== null && (previous as DocumentData)['published'] === true;
}

/**
 * An entry a person's write left: its stamp is a Firebase Auth uid. Not the server's: a delete without an account is
 * `system:<authType>`, and one by a service account (a function in production, the emulator's admin, which the e2e
 * world's reset is) carries that account's e-mail.
 */
function byPerson(entry: DocumentData): boolean {
    const writer = entry['updatedBy'];
    return typeof writer === 'string' && writer !== '' && !writer.startsWith('system:') && !writer.includes('@');
}

/** What a photo's history entries say a person did (`PhotoHistory`): a delete, and a change of a published version. */
export function photoHistoryOf(entries: readonly { readonly data: DocumentData }[]): PhotoHistory {
    const people = entries.map((entry) => entry.data).filter(byPerson);
    return { deleted: people.some((entry) => entry['action'] === 'delete'), everPublished: people.some(wasPublished) };
}

export function legacyPhotoStore(firebase: Pick<FirebasePorts, 'documents' | 'storage'>, uid: () => string | null): LegacyPhotoStore {
    const { documents, storage } = firebase;
    const stamp = (): DocumentData => ({ updatedBy: uid() ?? '', updatedAt: documents.serverTimestamp() });
    return {
        read: async (cityId, photoId) => photoStateOf(await documents.get(FIRESTORE_PATHS.photo(cityId, photoId))),
        findByLegacyId: async (cityId, legacyId) => {
            const found = await documents.query(FIRESTORE_PATHS.photos(cityId), [['legacyId', legacyId]]);
            return found[0]?.id ?? null;
        },
        create: async (cityId, photoId, fields) => {
            const created = { ...stamp(), createdBy: uid() ?? '', createdAt: documents.serverTimestamp() };
            await documents.set(FIRESTORE_PATHS.photo(cityId, photoId), { ...fields, ...created });
        },
        upload: (path, file, metadata) =>
            storage.upload(path, file, { contentType: metadata.contentType, customMetadata: { originalName: metadata.originalName } }),
        watch: (cityId, photoId, listener) =>
            documents.watch(
                FIRESTORE_PATHS.photo(cityId, photoId),
                (data) => {
                    listener(photoStateOf(data));
                },
                () => {
                    listener(null);
                },
            ),
        publish: (cityId, photoId) =>
            documents.set(FIRESTORE_PATHS.photo(cityId, photoId), { published: true, ...stamp() }, { merge: true }),
        history: async (cityId, photoId) =>
            photoHistoryOf(await documents.query(FIRESTORE_PATHS.history({ entity: 'photo', cityId, entityId: photoId }), [])),
    };
}

/** The rules keep a stored place valid (`validPhoto`); anything else is read as absent. */
const placeSchema = z.looseObject({
    location: z.strictObject({ lat: z.number(), lng: z.number() }).optional().catch(undefined),
    bearing: z.number().optional().catch(undefined),
    fov: z.number().optional().catch(undefined),
});

/** What the fixes read of a photo document: its point and direction, each left out when absent or malformed. */
export function photoPlaceOf(data: DocumentData | null): PhotoPlace | null {
    if (data === null) {
        return null;
    }
    const { location, bearing, fov } = placeSchema.parse(data);
    return {
        ...(location === undefined ? {} : { location }),
        ...(bearing === undefined ? {} : { bearing }),
        ...(fov === undefined ? {} : { fov }),
    };
}

function changed(entry: DocumentData, fields: readonly string[]): boolean {
    const names = entry['changedFields'];
    return entry['action'] !== 'create' && Array.isArray(names) && names.some((name) => fields.includes(String(name)));
}

/** What a photo's history entries say a person did to its place (`PlaceHistory`): moved it, aimed it. */
export function placeHistoryOf(entries: readonly { readonly data: DocumentData }[]): PlaceHistory {
    const people = entries.map((entry) => entry.data).filter(byPerson);
    return {
        placed: people.some((entry) => changed(entry, ['location'])),
        aimed: people.some((entry) => changed(entry, ['bearing', 'fov'])),
    };
}

/** The city's credits as the rules keep them (`validCity`). */
const creditsSchema = z.array(z.strictObject({ label: z.strictObject({ ro: z.string(), en: z.string() }), url: z.string().optional() }));

/** A city's credits (none: an empty list); null without a city, or with a list it does not understand, which it leaves alone. */
export function cityCreditsOf(city: DocumentData | null): z.infer<typeof creditsSchema> | null {
    const parsed = creditsSchema.safeParse(city?.['credits'] ?? []);
    return city === null || !parsed.success ? null : parsed.data;
}

/** The legacy fixes' store (`../import/legacy-fixes.ts`) over the shell's Firestore port; every write carries the stamp. */
export function legacyFixStore(firebase: Pick<FirebasePorts, 'documents'>, uid: () => string | null): LegacyFixStore {
    const { documents } = firebase;
    const stamp = (): DocumentData => ({ updatedBy: uid() ?? '', updatedAt: documents.serverTimestamp() });
    return {
        place: async (cityId, photoId) => photoPlaceOf(await documents.get(FIRESTORE_PATHS.photo(cityId, photoId))),
        history: async (cityId, photoId) =>
            placeHistoryOf(await documents.query(FIRESTORE_PATHS.history({ entity: 'photo', cityId, entityId: photoId }), [])),
        aim: (cityId, photoId, fields) => documents.set(FIRESTORE_PATHS.photo(cityId, photoId), { ...fields, ...stamp() }, { merge: true }),
        credits: async (cityId) => cityCreditsOf(await documents.get(FIRESTORE_PATHS.city(cityId))),
        saveCredits: (cityId, credits) => documents.set(FIRESTORE_PATHS.city(cityId), { credits, ...stamp() }, { merge: true }),
    };
}

/**
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`): the import's `photos.reprocess`, for a photo whose upload
 * event never reached the server; the callable uploads the photo's upload again, which is a new event.
 */
export function legacyReprocess(firebase: Pick<FirebasePorts, 'callables'>): (cityId: string, photoId: string) => Promise<void> {
    return async (cityId, photoId) => {
        await firebase.callables.call('photos.reprocess', { cityId, photoId });
    };
}
