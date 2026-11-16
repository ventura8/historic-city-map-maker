import { FakeMapboxMap } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import { Basemap3dObjects } from '../../src/map/basemap.js';
import { browserAdapterEnv, type BrowserScope } from '../../src/map/env.js';
import {
    canvasIconEnv,
    drawIcon,
    ensureIcon,
    ICON_PIXEL_RATIO,
    PHOTO_AERIAL_ICON,
    PHOTO_CAMERA_ICON,
    PHOTO_CLUSTER_ICON,
    PHOTO_DIRECTION_ICON,
    placeholderImage,
    poiIconId,
    SYMBOL_FONT_FAMILY,
    type IconScope,
} from '../../src/map/icons.js';
import { classifyError, mapboxOptions, whenLoaded } from '../../src/map/lifecycle.js';
import type { MapOptions } from '../../src/map/map-port.js';
import { attachPointer, firstSelection, KEYBOARD_PICK_RADIUS, selectionOf, type Selection } from '../../src/map/pointer.js';
import { fakeIconEnv, settle } from './support.js';

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard-satellite',
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 10 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'ro',
    reducedMotion: false,
};

function mapboxMap(config?: Readonly<Record<string, string | number | boolean>>): FakeMapboxMap {
    return new FakeMapboxMap(mapboxOptions({} as HTMLElement, config === undefined ? OPTIONS : { ...OPTIONS, config }));
}

describe('sprite icons', () => {
    it('happyPath_photoMarkersAreDrawnWithTheCameraPath', async () => {
        const env = fakeIconEnv();

        const camera = await drawIcon(PHOTO_CAMERA_ICON, env);
        const direction = await drawIcon(PHOTO_DIRECTION_ICON, env);
        const cluster = await drawIcon(PHOTO_CLUSTER_ICON, env);

        expect([camera?.width, direction?.width, cluster?.width]).toEqual([64, 64, 72]);
        expect(camera?.data).toHaveLength(64 * 64 * 4);
        expect(env.contexts[0]?.drawn).toContain('fill(path)');
        expect(env.contexts[1]?.drawn.slice(0, 2)).toEqual(['beginPath', 'moveTo']);
        expect(env.contexts[2]?.drawn).not.toContain('fill(path)');
        expect(env.paths).toHaveLength(2);
    });

    it('happyPath_aPoiIconIsItsMaterialSymbolGlyph', async () => {
        const env = fakeIconEnv();

        await drawIcon(poiIconId('church'), env);

        expect(SYMBOL_FONT_FAMILY).toBe('HCM Material Symbols Rounded');
        expect(env.fonts).toEqual([`32px "${SYMBOL_FONT_FAMILY}"`]);
        expect(env.contexts[0]?.drawn).toEqual(['fillText(church)']);
        expect(env.contexts[0]?.font).toBe(`32px "${SYMBOL_FONT_FAMILY}"`);
    });

    it('badPath_withoutTheSymbolFontAPoiGetsAPlainDot', async () => {
        const env = fakeIconEnv({ fontLoads: false });

        await drawIcon(poiIconId('church'), env);

        expect(env.contexts[0]?.drawn).toEqual(['beginPath', 'arc', 'closePath', 'fill']);
    });

    it('happyPath_anAerialPhotoHasItsOwnAeroplaneMarker', async () => {
        const env = fakeIconEnv();

        const aerial = await drawIcon(PHOTO_AERIAL_ICON, env);

        expect(aerial?.width).toBe(64);
        expect(env.contexts[0]?.drawn).toContain('fill(path)');
    });

    it('badPath_anUnknownIdOrNoCanvasDrawsNothing', async () => {
        expect(await drawIcon('mystery', fakeIconEnv())).toBeNull();
        expect(await drawIcon(PHOTO_CAMERA_ICON, fakeIconEnv({ noContext: true }))).toBeNull();
    });

    it('happyPath_aPlaceholderFirstThenTheDrawing', async () => {
        const map = mapboxMap();
        const env = fakeIconEnv();

        const done = ensureIcon(map, PHOTO_CAMERA_ICON, env, () => true);
        expect(map.callsOf('addImage')[0]).toEqual([PHOTO_CAMERA_ICON, placeholderImage(64), { pixelRatio: ICON_PIXEL_RATIO }]);
        await done;

        expect(map.callsOf('updateImage')).toHaveLength(1);
        expect(map.images.get(PHOTO_CAMERA_ICON)?.data[0]).toBe(255);
    });

    it('badPath_aDrawingThatLandsOnAnIdleMapAsksForAFrame', async () => {
        const map = mapboxMap();
        await ensureIcon(map, poiIconId('park'), fakeIconEnv(), () => true);

        const calls = map.calls.map((call) => call.method).filter((method) => method === 'updateImage' || method === 'triggerRepaint');
        expect(calls).toEqual(['updateImage', 'triggerRepaint']);
    });

    it('badPath_anExistingUnknownOrLateIconIsLeftAlone', async () => {
        const map = mapboxMap();
        const env = fakeIconEnv();
        await ensureIcon(map, PHOTO_CAMERA_ICON, env, () => true);

        await ensureIcon(map, PHOTO_CAMERA_ICON, env, () => true);
        await ensureIcon(map, 'mystery', env, () => true);
        await ensureIcon(map, poiIconId('park'), env, () => false);
        await ensureIcon(map, PHOTO_CLUSTER_ICON, fakeIconEnv({ noContext: true }), () => true);

        expect(map.callsOf('addImage').map(([id]) => id)).toEqual([PHOTO_CAMERA_ICON, poiIconId('park'), PHOTO_CLUSTER_ICON]);
        expect(map.callsOf('updateImage')).toHaveLength(1);
        expect(map.callsOf('triggerRepaint')).toHaveLength(1);
    });

    it('happyPath_theBrowserEnvUsesTheDocumentCanvasAndFonts', async () => {
        const canvas = { width: 0, height: 0, getContext: () => null };
        const scope = {
            document: {
                createElement: () => canvas,
                fonts: { load: (font: string) => Promise.resolve(font.includes('Symbols') ? [{}] : []) },
            },
            Path2D: class {
                readonly d: string;
                constructor(d: string) {
                    this.d = d;
                }
            },
        } as unknown as IconScope;
        const env = canvasIconEnv(scope);

        expect(env.createCanvas(48)).toBe(canvas);
        expect(canvas).toMatchObject({ width: 48, height: 48 });
        expect(env.createPath('M0 0')).toEqual({ d: 'M0 0' });
        expect(await env.loadFont('32px "Material Symbols Rounded"')).toBe(true);
        expect(await env.loadFont('12px nothing')).toBe(false);
    });

    it('badPath_aFontLoadThatFailsReadsAsNotLoaded', async () => {
        const scope = {
            document: { createElement: () => null, fonts: { load: () => Promise.reject(new Error('blocked')) } },
            Path2D: Object,
        } as unknown as IconScope;

        expect(await canvasIconEnv(scope).loadFont('32px x')).toBe(false);
    });
});

