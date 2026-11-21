// The places page's fixtures: its area state as the admin's store would hold it, and mounting the page over a fake app
// whose places area is a `FakeArea` (every intent recorded).
import { html } from 'lit';

import type { AreaPort, ListStatePort } from '../../../src/admin/content-port.js';
import type {
    CategoryItemPort,
    PlaceEditorPort,
    PoiDraftPort,
    PoiItemPort,
    PoisIntentsPort,
    PoisViewState,
    PoiValuePort,
} from '../../../src/admin/pois/pois-port.js';
import { adminState, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

export function ready<Item>(items: readonly Item[], more: Partial<ListStatePort<Item>> = {}): ListStatePort<Item> {
    return { status: 'ready', items, hasMore: false, reconnecting: false, failure: null, ...more };
}

export const CATEGORIES: readonly CategoryItemPort[] = [
    { id: 'biserici', label: { ro: 'Biserici', en: 'Churches' }, icon: 'church', color: '#8b5e3c' },
    { id: 'parcuri', label: { ro: 'Parcuri' }, icon: 'park', color: '#1f6f43' },
];

export function place(overrides: Partial<PoiItemPort> = {}): PoiItemPort {
    return {
        id: 'stavropoleos',
        category: 'biserici',
        title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
        yearStart: 1890,
        yearEnd: null,
        shape: 'point',
        published: true,
        ...overrides,
    };
}

export const VALUE: PoiValuePort = {
    category: 'biserici',
    geometry: { type: 'Point', coordinates: [26.1, 44.43] },
    title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
    links: [],
    photoIds: [],
    published: true,
};

export function draft(overrides: Partial<PoiDraftPort> = {}): PoiDraftPort {
    return {
        id: 'stavropoleos',
        isNew: false,
        base: { id: 'stavropoleos', path: 'cities/bucharest/pois/stavropoleos', data: {}, version: 'v1', pending: false },
        value: VALUE,
        dirty: [],
        issues: [],
        saving: false,
        conflict: null,
        gone: false,
        ...overrides,
    };
}

export function editor(overrides: Partial<PlaceEditorPort> = {}): PlaceEditorPort {
    return {
        id: 'stavropoleos',
        status: 'ready',
        reconnecting: false,
        draft: draft(),
        shape: 'point',
        sketch: [],
        vertex: null,
        refusal: null,
        ...overrides,
    };
}

export function poisState(overrides: Partial<PoisViewState> = {}): PoisViewState {
    return {
        filter: { category: null, unpublished: false, search: '' },
        list: ready([
            place(),
            place({
                id: 'cismigiu',
                category: 'parcuri',
                title: { ro: 'Cișmigiu' },
                shape: 'area',
                published: false,
                yearStart: null,
                yearEnd: 1900,
            }),
        ]),
        categories: ready(CATEGORIES),
        selection: [],
        editor: null,
        map: 'none',
        clicked: null,
        photos: null,
        linkedPhotos: [],
        exporting: false,
        importing: null,
        busy: false,
        traceLayers: [],
        traceOpacity: 100,
        assist: { titles: { status: 'idle', suggestions: [], attribution: null, error: null }, drafts: {} },
        ...overrides,
    };
}

/**
 * A scripted places area: the test sets its state, every intent call is recorded. Its intents are handed to the page's
 * own elements as a property, so only intent names answer: Lit probes a bound value for its directive marker
 * (`_$litDirective$`) and a thenable for `then`.
 */
export class PoisArea implements AreaPort<PoisViewState, PoisIntentsPort> {
    readonly calls: string[] = [];
    readonly intents: PoisIntentsPort;
    readonly #listeners = new Set<(state: PoisViewState) => void>();
    #state: PoisViewState;

    constructor(state: PoisViewState, answers: Partial<Record<keyof PoisIntentsPort, unknown>>) {
        this.#state = state;
        this.intents = new Proxy({} as PoisIntentsPort, {
            get: (_target, name: string | symbol) => {
                if (typeof name !== 'string' || name.startsWith('_$') || name === 'then') {
                    return undefined;
                }
                return (...args: unknown[]): unknown => {
                    this.calls.push([name, ...args.map((arg) => JSON.stringify(arg))].join(' '));
                    return answers[name as keyof PoisIntentsPort];
                };
            },
        });
    }

    get state(): PoisViewState {
        return this.#state;
    }

    set(patch: Partial<PoisViewState>): void {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    subscribe(listener: (state: PoisViewState) => void): () => void {
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

export function area(state: PoisViewState = poisState(), answers: Partial<Record<keyof PoisIntentsPort, unknown>> = {}): PoisArea {
    return new PoisArea(state, {
        add: 'new-1',
        save: Promise.resolve({ ok: true }),
        remove: Promise.resolve({ ok: true }),
        bulk: Promise.resolve(),
        chooseImport: Promise.resolve(),
        commitImport: Promise.resolve(),
        exportPlaces: Promise.resolve({ name: 'bucharest-places.geojson', type: 'application/geo+json', text: '{}' }),
        editVertex: true,
        addAtCentre: true,
        undoLastVertex: true,
        ...answers,
    });
}

/** Mounts the places page at `#/pois/<params>` over an app whose places store is `store`; `width` in CSS px. */
export async function poisPage(
    store: PoisArea | null,
    options: { readonly params?: readonly string[]; readonly width?: number; readonly locale?: 'ro' | 'en' } = {},
): Promise<{ readonly app: FakeAdminApp; readonly element: HTMLElement }> {
    const app = new FakeAdminApp(adminState({ route: { id: 'pois', params: options.params ?? [] }, locale: options.locale ?? 'en' }));
    app.areas.pois = store;
    const element = document.createElement('hcm-pois-page') as HTMLElement & { app: unknown; state: unknown };
    element.app = app;
    element.state = app.state;
    const box = await mount<HTMLElement>(html`<div class="box">${element}</div>`, options.width ?? 1300);
    box.style.blockSize = '800px';
    element.style.blockSize = '800px';
    element.style.display = 'block';
    await updated(element);
    return { app, element };
}

/** Moves the app to another address (the outlet would set the new state). */
export async function route(app: FakeAdminApp, element: HTMLElement, params: readonly string[]): Promise<void> {
    app.set({ route: { id: 'pois', params } });
    (element as HTMLElement & { state: unknown }).state = app.state;
    await updated(element);
}

/** The intents a test asked for, without the page's own `open` and `attachMap`. */
export function asked(store: PoisArea): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open') && !call.startsWith('attachMap') && call !== 'close');
}
