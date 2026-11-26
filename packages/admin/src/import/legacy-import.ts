import { STORAGE_PATHS, type ApiErrorCode, type Logger, type PhotoContentType } from '@hcm/shared';

import { bundleJson, bundleUrl, isLegacyRecord, legacyRecord, uploadType, type LegacyPhotoFields, type LegacyRecord } from './bundle.js';

/**
 * The legacy Bucharest import (`docs/research/M2b-interfaces.md` §3.3 h): one click creates a photo document per bundled
 * record and uploads its original through the normal upload path, so `photos.onUpload` makes the WebP files; each photo
 * is published once processed. Three at a time; idempotent by document id and `legacyId`, so a rerun or a closed tab
 * resumes where it stopped and never writes a photo twice. The store is admin-shell's Firestore and Storage adapter.
 *
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`; S-A28-HAPPY-STUCK-REPROCESSED, S-A28-BAD-STUCK-AGAIN): an
 * upload whose event never reaches the server (Eventarc refused, the event functions' account lacked `roles/run.invoker`)
 * leaves its photo `pending`. After {@link STUCK_PHOTO_MS} the photo is sent to `photos.reprocess` once, which uploads it
 * again (a new event); still `pending` as long again, it is listed as not received (`apiError.photo.notReceived`, which
 * names the role) and the import goes on with the others: no photo waits ten minutes any more.
 *
 * The 2023 additions (`docs/research/M5-interfaces.md` → *The 2023 additions*): the bundle grew from 45 to 57 records, so a
 * project that imported the 45 imports again to add the 12. That run must leave the 45 as their owner left them: a photo
 * whose document is gone and whose history has a person's delete is never created again, and a processed photo that is
 * unpublished although a person changed a published version of it was unpublished by someone and is never published
 * again. Both count as done. Only a photo without a history (an import that stopped before its publish) is resumed.
 */

/** What the import reads of a photo document. */
export interface PhotoState {
    readonly processing: 'pending' | 'done' | 'failed';
    /** `photos.onUpload` wrote the image. */
    readonly hasImage: boolean;
    readonly published: boolean;
    readonly processingError?: ApiErrorCode;
}

/**
 * What a photo's `history` subcollection (written by the history triggers, kept after a delete) says a person did to it:
 * only entries stamped with a person's uid count, never the server's (`system:…`, or a service account's e-mail, as a
 * function's own delete and the e2e world's reset are stamped).
 */
export interface PhotoHistory {
    /** A person deleted the photo (a `delete` entry). */
    readonly deleted: boolean;
    /** A person changed a published version of it (an entry's `previous` has `published: true`). */
    readonly everPublished: boolean;
}

/** The Firestore and Storage operations of the import (admin-shell's adapters, `packages/admin/src/firebase/`). */
export interface LegacyPhotoStore {
    read(cityId: string, photoId: string): Promise<PhotoState | null>;
    /** The id of a photo that already has this `legacyId`, or null. */
    findByLegacyId(cityId: string, legacyId: string): Promise<string | null>;
    /** `setDoc` of the fields plus the caller's stamp (`updatedBy`/`createdBy` = uid, `updatedAt`/`createdAt` = `serverTimestamp()`). */
    create(cityId: string, photoId: string, fields: LegacyPhotoFields): Promise<void>;
    /** Uploads to the private bucket with `customMetadata.originalName`. */
    upload(path: string, file: Blob, metadata: { readonly contentType: PhotoContentType; readonly originalName: string }): Promise<void>;
    /** Calls `listener` with the document on every change (null once deleted) until the returned function is called. */
    watch(cityId: string, photoId: string, listener: (state: PhotoState | null) => void): () => void;
    /** `published: true` with the caller's stamp. */
    publish(cityId: string, photoId: string): Promise<void>;
    /** The photo's history, read only. */
    history(cityId: string, photoId: string): Promise<PhotoHistory>;
}

