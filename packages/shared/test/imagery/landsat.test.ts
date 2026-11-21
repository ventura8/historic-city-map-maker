/**
 * M25 (`docs/research/M25-landsat.md`): Landsat's datasets and cameras, the season in its rank, the settings of the tick's own imports, the
 * report the pipeline writes and when it lets a version publish itself, and LandsatLook's browse addresses.
 */
import { describe, expect, it } from 'vitest';

import { rankScene, type RankedScene } from '../../src/imagery/ranking.js';
import { DECLASS_DATASETS, LANDSAT_DATASETS, USGS_DATASETS } from '../../src/schemas/firestore.js';
import { DEFAULT_LANDSAT_YEARS, cityImagerySchema, imagerySettingsOf, landsatYearsOf } from '../../src/schemas/imagery-settings.js';
import { landsatClear } from '../../src/schemas/landsat-verdict.js';
import { isLandsatDataset, landsatReportSchema, type LandsatReport } from '../../src/schemas/landsat.js';
import { SENSOR_SPECS, usgsBrowseUrlSchema } from '../../src/schemas/usgs-scene.js';

const CLEAR: LandsatReport = {
    checked: true,
    offsetPx: 0.4,
    offsetM: 12,
    eastM: 7.2,
    northM: -9.6,
    cityCloudPct: 2,
    resolutionM: 30,
    pansharpened: false,
};

function landsat(overrides: Partial<RankedScene> = {}): RankedScene {
    return {
        dataset: 'landsat_tm_c2_l1',
        downloadAvailable: true,
        coverage: 1,
        acquisitionDate: '1989-07-12',
        resolutionM: 30,
        cloudCover: 0,
        ...overrides,
    };
}

describe('Landsat datasets and cameras', () => {
    it('happyPath_theTwoLandsatDatasetsFollowTheDeclassifiedOnes @S-A130-HAPPY', () => {
        expect(USGS_DATASETS).toEqual([...DECLASS_DATASETS, ...LANDSAT_DATASETS]);
        expect(LANDSAT_DATASETS.every((dataset) => isLandsatDataset(dataset))).toBe(true);
        expect(DECLASS_DATASETS.some((dataset) => isLandsatDataset(dataset))).toBe(false);
        expect([SENSOR_SPECS['L5-TM'].maxzoom, SENSOR_SPECS['L7-ETM'].maxzoom, SENSOR_SPECS['L4-TM'].resolutionM]).toEqual([13, 14, 30]);
    });
});

describe('the season in a Landsat rank', () => {
    it('happyPath_aLeafOnSummerSceneCountsItsCloudsAsAnyFrame @S-A130-HAPPY', () => {
        const rank = rankScene(landsat(), { targetYears: [], layerYears: [] });

        expect(rank.reasons.map((reason) => reason.code)).toContain('cloud');
        expect(rank.reasons.map((reason) => reason.code)).not.toContain('season');
    });

    it('badPath_aCloudyOrOffSeasonSceneRanksBelowAClearSummerOne @S-A130-BAD-CLOUDY', () => {
        const context = { targetYears: [], layerYears: [] };
        const clear = rankScene(landsat(), context).score;
        const cloudy = rankScene(landsat({ cloudCover: 35 }), context).score;
        const may = rankScene(landsat({ acquisitionDate: '1989-05-20' }), context);
        const unknown = rankScene(landsat({ acquisitionDate: '1989-09-20', cloudCover: undefined }), context);

        expect(cloudy).toBeLessThan(clear);
        expect(rankScene(landsat({ cloudCover: 35 }), context).reasons[0]).toEqual({ code: 'cloud', params: { percent: '35' } });
        expect(may.score).toBeLessThan(clear);
        expect(may.reasons[0]).toEqual({ code: 'season', params: { month: '5' } });
        expect(unknown.score).toBeLessThan(may.score);
        // A declassified frame of May is not a Landsat scene: no season.
        expect(rankScene(landsat({ dataset: 'corona2', acquisitionDate: '1966-05-01' }), context).reasons.map((r) => r.code)).not.toContain(
            'season',
        );
    });
});

