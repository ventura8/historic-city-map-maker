// The photos area's test world: the editors' `contentWorld` (the shared `FakeContentStore`, the shell's fakes) plus the
// photos' own services, faked: resumable uploads each test drives by hand, and the admin map's factory with a fake map
// and drawing tools. Photo and city documents are built here with the shared schemas' shapes.
import { FIRESTORE_PATHS, type PhotoDoc } from '@hcm/shared';

import type { UploadEnd, UploadPort, UploadProgress, UploadRequest } from '../../src/firebase/uploads.js';
import type {
    DrawChange,
    DrawRefusal,
    DrawnPoint,
    PhotoDrawPort,
    PhotoFeatures,
    PhotoMapFactory,
    PhotoMapHandle,
    PhotoMapPort,
    PhotoMapResult,
    PhotosServices,
} from '../../src/photos/ports.js';
import type { PhotoFile } from '../../src/photos/upload-plan.js';
import { at, CITY, contentWorld, type ContentWorld } from '../content/world.js';

export { at, CITY };

/** One upload the fake received: its request, and the hands that move it. */
interface FakeUpload {
    readonly request: UploadRequest;
    readonly progress: (sent: number, total: number) => void;
    readonly end: (end: UploadEnd) => void;
    cancelled: boolean;
}

class FakeUploads implements UploadPort {
    readonly started: FakeUpload[] = [];

    start(request: UploadRequest, progress: (progress: UploadProgress) => void): { readonly finished: Promise<UploadEnd>; cancel(): void } {
        const resolvers: ((end: UploadEnd) => void)[] = [];
        const finished = new Promise<UploadEnd>((resolve) => {
            resolvers.push(resolve);
        });
        const settle = (end: UploadEnd): void => {
            for (const resolve of resolvers) {
                resolve(end);
            }
        };
        const upload: FakeUpload = {
            request,
            progress: (sent, total) => {
                progress({ sent, total });
            },
            end: (end) => {
                settle(end);
            },
            cancelled: false,
        };
        this.started.push(upload);
        return {
            finished,
            cancel: () => {
                upload.cancelled = true;
                settle({ ok: false, reason: 'cancelled' });
            },
        };
    }

    /** The upload number `index` (0-based), failing the test when it does not exist. */
    at(index: number): FakeUpload {
        const upload = this.started[index];
        if (upload === undefined) {
            throw new Error(`no upload ${String(index)}`);
        }
        return upload;
    }
}

class FakeDraw implements PhotoDrawPort {
    readonly calls: string[] = [];
    loaded: readonly DrawnPoint[] = [];
    mode = 'static';
    selected: string | null = null;
    limits: unknown = null;
    #picked: ((position: [number, number] | null) => void) | null = null;
    readonly #change = new Set<(change: DrawChange) => void>();
    readonly #refused = new Set<(refusal: DrawRefusal) => void>();

    attach(_map: PhotoMapPort, options: { readonly limits: unknown }): void {
        this.calls.push('attach');
        this.limits = options.limits;
    }

    setMode(mode: 'static' | 'select'): void {
        this.mode = mode;
    }

    load(features: readonly DrawnPoint[]): void {
        this.loaded = features;
    }

    select(id: string | null): void {
        this.selected = id;
    }

    pick(): Promise<[number, number] | null> {
        this.calls.push('pick');
        return new Promise((resolve) => {
            this.#picked = resolve;
        });
    }

    cancelPick(): void {
        this.calls.push('cancelPick');
        this.resolvePick(null);
    }

    resolvePick(position: [number, number] | null): void {
        this.#picked?.(position);
        this.#picked = null;
    }

    on(event: 'change', handler: (change: DrawChange) => void): () => void;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): () => void;
    on(event: 'change' | 'refused', handler: ((change: DrawChange) => void) | ((refusal: DrawRefusal) => void)): () => void {
        const set = (event === 'change' ? this.#change : this.#refused) as Set<typeof handler>;
        set.add(handler);
        return () => {
            set.delete(handler);
        };
    }

    emitChange(change: DrawChange): void {
        for (const handler of this.#change) {
            handler(change);
        }
    }

    emitRefused(): void {
        for (const handler of this.#refused) {
            handler({ kind: 'outside' });
        }
    }

    detach(): void {
        this.calls.push('detach');
    }
}

