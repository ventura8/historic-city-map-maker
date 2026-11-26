/**
 * Batch upload (`docs/research/M2c-interfaces.md` §6.2, behaviour A08): every dropped or chosen file is checked in the
 * page, gets its photo document (the sticky fields, the last pin or the city's centre), then a resumable upload into
 * that photo's folder, three at a time, each with its progress. Once `photos.onUpload` has processed it, a photo the
 * admin has not touched gets its EXIF suggestions in one stamped update; one without a usable position is marked
 * "check the place". A refused file shows the server's reason; an interrupted upload offers Retry into the same
 * document; Cancel removes a new photo whose file never arrived. The queue lives as long as the area (until sign-out),
 * so leaving the page does not stop an upload.
 */
import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    bboxCenter,
    photoDocSchema,
    type AdminContentKey,
    type ApiErrorCode,
    type BBox,
    type LngLat,
    type PhotoDoc,
} from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { UploadEnd, UploadHandle } from '../firebase/uploads.js';
import { autofillOf } from './autofill.js';
import { writeErrorKey } from './messages.js';
import { nullable } from './model.js';
import type { Stored } from '../content/services.js';
import type { PhotosServices } from './ports.js';
import type { PhotoMemory } from './session.js';
import { checkFile, newPhotoFields, originalName, uploadFileName, type PhotoFile, type UploadKind } from './upload-plan.js';

/** Uploads running at once. */
export const UPLOAD_CONCURRENCY = 3;

type UploadPhase = 'refused' | 'queued' | 'uploading' | 'processing' | 'done' | 'failed' | 'interrupted' | 'cancelled';

export interface UploadItem {
    readonly key: number;
    /** The file's name on the admin's computer, shown as text. */
    readonly name: string;
    readonly photoId: string | null;
    readonly phase: UploadPhase;
    /** 0 to 100. */
    readonly percent: number;
    readonly error: AdminContentKey | ApiErrorCode | null;
    readonly params: Readonly<Record<string, string>> | null;
    /** The photo a refused duplicate repeats. */
    readonly duplicateOf: string | null;
}

interface Entry {
    item: UploadItem;
    readonly file: PhotoFile;
    readonly kind: UploadKind | null;
    handle: UploadHandle | null;
    unwatch: Unsubscribe | null;
}

export interface UploadQueueDeps {
    readonly services: Pick<PhotosServices, 'cityId' | 'store' | 'uploads' | 'user' | 'log' | 'cityRole'>;
    readonly memory: PhotoMemory;
    /** The city's bounds, once read (the fallback pin is their centre; EXIF positions are checked against them). */
    readonly bounds: () => BBox | null;
    readonly changed: (items: readonly UploadItem[]) => void;
}

const FINISHED: ReadonlySet<UploadPhase> = new Set(['refused', 'done', 'failed', 'cancelled']);
const RETRYABLE: ReadonlySet<UploadPhase> = new Set(['interrupted', 'failed']);

const END_PHASES: Readonly<Record<Exclude<UploadEnd, { ok: true }>['reason'], UploadPhase>> = {
    cancelled: 'cancelled',
    interrupted: 'interrupted',
    denied: 'failed',
    failed: 'interrupted',
};

export class UploadQueue {
    readonly #deps: UploadQueueDeps;
    readonly #entries: Entry[] = [];
    /** Photos created in this session that the admin has not touched yet: their suggestions are applied. */
    readonly #untouched = new Set<string>();
    /** Photos created in this session (their editor starts with Published on: publish on save). */
    readonly #created = new Set<string>();
    #next = 1;

    constructor(deps: UploadQueueDeps) {
        this.#deps = deps;
    }

    get items(): readonly UploadItem[] {
        return this.#entries.map((entry) => entry.item);
    }

