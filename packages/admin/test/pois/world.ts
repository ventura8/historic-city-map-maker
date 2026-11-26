// The places area's test world: the editors' `contentWorld` plus the admin map's factory over `FakeMap` (with the real
// live preview) and `FakeMapDraw`, and the city, categories and places built with the shared schemas' shapes.
import { FIRESTORE_PATHS, geometryToDoc, type Geometry } from '@hcm/shared';
import { FakeMap } from '@hcm/test-support/fake-map';
import { FakeMapDraw } from '@hcm/test-support/fake-map-draw';

import type { AdminMapFactory, AdminMapHandle, AdminMapOptions, AdminMapResult } from '../../src/map/factory.js';
import { createMapPreview } from '../../src/map/preview.js';
import type { PoisServices } from '../../src/pois/state.js';
import { fakeFrames } from '../map/support.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';

export { CITY };

export const CONTAINER = {} as HTMLElement;

export const BOUNDS = { west: 26, south: 44.3, east: 26.3, north: 44.55 } as const;

/** A square inside the city. */
export const SQUARE: [number, number][] = [
    [26.1, 44.43],
    [26.11, 44.43],
    [26.11, 44.44],
    [26.1, 44.44],
    [26.1, 44.43],
];

export const POINT: Geometry = { type: 'Point', coordinates: [26.1, 44.43] };
export const AREA: Geometry = { type: 'Polygon', coordinates: [SQUARE] };

/** The map factory's fake: each map is a `FakeMap` with the real preview and `FakeMapDraw` tools. */
export class FakeMaps implements AdminMapFactory {
    readonly created: { readonly container: HTMLElement; readonly options: AdminMapOptions }[] = [];
    readonly maps: FakeMap[] = [];
    readonly draws: FakeMapDraw[] = [];
    readonly frames = fakeFrames();
    /** What the next `create` answers instead of a map. */
    refuse: Exclude<AdminMapResult, { readonly ok: true }>['reason'] | null = null;
    /** Holds `create` until `release` (a page that leaves while its map loads). */
    #held: (() => void) | null = null;
    hold = false;
    /** Holds the drawing tools of the next map until `releaseDraw`. */
    holdDraw = false;
    #drawHeld: (() => void) | null = null;
    destroyed = 0;

    async create(container: HTMLElement, options: AdminMapOptions): Promise<AdminMapResult> {
        this.created.push({ container, options });
        if (this.hold) {
            await new Promise<void>((resolve) => {
                this.#held = resolve;
            });
        }
        if (this.refuse !== null) {
            return { ok: false, reason: this.refuse };
        }
        return { ok: true, map: this.#handle() };
    }

    release(): void {
        this.#held?.();
        this.#held = null;
    }

    releaseDraw(): void {
        this.#drawHeld?.();
        this.#drawHeld = null;
    }

    #tools(draw: FakeMapDraw): Promise<FakeMapDraw> {
        if (!this.holdDraw) {
            return Promise.resolve(draw);
        }
        return new Promise((resolve) => {
            this.#drawHeld = () => {
                resolve(draw);
            };
        });
    }

    #handle(): AdminMapHandle {
        const port = new FakeMap();
        const draw = new FakeMapDraw();
        this.maps.push(port);
        this.draws.push(draw);
        return {
            port,
            preview: createMapPreview(port, this.frames),
            draw: () => this.#tools(draw),
            destroy: () => {
                this.destroyed += 1;
                port.destroy();
            },
        };
    }

    get map(): FakeMap {
        const map = this.maps.at(-1);
        if (map === undefined) {
            throw new Error('no map');
        }
        return map;
    }

    get draw(): FakeMapDraw {
        const draw = this.draws.at(-1);
        if (draw === undefined) {
            throw new Error('no drawing tools');
        }
        return draw;
    }
}

export interface PoisWorld extends Omit<ContentWorld, 'services'> {
    readonly services: PoisServices;
    readonly maps: FakeMaps;
}

export function poisWorld(overrides: Partial<PoisServices> = {}): PoisWorld {
    const maps = new FakeMaps();
    const world = contentWorld();
    return { ...world, services: { ...world.services, maps, ...overrides }, maps };
}

function seedCity(world: Pick<ContentWorld, 'store'>): void {
    world.store.put(FIRESTORE_PATHS.city(CITY), {
        name: { ro: 'București' },
        bounds: BOUNDS,
        center: { lat: 44.43, lng: 26.1 },
        zoom: 14,
        published: true,
        ...world.store.stamp(),
    });
}

export function seedCategory(world: Pick<ContentWorld, 'store'>, id: string, order: number, color = '#8b5e3c', icon = 'church'): void {
    world.store.put(FIRESTORE_PATHS.poiCategory(CITY, id), {
        label: { ro: `Categoria ${id}`, en: `Category ${id}` },
        icon,
        color,
        defaultOpacity: 0.9,
        order,
        ...world.store.stamp(),
    });
}

export function placeDoc(world: Pick<ContentWorld, 'store'>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        category: 'biserici',
        geometry: geometryToDoc(POINT),
        title: { ro: 'Stavropoleos', en: 'Stavropoleos Church' },
        yearStart: 1890,
        links: [],
        photoIds: [],
        published: true,
        ...world.store.stamp(),
        ...extra,
    };
}

export function seedPlace(world: Pick<ContentWorld, 'store'>, id: string, extra: Record<string, unknown> = {}): void {
    world.store.put(FIRESTORE_PATHS.poi(CITY, id), placeDoc(world, extra));
    world.store.now += 1000;
}

/** A city with two categories and two places. */
export function seededWorld(overrides: Partial<PoisServices> = {}): PoisWorld {
    const world = poisWorld(overrides);
    seedCity(world);
    seedCategory(world, 'biserici', 1);
    seedCategory(world, 'parcuri', 2, '#1f6f43', 'park');
    seedPlace(world, 'stavropoleos');
    seedPlace(world, 'cismigiu', { category: 'parcuri', geometry: geometryToDoc(AREA), title: { ro: 'Cișmigiu' }, published: false });
    return world;
}

/** Resolves once every queued promise callback has run. */
export async function settle(rounds = 20): Promise<void> {
    for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
    }
}
