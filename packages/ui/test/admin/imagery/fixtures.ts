// The Imagery and georeferencer pages' fixtures: their view states as the admin's stores would hold them, and mounting a
// page over a fake app whose area is a `FakeArea`.
import { html } from 'lit';

import { AREA_ELEMENTS as GEOREF } from '../../../src/admin/areas/georef.js';
import { AREA_ELEMENTS as IMAGERY } from '../../../src/admin/areas/imagery.js';
import type { AdminStatePort } from '../../../src/admin/admin-port.js';
import type { ListStatePort } from '../../../src/admin/content-port.js';
import type { GeorefIntentsPort, GeorefVersionPort, GeorefViewState } from '../../../src/admin/georef/georef-port.js';
import type {
    ImageryIntentsPort,
    ImageryViewState,
    JobViewPort,
    SceneItemPort,
    VersionItemPort,
    VersionPagePort,
    VersionViewPort,
} from '../../../src/admin/imagery/imagery-port.js';
import { UPLOAD_PANEL_CHUNK } from '../../../src/admin/imagery/hcm-imagery-page.js';
import { JOIN_CARD_CHUNK } from '../../../src/admin/imagery/join/lazy-card.js';
import { ORDER_CARD_CHUNK } from '../../../src/admin/imagery/orders/lazy-card.js';
import { MAPBOX_CHOICES_CHUNK } from '../../../src/admin/imagery/lazy-approval.js';
import { SCENE_USE_CHUNK } from '../../../src/admin/imagery/scene-detail.js';
import { APPROVAL_MAP_CHUNK } from '../../../src/admin/imagery/lazy-version.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, deep, deepAll, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

export function ready<Item>(items: readonly Item[], more: Partial<ListStatePort<Item>> = {}): ListStatePort<Item> {
    return { status: 'ready', items, hasMore: false, reconnecting: false, failure: null, ...more };
}

/** Registers the pages and fetches the order card's chunk first, so a page renders the card at once (`lazy-card.test.ts` waits). */
export async function defineImagery(): Promise<void> {
    defineAll();
    IMAGERY.define(customElements);
    GEOREF.define(customElements);
    await ORDER_CARD_CHUNK.load();
    await JOIN_CARD_CHUNK.load();
    await UPLOAD_PANEL_CHUNK.load();
    await APPROVAL_MAP_CHUNK.load();
    await MAPBOX_CHOICES_CHUNK.load();
    await SCENE_USE_CHUNK.load();
}

