import type { ApiErrorCode, PhotoContentType } from '@hcm/shared';

import type { LegacyPhotoFields } from '../../src/import/bundle.js';
import type { LegacyPhotoStore, PhotoHistory, PhotoState } from '../../src/import/legacy-import.js';

/**
 * An in-memory Firestore and Storage for the legacy import's tests: documents by id, uploads recorded, and a simulated
 * `photos.onUpload` that processes an upload (or refuses it) and notifies the document's watchers, as `onSnapshot`
 * does: once at once with the current document, then on every change. Each photo's history is kept as the history
 * triggers keep it: what a person did (a delete, an unpublish), kept after a delete.
 */

interface StoredPhoto extends PhotoState {
    readonly legacyId?: string;
}

interface Upload {
    readonly path: string;
    readonly contentType: PhotoContentType;
    readonly originalName: string;
    readonly bytes: number;
}

export interface MemoryStore extends LegacyPhotoStore {
    readonly docs: Map<string, StoredPhoto>;
    readonly created: string[];
    readonly uploads: Upload[];
    readonly published: string[];
    /** The photos sent to `photos.reprocess` (M6), in order. */
    readonly reprocessed: string[];
    /** `photos.reprocess`: a new upload of the photo, whose event `outcome` decides again (M6, finding 17). */
    reprocess(photoId: string): void;
    /** Watchers still listening. */
    watchers(): number;
    /** Each photo's history, by id (kept after a delete, as the subcollection is). */
    readonly past: Map<string, PhotoHistory>;
    /** What an owner does in the admin: unpublish or delete a photo (its history stays). */
    unpublishByHand(photoId: string): void;
    deleteByHand(photoId: string): void;
}

export interface MemoryStoreOptions {
    /**
     * What processing makes of a photo's upload: done (the default), a refusal, or nothing (its event never reaches the
     * server, M6: so it stays `pending`); asked again for each upload, a reprocess's included.
     */
    readonly outcome?: (photoId: string) => 'done' | ApiErrorCode | 'never' | 'deleted';
    /** Process right after the upload resolves (the default), or only after the watcher is attached. */
    readonly processing?: 'immediate' | 'later';
}

export function createMemoryStore(options: MemoryStoreOptions = {}): MemoryStore {
    const docs = new Map<string, StoredPhoto>();
    const listeners = new Map<string, Set<(state: PhotoState | null) => void>>();
    const created: string[] = [];
    const uploads: Upload[] = [];
    const published: string[] = [];
    const reprocessed: string[] = [];
    const past = new Map<string, PhotoHistory>();
    const remember = (photoId: string, change: Partial<PhotoHistory>): void => {
        past.set(photoId, { deleted: false, everPublished: false, ...past.get(photoId), ...change });
    };
    const notify = (photoId: string): void => {
        listeners.get(photoId)?.forEach((listener) => {
            listener(docs.get(photoId) ?? null);
        });
    };
    const process = (photoId: string): void => {
        const outcome = options.outcome?.(photoId) ?? 'done';
        const current = docs.get(photoId);
        if (outcome === 'never' || current === undefined) {
            return;
        }
        if (outcome === 'deleted') {
            docs.delete(photoId);
        } else {
            docs.set(
                photoId,
                outcome === 'done'
                    ? { ...current, processing: 'done', hasImage: true }
                    : { ...current, processing: 'failed', processingError: outcome },
            );
        }
        notify(photoId);
    };
    return {
        docs,
        created,
        uploads,
        published,
        reprocessed,
        past,
        unpublishByHand: (photoId) => {
            const current = docs.get(photoId);
            if (current !== undefined) {
                remember(photoId, { everPublished: current.published });
                docs.set(photoId, { ...current, published: false });
            }
        },
        deleteByHand: (photoId) => {
            remember(photoId, { deleted: true });
            docs.delete(photoId);
        },
        history: (_cityId, photoId) => Promise.resolve(past.get(photoId) ?? { deleted: false, everPublished: false }),
        reprocess: (photoId) => {
            reprocessed.push(photoId);
            process(photoId);
        },
        watchers: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
        read: (_cityId, photoId) => Promise.resolve(docs.get(photoId) ?? null),
        findByLegacyId: (_cityId, legacyId) => Promise.resolve([...docs].find(([, doc]) => doc.legacyId === legacyId)?.[0] ?? null),
        create: (_cityId, photoId, fields: LegacyPhotoFields) => {
            created.push(photoId);
            docs.set(photoId, {
                processing: 'pending',
                hasImage: false,
                published: false,
                ...(fields.legacyId === undefined ? {} : { legacyId: fields.legacyId }),
            });
            return Promise.resolve();
        },
        upload: async (path, file, metadata) => {
            uploads.push({ path, ...metadata, bytes: (await file.arrayBuffer()).byteLength });
            const photoId = path.split('/')[4] ?? '';
            if (options.processing === 'later') {
                setTimeout(() => {
                    process(photoId);
                }, 0);
            } else {
                process(photoId);
            }
        },
        watch: (_cityId, photoId, listener) => {
            const set = listeners.get(photoId) ?? new Set();
            set.add(listener);
            listeners.set(photoId, set);
            listener(docs.get(photoId) ?? null);
            return () => {
                set.delete(listener);
            };
        },
        publish: (_cityId, photoId) => {
            published.push(photoId);
            const current = docs.get(photoId);
            if (current !== undefined) {
                docs.set(photoId, { ...current, published: true });
            }
            return Promise.resolve();
        },
    };
}
