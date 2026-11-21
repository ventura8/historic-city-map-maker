import type { Page } from '@playwright/test';

/**
 * Read-only instrumentation added to every page before its own scripts run (`context.addInitScript`), with no hook
 * in production code (docs/research/design-review-testability.md §4.2):
 *
 * - the **map-instance counter**: `window.mapboxgl` is trapped when Mapbox GL's UMD bundle assigns it, and its `Map`
 *   is replaced by a subclass that counts constructions and `remove()` calls, so a spec asserts one map per view (each
 *   map is a billed Mapbox map load) and that swipe compare creates and destroys its second map. The live maps are kept
 *   in `window.__hcmE2e.maps` so the map helpers (support/map.ts) can read what the user sees: where a coordinate is
 *   drawn on the screen, when the map is idle, which features are rendered. Specs never drive the map through it;
 * - the **engine events**: every `hcm-*` event that reaches `document` (they bubble and are composed) is kept with
 *   its detail, so a spec can wait for `hcm-ready` even when it fired before the spec looked.
 */

export interface E2eInstrumentation {
    readonly mapsCreated: number;
    readonly mapsRemoved: number;
    readonly events: readonly { readonly type: string; readonly detail: unknown }[];
}

/** The engine's public events (docs/ENGINE_API.md → `<hcm-map-viewer>`; `hcm-compare-change` since M4's swipe compare). */
export const ENGINE_EVENTS = [
    'hcm-ready',
    'hcm-error',
    'hcm-layer-change',
    'hcm-overlay-change',
    'hcm-photo-open',
    'hcm-poi-open',
    'hcm-compare-change',
    'hcm-map-labels-change',
];

/** Runs in the page, serialized by Playwright: it must not reference anything outside its own body. */
export function instrumentPage(eventTypes: readonly string[]): void {
    interface Counted {
        created: number;
        removed: number;
        maps: unknown[];
        events: { type: string; detail: unknown }[];
    }
    type MapClass = new (...args: unknown[]) => { remove(): unknown };
    const state: Counted = { created: 0, removed: 0, maps: [], events: [] };
    const target = window as unknown as Record<string, unknown>;
    Object.defineProperty(target, '__hcmE2e', { value: state });
    const counting = (Base: MapClass): MapClass =>
        class CountingMap extends Base {
            constructor(...args: unknown[]) {
                super(...args);
                state.created += 1;
                state.maps.push(this);
            }

            override remove(): unknown {
                state.removed += 1;
                state.maps = state.maps.filter((map) => map !== this);
                return super.remove();
            }
        };
    let library: unknown;
    Object.defineProperty(target, 'mapboxgl', {
        configurable: true,
        get: () => library,
        set: (value: unknown) => {
            const gl = value as { Map?: unknown } | null;
            if (gl !== null && typeof gl === 'object' && typeof gl.Map === 'function') {
                gl.Map = counting(gl.Map as MapClass);
            }
            library = value;
        },
    });
    for (const type of eventTypes) {
        document.addEventListener(type, (event) => state.events.push({ type, detail: (event as CustomEvent).detail }), true);
    }
}

/** What the page recorded so far (zeros on a page without the init script, such as one opened before it). */
export async function readInstrumentation(page: Page): Promise<E2eInstrumentation> {
    return page.evaluate(() => {
        const state = (window as unknown as Record<string, unknown>)['__hcmE2e'] as
            { created: number; removed: number; events: { type: string; detail: unknown }[] } | undefined;
        return { mapsCreated: state?.created ?? 0, mapsRemoved: state?.removed ?? 0, events: state?.events ?? [] };
    });
}
