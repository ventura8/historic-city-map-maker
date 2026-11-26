/**
 * The plan of a date's frames (`docs/research/M8-join-interfaces.md` §2): the grid's coverage, the greedy choice and its
 * stops, the ties, the paid frames, and the order of the rows. The city is a unit square and each frame a band of it, so
 * every expected percentage can be read off the band.
 */
import { describe, expect, it } from 'vitest';

import { planDate, planDates, type DatePlanFrame } from '../../src/imagery/join.js';
import { DATE_PLAN_MAX_ROWS } from '../../src/schemas/imagery-plan.js';
import type { BoundsRecord } from '../../src/geo/bbox.js';

const CITY: BoundsRecord = { west: 0, south: 0, east: 1, north: 1 };

/** A frame covering the city's longitudes `from` to `to`, all its latitudes. */
function band(entityId: string, from: number, to: number, overrides: Partial<DatePlanFrame> = {}): DatePlanFrame {
    return {
        entityId,
        date: '1972-08-08',
        sensor: 'KH-4B',
        free: true,
        footprint: [
            { lat: 2, lng: from },
            { lat: 2, lng: to },
            { lat: -1, lng: to },
            { lat: -1, lng: from },
        ],
        ...overrides,
    };
}

function chosen(frames: readonly DatePlanFrame[]): readonly string[] | undefined {
    return planDate(frames, CITY)?.frames.map((frame) => frame.entityId);
}

/** Dates that reach the city with two free frames. */
function wholeCity(date: string, overrides: Partial<DatePlanFrame> = {}): readonly DatePlanFrame[] {
    return [band(`${date}A`, 0, 0.5, { date, ...overrides }), band(`${date}B`, 0.5, 1, { date, ...overrides })];
}

describe('planDate: outlines and spares', () => {
    it('happyPath_aMeasuredOutlineComesBeforeTheEstimate', () => {
        // Its footprint holds three quarters of the city, but the proved map says it reaches only a quarter (M9 §5).
        const measuredOutline = [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.25 },
            { lat: 1, lng: 0.25 },
            { lat: 1, lng: 0 },
        ];
        const east = band('east', 0.75, 1);
        const row = planDate([band('measured', 0, 0.75, { measuredOutline }), east], CITY);

        expect(row?.coveragePct).toBeCloseTo(50, 0);
        expect(planDate([band('estimated', 0, 0.75), east], CITY)?.coveragePct).toBe(100);
    });

    it('badPath_aFrameRenderedOnTheWholeWindowIsWhatItsOutlineSays_notWhatItsBoxHolds @S-A66-BAD-WINDOW-BOX', () => {
        // Every USGS render's grid is the city's window (M9 §5). Fitted by hand, this one shows the west 40 %: its metadata ring holds it all.
        const renderedBounds = { west: -0.1, south: -0.1, east: 1.1, north: 1.1 };
        const measuredOutline = [
            { lat: 0, lng: 0 },
            { lat: 0, lng: 0.4 },
            { lat: 1, lng: 0.4 },
            { lat: 1, lng: 0 },
        ];
        const neighbour = band('neighbour', 0.4, 1);

        const row = planDate([band('points', -1, 2, { versionId: 'v1', renderedBounds, measuredOutline }), neighbour], CITY);

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['points', 'neighbour']);
        expect(row?.coveragePct).toBeCloseTo(100, 0);
        // With no such outline the box lets one frame stand for the whole city, and no neighbour is offered.
        expect(planDate([band('points', -1, 2, { versionId: 'v1', renderedBounds }), neighbour], CITY)).toBeUndefined();
    });

    it('happyPath_aFrameOverLongitude180CoversACityOnEitherSide @S-P01-HAPPY-ANTIMERIDIAN', () => {
        const suva: BoundsRecord = { west: 178.3, south: -18.2, east: 178.55, north: -18.05 };
        const footprint = (north: number, south: number) => [
            { lat: north, lng: 174.5 },
            { lat: north, lng: -174.5 },
            { lat: south, lng: -174.5 },
            { lat: south, lng: 174.5 },
        ];
        const frame = (entityId: string, north: number, south: number) => ({ ...band(entityId, 0, 0), footprint: footprint(north, south) });

        expect(planDate([frame('north', -15, -18.125), frame('south', -18.125, -19)], suva)?.coveragePct).toBe(100);
    });

    it('happyPath_aRenderedFrameCountsWhatItsOutlineCovers_notItsWarpedBox', () => {
        // A tilted strip over the city's middle: its warped box holds the whole city, the frame holds about half of it.
        const tilted = [
            { lat: -0.5, lng: -0.5 },
            { lat: -0.5, lng: 0.2 },
            { lat: 1.5, lng: 1.5 },
            { lat: 1.5, lng: 0.8 },
            { lat: 0.5, lng: 0.5 },
        ];
        const frames = [
            band('tilted', 0, 0, {
                footprint: tilted,
                renderedBounds: { west: -0.5, south: -0.5, east: 1.5, north: 1.5 },
                versionId: 'v-1',
            }),
            band('west', 0, 0.3),
        ];

        const row = planDate(frames, CITY);

        // The box alone would read 100 %, with `west` left out and no row at all.
        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['tilted', 'west']);
        expect(row?.coveragePct).toBeLessThan(90);
    });

    it('badPath_aCropInsideTheOutlineCountsOnlyWhatItKept', () => {
        const row = planDate(
            [band('cropped', 0, 1, { renderedBounds: { west: 0, south: 0, east: 0.5, north: 1 } }), band('rest', 0.5, 1)],
            CITY,
        );

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['cropped', 'rest']);
        expect(row?.coveragePct).toBe(100);
    });

    it('happyPath_aFrameTheChoiceLeftOutIsASpare_theMostOfTheCityFirst', () => {
        const row = planDate([band('west', 0, 0.5), band('east', 0.5, 1), band('small', 0.8, 1), band('large', 0.2, 1)], CITY);

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['large', 'west']);
        expect(row?.spareFrames).toEqual(['east', 'small']);
    });

    it('badPath_aPaidFrameIsNoSpare_noSpareNoField', () => {
        const row = planDate([band('west', 0, 0.5), band('east', 0.5, 1), band('paid', 0.2, 0.8, { free: false })], CITY);

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['east', 'west']);
        expect(row).not.toHaveProperty('spareFrames');
    });
});

