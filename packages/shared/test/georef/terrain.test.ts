/**
 * The map of a frame over terrain (`terrainTransform`) against GDAL's (`pipeline/tests/contracts/terrain-map.json`: a frame seen off
 * nadir over a 90 m hill, each probe a place and the scan pixel GDAL's RPC transformer gives it over the record's heights, as the
 * warp's `RPC_DEM`): the georeferencer previews the layer's map, not a lattice of it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { fitTransform, type FittedTransform } from '../../src/georef/fit.js';
import { type GeoPoint, type PlanePoint } from '../../src/georef/mercator.js';
import { terrainTransform } from '../../src/georef/terrain.js';
import { georefSchema, type Georef } from '../../src/schemas/georef.js';

const CONTRACT = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts/terrain-map.json');
/** Scan pixels are 25 ground metres: a hundredth of one is 25 cm. */
const PIXEL_M = 25;

interface Probe {
    readonly geo: GeoPoint;
    readonly pixel: PlanePoint;
}

interface Contract {
    readonly terrain: NonNullable<Georef['terrain']>;
    readonly probes: readonly Probe[];
}

const contract = JSON.parse(readFileSync(CONTRACT, 'utf8')) as Contract;

/** A thin-plate spline through the probes: a start within metres of the map, as a lattice is. */
function start(): FittedTransform {
    const gcps = contract.probes.map((probe, index) => ({ id: `p${String(index)}`, ...probe, enabled: true, origin: 'auto' as const }));
    const fitted = fitTransform('tps', gcps);
    if (!fitted.ok) {
        throw new Error(fitted.reason);
    }
    return fitted.transform;
}

function gap(a: PlanePoint, b: PlanePoint): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('the map of a frame over terrain', () => {
    it('happyPath_eachPlaceGoesToThePixelGdalReadsForTheWarp', () => {
        const map = terrainTransform(contract.terrain, start());

        const worst = Math.max(...contract.probes.map((probe) => gap(map.toPixel(probe.geo), probe.pixel)));

        expect(worst * PIXEL_M).toBeLessThan(0.01);
    });

    it('happyPath_aPixelGoesBackThroughItsLatticeTheSameMapOnItsNodes', () => {
        const lattice = start();
        const map = terrainTransform(contract.terrain, lattice);
        const pixels = contract.probes.map((probe) => probe.pixel);

        // Only the preview's frame reads a pixel's place, and the lattice samples this very map.
        expect(pixels.map((pixel) => map.toGeo(pixel))).toEqual(pixels.map((pixel) => lattice.toGeo(pixel)));
        expect(map.kind).toBe('tps');
    });

    it('badPath_theHeightsAreTheMap', () => {
        const level = {
            ...contract.terrain,
            heights: { ...contract.terrain.heights, valuesDm: 'A'.repeat(contract.terrain.heights.valuesDm.length) },
        };
        const map = terrainTransform(level, start());

        const moved = contract.probes.map((probe) => gap(map.toPixel(probe.geo), probe.pixel));

        // Read at the frame's lowest height instead of the hill's, its slopes land metres away: the heights are the map.
        expect(Math.max(...moved) * PIXEL_M).toBeGreaterThan(10);
    });

    it('badPath_aRecordShortOfItsCellsOrLongInTermsReadsWhatIsThereAndNoMore', () => {
        const { terrain } = contract;
        const probe = contract.probes[24] ?? contract.probes[0];
        const map = (record: typeof terrain) => (probe === undefined ? null : terrainTransform(record, start()).toPixel(probe.geo));
        // Two cells' values for four (the schema refuses such a record; the map reads the missing ones as the base and stays a number).
        const short = { ...terrain, heights: { ...terrain.heights, columns: 2, rows: 2, valuesDm: 'AAAAAA==' } };
        const longer = { ...terrain, rpc: { ...terrain.rpc, sampNum: [...terrain.rpc.sampNum, 1e9] } };

        expect([map(short)?.x, map(short)?.y].every(Number.isFinite)).toBe(true);
        expect(map(longer)).toEqual(map(terrain));
    });

    it('badPath_heightsWhoseValuesDoNotFillTheirCellsAreRefused', () => {
        const short = { ...contract.terrain, heights: { ...contract.terrain.heights, valuesDm: 'AAAA' } };
        const terrainOnly = (terrain: unknown) => georefSchema.shape.terrain.safeParse(terrain).success;

        expect(terrainOnly(contract.terrain)).toBe(true);
        expect(terrainOnly(short)).toBe(false);
        expect(terrainOnly({ ...contract.terrain, heights: { ...contract.terrain.heights, columns: 1 } })).toBe(false);
    });
});
