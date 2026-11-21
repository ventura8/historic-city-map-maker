/**
 * Uploading a GeoTIFF (`docs/research/M3-interfaces.md` §8.1; behaviour A14), in the Imagery area and as the layer
 * editor's Replace image: the file's first bytes must say TIFF or BigTIFF (`II*\0`, `MM\0*`, `II+\0`, `MM\0+`) and it
 * must be under `RASTER_UPLOAD_MAX_BYTES`, else nothing is uploaded (`S-A14-BAD-NON-TIFF`); the year comes from the
 * file's name when it says one (the Year field is asked only when it does not). Then a resumable upload to
 * `RASTER_PATHS.upload` with the metadata `imagery.onRasterUpload` reads, its progress and Cancel; the upload's folder id
 * is the job's and the version's id, so once the job appears the area opens the version's page.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    RASTER_PATHS,
    RASTER_UPLOAD_MAX_BYTES,
    rasterUploadMetadataSchema,
    uploadYearOf,
    type JobDoc,
} from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentServices, Stored } from '../content/services.js';
import type { UploadEnd, UploadHandle, UploadPort } from '../firebase/uploads.js';
import type { NoticeInput } from '../state/state.js';

/** What the page hands over of a chosen file (a `File`). */
export interface ChosenFile {
    readonly name: string;
    readonly size: number;
    slice(start: number, end: number): Blob;
}

/**
 * `idle`; `refused` (not a TIFF, too large); `ready` (the name says no year: the Year field, then Upload); `uploading`;
 * `checking` (sent: the server sniffs it and creates the job); `done` (the job exists: its page opens); `failed`.
 */
type UploadPhase = 'idle' | 'refused' | 'ready' | 'uploading' | 'checking' | 'done' | 'failed';

export interface UploadState {
    readonly phase: UploadPhase;
    readonly fileName: string | null;
    readonly bytes: number;
    /** The Year field as typed (prefilled from the name). */
    readonly year: string;
    /** The name says no year: the field is required. */
    readonly needsYear: boolean;
    readonly refusal: NoticeInput | null;
    /** 0 to 1 while uploading. */
    readonly progress: number;
    /** The upload's id: its job's and its version's. */
    readonly jobId: string | null;
    /** Replace image: the layer whose image it replaces. */
    readonly layerId: string | null;
}

export const IDLE_UPLOAD: UploadState = {
    ...{ phase: 'idle', fileName: null, bytes: 0, year: '', needsYear: false },
    ...{ refusal: null, progress: 0, jobId: null, layerId: null },
};

const TIFF_MAGIC: readonly (readonly number[])[] = [
    [0x49, 0x49, 0x2a, 0x00],
    [0x4d, 0x4d, 0x00, 0x2a],
    [0x49, 0x49, 0x2b, 0x00],
    [0x4d, 0x4d, 0x00, 0x2b],
];

/** Whether the first bytes are a TIFF's or a BigTIFF's. */
export function isTiff(bytes: Uint8Array): boolean {
    return TIFF_MAGIC.some((magic) => magic.every((value, index) => bytes[index] === value));
}

const YEAR = /^(?:18|19|20)\d\d$/;

const ENDED: Readonly<Record<Exclude<UploadEnd, { ok: true }>['reason'], NoticeInput>> = {
    cancelled: { key: 'adminContent.imagery.upload.cancelled' },
    interrupted: { key: 'adminContent.imagery.upload.interrupted' },
    denied: { key: 'adminContent.imagery.upload.denied' },
    failed: { key: 'adminContent.imagery.upload.failed' },
};

/** A chosen file ready to go: the year its name says, asked for only when it names none and replaces no layer. */
function readyState(base: UploadState, year: number | undefined): UploadState {
    const needsYear = year === undefined && base.layerId === null;
    return { ...base, phase: 'ready', year: year === undefined ? '' : String(year), needsYear };
}

export class RasterUploader {
    readonly #services: ContentServices;
    readonly #uploads: UploadPort;
    readonly #changed: (state: UploadState) => void;
    #state: UploadState = IDLE_UPLOAD;
    #file: ChosenFile | null = null;
    #handle: UploadHandle | null = null;
    #watch: Unsubscribe | null = null;

    constructor(services: ContentServices, uploads: UploadPort, changed: (state: UploadState) => void) {
        this.#services = services;
        this.#uploads = uploads;
        this.#changed = changed;
    }

    get state(): UploadState {
        return this.#state;
    }

    /** The file is being sent or checked: a reload would end it (M18 item 1's self-reload waits). */
    get busy(): boolean {
        return this.#state.phase === 'uploading' || this.#state.phase === 'checking';
    }