describe('pointer selection', () => {
    const photo = { layer: { id: 'hcm-photos-marker' }, properties: { id: 'p1' } };
    const cone = { layer: { id: 'hcm-photos-cone-fill' }, properties: { id: 'p2' } };
    const poi = { layer: { id: 'hcm-poi-cladiri-circle' }, properties: { id: 'casa' } };
    const cluster = {
        layer: { id: 'hcm-photos-cluster' },
        properties: { cluster_id: 7 },
        geometry: { type: 'Point', coordinates: [26, 44] },
    };

    it('happyPath_aFeatureSelectsByItsLayer', () => {
        expect(selectionOf(photo)).toEqual({ kind: 'photo', id: 'p1' });
        expect(selectionOf(cone)).toEqual({ kind: 'photo', id: 'p2' });
        expect(selectionOf(poi)).toEqual({ kind: 'poi', id: 'casa' });
        expect(selectionOf(cluster)).toEqual({ kind: 'cluster', clusterId: 7, center: [26, 44] });
        expect(selectionOf({ ...cluster, geometry: { type: 'Point' } })).toEqual({ kind: 'cluster', clusterId: 7, center: null });
    });

    it('badPath_basemapFeaturesAndMalformedOnesSelectNothing', () => {
        expect(selectionOf({ layer: { id: 'building' }, properties: { id: 'x' } })).toBeNull();
        expect(selectionOf({ properties: { id: 'x' } })).toBeNull();
        expect(selectionOf({ layer: { id: 'hcm-photos-marker' }, properties: { id: 3 } })).toBeNull();
        expect(selectionOf({ layer: { id: 'hcm-photos-marker' }, properties: null })).toBeNull();
        expect(selectionOf({ layer: { id: 'hcm-photos-cluster' }, properties: {} })).toBeNull();
        expect(firstSelection([{ layer: { id: 'building' } }, poi, photo])).toEqual({ kind: 'poi', id: 'casa' });
        expect(firstSelection([])).toBeNull();
    });

    it('happyPath_clickHoverAndKeyboardSelect', () => {
        const map = mapboxMap();
        map.rendered = [photo];
        const selected: Selection[] = [];
        const stop = attachPointer(map, { layers: () => ['hcm-photos-marker'], select: (selection) => selected.push(selection) });

        map.fire('mousemove', { point: { x: 1, y: 1 } });
        expect(map.canvas.style.cursor).toBe('pointer');
        map.fire('click', { point: { x: 1, y: 1 } });
        const prevented = map.canvas.pressKey('Enter');
        map.canvas.pressKey(' ');

        expect(selected).toEqual([
            { kind: 'photo', id: 'p1' },
            { kind: 'photo', id: 'p1' },
            { kind: 'photo', id: 'p1' },
        ]);
        expect(prevented).toBe(true);
        const box = map.callsOf('queryRenderedFeatures').at(-1)?.[0];
        expect(box).toEqual([
            { x: 400 - KEYBOARD_PICK_RADIUS, y: 300 - KEYBOARD_PICK_RADIUS },
            { x: 400 + KEYBOARD_PICK_RADIUS, y: 300 + KEYBOARD_PICK_RADIUS },
        ]);
        stop();
        expect(map.listenerCount('click')).toBe(0);
        expect(map.canvas.listenerCount('keydown')).toBe(0);
    });

    it('badPath_missesAndOtherKeysSelectNothing', () => {
        const map = mapboxMap();
        const selected: Selection[] = [];
        attachPointer(map, { layers: () => [], select: (selection) => selected.push(selection) });

        map.fire('mousemove', {});
        map.fire('mousemove', { point: { x: 1, y: 1 } });
        map.fire('click', {});
        map.fire('click', { point: { x: 1, y: 1 } });
        map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.1, lat: 44.43 } });
        const prevented = map.canvas.pressKey('Enter') || map.canvas.pressKey('a');

        expect(selected).toEqual([]);
        expect(prevented).toBe(false);
        expect(map.canvas.style.cursor).toBe('');
        expect(map.callsOf('queryRenderedFeatures')).toEqual([]);
    });
});