    /** Checks each file and queues the accepted ones (a refused one is listed with its reason, nothing written). */
    add(files: readonly PhotoFile[]): void {
        for (const file of files) {
            const check = checkFile(file);
            const item: UploadItem = {
                ...{ key: this.#next, name: file.name, photoId: null, percent: 0, duplicateOf: null },
                ...(check.ok
                    ? { phase: 'queued', error: null, params: null }
                    : { phase: 'refused', error: check.error, params: check.params ?? null }),
            };
            this.#next += 1;
            this.#entries.push({ item, file, kind: check.ok ? check.kind : null, handle: null, unwatch: null });
        }
        this.#emit();
        this.#pump();
    }

    /** An interrupted or failed upload again, into the same photo document. */
    retry(key: number): void {
        const entry = this.#find(key);
        if (entry !== undefined && RETRYABLE.has(entry.item.phase)) {
            this.#update(entry, { phase: 'queued', percent: 0, error: null, params: null });
            this.#pump();
        }
    }

    /** Stops an upload; a new photo whose file never arrived is removed. */
    cancel(key: number): void {
        const entry = this.#find(key);
        if (entry === undefined || FINISHED.has(entry.item.phase)) {
            return;
        }
        entry.handle?.cancel();
        this.#settle(entry, { phase: 'cancelled' });
        void this.#removeDocument(entry);
    }

    /** Drops a finished item from the list. */
    dismiss(key: number): void {
        const index = this.#entries.findIndex((entry) => entry.item.key === key && FINISHED.has(entry.item.phase));
        if (index >= 0) {
            this.#entries.splice(index, 1);
            this.#emit();
        }
    }

    /** Drops every finished item. */
    clearFinished(): void {
        const kept = this.#entries.filter((entry) => !FINISHED.has(entry.item.phase));
        this.#entries.splice(0, this.#entries.length, ...kept);
        this.#emit();
    }

    /** The admin edited the photo: its suggestions are no longer applied by themselves. */
    touched(photoId: string): void {
        this.#untouched.delete(photoId);
    }

    /** Created in this session: its editor starts with Published on (publish on save, §5.4). */
    isNew(photoId: string): boolean {
        return this.#created.has(photoId);
    }

    /** An upload is still being sent. */
    busy(): boolean {
        return this.#entries.some((entry) => entry.item.phase === 'uploading');
    }

    destroy(): void {
        for (const entry of this.#entries) {
            entry.handle?.cancel();
            entry.unwatch?.();
        }
        this.#entries.length = 0;
    }

    #find(key: number): Entry | undefined {
        return this.#entries.find((entry) => entry.item.key === key);
    }