    /**
     * A file was chosen (or dropped): checked, then uploaded at once when its name says its year, or when it replaces a
     * layer's image (the layer keeps its own year, so nothing is asked).
     */
    async choose(file: ChosenFile, layerId: string | null = null): Promise<void> {
        this.reset();
        const base = { ...IDLE_UPLOAD, fileName: file.name, bytes: file.size, layerId };
        const refusal = await this.#refusal(file);
        if (refusal !== null) {
            this.#set({ ...base, phase: 'refused', refusal });
            return;
        }
        this.#file = file;
        const ready = readyState(base, uploadYearOf(undefined, file.name));
        this.#set(ready);
        if (!ready.needsYear) {
            this.start();
        }
    }

    setYear(text: string): void {
        if (this.#state.phase === 'ready') {
            this.#set({ ...this.#state, year: text.trim() });
        }
    }

    /** Upload (once the year is known). */
    start(): void {
        const ready = this.#ready();
        if (ready === null) {
            return;
        }
        const { file, uid } = ready;
        this.#file = null;
        const jobId = this.#services.store.newId();
        const path = RASTER_PATHS.upload(this.#services.cityId, uid, jobId, `${this.#nonce()}.tif`);
        const request = { path, data: file.slice(0, file.size), contentType: 'image/tiff', customMetadata: this.#metadata(file) };
        this.#set({ ...this.#state, phase: 'uploading', jobId, progress: 0 });
        this.#handle = this.#uploads.start(request, (progress) => {
            this.#progress(progress.sent / Math.max(progress.total, 1));
        });
        void this.#handle.finished.then((end) => {
            this.#ended(jobId, end, file);
        });
    }

    cancel(): void {
        this.#handle?.cancel();
    }

    /** Back to nothing chosen (a new file, the area closed). */
    reset(): void {
        this.#handle?.cancel();
        this.#handle = null;
        this.#stopWatch();
        this.#file = null;
        this.#set(IDLE_UPLOAD);
    }

    /**
     * The file and who uploads it, once the Year field holds a year (a replacement needs none); null before, and while it
     * uploads (the file is handed to the upload and comes back when it ends without being sent).
     */
    #ready(): { readonly file: ChosenFile; readonly uid: string } | null {
        const file = this.#file;
        const user = this.#services.user();
        const dated = YEAR.test(this.#state.year) || this.#state.layerId !== null;
        return file !== null && user !== null && dated ? { file, uid: user.uid } : null;
    }

    /** The file's name in its folder: a client nonce of at least 8 characters (`RASTER_UPLOAD_FILE_PATTERN`). */
    #nonce(): string {
        return [this.#services.store.newId(), this.#services.store.newId()].join('');
    }

    /** The custom metadata `imagery.onRasterUpload` reads: the name, the year (when known), the layer it replaces. */
    #metadata(file: ChosenFile): Readonly<Record<string, string>> {
        const layer = this.#state.layerId === null ? {} : { layerId: this.#state.layerId };
        const year = this.#state.year === '' ? {} : { year: this.#state.year };
        const metadata = { originalName: file.name.slice(0, 255), ...year, ...layer };
        rasterUploadMetadataSchema.parse(metadata);
        return metadata;
    }

    async #refusal(file: ChosenFile): Promise<NoticeInput | null> {
        if (file.size > RASTER_UPLOAD_MAX_BYTES) {
            return { key: 'adminContent.imagery.upload.tooLarge' };
        }
        const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
        return isTiff(head) ? null : { key: 'apiError.imagery.notTiff' };
    }

    #progress(share: number): void {
        if (this.#state.phase === 'uploading') {
            this.#set({ ...this.#state, progress: Math.min(1, share) });
        }
    }

    #ended(jobId: string, end: UploadEnd, file: ChosenFile): void {
        if (this.#state.jobId !== jobId) {
            return;
        }
        this.#handle = null;
        if (!end.ok) {
            this.#file = file;
            this.#set({ ...this.#state, phase: end.reason === 'cancelled' ? 'ready' : 'failed', refusal: ENDED[end.reason], jobId: null });
            return;
        }
        this.#set({ ...this.#state, phase: 'checking', progress: 1 });
        this.#watchJob(jobId);
    }

    /** The trigger creates the job (and the version) once it has checked the file: then its page opens. */
    #watchJob(jobId: string): void {
        const seen = { found: false };
        const stop = this.#services.store.watchDoc(
            FIRESTORE_PATHS.job(this.#services.cityId, jobId),
            jobDocSchema,
            (job: Stored<JobDoc> | null) => {
                if (job !== null && !seen.found) {
                    seen.found = true;
                    this.#stopWatch();
                    this.#set({ ...this.#state, phase: 'done' });
                }
            },
            () => undefined,
        );
        if (seen.found) {
            stop();
        } else {
            this.#watch = stop;
        }
    }

    #stopWatch(): void {
        this.#watch?.();
        this.#watch = null;
    }

    #set(state: UploadState): void {
        this.#state = state;
        this.#changed(state);
    }
}
