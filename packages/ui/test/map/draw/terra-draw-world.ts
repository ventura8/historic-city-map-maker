/** What the Terra Draw adapter's unit tests share: a mounted fake Mapbox map, the fake constructors and what the port said. */
import { MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS, type BBox } from '@hcm/shared';
import { FakeMapboxGl, type FakeMapboxMap } from '@hcm/test-support/fake-map';

import type { DrawChange, DrawnFeature, DrawOptions, DrawRefusal, MapDrawPort } from '../../../src/map/draw/draw-port.js';
import { createTerraDrawPort } from '../../../src/map/draw/terra-draw-adapter.js';
import type { MapOptions, MapPort } from '../../../src/map/map-port.js';
import { createMapboxPort } from '../../../src/map/mapbox-adapter.js';
import { fakeAdapterEnv, settle } from '../support.js';
import { fakeTerraDrawModules, type FakeTerraDraw, type FakeTerraDrawModules } from './fake-terra-draw.js';

/** A mutable `[lng, lat]`, the type of the manifest geometry's positions. */
export type Position = [number, number];

export const CITY: BBox = [
    [25.9, 44.3],
    [26.3, 44.55],
];

export const OPTIONS: DrawOptions = { limits: CITY, color: '#8b5e3c', maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS };

const MAP_OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard',
    accessToken: 'pk.test',
    view: { center: [26.1, 44.43], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'ro',
    reducedMotion: false,
};

export const SQUARE: Position[] = [
    [26.0, 44.4],
    [26.1, 44.4],
    [26.1, 44.5],
    [26.0, 44.5],
    [26.0, 44.4],
];

export const PLACE: DrawnFeature = { id: 'casa-capsa', geometry: { type: 'Polygon', coordinates: [SQUARE] } };

export const PIN: DrawnFeature = { id: 'photo-location', geometry: { type: 'Point', coordinates: [26.1, 44.43] } };

export interface World {
    readonly port: MapDrawPort;
    readonly modules: FakeTerraDrawModules;
    readonly td: FakeTerraDraw;
    readonly map: MapPort;
    readonly mapbox: FakeMapboxMap;
    readonly changes: DrawChange[];
    readonly selections: (string | null)[];
    readonly refusals: DrawRefusal[];
    /** A click on the map at `[lng, lat]` (one that misses every clickable layer). */
    readonly click: (position: Position) => void;
}

export async function mountedMap(): Promise<{ readonly map: MapPort; readonly mapbox: FakeMapboxMap }> {
    const gl = new FakeMapboxGl();
    const map = createMapboxPort(gl, fakeAdapterEnv());
    const mounting = map.mount({} as HTMLElement, MAP_OPTIONS);
    gl.map.fire('load');
    await mounting;
    await settle();
    return { map, mapbox: gl.map };
}

export async function attached(options: DrawOptions = OPTIONS): Promise<World> {
    const { map, mapbox } = await mountedMap();
    const modules = fakeTerraDrawModules();
    const port = createTerraDrawPort(modules);
    const changes: DrawChange[] = [];
    const selections: (string | null)[] = [];
    const refusals: DrawRefusal[] = [];
    port.on('change', (change) => changes.push(change));
    port.on('select', (id) => selections.push(id));
    port.on('refused', (refusal) => refusals.push(refusal));
    port.attach(map, options);
    const td = modules.instances.at(-1);
    if (td === undefined) {
        throw new Error('no Terra Draw');
    }
    const click = ([lng, lat]: Position): void => {
        mapbox.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng, lat } });
    };
    return { port, modules, td, map, mapbox, changes, selections, refusals, click };
}

export function polygon(ring: Position[]): { readonly type: string; readonly coordinates: unknown } {
    return { type: 'Polygon', coordinates: [ring] };
}

/** An area whose edges cross: two uneven lobes. */
export const CROSSED: Position[] = [
    [26.0, 44.4],
    [26.1, 44.5],
    [26.1, 44.4],
    [26.0, 44.45],
    [26.0, 44.4],
];
