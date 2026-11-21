// The layers and settings pages' fixtures: their area states as the admin's stores hold them, and mounting a page over
// a fake app whose area is a `FakeArea`. Every value is a generated test value.
import type { CityDoc, LayerDoc } from '@hcm/shared';
import { html } from 'lit';

import type {
    DraftStatePort,
    LayerEditorPort,
    LayerItemPort,
    LayersIntentsPort,
    LayersViewState,
} from '../../../src/admin/layers/layers-port.js';
import type { CategoryItemPort, SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { ready } from '../ops/fixtures.js';
import { adminState, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const T0 = { seconds: 1_759_305_600, nanoseconds: 0 };

export function layerDoc(overrides: Partial<LayerDoc> = {}): LayerDoc {
    return {
        year: 1968,
        label: { ro: 'Corona 1968', en: 'Corona 1968 (EN)' },
        kind: 'satellite',
        source: { type: 'mapbox', tilesetId: 'e2e-user.corona-1968' },
        minzoom: 10,
        maxzoom: 17,
        order: 1,
        opacity: 0.8,
        defaultVisible: false,
        status: 'ready',
        published: true,
        mapbox: { tilesetId: 'e2e-user.corona-1968' },
        updatedBy: 'system:pipeline',
        updatedAt: T0,
        ...overrides,
    };
}

export function layerItem(overrides: Partial<LayerItemPort> = {}): LayerItemPort {
    return {
        id: 'corona',
        label: { ro: 'Corona 1968', en: 'Corona 1968 (EN)' },
        year: 1968,
        status: 'ready',
        published: true,
        order: 1,
        opacity: 0.8,
        defaultVisible: false,
        sourceType: 'mapbox',
        linked: false,
        version: 'v1',
        ...overrides,
    };
}

export function draftOf<T>(value: T, overrides: Partial<DraftStatePort<T>> = {}): DraftStatePort<T> {
    return {
        base: { id: 'x', path: 'x', data: value, version: 'v1', pending: false },
        value,
        dirty: [],
        issues: [],
        saving: false,
        conflict: null,
        gone: false,
        ...overrides,
    };
}

export function editorOf(layer: LayerDoc = layerDoc(), overrides: Partial<LayerEditorPort> = {}): LayerEditorPort {
    return {
        id: 'corona',
        doc: { status: 'ready', reconnecting: false, failure: null },
        notFound: false,
        draft: draftOf(layer),
        ...overrides,
    };
}

export function layersState(overrides: Partial<LayersViewState> = {}): LayersViewState {
    return {
        list: ready([
            layerItem(),
            layerItem({
                id: 'plan',
                label: { ro: 'Planul 1911' },
                year: 1911,
                order: 5,
                published: false,
                linked: true,
                status: 'processing',
            }),
        ]),
        editor: null,
        reordering: false,
        deletion: { phase: 'idle' },
        link: null,
        map: 'none',
        crop: null,
        assist: { titles: { status: 'idle', suggestions: [], attribution: null, error: null }, drafts: {} },
        ...overrides,
    };
}

export function cityDoc(overrides: Partial<CityDoc> = {}): CityDoc {
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

function categoryItem(overrides: Partial<CategoryItemPort> = {}): CategoryItemPort {
    return {
        id: 'cladiri',
        label: { ro: 'Clădiri', en: 'Buildings' },
        icon: 'domain',
        bundled: true,
        color: '#8b5e3c',
        defaultOpacity: 0.7,
        order: 0,
        version: 'v1',
        ...overrides,
    };
}

export function settingsState(overrides: Partial<SettingsViewState> = {}): SettingsViewState {
    const city = cityDoc();
    return {
        section: null,
        city: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            doc: { id: 'bucharest', path: 'cities/bucharest', data: city, version: 'v1', pending: false },
        },
        citySection: {
            section: null,
            draft: draftOf(city),
            outside: [],
            checking: false,
            theme: { typed: '', invalid: false, adjusted: false, preview: null },
            linkLines: { about: { ro: [], en: [] }, privacy: { ro: [], en: [] } },
        },
        layers: ready([layerItem()]),
        categories: ready([
            categoryItem(),
            categoryItem({ id: 'biserici', label: { ro: 'Biserici' }, icon: 'church', color: '#3f6836', order: 1 }),
        ]),
        canAddCategory: true,
        startersMissing: 5,
        addingStarters: false,
        category: null,
        categoryDeletion: { phase: 'idle' },
        overlays: { rows: [], changes: 0, saving: false },
        reordering: false,
        map: { status: 'none', drawing: null },
        // M5 (CR-M5-10): Export the city, as the export section starts (`../export/fixtures.ts` holds its states).
        export: {
            status: 'loading',
            failure: null,
            owner: false,
            published: false,
            latest: null,
            scans: { count: 0, bytes: 0 },
            includeScans: false,
            starting: false,
            downloading: false,
        },
        // M5 (owner: multi-city): the city's budget, as its section starts.
        budget: { status: 'loading', failure: null, owner: false, limits: null, draft: {}, used: {}, saving: false, error: null },
        // The browser tab icon's card, idle.
        icon: { busy: false, error: null },
        ...overrides,
    };
}

type LayersArea = FakeArea<LayersViewState, LayersIntentsPort>;
type SettingsArea = FakeArea<SettingsViewState, SettingsIntentsPort>;

/** Mounts `<hcm-layers-page>` or `<hcm-settings-page>` at `#/<area>/<params>` over an app whose store is `store`. */
export async function page(
    area: 'layers' | 'settings',
    store: LayersArea | SettingsArea | null,
    options: {
        readonly params?: readonly string[];
        readonly width?: number;
        readonly locale?: 'ro' | 'en';
        /** A revoked admin's read-only page (DECISIONS-for-review.md §42d). */
        readonly revoked?: boolean;
    } = {},
): Promise<{ readonly app: FakeAdminApp; readonly element: HTMLElement }> {
    const route = { id: area, params: options.params ?? [] };
    const app = new FakeAdminApp(adminState({ route, locale: options.locale ?? 'en', revoked: options.revoked === true }));
    app.areas[area] = store;
    const element = document.createElement(`hcm-${area}-page`) as HTMLElement & { app: unknown; state: unknown };
    element.app = app;
    element.state = app.state;
    (element as HTMLElement & { mapCss?: string }).mapCss = '';
    const host = await mount<HTMLElement>(html`<div class="box">${element}</div>`, options.width ?? 1300);
    host.style.blockSize = '800px';
    element.style.blockSize = '800px';
    await updated(element);
    return { app, element };
}