class FakeMapPort implements PhotoMapPort {
    readonly data: PhotoFeatures[] = [];
    readonly flights: unknown[] = [];
    center: [number, number] = [26.1, 44.43];
    #click: ((photoId: string) => void) | null = null;

    setPhotosData(data: PhotoFeatures): void {
        this.data.push(data);
    }

    onPhotoClick(handler: (photoId: string) => void): () => void {
        this.#click = handler;
        return () => {
            this.#click = null;
        };
    }

    click(photoId: string): void {
        this.#click?.(photoId);
    }

    flyTo(view: unknown): void {
        this.flights.push(view);
    }

    getView(): { center: [number, number]; zoom: number; bearing: number } {
        return { center: this.center, zoom: 15, bearing: 0 };
    }
}

export class FakeMaps implements PhotoMapFactory {
    readonly created: unknown[] = [];
    result: 'ok' | 'no-token' | 'no-webgl' | 'failed' = 'ok';
    readonly port = new FakeMapPort();
    readonly draw = new FakeDraw();
    destroyed = 0;
    /** Holds `create` until the test releases it. */
    hold: Promise<void> | null = null;

    async create(container: HTMLElement, options: unknown): Promise<PhotoMapResult> {
        this.created.push({ container, options });
        await this.hold;
        if (this.result !== 'ok') {
            return { ok: false, reason: this.result };
        }
        const handle: PhotoMapHandle = {
            port: this.port,
            draw: () => Promise.resolve(this.draw),
            destroy: () => {
                this.destroyed += 1;
            },
        };
        return { ok: true, map: handle };
    }
}

/** The editors' world with the photos' services (their map factory is the fake one, not the pois' real one). */
export interface PhotosWorld extends Omit<ContentWorld, 'services'> {
    readonly services: PhotosServices;
    readonly uploads: FakeUploads;
    readonly maps: FakeMaps;
}

export function photosWorld(overrides: Partial<PhotosServices> = {}): PhotosWorld {
    const uploads = new FakeUploads();
    const maps = new FakeMaps();
    const world = contentWorld();
    return { ...world, services: { ...world.services, uploads, maps, ...overrides }, uploads, maps };
}

/** A container the map is created in (the node tests never touch it). */
export const CONTAINER = {} as HTMLElement;

const BOUNDS = { west: 26, south: 44.3, east: 26.3, north: 44.55 } as const;

/** The city document the photos read (bounds, centre, zoom). */
export function seedCity(world: Pick<ContentWorld, 'store'>, extra: Record<string, unknown> = {}): void {
    world.store.put(FIRESTORE_PATHS.city(CITY), {
        name: { ro: 'București' },
        bounds: BOUNDS,
        published: true,
        ...world.store.stamp(),
        ...extra,
    });
}

/** A processed, unpublished photo with an image and a known licence. */
export function photoDoc(overrides: Partial<PhotoDoc> = {}): PhotoDoc {
    return {
        title: { ro: 'Calea Victoriei' },
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.1 },
        published: false,
        processing: 'done',
        image: {
            web: 'https://storage.googleapis.com/b/web.webp',
            thumb: 'https://storage.googleapis.com/b/thumb.webp',
            sha256: 'a'.repeat(64),
            w: 800,
            h: 600,
        },
        updatedBy: 'admin-uid',
        updatedAt: at('2026-10-17T10:00:00.000Z'),
        ...overrides,
    };
}

export function photoPath(photoId: string): string {
    return FIRESTORE_PATHS.photo(CITY, photoId);
}

/** Puts a photo on the fake server. */
export function seedPhoto(world: Pick<ContentWorld, 'store'>, photoId: string, overrides: Partial<PhotoDoc> = {}): void {
    world.store.put(photoPath(photoId), photoDoc(overrides));
}

/** A chosen file of `size` bytes. */
export function file(name: string, size = 1000): PhotoFile {
    return { name, size, data: new Blob(['x']) };
}

/** Lets every queued promise callback run. */
export async function settle(rounds = 30): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
    }
}
