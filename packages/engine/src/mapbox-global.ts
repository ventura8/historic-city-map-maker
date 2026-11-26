/**
 * The page's Mapbox GL JS for the viewer's map: the global `mapboxgl` from api.mapbox.com, which the public pages load
 * `async` (the cold load of 2026-11-12, DECISIONS-for-review.md §178f), so the engine may run before it.
 */
import type { MapboxGl } from '@hcm/ui/map';

type MapboxScope = Window & { readonly mapboxgl?: MapboxGl };

/** The page's `<script>` of Mapbox GL JS (`mapbox-gl.js` or its `-csp` build), if any. */
function mapboxScript(win: Window): HTMLScriptElement | null {
    return win.document.querySelector<HTMLScriptElement>('script[src*="/mapbox-gl-js/"]');
}

/**
 * The page's `mapboxgl`, which `mapbox-gl.js` from api.mapbox.com defines: now, or once its script has loaded when the
 * page loads it `async` (the public pages do since the cold load of 2026-11-12, so the viewer paints before 526 KB of
 * Mapbox GL have arrived: scripts/site/src/page.ts). No global and no script still loading: an error.
 */
export function mapboxOf(win: Window, version: string): MapboxGl | Promise<MapboxGl> {
    const scope = win as MapboxScope;
    if (scope.mapboxgl !== undefined) {
        return scope.mapboxgl;
    }
    const missing = new Error(`mapboxgl is not defined: load https://api.mapbox.com/mapbox-gl-js/v${version}/mapbox-gl.js first`);
    const script = mapboxScript(win);
    if (script === null || win.document.readyState === 'complete') {
        throw missing;
    }
    return new Promise((resolve, reject) => {
        script.addEventListener('load', () => {
            const gl = scope.mapboxgl;
            if (gl === undefined) {
                reject(missing);
            } else {
                resolve(gl);
            }
        });
        script.addEventListener('error', () => {
            reject(missing);
        });
    });
}
