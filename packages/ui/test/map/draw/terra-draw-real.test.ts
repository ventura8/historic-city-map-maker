/**
 * The real Terra Draw 1.38.0 and its Mapbox GL adapter 1.5.0 (`loadTerraDraw`) through `MapDrawPort`, on a structural
 * Mapbox map in Chromium (DECISIONS-for-review.md §34g, docs/research/M2c-interfaces.md §4.7): the map is the test kit's
 * `FakeMapboxMap` with a real canvas in the page, a fixed linear projection and the handlers Terra Draw switches, so real
 * pointer events drag a whole shape, a vertex and a midpoint as an admin does, and a drag past the limits snaps back.
 * No Mapbox code and no network: Mapbox GL stays external, and Terra Draw only draws through the map's sources.
 */
import type { BBox } from '@hcm/shared';
import { FakeMapboxMap } from '@hcm/test-support/fake-map';
import { afterEach, describe, expect, it } from 'vitest';

import type { DrawChange, DrawnFeature, DrawRefusal, MapDrawPort } from '../../../src/map/draw/draw-port.js';
import { createTerraDrawPort, loadTerraDraw } from '../../../src/map/draw/terra-draw-adapter.js';
import type { MapboxGl, MapboxMapOptions } from '../../../src/map/mapbox-types.js';
import { createMapboxPort } from '../../../src/map/mapbox-adapter.js';
import { fakeAdapterEnv, settle } from '../support.js';

type Position = [number, number];

/** CSS px per degree, and the top-left corner of the map: 26.02 E is x 80, 44.48 N is y 80. */
const SCALE = 4000;
const WEST = 26.0;
const NORTH = 44.5;

const LIMITS: BBox = [
    [26.0, 44.4],
    [26.1, 44.5],
];

const RING: Position[] = [
    [26.02, 44.42],
    [26.08, 44.42],
    [26.08, 44.48],
    [26.02, 44.48],
    [26.02, 44.42],
];

const PLACE: DrawnFeature = { id: 'piata', geometry: { type: 'Polygon', coordinates: [RING] } };

function toggle(): { isEnabled(): boolean; enable(): void; disable(): void } {
    let enabled = true;
    return {
        isEnabled: () => enabled,
        enable: () => {
            enabled = true;
        },
        disable: () => {
            enabled = false;
        },
    };
}

const hosts: HTMLElement[] = [];

/** `FakeMapboxMap` with what Terra Draw's Mapbox adapter reaches: a real canvas and container, a projection, handlers. */
class PointerMap extends FakeMapboxMap {
    readonly container = document.createElement('div');
    readonly element = document.createElement('canvas');
    readonly dragPan = toggle();
    readonly dragRotate = toggle();
    readonly doubleClickZoom = toggle();

    constructor(options: MapboxMapOptions) {
        super(options);
        this.container.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
        this.element.style.cssText = 'display:block;width:800px;height:600px';
        this.container.append(this.element);
        document.body.append(this.container);
        hosts.push(this.container);
    }

    override getCanvas(): HTMLElement {
        return this.element;
    }

    getContainer(): HTMLElement {
        return this.container;
    }

    override project({ lng, lat }: { lng: number; lat: number }): { x: number; y: number } {
        return { x: (lng - WEST) * SCALE, y: (NORTH - lat) * SCALE };
    }

    override unproject({ x, y }: { x: number; y: number }): { lng: number; lat: number } {
        return { lng: WEST + x / SCALE, lat: NORTH - y / SCALE };
    }

    override moveLayer(): this {
        return this;
    }
}

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.remove();
    }
});

interface Drawing {
    readonly port: MapDrawPort;
    readonly map: PointerMap;
    readonly changes: DrawChange[];
    readonly refusals: DrawRefusal[];
}

async function drawing(): Promise<Drawing> {
    const created: PointerMap[] = [];
    const gl: MapboxGl = {
        Map: class extends PointerMap {
            constructor(options: MapboxMapOptions) {
                super(options);
                created.push(this);
            }
        },
    };
    const mapPort = createMapboxPort(gl, fakeAdapterEnv());
    const mounting = mapPort.mount(document.createElement('div'), {
        ...{ style: 'mapbox://styles/mapbox/standard', accessToken: 'pk.test', minZoom: 10, maxZoom: 20 },
        ...{ view: { center: [26.05, 44.45], zoom: 14, bearing: 0 }, locale: 'ro', reducedMotion: false },
    });
    const [map] = created;
    if (map === undefined) {
        throw new Error('no map');
    }
    map.fire('load');
    await mounting;
    const port = createTerraDrawPort(await loadTerraDraw());
    const changes: DrawChange[] = [];
    const refusals: DrawRefusal[] = [];
    port.on('change', (change) => changes.push(change));
    port.on('refused', (refusal) => refusals.push(refusal));
    port.attach(mapPort, { limits: LIMITS, color: '#8b5e3c', maxVertices: 500, maxRings: 20 });
    return { port, map, changes, refusals };
}