    #emit(): void {
        this.#deps.changed(this.items);
    }

    #update(entry: Entry, patch: Partial<UploadItem>): void {
        entry.item = { ...entry.item, ...patch };
        this.#emit();
    }

    /** A final phase: the item's upload and watch are over. */
    #settle(entry: Entry, patch: Partial<UploadItem>): void {
        entry.unwatch?.();
        entry.unwatch = null;
        entry.handle = null;
        this.#update(entry, patch);
        this.#pump();
    }

    /** The city has been read: uploads that waited for its centre start. */
    cityKnown(): void {
        this.#pump();
    }

    /**
     * Starts queued uploads while fewer than `UPLOAD_CONCURRENCY` run, once a photo can be placed: the last pin, or the
     * city's centre once the city is read. A file dropped before that waits: a photo at no place is refused by the rules.
     */
    #pump(): void {
        const pin = this.#pin();
        if (pin === null) {
            return;
        }
        const running = this.#entries.filter((entry) => entry.item.phase === 'uploading').length;
        const waiting = this.#entries.filter((entry) => entry.item.phase === 'queued').slice(0, Math.max(0, UPLOAD_CONCURRENCY - running));
        for (const entry of waiting) {
            this.#update(entry, { phase: 'uploading', percent: 0 });
            void this.#run(entry, pin);
        }
    }

    async #run(entry: Entry, pin: LngLat): Promise<void> {
        const photoId = entry.item.photoId ?? (await this.#createDocument(entry, pin));
        if (photoId === null) {
            return;
        }
        if (entry.item.phase === 'uploading') {
            this.#send(entry, photoId);
        } else {
            // Cancelled while its document was being created.
            await this.#removeDocument(entry);
        }
    }

    /** The fallback pin: the last one the admin placed, else the city's centre; null before the city is read. */
    #pin(): LngLat | null {
        const bounds = this.#deps.bounds();
        return this.#deps.memory.lastPin() ?? (bounds === null ? null : bboxCenter(bounds));
    }

    async #createDocument(entry: Entry, pin: LngLat): Promise<string | null> {
        const { store, cityId } = this.#deps.services;
        const photoId = store.newId();
        // M13 §2: an uploader's photo waits for review and, until they place it, has no location.
        const uploader = this.#deps.services.cityRole() === 'uploader';
        const made = newPhotoFields(entry.file, photoId, this.#deps.memory.sticky(), uploader ? null : pin);
        const fields = uploader ? { ...made, reviewStatus: 'pending' } : made;
        const outcome = await store.create(FIRESTORE_PATHS.photo(cityId, photoId), fields, { withCreator: true });
        if (!outcome.ok) {
            if (entry.item.phase === 'uploading') {
                this.#settle(entry, { phase: 'failed', error: writeErrorKey(outcome.reason) });
            }
            return null;
        }
        this.#created.add(photoId);
        this.#untouched.add(photoId);
        this.#update(entry, { photoId });
        return photoId;
    }

    #send(entry: Entry, photoId: string): void {
        const { uploads, cityId, user, store } = this.#deps.services;
        const uid = user()?.uid;
        if (uid === undefined) {
            this.#settle(entry, { phase: 'failed', error: 'apiError.unauthenticated' });
            return;
        }
        const kind = entry.kind ?? { ext: 'jpg', contentType: 'image/jpeg' };
        const path = STORAGE_PATHS.photoUpload(cityId, uid, photoId, uploadFileName(store.newId(), kind.ext));
        const request = {
            path,
            data: entry.file.data,
            contentType: kind.contentType,
            customMetadata: { originalName: originalName(entry.file.name) },
        };
        const handle = uploads.start(request, (progress) => {
            const percent = progress.total === 0 ? 0 : Math.round((progress.sent / progress.total) * 100);
            this.#update(entry, { percent });
        });
        entry.handle = handle;
        void handle.finished.then((end) => {
            this.#sent(entry, photoId, end);
        });
    }

    #sent(entry: Entry, photoId: string, end: UploadEnd): void {
        if (entry.item.phase !== 'uploading') {
            return;
        }
        if (end.ok) {
            entry.handle = null;
            this.#update(entry, { phase: 'processing', percent: 100 });
            this.#watch(entry, photoId);
            this.#pump();
            return;
        }
        const error = end.reason === 'denied' ? 'apiError.notAdmin' : 'adminContent.photos.upload.interrupted';
        this.#settle(entry, { phase: END_PHASES[end.reason], error });
    }

    #watch(entry: Entry, photoId: string): void {
        const { store, cityId, log } = this.#deps.services;
        entry.unwatch = store.watchDoc(
            FIRESTORE_PATHS.photo(cityId, photoId),
            photoDocSchema,
            (stored) => {
                void this.#processed(entry, stored);
            },
            (failure) => {
                log.warn('photo watch failed', { photoId, failure });
            },
        );
    }

    async #processed(entry: Entry, stored: Stored<PhotoDoc> | null): Promise<void> {
        if (stored === null) {
            this.#settle(entry, { phase: 'cancelled' });
            return;
        }
        const photo = stored.data;
        if (photo.processing === 'failed') {
            this.#refused(entry, photo);
        } else if (photo.processing === 'done') {
            this.#settle(entry, { phase: 'done' });
            await this.#autofill(stored);
        }
    }

    /** `photos.onUpload` refused the file: its reason, and the photo it repeats. */
    #refused(entry: Entry, photo: PhotoDoc): void {
        this.#settle(entry, {
            phase: 'failed',
            error: photo.processingError ?? 'apiError.internal',
            duplicateOf: nullable(photo.duplicateOf),
        });
    }

    /** Applies the suggestions to a photo the admin has not touched, once (§6.2 step 4). */
    async #autofill(stored: Stored<PhotoDoc>): Promise<void> {
        const bounds = this.#deps.bounds();
        if (!this.#untouched.delete(stored.id) || bounds === null) {
            return;
        }
        const autofill = autofillOf(stored.data, bounds);
        this.#deps.memory.markCheckPlace(stored.id, autofill.checkPlace);
        if (Object.keys(autofill.fields).length === 0) {
            return;
        }
        const { store, cityId, log } = this.#deps.services;
        const outcome = await store.update(FIRESTORE_PATHS.photo(cityId, stored.id), autofill.fields, stored.version);
        if (!outcome.ok) {
            log.warn('photo suggestions not applied', { photoId: stored.id, reason: outcome.reason });
        }
    }

    async #removeDocument(entry: Entry): Promise<void> {
        const photoId = entry.item.photoId;
        if (photoId === null) {
            return;
        }
        const outcome = await this.#deps.services.store.remove(FIRESTORE_PATHS.photo(this.#deps.services.cityId, photoId), null);
        this.#created.delete(photoId);
        this.#untouched.delete(photoId);
        if (!outcome.ok) {
            this.#deps.services.log.warn('cancelled photo not removed', { photoId, reason: outcome.reason });
        }
    }
}
