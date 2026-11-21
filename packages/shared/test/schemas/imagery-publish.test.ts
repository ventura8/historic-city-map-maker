import { describe, expect, it } from 'vitest';

import {
    availableComputeUnits,
    estimateComputeUnits,
    fnv1a32,
    guardVerdict,
    MAX_TILESETS,
    nextMonthStart,
    precisionOf,
    rasterRecipe,
    tilesetIdFor,
    tilesetName,
    usageMonth,
} from '../../src/schemas/imagery-publish.js';

describe('the compute-unit estimate', () => {
    it.each([
        [5, '10m'],
        [10, '1m'],
        [16, '30cm'],
        [17, '1cm'],
    ] as const)('precisionOf_z%i', (maxzoom, precision) => {
        expect(precisionOf(maxzoom)).toBe(precision);
    });

    it.each([
        [612.5, 16, 24.5],
        [12, 16, 0.5],
        [612.5, 17, 245],
        [100, 10, 0.1],
        [-3, 16, 0],
    ])('estimate_%f km² at z%i is %f units', (area, maxzoom, units) => {
        expect(estimateComputeUnits(area, maxzoom)).toBe(units);
    });
});

describe('the compute-unit guard', () => {
    it('happyPath_aPublishThatFitsTheFreeUnits', () => {
        expect(guardVerdict({ estimate: 5, usage: undefined, tilesets: 3, versionId: 'v1' })).toEqual({
            verdict: 'within',
            available: 20,
            overageUsd: 0,
        });
    });

    it('badPath_aPublishOverTheMonthCostsItsOverage', () => {
        const usage = { computeUnits: 12, computeUnitBudget: 20, reservations: { other: { computeUnits: 5 }, v1: { computeUnits: 24.5 } } };

        expect(guardVerdict({ estimate: 24.5, usage, tilesets: 3, versionId: 'v1' })).toEqual({
            verdict: 'over',
            available: 3,
            overageUsd: 19.35,
        });
    });

    it('happyPath_aPaidOverageRaisesWhatIsAvailable', () => {
        expect(availableComputeUnits({ computeUnits: 20, overageComputeUnits: 30 }, 'v1')).toBe(30);
    });

    it('badPath_theTilesetCapComesFirst', () => {
        expect(guardVerdict({ estimate: 1, usage: undefined, tilesets: MAX_TILESETS, versionId: 'v1' }).verdict).toBe('tileset-limit');
    });

    it('badPath_aPublishWithinTheMonthButOverItsCitysShareWaits', () => {
        expect(guardVerdict({ estimate: 5, usage: undefined, tilesets: 3, versionId: 'v1', cityAvailable: 4.5 })).toEqual({
            verdict: 'city-over',
            available: 4.5,
            overageUsd: 0,
        });
    });

    it('happyPath_aPublishWithinItsCitysShareGoesThroughAndTheMonthComesFirst', () => {
        expect(guardVerdict({ estimate: 5, usage: undefined, tilesets: 3, versionId: 'v1', cityAvailable: 5 }).verdict).toBe('within');
        expect(guardVerdict({ estimate: 25, usage: undefined, tilesets: 3, versionId: 'v1', cityAvailable: 1 }).verdict).toBe('over');
    });

    it('happyPath_monthsAreUtc', () => {
        expect(usageMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-10');
        expect(nextMonthStart(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });
});

describe('deterministic tilesets', () => {
    it.each([
        ['', '811c9dc5'],
        ['a', 'e40c292c'],
        ['foobar', 'bf9cf968'],
    ])('fnv1a32_%j', (text, hash) => {
        expect(fnv1a32(text)).toBe(hash);
    });

    it('happyPath_aShortLowercaseLayerKeepsItsName', () => {
        expect(tilesetIdFor('ventura86', 'bucharest', 'corona-1966')).toBe('ventura86.hcm-bucharest-corona-1966');
    });

    it.each([
        ['capitals', 'Corona-1966', 'hcm-bucharest-corona-19-e761fc12'],
        ['a long id', 'kh-9-hexagon-mapping-camera-1978-03-30', 'hcm-bucharest-kh-9-hexa-aed3512a'],
    ])('badPath_%s get a hash within 32 characters', (_name, layerId, name) => {
        expect(tilesetName('bucharest', layerId)).toBe(name);
        expect(name).toHaveLength(32);
    });

    it('happyPath_theRecipeNamesItsSourceAndZooms', () => {
        expect(rasterRecipe('ventura86', 'hcm-bucharest-corona-1966', 10, 16)).toEqual({
            version: 1,
            type: 'raster',
            sources: [{ uri: 'mapbox://tileset-source/ventura86/hcm-bucharest-corona-1966' }],
            minzoom: 10,
            maxzoom: 16,
        });
    });
});
