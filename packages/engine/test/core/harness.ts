/** A viewer store wired to fakes: FakeMap, a recording telemetry, memory storage, a scripted manifest fetch. */
import type { EngineConfig } from '@hcm/shared';
import { FakeMap, type FakeMapOptions } from '@hcm/test-support/fake-map';
import { vi } from 'vitest';

import type { CatalogueLoader } from '../../src/core/catalogues.js';
import type { ColorSchemeSource } from '../../src/core/deps.js';
import { createViewerStore, type ViewerStore } from '../../src/core/store.js';
import type { FakeCompare } from '../compare/support.js';
import { FakeTelemetry, jsonResponse, memoryStorage, recordingLog, settle, type MemoryStorage, type RecordingLog } from './support.js';
import { manifest as defaultManifest } from './fixtures.js';

export const MANIFEST_URL = 'https://storage.example.org/cities/bucuresti/manifest.json';

interface FakeLocation {
    hash: string;
    readonly written: string[];
    readonly href?: string;
    readonly search: string;
    replaceHash(next: string): void;
    subscribe(listener: () => void): () => void;
    /** The visitor edits the hash (fires `hashchange`). */
    navigate(hash: string): void;
    readonly listeners: Set<() => void>;
}

function fakeLocation(hash: string, search: string, href: string | undefined): FakeLocation {
    const listeners = new Set<() => void>();
    return {
        hash,
        written: [],
        ...(href === undefined ? {} : { href }),
        search,
        listeners,
        replaceHash(next: string) {
            this.written.push(next);
            this.hash = next;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        navigate(next: string) {
            this.hash = next;
            for (const listener of listeners) {
                listener();
            }
        },
    };
}

export interface HarnessOptions {
    /** The manifest JSON the fetch answers (or the inline one); any value, to test invalid ones. */
    readonly manifest?: unknown;
    readonly config?: Partial<EngineConfig>;
    readonly hash?: string;
    readonly search?: string;
    readonly stored?: Readonly<Record<string, string>>;
    readonly map?: FakeMapOptions;
    readonly container?: HTMLElement | null;
    readonly response?: () => Promise<Response>;
    readonly reducedMotion?: boolean;
    /** The manifest given inline in the configuration instead of fetched. */
    readonly inline?: boolean;
    /** The page address (default `https://site.example.org/bucuresti/`; null: the location has none). */
    readonly href?: string | null;
    /** Swipe compare's chunk (M4); without it the store keeps compare in its state only. */
    readonly compare?: FakeCompare;
    /** `prefers-color-scheme` of the page; without it `system` counts as light. */
    readonly colorScheme?: ColorSchemeSource;
    /** The storage of an earlier harness (the visitor comes back). */
    readonly storage?: MemoryStorage;
    /** The languages' texts (`core/catalogues.ts`); without it only Romanian and English, which the tests import. */
    readonly catalogues?: CatalogueLoader;
}

export interface Harness {
    readonly store: ViewerStore;
    readonly map: FakeMap;
    readonly telemetry: FakeTelemetry;
    readonly storage: MemoryStorage;
    readonly location: FakeLocation;
    readonly fetch: ReturnType<typeof vi.fn>;
    readonly log: RecordingLog;
    readonly container: HTMLElement | null;
}

export function harness(options: HarnessOptions = {}): Harness {
    const map = new FakeMap(options.map);
    const telemetry = new FakeTelemetry();
    const storage = options.storage ?? memoryStorage(options.stored);
    const href = options.href === null ? undefined : (options.href ?? 'https://site.example.org/bucuresti/');
    const location = fakeLocation(options.hash ?? '', options.search ?? '', href);
    const body = options.manifest ?? defaultManifest();
    const fetch = vi.fn(options.response ?? (() => Promise.resolve(jsonResponse(body))));
    const log = recordingLog();
    const container = options.container === undefined ? ({ id: 'map' } as unknown as HTMLElement) : options.container;
    const source = options.inline === true ? { manifest: body } : { manifestUrl: MANIFEST_URL };
    const config: EngineConfig = { ...source, ...options.config };
    const store = createViewerStore({
        config,
        fetch,
        map,
        telemetry,
        storage,
        location,
        log: log.log,
        engineVersion: '1.0.0',
        mapContainer: () => container,
        ...(options.reducedMotion === undefined ? {} : { reducedMotion: () => options.reducedMotion === true }),
        ...(options.compare === undefined ? {} : { compare: options.compare.deps }),
        ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
        ...(options.catalogues === undefined ? {} : { catalogues: options.catalogues }),
    });
    return { store, map, telemetry, storage, location, fetch, log, container };
}

/** A harness whose store has loaded (fake timers must not be on: the fetch resolves at once). */
export async function loaded(options: HarnessOptions = {}): Promise<Harness> {
    const parts = harness(options);
    await parts.store.load();
    await settle();
    return parts;
}