describe('the settings of the tick’s Landsat imports', () => {
    it('happyPath_aCityThatSetNothingImports1984ToTheCurrentYear @S-A130-HAPPY-AUTO', () => {
        const settings = imagerySettingsOf(undefined);

        expect([settings.landsatAuto, settings.landsatFrom, settings.landsatTo]).toEqual([true, DEFAULT_LANDSAT_YEARS.from, undefined]);
        expect(landsatYearsOf(settings, 2026)).toHaveLength(43);
        expect(landsatYearsOf(settings, 2026).at(-1)).toBe(2026);
        expect(landsatYearsOf({ landsatFrom: 1990, landsatTo: 1992 }, 2026)).toEqual([1990, 1991, 1992]);
    });

    it('badPath_aReversedRangeHasNoYearAndAYearPastTheCurrentOneIsNotWanted @S-A130-BAD-AUTO-OFF', () => {
        expect(landsatYearsOf({ landsatFrom: 2000, landsatTo: 1990 }, 2026)).toEqual([]);
        expect(landsatYearsOf({ landsatFrom: 2025, landsatTo: 2030 }, 2026)).toEqual([2025, 2026]);
        expect(cityImagerySchema.safeParse({ landsatFrom: 1700 }).success).toBe(false);
        expect(cityImagerySchema.safeParse({ landsatAuto: false, landsatFrom: 1985, landsatTo: 1995 }).success).toBe(true);
    });
});

describe('the Landsat report', () => {
    it('happyPath_withinAPixelOverAClearCityPublishesOnItsOwn @S-A130-HAPPY', () => {
        expect(landsatReportSchema.safeParse(CLEAR).success).toBe(true);
        expect(landsatClear(CLEAR)).toBe(true);
    });

    it('badPath_offByMoreThanAPixelCloudyOrUnmeasuredWaits @S-A130-BAD-OFFSET', () => {
        expect(landsatClear({ ...CLEAR, offsetPx: 1.6 })).toBe(false);
        expect(landsatClear({ ...CLEAR, cityCloudPct: 25 })).toBe(false);
        expect(landsatClear({ checked: false, cityCloudPct: 0, resolutionM: 30, pansharpened: false })).toBe(false);
        expect(landsatClear({ ...CLEAR, offsetPx: undefined })).toBe(false);
        // Lesson 727: a systematic scene moved onto Sentinel-2 always waits, however close it lies now.
        expect(landsatClear({ ...CLEAR, correction: { state: 'applied', eastM: -2434.4, northM: -2844.7 } })).toBe(false);
        expect(landsatReportSchema.safeParse({ ...CLEAR, correction: { state: 'moved', eastM: 0, northM: 0 } }).success).toBe(false);
        expect(landsatReportSchema.safeParse({ ...CLEAR, cityCloudPct: 120 }).success).toBe(false);
    });
});

describe('LandsatLook browse addresses', () => {
    it('happyPath_aLandsatProductsBrowseIsAccepted @S-A130-HAPPY', () => {
        const url = 'https://landsatlook.usgs.gov/gen-browse?size=rrb&type=refl&product_id=LT05_L1TP_183029_19890712_20200916_02_T1';

        expect(usgsBrowseUrlSchema.safeParse(url).success).toBe(true);
    });

    it('badPath_anyOtherAddressOrQueryIsRefused @S-A130-BAD-CLOUDY', () => {
        for (const url of [
            'https://landsatlook.usgs.gov/gen-browse?size=rrb&type=refl&product_id=../x',
            'https://landsatlook.usgs.gov/other?product_id=LT05_L1TP_183029_19890712_20200916_02_T1',
            'https://evil.example/gen-browse?size=rrb&type=refl&product_id=LT05_L1TP_183029_19890712_20200916_02_T1',
        ]) {
            expect(usgsBrowseUrlSchema.safeParse(url).success).toBe(false);
        }
    });
});
