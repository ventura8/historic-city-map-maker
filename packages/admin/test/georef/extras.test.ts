// The georeferencer's lazy chunk (DECISIONS-for-review.md §110): the map a lattice or terrain publishes and Snap my points come from
// `georef-extras.ts`, fetched on their first need; a failed fetch says so in plain words and leaves the page working.
import { fitTransform, type Gcp, type Georef } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { loadGeorefExtras, publishedOf, snapOf, type ExtrasLoader } from '../../src/georef/extras.js';
import { ownFitOf, type OwnFit } from '../../src/georef/fit-view.js';
import { publishedMap } from '../../src/georef/georef-extras.js';
import { answer, callsOf, CITY, imageryWorld } from '../imagery/world.js';

const OFFLINE: ExtrasLoader = () => Promise.reject(new TypeError('Failed to fetch dynamically imported module'));

const pair = (id: string, x: number, y: number): Gcp => ({
    ...{ id, pixel: { x, y }, geo: { lat: 44.4 + y / 1e4, lng: 26.1 + x / 1e4 } },
    ...{ enabled: true, origin: 'manual' as const },
});
const GRID: Gcp[] = [pair('g1', 0, 0), pair('g2', 100, 0), pair('g3', 0, 100), pair('g4', 100, 100)];
const NEW_POINT = pair('g5', 50, 50);
const STORED: Georef = { method: 'auto', transform: 'affine', gcps: GRID, fitRmseM: 1 };
/** A camera's lattice: 4 x 4 nodes (a thin-plate spline needs ten). */
const NODES: Gcp[] = Array.from({ length: 16 }, (_node, index) => pair(`n${String(index)}`, (index % 4) * 40, Math.floor(index / 4) * 40));
const LATTICE: NonNullable<Georef['lattice']> = { model: 'panoramic', nodes: NODES.map(({ pixel, geo }) => ({ pixel, geo })) };

function ownWithLattice(): OwnFit {
    const own = ownFitOf({ ...STORED, lattice: LATTICE });
    if (own === null) {
        throw new Error('a lattice is an own map');
    }
    return own;
}

/** The chunk, counting its fetches. */
function counted(): { readonly load: ExtrasLoader; readonly fetched: { count: number } } {
    const fetched = { count: 0 };
    const load: ExtrasLoader = async () => {
        fetched.count += 1;
        return loadGeorefExtras();
    };
    return { load, fetched };
}

describe('the georeferencer fetches its lazy chunk on first need', () => {
    it('happyPath_aLatticeIsMappedThroughTheChunkAndAVersionWithoutOneFetchesNothing', async () => {
        const world = imageryWorld();
        const { load, fetched } = counted();
        const plain = ownFitOf(STORED);

        const shown = await publishedOf(world.services, load, ownWithLattice());

        const tps = fitTransform('tps', NODES);
        expect([shown?.transform?.kind, shown?.published]).toEqual(['tps', null]);
        expect(shown?.transform?.toGeo({ x: 50, y: 50 })).toEqual(tps.ok ? tps.transform.toGeo({ x: 50, y: 50 }) : null);
        await expect(publishedOf(world.services, load, plain)).resolves.toBe(plain);
        await expect(publishedOf(world.services, load, null)).resolves.toBeNull();
        expect([fetched.count, world.notices]).toEqual([1, []]);
    });

    it('happyPath_snapSendsTheNewPointsThroughTheChunk @S-A89-HAPPY-POINTS', async () => {
        const world = imageryWorld();
        answer(world.callables, 'imagery.recalibrate', () => ({ jobId: 'job-new', versionId: 'job-new' }));

        const outcome = await snapOf(world.services, loadGeorefExtras, {
            version: { id: 'job-1' },
            pairs: [...GRID, NEW_POINT],
            base: GRID,
        });

        expect(outcome).toEqual({ saved: 'job-new', refusal: null });
        expect(callsOf(world.callables, 'imagery.recalibrate')).toEqual([
            { cityId: CITY, versionId: 'job-1', route: 'points', points: [{ pixel: NEW_POINT.pixel, geo: NEW_POINT.geo }] },
        ]);
    });

    it('badPath_aFailedFetchSaysSoAndKeepsTheVersionsFigures @S-A16-BAD-TERRAIN-CHUNK', async () => {
        const world = imageryWorld();
        const own = ownWithLattice();

        await expect(publishedOf(world.services, OFFLINE, own)).resolves.toBe(own);
        expect(own.transform).toBeNull();
        expect(world.notices).toEqual([{ key: 'adminContent.georef.mapUnavailable' }]);
    });

    it('badPath_aFailedFetchOnSnapSendsNothingAndSaysWhy @S-A89-BAD-SNAP-CHUNK', async () => {
        const world = imageryWorld();

        const outcome = await snapOf(world.services, OFFLINE, { version: { id: 'job-1' }, pairs: [...GRID, NEW_POINT], base: GRID });

        expect(outcome).toEqual({ saved: null, refusal: { key: 'adminContent.georef.snapUnavailable' } });
        expect(callsOf(world.callables, 'imagery.recalibrate')).toEqual([]);
        expect(world.notices).toEqual([]);
    });

    it('badPath_aLatticeThatSpansNothingIsNoMapAndAnOwnFitWithoutOneIsUnchanged', () => {
        const flat = { model: 'panoramic' as const, nodes: NODES.map(({ geo }) => ({ pixel: { x: 5, y: 5 }, geo })) };
        const plain = ownFitOf(STORED);

        expect(publishedMap({ ...ownWithLattice(), published: { lattice: flat } }).transform).toBeNull();
        expect(plain === null ? null : publishedMap(plain)).toBe(plain);
    });
});