export function scene(overrides: Partial<SceneItemPort> = {}): SceneItemPort {
    return {
        ...{ id: 'DS1035-1057DA023', displayId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A', sensorName: 'KH-4A Corona' },
        ...{
            date: '1966-07-12',
            year: 1966,
            status: 'candidate',
            free: true,
            cloudCover: 12,
            resolutionM: 2.75,
            coverage: 0.94,
            score: 87,
        },
        reasons: [
            { code: 'free' },
            { code: 'coverage', params: { percent: '94' } },
            { code: 'targetYear', params: { year: '1966' } },
            { code: 'resolution', params: { metres: '2.8' } },
        ],
        footprint: [
            [25.9, 44.6],
            [26.3, 44.6],
            [26.3, 44.3],
        ],
        corners: null,
        browse: { state: 'copied', path: 'usgs-browse/corona2/DS1035-1057DA023.jpg', error: null },
        layerId: null,
        // M4: the acquisition state follows `free` unless a test says otherwise; no order; the verified EarthExplorer page.
        acquisition: overrides.free === false ? 'needsOrder' : 'available',
        order: null,
        earthExplorerUrl: `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/${overrides.id ?? 'DS1035-1057DA023'}/`,
        unusable: null,
        cloudCity: null,
        ...overrides,
    };
}

export function versionItem(overrides: Partial<VersionItemPort> = {}): VersionItemPort {
    return {
        ...{ id: 'job-1966', layerId: 'kh-4a-1966', label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' } },
        ...{
            year: 1966,
            origin: 'usgs',
            state: 'awaiting_approval',
            updatedAt: '2026-10-20T09:00:00.000Z',
            needsYou: true,
            checkpointRmseM: 7.2,
            partOf: null,
            entityIds: [],
            basedOn: null,
            thumbPath: null,
        },
        ...overrides,
    };
}

export function versionView(overrides: Partial<VersionViewPort> = {}): VersionViewPort {
    return {
        ...{ id: 'job-1966', layerId: 'kh-4a-1966', label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' } },
        ...{ year: 1966, date: '1966-07-12', sensor: 'KH-4A', origin: 'usgs', state: 'awaiting_approval' },
        georef: {
            method: 'auto',
            transform: 'poly2',
            pairs: 24,
            fitRmseM: 3.1,
            checkpointRmseM: 7.2,
            checkpointCount: 24,
            checkpointKind: 'held-out',
        },
        calibration: null,
        landsat: null,
        output: {
            bounds: [
                [25.95, 44.33],
                [26.25, 44.55],
            ],
            ...{ minzoom: 10, maxzoom: 16, areaKm2: 612.5, previewPath: 'rasters/x/preview.png', studioPath: 'rasters/x/studio.tif' },
            cogBytes: 212_000_000,
            coveragePct: null,
            tiles: null,
            outline: null,
        },
        ...{ estimate: 2.5, guard: null, approval: null, error: null, hasScan: true },
        ...{ entityId: 'DS1035-1057DA023', partOf: null, parts: [], join: null },
        ...{ basedOn: null, recalibration: null, publicUrl: null, rights: null },
        ...overrides,
    };
}

export function jobView(overrides: Partial<JobViewPort> = {}): JobViewPort {
    return {
        ...{ id: 'job-1966', type: 'usgs-import', status: 'awaiting_approval', finished: false, progress: 0.75, step: 'register' },
        steps: [
            { name: 'fetch', status: 'done', transfer: null },
            { name: 'georef', status: 'done', transfer: null },
            { name: 'register', status: 'running', transfer: null },
        ],
        ...{ waitReason: 'approval', retryAt: null, attempt: 1, cancelRequested: false, error: null },
        ...{ retryable: false, atMapbox: false, refusedUpload: false },
        ...overrides,
    };
}

export function versionPage(
    overrides: Partial<VersionPagePort> = {},
    version = versionView(),
    job: JobViewPort | null = jobView(),
): VersionPagePort {
    const doc = <T>(data: T, id: string) => ({ id, path: `cities/bucharest/x/${id}`, data, version: '', pending: false });
    return {
        id: 'job-1966',
        version: { status: 'ready', doc: doc(version, 'job-1966'), reconnecting: false, failure: null },
        job: { status: 'ready', doc: job === null ? null : doc(job, 'job-1966'), reconnecting: false, failure: null },
        logs: ready([{ seq: 1, level: 'info', step: 'register', message: 'rendered <b>ok</b>', at: '2026-10-20T09:00:00.000Z' }]),
        usage: { computeUnits: 4, computeUnitBudget: 20, overageComputeUnits: 0, reservations: {} },
        ...{ acting: null, refusal: null, downloaded: false, current: null, showing: 'new' as const },
        ...overrides,
    };
}

export function imageryState(overrides: Partial<ImageryViewState> = {}): ImageryViewState {
    const scenes = [
        scene(),
        scene({
            id: 'DS2',
            displayId: 'DS2',
            free: false,
            score: 40,
            reasons: [{ code: 'needsOrder' }],
            browse: { state: 'none', path: null, error: null },
        }),
    ];
    return {
        ...{
            tab: 'find',
            usgs: 'ok',
            city: null,
            settings: { autoPublish: true, rmseThresholdM: 15, targetYears: [1966], publishThroughMapbox: true },
            sources: { usgs: true, landsat: true, archives: true },
        },
        search: { phase: 'idle', found: null, added: null, failedDatasets: [], error: null },
        filters: { freeOnly: true, datasets: [], fromYear: null, toYear: null, hideRejected: true },
        ...{ scenes: ready(scenes), visible: scenes, browse: { 'DS1035-1057DA023': { status: 'ready', url: blankImage() } } },
        ...{ versions: ready([versionItem(), versionItem({ id: 'job-1980', year: 1980, state: 'processing', needsYou: false })]) },
        jobs: {
            'job-1980': { id: 'job-1980', status: 'running', progress: 0.4, step: 'warp', waitReason: null, retryAt: null, attempt: 1 },
        },
        ...{
            detail: null,
            version: null,
            importing: null,
            importRefusal: null,
            guard: null,
            resuming: false,
            named: { loading: false, scene: null, failure: null },
        },
        upload: {
            phase: 'idle',
            fileName: null,
            bytes: 0,
            year: '',
            needsYear: false,
            refusal: null,
            progress: 0,
            jobId: null,
            layerId: null,
        },
        ...{ map: 'none', previewOpacity: 0.8, replaceLayer: null },
        ...{ orders: ready([]), ordering: null, orderRefusal: null },
        ...{ dates: [], joining: null, joinRefusal: null, addingYear: null, image: { status: 'none' }, thumbs: {} },
        ...overrides,
    };
}

/** A small grey image as a data address, drawn here (the tests make no network request). */
export function blankImage(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 20;
    const context = canvas.getContext('2d');
    if (context !== null) {
        context.fillStyle = '#888';
        context.fillRect(0, 0, 40, 20);
    }
    return canvas.toDataURL('image/png');
}

export function georefReference(
    overrides: Partial<NonNullable<GeorefVersionPort['reference']>> = {},
): NonNullable<GeorefVersionPort['reference']> {
    return {
        bounds: [
            [25.95, 44.33],
            [26.25, 44.55],
        ],
        ...{ osmPath: 'x/reference-osm.png', s2Path: 'x/reference-s2.jpg', s2Date: '2025-08-03' },
        ...overrides,
    };
}

export function georefVersion(overrides: Partial<GeorefVersionPort> = {}): GeorefVersionPort {
    return {
        ...{ id: 'job-1966', layerId: 'kh-4a-1966', label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' } },
        ...{ state: 'needs_gcps', scan: { width: 2000, height: 1000, previewScale: 0.5, previewPath: 'x/scan-preview.jpg' } },
        reference: georefReference(),
        editable: true,
        ...overrides,
    };
}

export function georefState(overrides: Partial<GeorefViewState> = {}): GeorefViewState {
    return {
        ...{
            versionId: 'job-1966',
            doc: { status: 'ready', reconnecting: false, failure: null },
            notFound: false,
            version: georefVersion(),
        },
        ...{
            scan: { status: 'ready', url: blankImage() },
            reference: 'osm',
            adding: false,
            half: null,
            ghost: null,
            moving: null,
            selected: null,
            transform: 'affine',
            linked: true,
            scanFollow: null,
            scanDetail: null,
            baseLayers: [],
            base: null,
            rotateLinked: true,
        },
        pairs: [
            { id: 'g1', pixel: { x: 100, y: 100 }, geo: { lat: 44.5, lng: 26 }, enabled: true, origin: 'auto', score: 0.9 },
            { id: 'g2', pixel: { x: 1900, y: 100 }, geo: { lat: 44.5, lng: 26.2 }, enabled: true, origin: 'manual' },
            { id: 'g3', pixel: { x: 1000, y: 900 }, geo: { lat: 44.35, lng: 26.1 }, enabled: true, origin: 'corner' },
            { id: 'g4', pixel: { x: 100, y: 900 }, geo: { lat: 44.35, lng: 26 }, enabled: false, origin: 'manual' },
        ],
        fit: {
            ...{
                refusal: null,
                fitRmseM: 2.1,
                checkpointRmseM: 6.4,
                checkpointCount: 1,
                residuals: { g1: 1.2, g2: 3.4, g3: 0.8, g4: 6.4 },
            },
            ...{ missing: { affine: 0, poly2: 3, tps: 7 }, overThreshold: false, refitted: false },
        },
        ...{
            thresholdM: 15,
            dirty: false,
            canUndo: false,
            saving: false,
            refusal: null,
            saved: null,
            showPreview: true,
            previewOpacity: 0.7,
            map: 'none',
            pane: 'scan',
            suggestions: { matched: false, total: 0, pending: [], selected: null, confident: null, noSpread: false, outsideCity: false },
        },
        ...overrides,
    };
}

interface Mounted<State, Intents extends object> {
    readonly app: FakeAdminApp;
    readonly element: HTMLElement;
    readonly area: FakeArea<State, Intents>;
}

async function mountPage<State, Intents extends object>(
    tag: string,
    key: 'imagery' | 'georef',
    area: FakeArea<State, Intents>,
    options: {
        readonly params?: readonly string[];
        readonly width?: number;
        readonly locale?: 'ro' | 'en';
        readonly state?: Partial<AdminStatePort>;
    },
): Promise<Mounted<State, Intents>> {
    const app = new FakeAdminApp(
        adminState({ route: { id: key, params: options.params ?? [] }, locale: options.locale ?? 'en', ...options.state }),
    );
    app.areas[key] = area;
    const host = await mount<HTMLElement>(html`<div class="box"></div>`, options.width ?? 1300);
    const element = document.createElement(tag) as HTMLElement & { app: unknown; state: unknown; mapCss: string };
    element.app = app;
    element.state = app.state;
    element.mapCss = '';
    element.style.blockSize = '800px';
    host.append(element);
    await updated(element);
    return { app, element, area };
}

export function imageryPage(
    state: ImageryViewState = imageryState(),
    options: Parameters<typeof mountPage>[3] = {},
    answers: Partial<Record<keyof ImageryIntentsPort, unknown>> = {},
): Promise<Mounted<ImageryViewState, ImageryIntentsPort>> {
    const area = new FakeArea<ImageryViewState, ImageryIntentsPort>(state, {
        ...{
            importScene: Promise.resolve('job-new'),
            search: Promise.resolve(),
            approve: Promise.resolve(true),
            reject: Promise.resolve(true),
            confirmRights: Promise.resolve(true),
            deleteVersion: Promise.resolve(true),
        },
        ...{
            choose: Promise.resolve(true),
            studioDone: Promise.resolve(true),
            download: Promise.resolve(true),
            retryJob: Promise.resolve(true),
            locateAgain: Promise.resolve(true),
        },
        ...{ cancelJob: Promise.resolve(true), chooseFile: Promise.resolve() },
        ...{ joinFrames: Promise.resolve('job-join'), addTargetYear: Promise.resolve(true) },
        ...answers,
    });
    return mountPage('hcm-imagery-page', 'imagery', area, options);
}

export function georefPage(
    state: GeorefViewState = georefState(),
    options: Parameters<typeof mountPage>[3] = {},
    answers: Partial<Record<keyof GeorefIntentsPort, unknown>> = {},
): Promise<Mounted<GeorefViewState, GeorefIntentsPort>> {
    const area = new FakeArea<GeorefViewState, GeorefIntentsPort>(state, { save: Promise.resolve(true), ...answers });
    return mountPage('hcm-georef-page', 'georef', area, { params: ['job-1966'], ...options });
}

/** Clicks a kit element's inner button. */
export function click(host: HTMLElement): void {
    deep(host, 'button').click();
}

/** The `index`th match of `selector` anywhere below `root` (throws when missing). */
export function nth(root: HTMLElement, selector: string, index: number): HTMLElement {
    const found = deepAll(root, selector)[index];
    if (found === undefined) {
        throw new Error(`no ${selector} #${String(index)}`);
    }
    return found;
}

/** The `hcm-button` whose label is `text`. */
/** The scene page's action buttons, its Not useful section's left out (`scene-unusable.test.ts` has those). */
export function sceneButtons(root: HTMLElement): HTMLElement[] {
    return deepAll(root, '.pane[data-scene] hcm-button').filter((target) => target.closest('[data-scene-unusable]') === null);
}

export function button(root: HTMLElement, text: string): HTMLElement {
    const found = deepAll(root, 'hcm-button').find((candidate) => candidate.textContent.trim() === text);
    if (found === undefined) {
        throw new Error(`no button ${text}`);
    }
    return found;
}
