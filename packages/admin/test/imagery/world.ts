// The Imagery area's and the georeferencer's test world: `ContentServices` over the shared fakes plus the area's own
// (resumable uploads, bucket files, decoded pictures), the imagery callables answered by name, and documents as the
// harvest, the callables and the pipeline write them (the golden documents of `pipeline/tests/contracts/` included).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FIRESTORE_PATHS } from '@hcm/shared';

import type { ContentServices } from '../../src/content/services.js';
import type { UploadEnd, UploadPort, UploadProgress, UploadRequest } from '../../src/firebase/uploads.js';
import type { ImageryCallName, ImageryRequest, ImageryResponse } from '../../src/imagery/api.js';
import type { FilePort, Picture, PicturePort, PictureTriangle } from '../../src/imagery/files.js';
import type { FakeCallables } from '../app/fakes.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

export { at, CITY } from '../content/world.js';

const CONTRACTS = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts');

/** A golden document of the pipeline's contract (`version.awaiting-approval.json`, ...). */
export function golden(name: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(CONTRACTS, name), 'utf8')) as Record<string, unknown>;
}

/** Answers an imagery callable (the registry rows are fn-imagery's: the fake takes any name). */
export function answer<N extends ImageryCallName>(
    callables: FakeCallables,
    name: N,
    reply: (request: ImageryRequest<N>) => ImageryResponse<N> | Promise<ImageryResponse<N>>,
): void {
    callables.answer(name, reply as never);
}

/** Every call of an imagery callable, with its request. */
export function callsOf(callables: FakeCallables, name: ImageryCallName): unknown[] {
    return callables.calls.filter((call) => (call.name as string) === name).map((call) => call.request);
}

interface FakeUpload {
    readonly request: UploadRequest;
    progress(progress: UploadProgress): void;
    finish(end: UploadEnd): void;
    readonly cancelled: number;
}

class FakeUploads implements UploadPort {
    readonly started: FakeUpload[] = [];

    start(request: UploadRequest, progress: (progress: UploadProgress) => void): { finished: Promise<UploadEnd>; cancel(): void } {
        const ends: ((end: UploadEnd) => void)[] = [];
        const finished = new Promise<UploadEnd>((done) => {
            ends.push(done);
        });
        const finish = (end: UploadEnd): void => {
            ends[0]?.(end);
        };
        const upload = {
            request,
            progress,
            finish: (end: UploadEnd) => {
                finish(end);
            },
            cancelled: 0,
        };
        this.started.push(upload);
        return {
            finished,
            cancel: () => {
                (upload as { cancelled: number }).cancelled += 1;
                finish({ ok: false, reason: 'cancelled' });
            },
        };
    }

    get last(): FakeUpload {
        const upload = this.started.at(-1);
        if (upload === undefined) {
            throw new Error('nothing was uploaded');
        }
        return upload;
    }
}

export class FakeFiles implements FilePort {
    /** The bucket: a path's blob (a missing path reads as null). */
    readonly objects = new Map<string, Blob>();
    readonly released: string[] = [];
    readonly saved: { readonly path: string; readonly name: string }[] = [];
    /** Reads answered only when the test lets them (`flush`), to play a slow bucket. */
    hold = false;
    readonly #held: (() => void)[] = [];

    put(path: string, text = 'image'): void {
        this.objects.set(path, new File([text], path, { type: text === 'not an image' ? 'text/plain' : 'image/jpeg' }));
    }

    async read(path: string): Promise<Blob | null> {
        await this.#wait();
        return this.objects.get(path) ?? null;
    }

    async url(path: string): Promise<string | null> {
        return (await this.read(path)) === null ? null : `blob:${path}`;
    }

    release(url: string): void {
        this.released.push(url);
    }

    async save(path: string, name: string): Promise<boolean> {
        const blob = await this.read(path);
        if (blob !== null) {
            this.saved.push({ path, name });
        }
        return blob !== null;
    }

    /** Answers every held read. */
    flush(): void {
        for (const release of this.#held.splice(0)) {
            release();
        }
    }