function pointer(map: PointerMap, type: string, [x, y]: Position): void {
    map.element.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 1, isPrimary: true, bubbles: true }),
    );
}

/** A press at `from`, twelve moves to `to` and a release, as a mouse drags. */
async function drag(map: PointerMap, from: Position, to: Position): Promise<void> {
    pointer(map, 'pointerdown', from);
    for (let step = 1; step <= 12; step += 1) {
        pointer(map, 'pointermove', [from[0] + ((to[0] - from[0]) * step) / 12, from[1] + ((to[1] - from[1]) * step) / 12]);
    }
    pointer(map, 'pointerup', to);
    await settle();
}

function ring(port: MapDrawPort): readonly Position[] {
    const geometry = port.snapshot()[0]?.geometry;
    return geometry?.type === 'Polygon' ? (geometry.coordinates[0] ?? []) : [];
}

describe('Terra Draw for real: dragging in select', () => {
    it('happyPath_aVertexIsDraggedAndSettlesAsTheDraft', async () => {
        const { port, map, changes } = await drawing();
        port.load([PLACE]);
        port.setMode('select', 'piata');

        await drag(map, [320, 80], [360, 40]);

        expect(changes.at(-1)?.final).toBe(true);
        expect(ring(port)[2]).toEqual([26.09, 44.49]);
        expect(ring(port)).toHaveLength(5);
        // Terra Draw shows it through the map's own sources, never through Mapbox code of its own.
        expect(map.getSource('td-polygon')).toBeDefined();
    });

    it('happyPath_aMidpointIsDraggedAndInsertsAVertex', async () => {
        const { port, map } = await drawing();
        port.load([PLACE]);
        port.setMode('select', 'piata');

        await drag(map, [200, 320], [200, 360]);

        expect(ring(port)).toHaveLength(6);
        expect(ring(port)).toContainEqual([26.05, 44.41]);
    });

    it('happyPath_theWholeShapeIsDragged', async () => {
        const { port, map } = await drawing();
        port.load([PLACE]);
        port.setMode('select', 'piata');

        await drag(map, [200, 200], [240, 200]);

        // Terra Draw follows every move but each fifth (its drag throttle), so the shape lands within a step of the release.
        const moved = ring(port).map(([lng, lat], index): Position => [lng - (RING[index]?.[0] ?? 0), lat - (RING[index]?.[1] ?? 0)]);
        expect(moved.every(([east, north]) => east > 0.008 && east <= 0.01 && Math.abs(north) < 1e-9)).toBe(true);
    });

    it('badPath_aVertexDraggedPastTheLimitsStaysInsideAndIsSaid', async () => {
        const { port, map, refusals } = await drawing();
        port.load([PLACE]);
        port.setMode('select', 'piata');

        await drag(map, [320, 80], [460, 80]);

        expect(refusals.map((refusal) => refusal.kind)).toContain('outside');
        expect(ring(port).every(([lng]) => lng <= 26.1)).toBe(true);
    });

    it('happyPath_aPinIsDraggedAndAClickElsewhereMovesIt', async () => {
        const { port, map } = await drawing();
        port.load([{ id: 'photo-location', geometry: { type: 'Point', coordinates: [26.05, 44.45] } }]);
        port.setMode('select', 'photo-location');

        await drag(map, [200, 200], [240, 240]);
        expect(port.snapshot()[0]?.geometry).toEqual({ type: 'Point', coordinates: [26.06, 44.44] });

        map.fire('click', { point: { x: 80, y: 80 }, lngLat: { lng: 26.02, lat: 44.48 } });
        expect(port.snapshot()[0]?.geometry).toEqual({ type: 'Point', coordinates: [26.02, 44.48] });
    });

    it('happyPath_anAreaDrawnByClicksIsShownAndThenDragged', async () => {
        const { port, map, changes } = await drawing();
        port.setMode('draw-polygon', 'nou');
        for (const [lng, lat] of RING.slice(0, 4)) {
            map.fire('click', { point: { x: 0, y: 0 }, lngLat: { lng, lat } });
        }
        port.setMode('select', 'nou');

        await drag(map, [200, 200], [200, 240]);

        expect(changes.filter((change) => change.final)).toHaveLength(3);
        const [lng = 0, lat = 0] = ring(port)[0] ?? [];
        expect(lng).toBeCloseTo(26.02, 7);
        expect(lat).toBeGreaterThan(44.41);
        expect(lat).toBeLessThan(44.4125);
    });
});
