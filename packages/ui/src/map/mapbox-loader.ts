/**
 * Mapbox GL JS for a page that does not load it up front (the admin, docs/research/M2c-interfaces.md §3.4): the first map
 * of the session adds `mapbox-gl.js` of the pinned release from api.mapbox.com (never bundled; the admin's CSP allows
 * `https://api.mapbox.com/mapbox-gl-js/`) and resolves the global `mapboxgl` it defines. The script is fetched with CORS
 * and, when the page names one, its Subresource Integrity digest: the admin's site build writes the digest of the pinned
 * npm release into `<html data-mapbox-integrity>` (`DECISIONS-for-review.md` §34h), as the viewer's page names it on its
 * own script element, so a changed file on the CDN is refused. A failed load is tried again by the next map. Its
 * stylesheet is linked inside each map element's shadow root (`MAPBOX_GL_CSS_URL`), as the viewer does.
 */
import type { MapboxGl } from './mapbox-types.js';

/** The release the map code is written against (the engine's `MAPBOX_GL_VERSION`, the site's page). */
export const MAPBOX_GL_VERSION = '3.34.1';

const MAPBOX_GL_BASE = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_GL_VERSION}`;

export const MAPBOX_GL_SCRIPT_URL = `${MAPBOX_GL_BASE}/mapbox-gl.js`;
export const MAPBOX_GL_CSS_URL = `${MAPBOX_GL_BASE}/mapbox-gl.css`;

/** The attribute of the page's `<html>` that holds the script's Subresource Integrity digest. */
export const MAPBOX_INTEGRITY_ATTRIBUTE = 'data-mapbox-integrity';

/** A SHA-384 Subresource Integrity digest, as the site build writes it (`scripts/site/src/sri.ts`). */
const INTEGRITY = /^sha384-[A-Za-z0-9+/]{64}$/;

/** The parts of `window` the loader uses. */
export interface MapboxLoaderScope {
    readonly document: Pick<Document, 'createElement' | 'head'> & { readonly documentElement?: Pick<Element, 'getAttribute'> };
    readonly mapboxgl?: MapboxGl;
}

/** The digest the page names for the script, or null (none, or not a SHA-384 digest: then the script loads without one). */
export function pageIntegrity(scope: MapboxLoaderScope): string | null {
    const value = scope.document.documentElement?.getAttribute(MAPBOX_INTEGRITY_ATTRIBUTE) ?? null;
    return value !== null && INTEGRITY.test(value) ? value : null;
}

const loads = new WeakMap<MapboxLoaderScope, Promise<MapboxGl>>();

function loadScript(scope: MapboxLoaderScope): Promise<MapboxGl> {
    return new Promise((resolve, reject) => {
        const script = scope.document.createElement('script');
        const integrity = pageIntegrity(scope);
        if (integrity !== null) {
            script.integrity = integrity;
        }
        script.crossOrigin = 'anonymous';
        script.src = MAPBOX_GL_SCRIPT_URL;
        script.addEventListener('load', () => {
            const gl = scope.mapboxgl;
            if (gl === undefined) {
                reject(new Error('mapbox-gl.js did not define mapboxgl'));
            } else {
                resolve(gl);
            }
        });
        script.addEventListener('error', () => {
            reject(new Error('mapbox-gl.js failed to load'));
        });
        scope.document.head.append(script);
    });
}

/** The page's `mapboxgl`, loading Mapbox GL JS the first time (one script element however many maps ask). */
export function loadMapboxGl(scope: MapboxLoaderScope): Promise<MapboxGl> {
    const ready = scope.mapboxgl;
    if (ready !== undefined) {
        return Promise.resolve(ready);
    }
    let loading = loads.get(scope);
    if (loading === undefined) {
        loading = loadScript(scope);
        loads.set(scope, loading);
        loading.catch(() => {
            loads.delete(scope);
        });
    }
    return loading;
}
