import { describe, expect, it } from 'vitest';

import { fillMissingModelScopes, guardContextRestore } from '../../src/map/context-restore.js';

interface Fragment {
    readonly scope: string;
    readonly modelManager: { modelUris: Record<string, unknown> };
}

/** A map whose root style has models and whose `basemap` fragment never had one (the Crashes group of 2026-11-08). */
function restorableMap(canvas: HTMLCanvasElement) {
    const root: Fragment = { scope: '', modelManager: { modelUris: { '': {} } } };
    const basemap: Fragment = { scope: 'basemap', modelManager: { modelUris: {} } };
    const style = {
        modelManager: root.modelManager,
        forEachFragmentStyle: (visit: (fragment: Fragment) => void) => {
            visit(root);
            visit(basemap);
        },
    };
    return { map: { getCanvas: () => canvas, style }, basemap };
}

/** Mapbox 3.34.1's `_contextRestored` as far as the crash goes: `Object.keys` of every fragment's model list. */
function mapboxRestore(map: ReturnType<typeof restorableMap>['map']): () => void {
    return () => {
        map.style.forEachFragmentStyle((fragment) => {
            Object.keys(fragment.modelManager.modelUris[fragment.scope] as object);
        });
    };
}

function restoreThrows(canvas: HTMLCanvasElement, map: ReturnType<typeof restorableMap>['map']): boolean {
    let thrown = false;
    const restore = mapboxRestore(map);
    const listener = (): void => {
        try {
            restore();
        } catch {
            thrown = true;
        }
    };
    canvas.addEventListener('webglcontextrestored', listener);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    canvas.removeEventListener('webglcontextrestored', listener);
    return thrown;
}

describe('the WebGL context restore guard', () => {
    it('badPath_withoutTheGuardMapboxRestoreThrowsOnAFragmentWithoutModels', () => {
        const canvas = document.createElement('canvas');
        const { map } = restorableMap(canvas);
        expect(restoreThrows(canvas, map)).toBe(true);
    });

    it('happyPath_theGuardRunsBeforeMapboxAndTheRestoreCompletes', () => {
        const canvas = document.createElement('canvas');
        const { map, basemap } = restorableMap(canvas);
        const stop = guardContextRestore(map);
        expect(restoreThrows(canvas, map)).toBe(false);
        expect(basemap.modelManager.modelUris['basemap']).toEqual({});
        stop();
    });

    it('happyPath_removedGuardNoLongerListens', () => {
        const canvas = document.createElement('canvas');
        const { map } = restorableMap(canvas);
        guardContextRestore(map)();
        expect(restoreThrows(canvas, map)).toBe(true);
    });

    it('badPath_aMapboxWithoutTheseInternalsIsLeftAlone', () => {
        expect(fillMissingModelScopes({})).toBe(0);
        expect(fillMissingModelScopes({ style: {} })).toBe(0);
        const oddScope = (visit: (fragment: { scope: unknown; modelManager: { modelUris: Record<string, unknown> } }) => void): void => {
            visit({ scope: 3, modelManager: { modelUris: {} } });
        };
        expect(fillMissingModelScopes({ style: { forEachFragmentStyle: oddScope } })).toBe(0);
        expect(fillMissingModelScopes({ style: { modelManager: { modelUris: {} } } })).toBe(1);
    });
});
