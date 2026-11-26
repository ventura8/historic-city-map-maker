/**
 * A work-around for Mapbox GL JS 3.34.1's WebGL context restore (the Crashes group "TypeError: Cannot convert undefined
 * or null to object" at `ModelManager.load ← reloadModels ← Style.forEachFragmentStyle ← Map._contextRestored`, viewer
 * 1.0.0, 2026-11-08; `docs/LESSONS.md`): `_contextRestored` reloads the 3D models of every style fragment with
 * `load(this.modelUris[scope])`, and a fragment that never had a model (the Standard basemap import of a map without 3D
 * models) has no `modelUris[scope]`, so `Object.keys(undefined)` throws. The throw aborts the restore half-way (the
 * sources are not cleared, `webglcontextrestored` never fires) and leaves a blank map.
 *
 * The guard listens to the canvas's `webglcontextrestored` in the capture phase, which runs before Mapbox's own listener
 * on the same canvas, and gives every fragment without one an empty model list, so the restore completes. It reads only
 * the shapes below, defensively: a later Mapbox without these internals is left alone (the pin is exact, `mapbox-gl.js`
 * 3.34.1 from api.mapbox.com). Each repair is logged with the number of fragments it filled.
 */
import { createLogger } from '@hcm/shared';

const log = createLogger('map-context-restore');

/** The part of a Mapbox style fragment the guard touches. */
interface FragmentStyle {
    readonly scope?: unknown;
    readonly modelManager?: { modelUris?: Record<string, unknown> };
}

/** The part of Mapbox's map the guard reads. */
interface RestorableMap {
    getCanvas(): Pick<HTMLElement, 'addEventListener' | 'removeEventListener'>;
    readonly style?: {
        readonly modelManager?: FragmentStyle['modelManager'];
        forEachFragmentStyle?: (visit: (style: FragmentStyle) => void) => void;
    };
}

/** The model list of `scope` made empty when missing. Returns whether it was missing. */
function fillScope(manager: FragmentStyle['modelManager'], scope: unknown): boolean {
    const uris = manager?.modelUris;
    if (uris === undefined || typeof scope !== 'string' || uris[scope] !== undefined) {
        return false;
    }
    uris[scope] = Object.create(null) as Record<string, unknown>;
    return true;
}

/** Fills the missing model lists of the root style and of every fragment; returns how many were missing. */
export function fillMissingModelScopes(map: Pick<RestorableMap, 'style'>): number {
    const style = map.style;
    let filled = fillScope(style?.modelManager, '') ? 1 : 0;
    style?.forEachFragmentStyle?.((fragment) => {
        filled += fillScope(fragment.modelManager, fragment.scope) ? 1 : 0;
    });
    return filled;
}

/** Installs the guard on `map`'s canvas; returns the function that removes it. */
export function guardContextRestore(map: RestorableMap): () => void {
    const canvas = map.getCanvas();
    const listener = (): void => {
        const filled = fillMissingModelScopes(map);
        log.info('WebGL context restored: empty 3D-model lists given to the style fragments without one', { filled });
    };
    canvas.addEventListener('webglcontextrestored', listener, true);
    return () => {
        canvas.removeEventListener('webglcontextrestored', listener, true);
    };
}