describe('planDate', () => {
    it('happyPath_theLargestGainFirst_coverageIsTheUnion', () => {
        const row = planDate([band('small', 0, 0.25), band('large', 0.25, 1)], CITY);

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['large', 'small']);
        expect(row?.coveragePct).toBe(100);
        expect(row?.framesToDownload).toBe(2);
        expect(row).toMatchObject({ date: '1972-08-08', sensor: 'KH-4B', paidFrames: [], winter: false });
    });

    it('happyPath_stopsOnceTheCityIsCovered', () => {
        expect(chosen([band('whole', 0, 0.96), band('almost', 0, 0.5), band('rest', 0.96, 1)])).toBeUndefined();
    });

    it('happyPath_stopsWhenTheBestLeftAddsUnderTwoPercent', () => {
        // Column 43 of 48 holds its centre at 0.906: all its 48 cells are 2.08 % of the city, 43 of them are 1.87 %.
        const footprint = [
            { lat: 0.9, lng: 0.9 },
            { lat: 0.9, lng: 0.91 },
            { lat: 0, lng: 0.91 },
            { lat: 0, lng: 0.9 },
        ];
        const frames = [band('a', 0, 0.5), band('b', 0.5, 0.9)];

        expect(chosen([...frames, band('short', 0.9, 0.91, { footprint })])).toEqual(['a', 'b']);
        expect(chosen([...frames, band('tall', 0.9, 0.91)])).toEqual(['a', 'b', 'tall']);
    });

    it('happyPath_neverMoreThanEightFrames', () => {
        const frames = Array.from({ length: 12 }, (_frame, index) =>
            band(`f${String(index).padStart(2, '0')}`, index / 12, (index + 1) / 12),
        );

        expect(chosen(frames)).toHaveLength(8);
        expect(planDate(frames, CITY)?.coveragePct).toBeCloseTo(66.7, 0);
    });

    it('happyPath_startsFromRenderedFramesAndUsesTheirBounds', () => {
        const renderedBounds = { west: 0.5, south: 0, east: 1, north: 1 };
        // Its footprint is off the city: only its output's bounds place it.
        const rendered = band('rendered', 5, 6, { renderedBounds, versionId: 'v1', state: 'awaiting_approval' });
        const row = planDate([band('wide', 0, 0.75), rendered], CITY);

        expect(row?.frames).toEqual([
            { entityId: 'rendered', free: true, versionId: 'v1', state: 'awaiting_approval' },
            { entityId: 'wide', free: true },
        ]);
        expect(row?.coveragePct).toBe(100);
        expect(row?.framesToDownload).toBe(1);
    });

    it('happyPath_aPanoramicFrameCoversItsBowTieNotItsCorners', () => {
        const corners = { nw: { lat: 1, lng: 0 }, ne: { lat: 1, lng: 1 }, se: { lat: 0, lng: 1 }, sw: { lat: 0, lng: 0 } };
        const footprint = [corners.nw, corners.ne, corners.se, corners.sw];
        const panoramic = band('D3C1202-200149F039', 0, 1, { sensor: 'KH-9-pan', corners, footprint });
        const edge = band('edge', 0, 0.02, { renderedBounds: { west: 0, south: 0, east: 0.02, north: 1 } });

        // Its corners alone would say 100 %.
        expect(planDate([panoramic, edge], CITY)?.coveragePct).toBeLessThan(90);
    });

    it('happyPath_tiesGoToFreeThenTheSameCameraThenImported_thenById', () => {
        // Every candidate adds the same cells; 'seed' is rendered and sets the camera, F.
        const seed = band('D3C-1F001', 0, 0.5, { renderedBounds: { west: 0, south: 0, east: 0.5, north: 1 }, versionId: 's' });
        const free = band('D3C-1A002', 0.5, 0.75, { free: true });
        const sameCamera = band('D3C-1F003', 0.5, 0.75, { free: true });
        const imported = band('D3C-1A004', 0.5, 0.75, { free: true, versionId: 'v' });
        const notFree = band('D3C-1F005', 0.5, 0.75, { free: false, versionId: 'w' });

        const second = (frames: readonly DatePlanFrame[]): string | undefined => chosen([seed, ...frames])?.[1];

        expect(second([notFree, free])).toBe('D3C-1A002');
        expect(second([free, sameCamera])).toBe('D3C-1F003');
        expect(second([free, imported])).toBe('D3C-1A004');
        expect(second([band('D3C-1A007', 0.5, 0.75), free])).toBe('D3C-1A002');
    });

    it('badPath_aPaidFrameIsNeverChosen_itIsListed', () => {
        const row = planDate([band('free', 0, 0.5), band('paid', 0.5, 1, { free: false })], CITY);

        expect(row?.frames.map((frame) => frame.entityId)).toEqual(['free']);
        expect(row?.paidFrames).toEqual(['paid']);
        expect(row?.coveragePct).toBe(50);
    });

    it('badPath_aCloudyPaidFrameIsListedWithItsWarning @S-A152-BAD-CLOUDY', () => {
        const row = planDate([band('free', 0, 0.5, { cloudPercent: 39 }), band('paid', 0.5, 1, { free: false, cloudPercent: 70 })], CITY);

        expect(row?.paidFrames).toEqual(['paid']);
        expect(row?.cloudyFrames).toEqual([{ entityId: 'paid', percent: 70 }]);
    });

    it('happyPath_clearFramesCarryNoCloudWarning', () => {
        expect(planDate([band('a', 0, 0.5, { cloudPercent: 5 }), band('b', 0.5, 1)], CITY)).not.toHaveProperty('cloudyFrames');
    });

    it('happyPath_aPaidFrameThatAddsNothingIsNotListed', () => {
        const row = planDate([band('a', 0, 0.5), band('b', 0.5, 1), band('paid', 0, 1, { free: false })], CITY);

        expect(row?.paidFrames).toEqual([]);
    });

    it('happyPath_anImportedFrameCountsEvenIfNotFree', () => {
        const row = planDate([band('a', 0, 0.5), band('ordered', 0.5, 1, { free: false, versionId: 'v', displayId: 'ORD' })], CITY);

        expect(row?.frames).toContainEqual({ entityId: 'ordered', free: false, versionId: 'v', displayId: 'ORD' });
        expect(row?.paidFrames).toEqual([]);
    });

    it.each([
        ['no frames', []],
        ['one frame, no neighbour', [band('alone', 0, 0.5)]],
        ['only paid frames', [band('p1', 0, 0.5, { free: false }), band('p2', 0.5, 1, { free: false })]],
        ['neighbours off the city', [band('far', 5, 6), band('farther', 7, 8)]],
    ])('badPath_noRowFor_%s', (_case, frames) => {
        expect(planDate(frames, CITY)).toBeUndefined();
    });

    it.each([
        ['1972-12-20', true],
        ['1972-01-20', true],
        ['1972-02-02', true],
        ['1972-03-01', false],
        ['1972-11-30', false],
    ])('happyPath_winterOf_%s', (date, winter) => {
        expect(planDate(wholeCity(date), CITY)?.winter).toBe(winter);
    });
});