describe('clicks that select nothing', () => {
    it('happyPath_aMissReportsWhereTheMapWasClicked', () => {
        const map = mapboxMap();
        const missed: (readonly [number, number])[] = [];
        attachPointer(map, { layers: () => ['hcm-photos-marker'], select: () => undefined, miss: (position) => missed.push(position) });

        map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.1, lat: 44.43 } });
        map.rendered = [{ layer: { id: 'hcm-photos-marker' }, properties: { id: 'p1' } }];
        map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 26.2, lat: 44.44 } });

        expect(missed).toEqual([[26.1, 44.43]]);
    });

    it('badPath_aMissWithoutAPositionReportsNothing', () => {
        const map = mapboxMap();
        const missed: (readonly [number, number])[] = [];
        attachPointer(map, { layers: () => [], select: () => undefined, miss: (position) => missed.push(position) });

        map.fire('click', {});
        map.fire('click', { point: { x: 1, y: 1 } });

        expect(missed).toEqual([]);
    });
});

describe('3D objects of the basemap', () => {
    it('happyPath_offWhileAHistoricalLayerIsVisibleThenBack', () => {
        const map = mapboxMap({ show3dObjects: true });
        const objects = new Basemap3dObjects(map);

        objects.update(true);
        objects.update(true);
        objects.update(false);

        expect(map.callsOf('setConfigProperty')).toEqual([
            ['basemap', 'show3dObjects', false],
            ['basemap', 'show3dObjects', true],
        ]);
    });

    it('happyPath_aStyleThatHidesThemAlreadyIsNotTouched', () => {
        const map = mapboxMap({ show3dObjects: false });

        new Basemap3dObjects(map).update(true);

        expect(map.callsOf('setConfigProperty')).toEqual([]);
    });

    it('badPath_aStyleWithoutTheConfigurationIsLeftAlone', () => {
        const plain = mapboxMap();
        const throwing = mapboxMap();
        throwing.configError = new Error('no import');

        new Basemap3dObjects(plain).update(true);
        new Basemap3dObjects(throwing).update(true);

        expect(plain.callsOf('setConfigProperty')).toEqual([]);
        expect(throwing.callsOf('setConfigProperty')).toEqual([]);
    });
});

