/**
 * Replace image (`docs/research/M2c-interfaces.md` §6.4, behaviour A37): the new file goes into the photo's own upload
 * folder and the document is not touched (a `processing: 'pending'` would take a published photo off the public map).
 * `photos.onUpload` then swaps the image in one write, or keeps it and records why in `replacement` (CR-M2c-4); the
 * same file again leaves the image as it was. The editor shows "Processing the new image…" meanwhile (session state);
 * Cancel during the upload changes nothing (`S-A37-BAD-CANCEL-UPLOAD`). The same flow adds or replaces an improved or
 * colorized version (the owner 2026-11-09, A140): `version` goes into the upload's custom metadata, and `photos.onUpload`
 * writes `versions.<version>` instead of the image.
 */
import { STORAGE_PATHS, systemWriter, type AdminContentKey, type ApiErrorCode, type PhotoDoc } from '@hcm/shared';

import type { UploadEnd, UploadHandle } from '../firebase/uploads.js';
import type { Stored } from '../content/services.js';
import type { PhotosServices } from './ports.js';
import { checkFile, originalName, uploadFileName, type FileRefusal, type PhotoFile, type UploadKind } from './upload-plan.js';

type ReplacePhase = 'uploading' | 'processing' | 'replaced' | 'same' | 'refused' | 'failed';

export interface ReplaceState {
    readonly phase: ReplacePhase;
    /** 0 to 100 while uploading. */
    readonly percent: number;
    readonly error: AdminContentKey | ApiErrorCode | null;
    readonly params: Readonly<Record<string, string>> | null;
    /** The photo a refused duplicate repeats. */
    readonly duplicateOf: string | null;
}

/** The versions of a photo besides its original image. */
export type PhotoVersionKind = 'improved' | 'colorized';

export interface ReplacementDeps {
    readonly services: Pick<PhotosServices, 'cityId' | 'uploads' | 'user' | 'store'>;
    /** The version this replaces; absent: the photo's own image. */
    readonly version?: PhotoVersionKind;
    readonly changed: (state: ReplaceState | null) => void;
}

/** What `photos.onUpload` did with the new file, read from its write. */
type Result = Pick<ReplaceState, 'phase' | 'error' | 'duplicateOf'>;

const PHOTOS_WRITER = systemWriter('photos');

function timeOf(photo: PhotoDoc): string {
    const at = photo.replacement?.at;
    return at === undefined ? '' : `${String(at.seconds)}.${String(at.nanoseconds)}`;
}

/** A write of `photos.onUpload` after the replacement started. */
function isServerWrite(start: Stored<PhotoDoc>, stored: Stored<PhotoDoc> | null): stored is Stored<PhotoDoc> {
    return stored !== null && stored.version !== start.version && stored.data.updatedBy === PHOTOS_WRITER;
}

/** A refusal recorded after the replacement started (CR-M2c-4), or null. */
function refusalOf(before: PhotoDoc, after: PhotoDoc): Result | null {
    const refusal = after.replacement;
    if (refusal === undefined || timeOf(after) === timeOf(before)) {
        return null;
    }
    return { phase: 'refused', error: refusal.error, duplicateOf: refusal.duplicateOf ?? null };
}

function imageOf(photo: PhotoDoc, version: PhotoVersionKind | undefined): PhotoDoc['image'] {
    return version === undefined ? photo.image : photo.versions?.[version]?.image;
}

function shaOf(photo: PhotoDoc, version: PhotoVersionKind | undefined): string | null {
    return imageOf(photo, version)?.sha256 ?? null;
}

/** What `photos.onUpload` did: refused the file, kept the same image, or swapped it. */
function resultOf(before: PhotoDoc, after: PhotoDoc, version: PhotoVersionKind | undefined): Result {
    const kept = shaOf(after, version) === shaOf(before, version);
    return refusalOf(before, after) ?? { phase: kept ? 'same' : 'replaced', error: null, duplicateOf: null };
}

