/**
 * Fakes for swipe compare's tests (M4, V06): a recording compare surface in place of `<hcm-compare>` and a compare module
 * whose `startCompare` is the real session, so the store, the driver and the session are tested together in node, with
 * FakeMap for both maps.
 */
import { FakeMap, type FakeMapOptions } from '@hcm/test-support/fake-map';
import type { CompareUi, CompareUiEvents, CompareUiProps } from '@hcm/ui/viewer/compare';

import { startCompare } from '../../src/compare/session.js';
import type { CompareDeps, CompareModule, CompareSession, CompareSessionDeps } from '../../src/core/compare-port.js';

/** A recording `CompareUi`: what the session showed, and the visitor's side through `events`. */
export class FakeCompareUi implements CompareUi {
    readonly updates: CompareUiProps[] = [];
    readonly anchor: HTMLElement;
    readonly css: string;
    readonly events: CompareUiEvents;
    /** What `mapContainer` answers (null: the surface has no second map's container). */
    container: HTMLElement | null = { id: 'second-map' } as unknown as HTMLElement;
    /** `mapContainer` answers once this settles (mapbox-gl.css on its way). */
    gate: Promise<void> = Promise.resolve();
    removed = 0;

    constructor(anchor: HTMLElement, css: string, events: CompareUiEvents) {
        this.anchor = anchor;
        this.css = css;
        this.events = events;
    }

    /** The props of the last update. */
    get props(): CompareUiProps | undefined {
        return this.updates.at(-1);
    }

    update(props: CompareUiProps): void {
        this.updates.push(props);
    }

    async mapContainer(): Promise<HTMLElement | null> {
        await this.gate;
        return this.container;
    }

    remove(): void {
        this.removed += 1;
    }
}

/** A compare module around the real session: every surface and second map it makes is kept for the test. */
export class FakeCompare {
    readonly uis: FakeCompareUi[] = [];
    readonly maps: FakeMap[] = [];
    readonly started: CompareSessionDeps[] = [];
    readonly sessions: CompareSession[] = [];
    /** How the next second maps behave (a failing style: `{ mountError: new Error('style') }`). */
    mapOptions: FakeMapOptions = {};
    /** When set, `load` rejects with it (the chunk could not be fetched). */
    loadError: Error | null = null;
    /** When set, the chunk's `startCompare` throws it (the chunk arrived but could not start). */
    startError: Error | null = null;
    /** The next surfaces' `gate` and `container` (a surface without the second map's container: null). */
    gate: Promise<void> = Promise.resolve();
    /** The next second maps' `mount` waits for this (their style on its way). */
    mountGate: Promise<void> = Promise.resolve();
    container: HTMLElement | null | undefined = undefined;
    loads = 0;

    readonly module: CompareModule = {
        startCompare: (deps) => {
            if (this.startError !== null) {
                throw this.startError;
            }
            this.started.push(deps);
            const session = startCompare(deps);
            this.sessions.push(session);
            return session;
        },
        createCompareUi: (anchor, css, events) => {
            const ui = new FakeCompareUi(anchor, css, events);
            ui.gate = this.gate;
            if (this.container !== undefined) {
                ui.container = this.container;
            }
            this.uis.push(ui);
            return ui;
        },
    };

    /** `ViewerDeps.compare` for a store under test. */
    readonly deps: CompareDeps = {
        load: () => {
            this.loads += 1;
            return this.loadError === null ? Promise.resolve(this.module) : Promise.reject(this.loadError);
        },
        createMap: () => {
            const map = new FakeMap(this.mapOptions);
            const mount = map.mount.bind(map);
            const gate = this.mountGate;
            map.mount = async (container, options) => {
                await gate;
                return mount(container, options);
            };
            this.maps.push(map);
            return map;
        },
        mapboxCssUrl: 'https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css',
    };

    /** The newest surface. */
    get ui(): FakeCompareUi {
        const ui = this.uis.at(-1);
        if (ui === undefined) {
            throw new Error('no compare surface was made');
        }
        return ui;
    }

    /** The newest second map. */
    get map(): FakeMap {
        const map = this.maps.at(-1);
        if (map === undefined) {
            throw new Error('no second map was made');
        }
        return map;
    }
}