export interface LegacyImportDeps {
    /** Fetches the bundled files (same origin). */
    readonly fetch: typeof fetch;
    readonly store: LegacyPhotoStore;
    readonly cityId: string;
    /** The admin's absolute base URL, where `legacy/<city>/` is served. */
    readonly baseUrl: string;
    /** The signed-in admin's uid (the upload path); null when signed out. */
    readonly uid: () => string | null;
    /** A fresh upload file name stem (`crypto.randomUUID()`). */
    readonly nonce: () => string;
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: Logger;
    /** `photos.reprocess` for a photo of the city (M6: a photo whose upload event never arrived). */
    readonly reprocess: (cityId: string, photoId: string) => Promise<void>;
    /** Photos in flight at once (default 3). */
    readonly concurrency?: number;
    /** How long a photo may stay `pending` after its upload before it counts as stuck (default {@link STUCK_PHOTO_MS}). */
    readonly stuckAfterMs?: number;
}

/** M6: two minutes without the upload's event; `photos.onUpload` takes seconds, a cold start well under a minute. */
export const STUCK_PHOTO_MS = 120_000;

interface LegacyImportFailure {
    readonly id: string;
    readonly detail: ApiErrorCode;
}

export interface LegacyImportProgress {
    /** Photos imported, processed and published. */
    readonly done: number;
    readonly total: number;
    readonly failed: readonly LegacyImportFailure[];
    /** Photos already on the map that get the old site's direction (`legacy-fixes.ts`); none when absent. */
    readonly directions?: number;
    /** The city's credits do not name every bundled photo's author yet (`legacy-fixes.ts`). */
    readonly credits?: boolean;
}

export interface LegacyImport {
    /** What is already imported, read only. */
    detect(): Promise<LegacyImportProgress>;
    run(onProgress: (progress: LegacyImportProgress) => void): Promise<LegacyImportProgress>;
}

/** How one record ended: imported (`done`), not yet (`open`: detect only), or `failed` with its reason. */
interface Outcome {
    readonly id: string;
    readonly status: 'done' | 'open' | 'failed';
    readonly detail?: ApiErrorCode;
}

const TIMEOUT = Symbol('timeout');
/** Still `pending` after `photos.reprocess`: the server never received either upload. */
const STUCK = Symbol('stuck');

/** Whether the photo is processed and has its image. */
function processed(state: PhotoState): boolean {
    return state.processing === 'done' && state.hasImage;
}

function failure(id: string, detail: ApiErrorCode): Outcome {
    return { id, status: 'failed', detail };
}

function settledAs(id: string, status: 'done' | 'open'): Outcome {
    return { id, status };
}

/** The failure a processed-and-failed document names (its `processingError`, else unreadable). */
function failedProcessing(id: string, state: PhotoState): Outcome {
    return failure(id, state.processingError ?? 'apiError.photo.unreadable');
}

/** What an existing document says: done (processed and published), failed (processing refused the file), or open. */
function outcomeOf(id: string, state: PhotoState): Outcome {
    if (state.processing === 'failed' && !state.hasImage) {
        return failedProcessing(id, state);
    }
    return settledAs(id, processed(state) && state.published ? 'done' : 'open');
}

/** Runs `work` over `items`, `size` at a time, reporting each outcome as it settles. */
async function inPool<T extends object, R>(
    items: readonly T[],
    size: number,
    work: (item: T) => Promise<R>,
    settled: (outcome: R) => void,
): Promise<void> {
    const queue = [...items];
    const worker = async (): Promise<void> => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
            settled(await work(item));
        }
    };
    await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

/**
 * The `legacyId`s that more than one record carries: the old site gave two different photos the same id (Bateriilor and
 * Ferdinand, `seed/bucharest/photos.legacy.geojson`), so such an id cannot tell that a photo was imported under another
 * document id; only the document id identifies those records.
 */
function sharedLegacyIds(records: readonly LegacyRecord[]): ReadonlySet<string> {
    const seen = new Set<string>();
    const shared = new Set<string>();
    for (const legacyId of records.map((record) => record.legacyId)) {
        if (legacyId !== undefined) {
            (seen.has(legacyId) ? shared : seen).add(legacyId);
        }
    }
    return shared;
}

class Importer implements LegacyImport {
    readonly #deps: LegacyImportDeps;
    #shared: ReadonlySet<string> = new Set();

