/**
 * The scene ranking (`docs/research/M3-interfaces.md` §3.3): six weighted parts, the score rounded, the reasons that
 * explain a low rank always listed and first (a card shows three), then the others by their contribution.
 */
import { describe, expect, it } from 'vitest';

import { rankScene, type RankContext, type RankedScene } from '../../src/imagery/ranking.js';
import { RANKING_VERSION } from '../../src/schemas/usgs-scene.js';

/** The 1966 KH-4A frame over Bucharest, already scanned, covering all the city, no cloud recorded. */
function scene(overrides: Partial<RankedScene> = {}): RankedScene {
    return { downloadAvailable: true, coverage: 1, acquisitionDate: '1966-07-12', resolutionM: 2.75, ...overrides };
}

const NO_CONTEXT: RankContext = { targetYears: [], layerYears: [] };
const BUCHAREST: RankContext = { targetYears: [1966, 1976, 1977, 1978, 1980], layerYears: [] };

function codes(context: RankContext, overrides: Partial<RankedScene> = {}): string[] {
    return rankScene(scene(overrides), context).reasons.map((entry) => entry.code);
}

describe('rankScene', () => {
    it('happyPath_aFreeTargetYearFrameOverTheCityRanksNearTheTop', () => {
        const rank = rankScene(scene(), BUCHAREST);

        // free 30 + coverage 25 + target year 15 + new year 10 + cloud unknown 5 + resolution 10 × 0.78125.
        expect(rank).toEqual({
            score: 93,
            reasons: [
                { code: 'free' },
                { code: 'coverage', params: { percent: '100' } },
                { code: 'targetYear', params: { year: '1966' } },
                { code: 'noLayers' },
                { code: 'resolution', params: { metres: '2.8' } },
                { code: 'cloudUnknown' },
            ],
            version: RANKING_VERSION,
        });
    });

    it('happyPath_aYearNextToATargetCountsHalf', () => {
        const rank = rankScene(scene({ acquisitionDate: '1967-03-01' }), BUCHAREST);

        expect(rank.reasons).toContainEqual({ code: 'nearTargetYear', params: { year: '1966' } });
        expect(rank.score).toBe(85);
    });

    it('happyPath_theNewYearPartGrowsWithTheGapToTheNearestLayer', () => {
        const near = rankScene(scene(), { targetYears: [], layerYears: [1968, 1990] });
        const far = rankScene(scene(), { targetYears: [], layerYears: [1990] });

        expect(near.reasons).toContainEqual({ code: 'newYear', params: { years: '2' } });
        expect(far.reasons).toContainEqual({ code: 'newYear', params: { years: '24' } });
        expect(far.score - near.score).toBe(8);
    });

    it('happyPath_aRecordedCloudCoverLowersTheScore', () => {
        const clear = rankScene(scene({ cloudCover: 0 }), NO_CONTEXT);
        const cloudy = rankScene(scene({ cloudCover: 25 }), NO_CONTEXT);

        expect(clear.reasons).toContainEqual({ code: 'cloud', params: { percent: '0' } });
        expect(clear.score - cloudy.score).toBe(5);
    });

    it('happyPath_resolutionIsBoundedBetweenAFifthAndOne', () => {
        const sharp = rankScene(scene({ resolutionM: 0.6 }), NO_CONTEXT);
        const coarse = rankScene(scene({ resolutionM: 60 }), NO_CONTEXT);

        expect(sharp.score - coarse.score).toBe(8);
        expect(coarse.reasons).toContainEqual({ code: 'resolution', params: { metres: '60.0' } });
    });

    it('badPath_aFrameToOrderIsExplainedAndRanksLower', () => {
        const rank = rankScene(scene({ downloadAvailable: false }), BUCHAREST);

        expect(rank.score).toBe(63);
        expect(rank.reasons[0]).toEqual({ code: 'needsOrder' });
    });

    it('badPath_aYearTheCityHasIsExplainedAmongTheFirstThree', () => {
        expect(codes({ targetYears: [1966], layerYears: [1966] }).slice(0, 3)).toContain('sameYear');
        expect(rankScene(scene(), { targetYears: [], layerYears: [1966] }).reasons).toContainEqual({
            code: 'sameYear',
            params: { year: '1966' },
        });
    });

    it('badPath_aSmallCoverageIsAlwaysListed_aZeroOneIsToo', () => {
        expect(codes(NO_CONTEXT, { coverage: 0.3 })).toContain('coverage');
        expect(codes(NO_CONTEXT, { coverage: 0 })).toContain('coverage');
    });

    it('badPath_anOvercastFrameAndAnOtherYearAddNothingAndAreLeftOut', () => {
        const reasons = codes({ targetYears: [1900], layerYears: [] }, { cloudCover: 80 });

        expect(reasons).not.toContain('cloud');
        expect(reasons).not.toContain('targetYear');
        expect(reasons).not.toContain('nearTargetYear');
    });

    it('badPath_theWorstFrameScoresAtLeastZero', () => {
        const rank = rankScene(scene({ downloadAvailable: false, coverage: 0, cloudCover: 100, resolutionM: 90 }), {
            targetYears: [],
            layerYears: [1966],
        });

        expect(rank.score).toBe(2);
        expect(rank.reasons.map((entry) => entry.code)).toEqual(['needsOrder', 'coverage', 'sameYear', 'resolution']);
    });

    it('happyPath_aFrameOfTheDateInProgressKeepsItsNewYearPointsAndSaysWhy', () => {
        const context: RankContext = { targetYears: [], layerYears: [1966], pendingDates: ['1966-07-12'] };
        const rank = rankScene(scene(), context);

        // The same frame without the date scores 10 less and blames the year.
        expect(rank.score).toBe(rankScene(scene(), { targetYears: [], layerYears: [1966] }).score + 10);
        expect(rank.reasons[0]).toEqual({ code: 'sameDate' });
        expect(rank.reasons.map((entry) => entry.code)).not.toContain('sameYear');
    });

    it('badPath_anotherDateOfTheSameYearStaysDemoted', () => {
        const context: RankContext = { targetYears: [], layerYears: [1966], pendingDates: ['1966-02-02'] };

        expect(codes(context)).toContain('sameYear');
        expect(codes(context)).not.toContain('sameDate');
    });

    it('happyPath_theRankingVersionMovedWithTheCloudEstimate', () => {
        expect(RANKING_VERSION).toBe(5);
    });

    it('happyPath_aClearEstimateCountsAsCloudAndSaysSo', () => {
        const rank = rankScene(scene({ cloudEstimate: { percent: 10, version: 1 } }), BUCHAREST);

        // The cloud part is 1 − 10/50 = 0.8 (8 points) in place of the unknown's 5: 96, nothing taken off.
        expect(rank.score).toBe(96);
        expect(rank.reasons).toContainEqual({ code: 'cloudCity', params: { percent: '10' } });
        expect(rank.reasons[0]).toEqual({ code: 'free' });
    });

    it('badPath_aFrameProbablyCloudyOverTheCityLosesThatShareAndSaysItFirst', () => {
        const rank = rankScene(scene({ cloudEstimate: { percent: 70, version: 1 } }), BUCHAREST);

        // 30 + 25 + 15 + 10 + 0 + 7.8 = 87.8, of which the clear 30 % is left.
        expect(rank.score).toBe(26);
        expect(rank.reasons[0]).toEqual({ code: 'cloudCity', params: { percent: '70' } });
    });

    it('badPath_usgsCloudCoverWinsOverTheEstimate', () => {
        const rank = rankScene(scene({ cloudCover: 0, cloudEstimate: { percent: 90, version: 1 } }), BUCHAREST);

        expect(rank.score).toBe(98);
        expect(rank.reasons.map((entry) => entry.code)).not.toContain('cloudCity');
    });

    it('happyPath_aCityWithoutLayersSaysAnyYearIsNew', () => {
        expect(codes(NO_CONTEXT)).toContain('noLayers');
        expect(codes(NO_CONTEXT)).not.toContain('newYear');
    });
});