describe('planDates', () => {
    function dates(frames: readonly DatePlanFrame[], targetYears: readonly number[] = []): readonly string[] {
        return planDates(frames, CITY, targetYears).map((row) => row.date);
    }

    it('happyPath_aSummerDateRanksAboveASnowyOneOfTheSameYear', () => {
        expect(dates([...wholeCity('1972-02-02'), ...wholeCity('1972-08-08')])).toEqual(['1972-08-08', '1972-02-02']);
    });

    it('happyPath_reachingTheCityOutranksATargetYear', () => {
        const short = [band('s1', 0, 0.4, { date: '1966-07-12' }), band('s2', 0.4, 0.8, { date: '1966-07-12' })];

        expect(dates([...short, ...wholeCity('1975-06-01')], [1966])).toEqual(['1975-06-01', '1966-07-12']);
    });

    it('happyPath_aTargetYearOutranksSummer', () => {
        expect(dates([...wholeCity('1975-06-01'), ...wholeCity('1966-01-10')], [1966])).toEqual(['1966-01-10', '1975-06-01']);
    });

    it('happyPath_fewerDownloadsFirstThenTheEarliest', () => {
        const imported = wholeCity('1980-07-16', { versionId: 'v' });

        expect(dates([...wholeCity('1970-07-01'), ...imported])).toEqual(['1980-07-16', '1970-07-01']);
        expect(dates([...wholeCity('1971-07-01'), ...wholeCity('1970-07-01')])).toEqual(['1970-07-01', '1971-07-01']);
    });

    it('badPath_framesOfOneDateFromTwoCamerasAreNeverJoined', () => {
        const frames = [band('a', 0, 0.5), band('b', 0.5, 1, { sensor: 'KH-7' })];

        expect(planDates(frames, CITY, [])).toEqual([]);
    });

    it('happyPath_aFrameWithWorkHoldsItsRowPastTheCap_theOrderStays', () => {
        const others = Array.from({ length: DATE_PLAN_MAX_ROWS + 5 }, (_date, index) => wholeCity(`19${String(10 + index)}-07-01`)).flat();
        const rendered = band('F039', 0, 0.5, { date: '1972-02-02', versionId: 'v-f039', state: 'awaiting_approval' });

        const rows = planDates([...others, rendered, band('F040', 0.5, 1, { date: '1972-02-02' })], CITY, []);

        expect(rows).toHaveLength(DATE_PLAN_MAX_ROWS);
        expect(rows.map((row) => row.date)).toContain('1972-02-02');
        // It is kept, not promoted: a winter date still comes after the summer ones.
        expect(rows.at(-1)?.date).toBe('1972-02-02');
    });

    it('badPath_theRowsAreCapped', () => {
        const frames = Array.from({ length: DATE_PLAN_MAX_ROWS + 5 }, (_date, index) => wholeCity(`19${String(10 + index)}-07-01`)).flat();

        expect(planDates(frames, CITY, [])).toHaveLength(DATE_PLAN_MAX_ROWS);
    });
});