    constructor(deps: LegacyImportDeps) {
        this.#deps = deps;
    }

    async detect(): Promise<LegacyImportProgress> {
        return this.#each(
            () => undefined,
            (record) => this.#detectOne(record),
        );
    }

    async run(onProgress: (progress: LegacyImportProgress) => void): Promise<LegacyImportProgress> {
        const uid = this.#deps.uid();
        if (uid === null) {
            throw new Error('the legacy import needs a signed-in admin');
        }
        return this.#each(onProgress, (record) => this.#importOne(record, uid));
    }

    async #each(
        onProgress: (progress: LegacyImportProgress) => void,
        work: (record: LegacyRecord) => Promise<Outcome>,
    ): Promise<LegacyImportProgress> {
        const records = (await this.#records()).map(legacyRecord);
        const failed: LegacyImportFailure[] = records
            .filter((record) => !isLegacyRecord(record))
            .map((record) => ({ id: record.id, detail: 'apiError.invalidRequest' }));
        this.#shared = sharedLegacyIds(records.filter(isLegacyRecord));
        let done = 0;
        const progress = (): LegacyImportProgress => ({ done, total: records.length, failed: [...failed] });
        const count = (outcome: Outcome): void => {
            done += outcome.status === 'done' ? 1 : 0;
            if (outcome.detail !== undefined) {
                failed.push({ id: outcome.id, detail: outcome.detail });
            }
            onProgress(progress());
        };
        onProgress(progress());
        await inPool(records.filter(isLegacyRecord), this.#deps.concurrency ?? 3, (record) => this.#safely(record, work), count);
        return progress();
    }

    async #records(): Promise<readonly unknown[]> {
        const body = await bundleJson(this.#deps.fetch, this.#deps.baseUrl, this.#deps.cityId, 'photos.json');
        if (!Array.isArray(body)) {
            throw new Error(`the legacy bundle of ${this.#deps.cityId} is unavailable`);
        }
        return body as readonly unknown[];
    }

    /** A record whose store call failed is listed as unavailable (a rerun tries it again); the others go on. */
    async #safely(record: LegacyRecord, work: (record: LegacyRecord) => Promise<Outcome>): Promise<Outcome> {
        try {
            return await work(record);
        } catch (error) {
            this.#deps.log.warn('legacy import: a photo failed', {
                photo: record.id,
                error: error instanceof Error ? error.name : 'unknown',
            });
            return failure(record.id, 'apiError.unavailable');
        }
    }

    async #detectOne(record: LegacyRecord): Promise<Outcome> {
        const state = await this.#deps.store.read(this.#deps.cityId, record.id);
        if (state === null) {
            return settledAs(record.id, (await this.#imported(record)) ? 'done' : 'open');
        }
        return this.#detectExisting(record, state);
    }

    /** A processed photo still unpublished is open, unless someone unpublished it; any other document says it itself. */
    async #detectExisting(record: LegacyRecord, state: PhotoState): Promise<Outcome> {
        if (processed(state) && !state.published) {
            return settledAs(record.id, (await this.#unpublishedByHand(record)) ? 'done' : 'open');
        }
        return outcomeOf(record.id, state);
    }

    /** A record without a document was imported: under another id, or deleted by a person since. */
    async #imported(record: LegacyRecord): Promise<boolean> {
        return (await this.#importedElsewhere(record)) || (await this.#history(record)).deleted;
    }

    /** A processed, unpublished photo that was published once: someone unpublished it, and the import leaves it so. */
    async #unpublishedByHand(record: LegacyRecord): Promise<boolean> {
        return (await this.#history(record)).everPublished;
    }

    #history(record: LegacyRecord): Promise<PhotoHistory> {
        return this.#deps.store.history(this.#deps.cityId, record.id);
    }

    async #importedElsewhere(record: LegacyRecord): Promise<boolean> {
        const { legacyId } = record;
        if (legacyId === undefined || this.#shared.has(legacyId)) {
            return false;
        }
        return (await this.#deps.store.findByLegacyId(this.#deps.cityId, legacyId)) !== null;
    }

    async #importOne(record: LegacyRecord, uid: string): Promise<Outcome> {
        const state = await this.#deps.store.read(this.#deps.cityId, record.id);
        if (state === null) {
            return this.#importNew(record, uid);
        }
        if (!processed(state)) {
            return this.#uploadAndFinish(record, uid);
        }
        return !state.published && (await this.#unpublishedByHand(record)) ? settledAs(record.id, 'done') : this.#publish(record, state);
    }

    async #importNew(record: LegacyRecord, uid: string): Promise<Outcome> {
        if (await this.#imported(record)) {
            return settledAs(record.id, 'done');
        }
        await this.#deps.store.create(this.#deps.cityId, record.id, record.fields);
        return this.#uploadAndFinish(record, uid);
    }

    async #uploadAndFinish(record: LegacyRecord, uid: string): Promise<Outcome> {
        const uploaded = await this.#upload(record, uid);
        return uploaded ?? this.#finish(record);
    }

    /** Uploads the original; resolves to undefined once uploaded, else to the failure. */
    async #upload(record: LegacyRecord, uid: string): Promise<Outcome | undefined> {
        const type = uploadType(record.sourceFile);
        if (type === undefined) {
            return failure(record.id, 'apiError.photo.unsupportedType');
        }
        const url = bundleUrl(this.#deps.baseUrl, this.#deps.cityId, `originals/${encodeURIComponent(record.sourceFile)}`);
        const response = await this.#deps.fetch(url);
        if (!response.ok) {
            return failure(record.id, response.status === 404 ? 'apiError.notFound' : 'apiError.unavailable');
        }
        const path = STORAGE_PATHS.photoUpload(this.#deps.cityId, uid, record.id, `${this.#deps.nonce()}.${type.extension}`);
        await this.#deps.store.upload(path, await response.blob(), { contentType: type.contentType, originalName: record.sourceFile });
        return undefined;
    }

    /** Waits for `photos.onUpload`, then publishes; a failed processing is listed with its reason. */
    async #finish(record: LegacyRecord): Promise<Outcome> {
        const state = await this.#settled(record);
        if (state === STUCK) {
            return failure(record.id, 'apiError.photo.notReceived');
        }
        if (state === null) {
            return failure(record.id, 'apiError.notFound');
        }
        return state.processing === 'failed' ? failedProcessing(record.id, state) : this.#publish(record, state);
    }

    /** The photo once processed or failed; a photo still `pending` after its wait is reprocessed once, then stuck. */
    async #settled(record: LegacyRecord): Promise<PhotoState | null | typeof STUCK> {
        const first = await this.#processing(record.id);
        if (first !== TIMEOUT) {
            return first;
        }
        this.#deps.log.warn('legacy import: the upload event never arrived, reprocessing the photo', { photo: record.id });
        await this.#deps.reprocess(this.#deps.cityId, record.id);
        const second = await this.#processing(record.id);
        return second === TIMEOUT ? STUCK : second;
    }

    async #publish(record: LegacyRecord, state: PhotoState): Promise<Outcome> {
        if (!state.published) {
            await this.#deps.store.publish(this.#deps.cityId, record.id);
        }
        return settledAs(record.id, 'done');
    }

    /** The document once processed or failed (null once deleted), or the timeout. */
    #processing(photoId: string): Promise<PhotoState | null | typeof TIMEOUT> {
        return new Promise((resolve) => {
            const watching = { settled: false, stop: (): void => undefined };
            const settle = (value: PhotoState | null | typeof TIMEOUT): void => {
                if (!watching.settled) {
                    watching.settled = true;
                    watching.stop();
                    resolve(value);
                }
            };
            const stop = this.#deps.store.watch(this.#deps.cityId, photoId, (state) => {
                if (state === null || processed(state) || state.processing === 'failed') {
                    settle(state);
                }
            });
            watching.stop = stop;
            if (watching.settled) {
                stop();
            }
            void this.#deps.sleep(this.#deps.stuckAfterMs ?? STUCK_PHOTO_MS).then(() => {
                settle(TIMEOUT);
            });
        });
    }
}

export function createLegacyImport(deps: LegacyImportDeps): LegacyImport {
    return new Importer(deps);
}
