import { createLogger, type BBox } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { FakeMap, FakeMapboxGl } from '@hcm/test-support/fake-map';
import type { TerraDrawModules } from '@hcm/ui/map/draw';
import { describe, expect, it } from 'vitest';

import {
    ADMIN_MAP_STYLE,
    createAdminMapFactory,
    type AdminMapDeps,
    type AdminMapHandle,
    type AdminMapOptions,
    type AdminMapResult,
} from '../../src/map/factory.js';
import { fakeEnv } from './support.js';

const CITY: BBox = [
    [25.9, 44.3],
    [26.3, 44.55],
];

const OPTIONS: AdminMapOptions = { bounds: CITY, view: { center: [26.1, 44.43], zoom: 13, bearing: 0 }, locale: 'ro' };

interface World {
    readonly gl: FakeMapboxGl;
    readonly deps: AdminMapDeps;
    readonly warnings: () => readonly string[];
}

function world(overrides: Partial<AdminMapDeps> = {}, gl = new FakeMapboxGl()): World {
    const recording = createRecordingSink();
    const deps: AdminMapDeps = {
        gl: () => Promise.resolve(gl),
        token: () => Promise.resolve('pk.admin'),
        terraDraw: null,
        reducedMotion: () => false,
        env: fakeEnv(),
        log: createLogger('admin-map-test', { sink: recording.sink }),
        ...overrides,
    };
    const warnings = (): readonly string[] => recording.records.filter((record) => record.level === 'warn').map((record) => record.message);
    return { gl, deps, warnings };
}

/** Creates the map and plays Mapbox's `load` once the map exists. */
async function created(target: World): Promise<AdminMapResult> {
    const creating = createAdminMapFactory(target.deps).create({} as HTMLElement, OPTIONS);
    for (let round = 0; round < 20 && target.gl.maps.length === 0; round += 1) {
        await Promise.resolve();
    }
    target.gl.maps.at(-1)?.fire('load');
    return creating;
}

function handleOf(result: AdminMapResult): AdminMapHandle {
    if (!result.ok) {
        throw new Error(`no map: ${result.reason}`);
    }
    return result.map;
}

