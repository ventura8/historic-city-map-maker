// The photos page's fixtures: its area state as the admin's store would hold it, and mounting the page over a fake app
// whose photos area is a `FakeArea` (every intent recorded).
import { html } from 'lit';

import type {
    PhotoEditorPort,
    PhotoRowPort,
    PhotosIntentsPort,
    PhotosViewState,
    PhotoValuePort,
    UploadItemPort,
} from '../../../src/admin/photos/photos-port.js';
import { adminState, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

export function row(overrides: Partial<PhotoRowPort> = {}): PhotoRowPort {
    return {
        reviewStatus: null,
        reviewNote: null,
        id: 'p1',
        title: { ro: 'Calea Victoriei', en: 'Victory Avenue' },
        year: 1936,
        yearEnd: null,
        author: 'Ion',
        thumb: null,
        published: true,
        processing: 'done',
        error: null,
        duplicateOf: null,
        rightsReview: false,
        checkPlace: false,
        block: null,
        ...overrides,
    };
}

export function upload(overrides: Partial<UploadItemPort> = {}): UploadItemPort {
    return {
        key: 1,
        name: 'a.jpg',
        photoId: null,
        phase: 'uploading',
        percent: 40,
        error: null,
        params: null,
        duplicateOf: null,
        ...overrides,
    };
}

/** The draft of the fixtures' photo. */
export const VALUE: PhotoValuePort = {
    title: { ro: 'Calea Victoriei' },
    license: 'CC-BY-4.0',
    location: { lat: 44.43, lng: 26.1 },
    published: false,
};

export function editor(overrides: Partial<PhotoEditorPort> = {}): PhotoEditorPort {
    return {
        role: 'editor',
        id: 'p1',
        status: 'ready',
        reconnecting: false,
        failure: null,
        value: VALUE,
        dirty: [],
        touched: false,
        issues: [],
        saving: false,
        conflict: null,
        image: { web: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', w: 1, h: 1 },
        processing: 'done',
        processingError: null,
        duplicateOf: null,
        block: null,
        checkPlace: false,
        suggestions: [],
        picking: false,
        replace: null,
        versionUploads: { improved: null, colorized: null },
        ...overrides,
    };
}

export function photosState(overrides: Partial<PhotosViewState> = {}): PhotosViewState {
    return {
        role: 'editor',
        list: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            filter: 'all',
            search: { text: '', yearFrom: null, yearTo: null },
            rows: [row(), row({ id: 'p2', title: { ro: 'Piața Romană' }, year: null, author: null, published: false })],
            loaded: 2,
            hasMore: false,
            selection: [],
        },
        uploads: [],
        sticky: {},
        editor: null,
        map: 'none',
        confirm: null,
        report: null,
        busy: false,
        assist: { titles: { status: 'idle', suggestions: [], attribution: null, error: null }, drafts: {} },
        ...overrides,
    };
}

/**
 * A scripted photos area (as the editing kit's `FakeArea`): the test sets its state, every intent call is recorded. Its
 * intents are passed to the page's own elements as a property, so only intent names answer: Lit probes a bound value
 * for its directive marker (`_$litDirective$`) and a thenable for `then`.
 */
export class PhotosArea {
    readonly calls: string[] = [];
    readonly intents: PhotosIntentsPort;
    readonly #listeners = new Set<(state: PhotosViewState) => void>();
    #state: PhotosViewState;

    constructor(state: PhotosViewState, answers: Partial<Record<keyof PhotosIntentsPort, unknown>> = {}) {
        this.#state = state;
        this.intents = new Proxy({} as PhotosIntentsPort, {
            get: (_target, name: string | symbol) => {
                if (typeof name !== 'string' || name.startsWith('_$') || name === 'then') {
                    return undefined;
                }
                return (...args: unknown[]): unknown => {
                    this.calls.push([name, ...args.map((arg) => JSON.stringify(arg))].join(' '));
                    return answers[name as keyof PhotosIntentsPort];
                };
            },
        });
    }

    get state(): PhotosViewState {
        return this.#state;
    }

    set(patch: Partial<PhotosViewState>): void {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    subscribe(listener: (state: PhotosViewState) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    open(params: readonly string[]): void {
        this.calls.push(`open ${JSON.stringify(params)}`);
    }

    close(): void {
        this.calls.push('close');
    }

    /** The calls of one intent (or of `open`, `close`). */
    named(name: string): readonly string[] {
        return this.calls.filter((call) => call === name || call.startsWith(`${name} `));
    }
}

export function area(state: PhotosViewState = photosState()): PhotosArea {
    return new PhotosArea(state, {
        save: Promise.resolve(true),
        confirmDelete: Promise.resolve(true),
        bulk: Promise.resolve(),
        confirmRights: Promise.resolve(),
        setDirection: Promise.resolve(),
    });
}

/** Mounts the photos page at `#/photos/<params>` over an app whose photos store is `store`; `width` in CSS px. */
export async function photosPage(
    store: PhotosArea | null,
    options: { readonly params?: readonly string[]; readonly width?: number; readonly locale?: 'ro' | 'en' } = {},
): Promise<{ readonly app: FakeAdminApp; readonly element: HTMLElement }> {
    const app = new FakeAdminApp(adminState({ route: { id: 'photos', params: options.params ?? [] }, locale: options.locale ?? 'en' }));
    app.areas.photos = store;
    const element = document.createElement('hcm-photos-page') as HTMLElement & { app: unknown; state: unknown };
    element.app = app;
    element.state = app.state;
    const box = await mount<HTMLElement>(html`<div class="box">${element}</div>`, options.width ?? 1300);
    box.style.blockSize = '800px';
    element.style.blockSize = '800px';
    element.style.display = 'block';
    await updated(element);
    return { app, element };
}

/** A `FileList` of the named files (what a chooser or a drop gives). */
export function files(...names: string[]): FileList {
    const transfer = new DataTransfer();
    for (const name of names) {
        transfer.items.add(new File(['x'], name, { type: 'image/jpeg' }));
    }
    return transfer.files;
}
