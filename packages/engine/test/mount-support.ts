/**
 * Fakes for the public-API tests (`mount.ts`, `index.ts`): a recording stand-in for `<hcm-map-viewer>`, a document that
 * creates it, and a `MountEnvironment` around the real viewer store with FakeMap, a fake telemetry and a scripted
 * manifest fetch. No DOM, no network.
 */
import type { EngineConfig } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import type { HcmMapViewer, ViewerController, ViewerError, ViewerStorePort } from '@hcm/ui';

import { createViewerStore, type ViewerStore } from '../src/core/store.js';
import type { MountEnvironment } from '../src/mount.js';
import { FakeCompare } from './compare/support.js';
import { manifest } from './core/fixtures.js';
import { FakeTelemetry, jsonResponse, memoryStorage, recordingLog, type RecordingLog } from './core/support.js';

export const MANIFEST_URL = 'https://storage.example.org/cities/bucuresti/manifest.json';

/** Records what `mount` does to its `<hcm-map-viewer>`. */
export class FakeViewer {
    manifestUrl = '';
    cityId = '';
    engineBase = '';
    manifest: unknown = undefined;
    bootError: ViewerError | null = null;
    engineVersion = '';
    mapboxCssUrl = '';
    /** The map container the store mounts the map into (any object: FakeMap only records it). */
    readonly mapContainer = { id: 'map-container' } as unknown as HTMLElement;
    readonly updateComplete = Promise.resolve(true);
    readonly attributes = new Map<string, string>();
    store: ViewerStorePort | null = null;
    controller: ViewerController | null = null;
    detached = 0;
    removed = 0;

    getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
    }

    attach(store: ViewerStorePort, controller: ViewerController | null): void {
        this.store = store;
        this.controller = controller;
    }

    detach(): void {
        this.detached += 1;
        this.store = null;
    }

    remove(): void {
        this.removed += 1;
    }

    /** Typed as the element `mount` expects. */
    get element(): HcmMapViewer {
        return this as unknown as HcmMapViewer;
    }
}

/** A container `mount` renders into. */
export class FakeContainer {
    readonly children: unknown[] = [];

    append(child: unknown): void {
        this.children.push(child);
    }

    get element(): Element {
        return this as unknown as Element;
    }
}

export interface TestEnvironment {
    readonly env: MountEnvironment;
    readonly viewer: FakeViewer;
    readonly map: FakeMap;
    readonly telemetry: FakeTelemetry;
    readonly log: RecordingLog;
    readonly stores: ViewerStore[];
    readonly fonts: (string | undefined)[];
    readonly containers: Map<string, FakeContainer>;
    readonly created: string[];
    /** Swipe compare's chunk (M4): the second maps and surfaces the store's compare made. */
    readonly compare: FakeCompare;
}

export interface TestEnvironmentOptions {
    /** The manifest the fetch answers (the fixture by default). */
    readonly manifest?: unknown;
    /** The HTTP status of the manifest response (200 by default). */
    readonly status?: number;
    /** `createMap` throws (Mapbox GL JS missing from the page). */
    readonly noMapbox?: boolean;
    readonly webgl?: boolean;
    /** The page address's hash and query (`?lang=en`); empty by default. */
    readonly location?: { readonly hash?: string; readonly search?: string };
    /** The languages' texts by engine folder (`MountEnvironment.catalogues`); without it only Romanian and English. */
    readonly catalogues?: MountEnvironment['catalogues'];
}

/** A `MountEnvironment` with the real store on fakes; `containers` answers `querySelector`. */
export function testEnvironment(options: TestEnvironmentOptions = {}): TestEnvironment {
    const viewer = new FakeViewer();
    const map = new FakeMap({ webgl: options.webgl ?? true });
    const telemetry = new FakeTelemetry();
    const log = recordingLog();
    const stores: ViewerStore[] = [];
    const fonts: (string | undefined)[] = [];
    const containers = new Map<string, FakeContainer>();
    const created: string[] = [];
    const compare = new FakeCompare();
    let mapsMade = 0;
    const body = options.manifest ?? manifest();
    const env: MountEnvironment = {
        document: {
            createElement: (tag: string) => {
                created.push(tag);
                return viewer.element;
            },
            querySelector: (selector: string) => {
                if (selector.startsWith('!')) {
                    throw new SyntaxError(`'${selector}' is not a valid selector`);
                }
                return containers.get(selector)?.element ?? null;
            },
        },
        // The viewer's map first; every later map is swipe compare's second map (M4), kept by `compare`.
        createMap: () => {
            if (options.noMapbox === true) {
                throw new Error('mapboxgl is not defined');
            }
            mapsMade += 1;
            return mapsMade === 1 ? map : compare.deps.createMap();
        },
        createTelemetry: () => telemetry,
        createStore: (deps) => {
            const store = createViewerStore(deps);
            stores.push(store);
            return store;
        },
        fetch: () => Promise.resolve(jsonResponse(body, options.status ?? 200)),
        storage: memoryStorage(),
        location: { hash: options.location?.hash ?? '', search: options.location?.search ?? '', replaceHash: () => undefined },
        log: log.log,
        engineVersion: '1.0.0',
        mapboxCssUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css',
        reducedMotion: () => false,
        installFonts: (engineBase) => {
            fonts.push(engineBase);
        },
        loadCompare: () => compare.deps.load(),
        ...(options.catalogues === undefined ? {} : { catalogues: options.catalogues }),
    };
    return { env, viewer, map, telemetry, log, stores, fonts, containers, created, compare };
}

/** A valid embed configuration. */
export function config(change: Partial<EngineConfig> = {}): EngineConfig {
    return { cityId: 'bucuresti', manifestUrl: MANIFEST_URL, ...change };
}