describe('map lifecycle', () => {
    it('happyPath_mapOptionsPinTheRules', () => {
        const container = {} as HTMLElement;

        expect(
            mapboxOptions(container, {
                ...OPTIONS,
                config: { lightPreset: 'dusk' },
                maxBounds: [
                    [25.9, 44.3],
                    [26.2, 44.5],
                ],
            }),
        ).toEqual({
            container,
            style: OPTIONS.style,
            accessToken: 'pk.test',
            center: [26.08, 44.42],
            zoom: 14,
            bearing: 10,
            minZoom: 10,
            maxZoom: 20,
            language: 'ro',
            locale: {
                'Map.Title': 'Hartă',
                'AttributionControl.ToggleAttribution': 'Arată sau ascunde sursele hărții',
                'LogoControl.Title': 'Pagina Mapbox',
            },
            attributionControl: true,
            performanceMetricsCollection: false,
            maxBounds: [
                [25.9, 44.3],
                [26.2, 44.5],
            ],
            config: { basemap: { lightPreset: 'dusk' } },
        });
        expect(mapboxOptions(container, OPTIONS)).not.toHaveProperty('config');
    });

    it('happyPath_errorsAreClassifiedAndTokensStripped', () => {
        expect(
            classifyError(
                {
                    error: new Error('Unauthorized https://api.mapbox.com/v4/x.json?access_token=pk.abc'),
                    sourceId: 'hcm-source-kh4',
                    tile: {},
                },
                true,
            ),
        ).toEqual({
            kind: 'tile',
            layerId: 'kh4',
            message: 'Unauthorized https://api.mapbox.com/v4/x.json',
        });
        expect(classifyError({ error: 'gone', sourceId: 'hcm-source-kh4' }, true)).toEqual({
            kind: 'source',
            layerId: 'kh4',
            message: 'gone',
        });
        expect(classifyError({ error: new Error('style 404') }, false)).toEqual({ kind: 'style', message: 'style 404' });
        expect(classifyError({ error: 42 }, true)).toEqual({ kind: 'unknown', message: 'unknown' });
    });

    it('happyPath_loadResolvesAndRemovesItsErrorListener', async () => {
        const map = mapboxMap();
        const loading = whenLoaded(map, () => undefined);

        map.fire('error', { error: new Error('tile'), tile: {}, sourceId: 'hcm-source-x' });
        map.fire('load');

        await expect(loading).resolves.toBeUndefined();
        expect(map.listenerCount('error')).toBe(0);
    });

    it('badPath_aStyleErrorBeforeLoadRejectsAndAbortRejectsToo', async () => {
        const failing = mapboxMap();
        const aborted = mapboxMap();
        let abort: ((error: Error) => void) | undefined;

        const fails = whenLoaded(failing, () => undefined);
        failing.fire('error', { error: new Error('404 style') });
        const stops = whenLoaded(aborted, (reject) => {
            abort = reject;
        });
        abort?.(new Error('unknown'));

        await expect(fails).rejects.toThrow('style');
        await expect(stops).rejects.toThrow('unknown');
        expect(failing.listenerCount('load')).toBe(0);
    });
});

describe('browser adapter env', () => {
    function scope(
        withObserver: boolean,
        webgl: boolean | 'throws',
    ): BrowserScope & { frames: (() => void)[]; cancelled: number[]; observed: unknown[]; disconnected: number } {
        const frames: (() => void)[] = [];
        const cancelled: number[] = [];
        const observed: unknown[] = [];
        const state = { disconnected: 0 };
        const canvas = {
            getContext: () => {
                if (webgl === 'throws') {
                    throw new Error('blocked');
                }
                return webgl ? {} : null;
            },
        };
        class Observer {
            readonly #callback: () => void;
            constructor(callback: () => void) {
                this.#callback = callback;
            }
            observe(element: unknown): void {
                observed.push(element);
                this.#callback();
            }
            disconnect(): void {
                state.disconnected += 1;
            }
        }
        const base = {
            document: { createElement: () => canvas, fonts: { load: () => Promise.resolve([]) } },
            Path2D: Object,
            requestAnimationFrame: (callback: () => void) => frames.push(callback),
            cancelAnimationFrame: (handle: number) => {
                cancelled.push(handle);
            },
            frames,
            cancelled,
            observed,
            get disconnected() {
                return state.disconnected;
            },
        };
        return (withObserver ? Object.assign(base, { ResizeObserver: Observer }) : base) as unknown as ReturnType<typeof scope>;
    }

    it('happyPath_framesObserverAndWebGlProbeComeFromTheWindow', async () => {
        const window = scope(true, true);
        const env = browserAdapterEnv(window);
        let resized = 0;

        const handle = env.frames.request(() => undefined);
        env.frames.cancel(handle);
        const stop = env.observeResize({} as HTMLElement, () => {
            resized += 1;
        });
        stop();

        expect(handle).toBe(1);
        expect(window.cancelled).toEqual([1]);
        expect(resized).toBe(1);
        expect(window.disconnected).toBe(1);
        expect(env.probeWebGL()).toBe(true);
        expect(await env.icons.loadFont('x')).toBe(false);
        await settle();
    });

    it('badPath_withoutResizeObserverOrWebGlTheEnvDegrades', () => {
        const none = browserAdapterEnv(scope(false, false));
        const blocked = browserAdapterEnv(scope(false, 'throws'));

        const stop = none.observeResize({} as HTMLElement, () => undefined);
        stop();

        expect(none.probeWebGL()).toBe(false);
        expect(blocked.probeWebGL()).toBe(false);
    });
});