describe('the admin map factory', () => {
    it('happyPath_theMapIsStandardWithoutThreeDObjectsInsideTheCity', async () => {
        const target = world({ reducedMotion: () => true });

        const handle = handleOf(await created(target));

        const options = target.gl.map.options;
        expect(options.style).toBe(ADMIN_MAP_STYLE);
        expect(options.style).not.toMatch(/satellite/);
        expect(options.config).toEqual({ basemap: { show3dObjects: false } });
        expect(options.accessToken).toBe('pk.admin');
        expect(options.maxBounds).toEqual([
            [25.4, 43.8],
            [26.8, 45.05],
        ]);
        expect(options.language).toBe('ro');
        expect(options.performanceMetricsCollection).toBe(false);
        expect(handle.port.mapLoadCount).toBe(1);
        handle.port.flyTo({ zoom: 15 });
        expect(target.gl.map.callsOf('jumpTo')).toEqual([[{ zoom: 15 }]]);
    });

    it('badPath_withoutTheAdminTokenNoMapIsCreated', async () => {
        const target = world({ token: () => Promise.resolve(null) });

        await expect(createAdminMapFactory(target.deps).create({} as HTMLElement, OPTIONS)).resolves.toEqual({
            ok: false,
            reason: 'no-token',
        });
        expect(target.gl.maps).toEqual([]);
    });

    it('badPath_mapboxGlThatFailsToLoadOrNoWebGlOrAStyleErrorIsReported', async () => {
        const failing = world({ gl: () => Promise.reject(new Error('offline')) });
        const noWebGl = world({}, new FakeMapboxGl({ supported: false }));
        const broken = world();
        broken.gl.constructError = new Error('context lost');
        const styleError = world();

        expect(await createAdminMapFactory(failing.deps).create({} as HTMLElement, OPTIONS)).toEqual({ ok: false, reason: 'failed' });
        expect(await createAdminMapFactory(noWebGl.deps).create({} as HTMLElement, OPTIONS)).toEqual({ ok: false, reason: 'no-webgl' });
        expect(await createAdminMapFactory(broken.deps).create({} as HTMLElement, OPTIONS)).toEqual({ ok: false, reason: 'no-webgl' });
        const creating = createAdminMapFactory(styleError.deps).create({} as HTMLElement, OPTIONS);
        for (let round = 0; round < 20 && styleError.gl.maps.length === 0; round += 1) {
            await Promise.resolve();
        }
        styleError.gl.map.fire('error', { error: new Error('style 401') });
        expect(await creating).toEqual({ ok: false, reason: 'failed' });
        expect(styleError.gl.map.removed).toBe(true);
        expect(failing.warnings()).toEqual(['mapbox gl failed to load']);
        expect(styleError.warnings()).toEqual(['admin map failed to mount']);
    });

    it('happyPath_theDrawingToolsAreClickOnlyWithoutTerraDrawAndMadeOnce', async () => {
        const target = world();
        const handle = handleOf(await created(target));

        const tools = await handle.draw();

        expect(await handle.draw()).toBe(tools);
        tools.attach(handle.port, { limits: CITY, color: '#8b5e3c', maxVertices: 500, maxRings: 20 });
        tools.setMode('draw-point', 'casa');
        target.gl.map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.1, lat: 44.43 } });
        expect(tools.snapshot()).toEqual([{ id: 'casa', geometry: { type: 'Point', coordinates: [26.1, 44.43] }, shape: 'point' }]);
        handle.destroy();
        await Promise.resolve();
        expect(target.gl.map.removed).toBe(true);
        expect(tools.mode).toBe('static');
    });

    it('badPath_theDrawingToolsLeaveTheMapBeforeItIsRemoved', async () => {
        const target = world();
        const handle = handleOf(await created(target));
        const tools = await handle.draw();
        tools.attach(handle.port, { limits: CITY, color: '#8b5e3c', maxVertices: 500, maxRings: 20 });
        tools.setMode('draw-point', 'casa');

        // Synchronously, while the map still has its canvas (CR-M3-34).
        handle.destroy();

        expect([tools.mode, target.gl.map.removed]).toEqual(['static', true]);
    });

    it('badPath_toolsStillLoadingWhenTheMapGoesAreDetachedOnArrival', async () => {
        const target = world();
        const handle = handleOf(await created(target));
        const loading = handle.draw();

        handle.destroy();
        const tools = await loading;
        await Promise.resolve();

        expect([tools.mode, target.gl.map.removed]).toEqual(['static', true]);
    });

    it('badPath_terraDrawThatFailsToLoadFallsBackToClickDrawing', async () => {
        const target = world({ terraDraw: () => Promise.reject(new Error('chunk 404')) });
        const handle = handleOf(await created(target));

        const tools = await handle.draw();

        expect(tools.mode).toBe('static');
        expect(target.warnings()).toEqual(['terra draw failed to load: click drawing']);
        handle.destroy();
    });

    it('happyPath_loadedTerraDrawIsUsed', async () => {
        const mode = class {
            readonly kind = 'mode';
        };
        const modules = {
            ...{ TerraDraw: mode, TerraDrawPointMode: mode, TerraDrawLineStringMode: mode, TerraDrawPolygonMode: mode },
            ...{ TerraDrawRectangleMode: mode, TerraDrawSelectMode: mode, TerraDrawRenderMode: mode, TerraDrawMapboxGLAdapter: mode },
        } as unknown as TerraDrawModules;
        const target = world({ terraDraw: () => Promise.resolve(modules) });
        const handle = handleOf(await created(target));

        const tools = await handle.draw();

        expect(() => {
            tools.attach(new FakeMap(), { limits: CITY, color: '#8b5e3c', maxVertices: 500, maxRings: 20 });
        }).toThrow('draw needs a mounted Mapbox map');
        handle.destroy();
    });

    it('happyPath_destroyWithoutDrawingToolsRemovesTheMap', async () => {
        const target = world();
        const handle = handleOf(await created(target));

        handle.destroy();

        expect(target.gl.map.removed).toBe(true);
    });

    it('happyPath_theAdminPortProjectsAndUnprojectsOutsideTheEngineMapPort', async () => {
        const target = world();
        const handle = handleOf(await created(target));

        const at = handle.port.project([26.1, 44.43]);
        expect(at).toEqual({ x: 400, y: 300 });
        expect(at === null ? null : handle.port.unproject(at)).toEqual([26.1, 44.43]);
        handle.destroy();
        expect(handle.port.project([26.1, 44.43])).toBeNull();
    });
});