    #wait(): Promise<void> {
        return this.hold ? new Promise((done) => this.#held.push(done)) : Promise.resolve();
    }
}

export class FakePictures implements PicturePort {
    readonly decoded: number[] = [];
    readonly shrunk: number[] = [];
    readonly drawn: { readonly target: Picture; readonly source: Picture; readonly triangles: readonly PictureTriangle[] }[] = [];
    #next = 1;

    async decode(read: () => Promise<Blob | null>, maxSide: number): Promise<Picture | null> {
        const blob = await read();
        if (blob === null) {
            return null;
        }
        this.decoded.push(maxSide);
        return blob.type.startsWith('image/') ? this.blank(Math.min(maxSide, 400), Math.min(maxSide, 300)) : null;
    }

    /** The address of a thumbnail (`blob:<path>`), and the sides asked for. */
    async thumbnail(read: () => Promise<Blob | null>, side: number): Promise<string | null> {
        this.shrunk.push(side);
        return this.#address('', await read());
    }

    /** The address of a preview (`blob:preview:<path>`), and the sides asked for. */
    async preview(read: () => Promise<Blob | null>, maxSide: number): Promise<string | null> {
        this.shrunk.push(maxSide);
        return this.#address('preview:', await read());
    }

    #address(kind: string, blob: Blob | null): string | null {
        return blob?.type.startsWith('image/') === true ? `blob:${kind}${(blob as File).name}` : null;
    }

    blank(width: number, height: number): Picture {
        const id = this.#next;
        this.#next += 1;
        return { canvas: { id }, width, height };
    }

    draw(target: Picture, source: Picture, triangles: readonly PictureTriangle[]): void {
        this.drawn.push({ target, source, triangles });
    }
}

export interface ImageryWorld extends ContentWorld {
    readonly uploads: FakeUploads;
    readonly files: FakeFiles;
    readonly pictures: FakePictures;
}

export function imageryWorld(overrides: Partial<ContentServices> = {}): ImageryWorld {
    const uploads = new FakeUploads();
    const files = new FakeFiles();
    const pictures = new FakePictures();
    const world = contentWorld({ uploads, files, pictures, maps: null, ...overrides });
    return { ...world, uploads, files, pictures };
}

const T0 = at('2026-10-20T09:00:00.000Z');

export const SCENES = (id: string): string => FIRESTORE_PATHS.usgsScene(CITY, id);
export const VERSIONS = (id: string): string => FIRESTORE_PATHS.layerVersion(CITY, id);
export const JOBS = (id: string): string => FIRESTORE_PATHS.job(CITY, id);

export function sceneDoc(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        entityId: id,
        dataset: 'corona2',
        sensor: 'KH-4A',
        acquisitionDate: '1966-07-12',
        status: 'candidate',
        downloadAvailable: true,
        footprint: [
            { lat: 44.6, lng: 25.9 },
            { lat: 44.6, lng: 26.3 },
            { lat: 44.3, lng: 26.3 },
            { lat: 44.3, lng: 25.9 },
        ],
        resolutionM: 2.75,
        coverage: 1,
        browse: { state: 'none' },
        rank: { score: 80, reasons: [{ code: 'free' }, { code: 'coverage', params: { percent: '100' } }], version: 1 },
        harvestedAt: T0,
        updatedBy: 'system:imagery',
        updatedAt: T0,
        ...overrides,
    };
}

export function jobDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'usgs-import',
        status: 'running',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'admin-uid',
        createdAt: T0,
        step: 'fetch',
        progress: 0.25,
        steps: { fetch: { status: 'running' } },
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

/** The golden version that waits for approval, with overrides. */
export function versionDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...golden('version.awaiting-approval.json'), ...overrides };
}

export function setupStatus(usgs: string): Record<string, unknown> {
    return { usgs: { state: usgs }, updatedBy: 'system:setup', updatedAt: T0 };
}

export function cityDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        center: { lat: 44.43, lng: 26.1 },
        zoom: 13,
        published: true,
        updatedBy: 'system:setup',
        updatedAt: T0,
        ...overrides,
    };
}