export class PhotoReplacement {
    readonly #deps: ReplacementDeps;
    #state: ReplaceState | null = null;
    #handle: UploadHandle | null = null;
    #start: Stored<PhotoDoc> | null = null;
    /** The server's answer, when it came before the upload's own end. */
    #result: Result | null = null;

    constructor(deps: ReplacementDeps) {
        this.#deps = deps;
    }

    get state(): ReplaceState | null {
        return this.#state;
    }

    /** Uploads `file` as the photo's new image (refused at once when too large, not a photo's name, or signed out). */
    start(photo: Stored<PhotoDoc>, file: PhotoFile): void {
        if (this.#handle !== null) {
            return;
        }
        const ready = this.#ready(file);
        if (!ready.ok) {
            this.#set({ phase: 'refused', percent: 0, error: ready.error, params: ready.params ?? null, duplicateOf: null });
            return;
        }
        const { uploads, cityId, store } = this.#deps.services;
        this.#start = photo;
        this.#result = null;
        this.#set({ phase: 'uploading', percent: 0, error: null, params: null, duplicateOf: null });
        const path = STORAGE_PATHS.photoUpload(cityId, ready.uid, photo.id, uploadFileName(store.newId(), ready.kind.ext));
        const request = {
            path,
            data: file.data,
            contentType: ready.kind.contentType,
            customMetadata: {
                originalName: originalName(file.name),
                ...(this.#deps.version === undefined ? {} : { version: this.#deps.version }),
            },
        };
        const handle = uploads.start(request, (progress) => {
            this.#progress(progress.total === 0 ? 0 : Math.round((progress.sent / progress.total) * 100));
        });
        this.#handle = handle;
        void handle.finished.then((end) => {
            this.#finished(handle, end);
        });
    }

    /** The upload's kind and the uploader, or why the file cannot be sent. */
    #ready(file: PhotoFile): { readonly ok: true; readonly kind: UploadKind; readonly uid: string } | FileRefusal {
        const check = checkFile(file);
        const uid = this.#deps.services.user()?.uid;
        if (!check.ok) {
            return check;
        }
        return uid === undefined ? { ok: false, error: 'apiError.unauthenticated' } : { ok: true, kind: check.kind, uid };
    }

    /** Stops the upload; the photo stays as it is. */
    cancel(): void {
        this.#handle?.cancel();
        this.#handle = null;
        this.#start = null;
        this.#set(null);
    }

    /** Forgets a finished replacement's message. */
    dismiss(): void {
        if (this.#handle === null) {
            this.#set(null);
        }
    }

    /** A snapshot of the photo: the server's write after the upload ends the replacement. */
    snapshot(stored: Stored<PhotoDoc> | null): void {
        const start = this.#start;
        if (start === null || !isServerWrite(start, stored)) {
            return;
        }
        this.#result = resultOf(start.data, stored.data, this.#deps.version);
        if (this.#state?.phase === 'processing') {
            this.#finish(this.#result);
        }
    }

    #progress(percent: number): void {
        if (this.#state?.phase === 'uploading') {
            this.#set({ ...this.#state, percent });
        }
    }

    #finished(handle: UploadHandle, end: UploadEnd): void {
        if (this.#handle !== handle) {
            return;
        }
        this.#handle = null;
        if (!end.ok) {
            this.#failed(end.reason);
            return;
        }
        this.#set({ phase: 'processing', percent: 100, error: null, params: null, duplicateOf: null });
        if (this.#result !== null) {
            this.#finish(this.#result);
        }
    }

    #failed(reason: Exclude<UploadEnd, { ok: true }>['reason']): void {
        this.#start = null;
        const error = reason === 'denied' ? 'apiError.notAdmin' : 'adminContent.photos.upload.interrupted';
        this.#set(reason === 'cancelled' ? null : { phase: 'failed', percent: 0, error, params: null, duplicateOf: null });
    }

    #finish(result: Result): void {
        this.#start = null;
        this.#result = null;
        this.#set({ ...result, percent: 100, params: null });
    }

    #set(state: ReplaceState | null): void {
        this.#state = state;
        this.#deps.changed(state);
    }
}
