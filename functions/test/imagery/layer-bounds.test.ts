/**
 * A layer's bounds where its image holds data (`functions/src/imagery/layer-bounds.ts`; live 2026-11-22: joins published the city's
 * window as their bounds, so the year view flew to the whole city).
 */
import { describe, expect, it } from 'vitest';

import { correctLayerBounds, dataBoundsOf } from '../../src/imagery/layer-bounds.js';
import { BOUNDS, goldenOutput, readLayer, readyWorld, renderedVersion, seedLayer, seedVersion } from './world.js';

const OUTLINE = [
    { lat: 44.4, lng: 26.0 },
    { lat: 44.5, lng: 26.0 },
    { lat: 44.5, lng: 26.1 },
];

function cityWide() {
    return { ...goldenOutput(), bounds: BOUNDS, outline: OUTLINE };
}

describe('layer bounds', () => {
    it('happyPath_aLayerOverTheCitysWindowGetsItsDataBounds @S-A65-HAPPY-DATA-BOUNDS', async () => {
        const world = await readyWorld();
        await seedVersion(world, 'jn-1', renderedVersion({ layerId: 'joined', output: cityWide() }));
        await seedLayer(world, 'joined', { currentVersion: 'jn-1', bounds: BOUNDS });

        await correctLayerBounds(world.deps, 'bucharest');

        expect((await readLayer(world, 'joined'))?.bounds).toEqual({ west: 26.0, south: 44.4, east: 26.1, north: 44.5 });
    });

    it('badPath_aLayerOfItsOwnBoundsOrWithoutAnOutlineIsLeftAlone @S-A65-BAD-DATA-BOUNDS', async () => {
        const world = await readyWorld();
        const own = { west: 26.0, south: 44.4, east: 26.1, north: 44.5 };
        await seedLayer(world, 'own', { currentVersion: 'v-own', bounds: own });
        await seedVersion(
            world,
            'v-bare',
            renderedVersion({ layerId: 'bare', output: { ...goldenOutput(), bounds: BOUNDS, outline: undefined } }),
        );
        await seedLayer(world, 'bare', { currentVersion: 'v-bare', bounds: BOUNDS });
        await seedLayer(world, 'none', { currentVersion: undefined, bounds: BOUNDS });

        await correctLayerBounds(world.deps, 'bucharest');
        await correctLayerBounds(world.deps, 'nowhere');

        expect((await readLayer(world, 'own'))?.bounds).toEqual(own);
        expect((await readLayer(world, 'bare'))?.bounds).toEqual(BOUNDS);
        expect((await readLayer(world, 'none'))?.bounds).toEqual(BOUNDS);
    });

    it('happyPath_aLayerBoundedByItsOutlinesBoxGetsItsRastersExtent @S-A65-HAPPY-RASTER-BOUNDS', async () => {
        const world = await readyWorld();
        const raster = { west: 25.95, south: 44.35, east: 26.2, north: 44.5842 };
        await seedVersion(world, 'v-1965', renderedVersion({ layerId: 'plan-1965', output: { ...goldenOutput(), bounds: raster, outline: OUTLINE } }));
        await seedLayer(world, 'plan-1965', { currentVersion: 'v-1965', bounds: { west: 26.0, south: 44.4, east: 26.1, north: 44.5 } });

        await correctLayerBounds(world.deps, 'bucharest');

        expect((await readLayer(world, 'plan-1965'))?.bounds).toEqual(raster);
        expect(dataBoundsOf({ ...goldenOutput(), bounds: raster, outline: OUTLINE })).toEqual(raster);
    });

    it('badPath_aLayerOfOtherBoundsOrAMissingVersionIsLeftAlone @S-A65-BAD-RASTER-BOUNDS', async () => {
        const world = await readyWorld();
        const raster = { west: 25.95, south: 44.35, east: 26.2, north: 44.5842 };
        const chosen = { west: 26.01, south: 44.41, east: 26.09, north: 44.49 };
        await seedVersion(world, 'v-own', renderedVersion({ layerId: 'chosen', output: { ...goldenOutput(), bounds: raster, outline: OUTLINE } }));
        await seedLayer(world, 'chosen', { currentVersion: 'v-own', bounds: chosen });
        await seedLayer(world, 'lost', { currentVersion: 'v-gone', bounds: chosen });

        await correctLayerBounds(world.deps, 'bucharest');

        expect((await readLayer(world, 'chosen'))?.bounds).toEqual(chosen);
        expect((await readLayer(world, 'lost'))?.bounds).toEqual(chosen);
    });

    it('badPath_anOutlineOutsideTheOutputKeepsTheOutputBounds', () => {
        const far = [
            { lat: 10, lng: 10 },
            { lat: 11, lng: 10 },
            { lat: 11, lng: 11 },
        ];
        expect(dataBoundsOf({ ...goldenOutput(), bounds: BOUNDS, outline: far }, BOUNDS)).toEqual(BOUNDS);
    });
});
