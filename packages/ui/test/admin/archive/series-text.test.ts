import type { ArchiveSeries } from '@hcm/shared';
import { translateAdminArchive, type AdminArchiveKey } from '@hcm/shared/admin-archive';
import { describe, expect, it } from 'vitest';

import type { SeriesEditPort, SeriesProgressPort } from '../../../src/admin/archive/archive-port.js';
import { sizeText } from '../../../src/admin/archive/archive-element.js';
import {
    actionText,
    chosenOf,
    estimateText,
    overallPercent,
    stateText,
    totalText,
    yearShown,
} from '../../../src/admin/archive/series-text.js';

function t(key: AdminArchiveKey, params?: Readonly<Record<string, string>>, locale: 'ro' | 'en' = 'en'): string {
    return translateAdminArchive(locale, key, params);
}

function makeSeries(n: number, more: Partial<ArchiveSeries> = {}): ArchiveSeries {
    return {
        seriesId: `s-${String(n).padStart(12, '0')}`,
        class: 'grid',
        title: `Plan ${String(n)}`,
        year: 1911,
        files: 4545,
        bytes: 4_000_000,
        action: 'import',
        encoding: 'lineart',
        rights: { licence: 'PD', state: 'clear', year: '1911' },
        estimate: { maxzoom: 19, tilesBytes: 1_000_000_000, minutes: 75, auto: 'likely' },
        order: n,
        ...more,
    };
}

function makeProgress(more: Partial<SeriesProgressPort> = {}): SeriesProgressPort {
    return {
        versionId: 'job-0',
        state: 'processing',
        jobStatus: 'queued',
        waitReason: null,
        step: null,
        progress: null,
        help: null,
        errorM: null,
        thresholdM: null,
        ...more,
    };
}

describe('yearShown', () => {
    it('happyPath_acceptsFourDigitYearsInRange', () => {
        expect(yearShown('1500')).toBe(true);
        expect(yearShown(' 1911 ')).toBe(true);
        expect(yearShown('2100')).toBe(true);
    });

    it('badPath_rejectsOutOfRangeAndMalformedYears', () => {
        expect(yearShown('')).toBe(false);
        expect(yearShown('191')).toBe(false);
        expect(yearShown('1911a')).toBe(false);
        expect(yearShown('1499')).toBe(false);
        expect(yearShown('2101')).toBe(false);
    });
});

describe('actionText', () => {
    it('happyPath_formatsImportClassAndSkippedWithReason', () => {
        const grid = makeSeries(0, { class: 'grid', files: 4545 });
        const single = makeSeries(1, { class: 'single', files: 1 });
        const skipped = makeSeries(2, { action: 'skip', reason: 'do-not-publish' });

        expect(actionText('en', grid)).toBe(t('adminArchive.action.grid', { files: '4,545' }));
        expect(actionText('en', single)).toBe(t('adminArchive.action.single', { files: '1' }));
        expect(actionText('en', skipped)).toBe(t('adminArchive.action.skip', { reason: t('adminArchive.reason.do-not-publish') }));
    });

    it('badPath_fallsBackToClassActionWhenSkipHasNoReason', () => {
        const skippedNoReason = makeSeries(3, { action: 'skip', class: 'single', files: 2 });

        expect(actionText('en', skippedNoReason)).toBe(t('adminArchive.action.single', { files: '2' }));
    });
});

describe('estimateText', () => {
    it('happyPath_formatsZoomSizeAndMinutes', () => {
        const series = makeSeries(0, { estimate: { maxzoom: 19, tilesBytes: 1_000_000_000, minutes: 75, auto: 'likely' } });

        expect(estimateText('en', series)).toBe(
            t('adminArchive.estimate', { zoom: '19', size: sizeText('en', 1_000_000_000), minutes: '75' }),
        );
    });

    it('badPath_clampsZeroMinutesToAtLeastOne', () => {
        const series = makeSeries(1, { estimate: { maxzoom: 16, tilesBytes: 0, minutes: 0, auto: 'points' } });

        expect(estimateText('en', series)).toBe(t('adminArchive.estimate', { zoom: '16', size: sizeText('en', 0), minutes: '1' }));
    });
});

describe('totalText', () => {
    it('happyPath_sumsChosenSeriesCountAndBytes', () => {
        const chosen = [
            makeSeries(0, { estimate: { maxzoom: 19, tilesBytes: 1_000_000_000, minutes: 30, auto: 'likely' } }),
            makeSeries(1, { estimate: { maxzoom: 18, tilesBytes: 500_000_000, minutes: 15, auto: 'likely' } }),
        ];

        expect(totalText('en', chosen)).toBe(t('adminArchive.total', { jobs: '2', size: sizeText('en', 1_500_000_000) }));
    });

    it('badPath_reportsNoneWhenSelectionIsEmpty', () => {
        expect(totalText('en', [])).toBe(t('adminArchive.totalNone'));
    });
});

describe('chosenOf', () => {
    it('happyPath_keepsOnlySeriesMarkedIncluded', () => {
        const first = makeSeries(0);
        const second = makeSeries(1);
        const third = makeSeries(2);
        const edits: Readonly<Record<string, SeriesEditPort>> = {
            [first.seriesId]: { include: true, title: first.title, year: '1911', confirmedBy: null },
            [second.seriesId]: { include: false, title: second.title, year: '1911', confirmedBy: null },
        };

        expect(chosenOf([first, second, third], edits)).toEqual([first]);
    });

    it('badPath_returnsEmptyWhenEditsAreEmpty', () => {
        expect(chosenOf([makeSeries(0)], {})).toEqual([]);
    });
});

describe('stateText', () => {
    it('happyPath_formatsEveryStateLine', () => {
        const cases: readonly [SeriesProgressPort, string][] = [
            [makeProgress({ waitReason: 'daily' }), t('adminArchive.state.daily')],
            [makeProgress({ jobStatus: 'queued' }), t('adminArchive.state.queued')],
            [
                makeProgress({ jobStatus: 'running', step: 'place', progress: 0.25 }),
                t('adminArchive.state.running', { step: 'place', percent: '25' }),
            ],
            [makeProgress({ jobStatus: 'starting' }), t('adminArchive.state.running', { step: '…', percent: '0' })],
            [
                makeProgress({ state: 'needs_gcps', help: { reason: 'frame-not-found', note: 'no neat line' } }),
                t('adminArchive.state.points', { note: t('adminArchive.help.frame-not-found') }),
            ],
            [
                makeProgress({ state: 'awaiting_approval', errorM: 4.2, thresholdM: 15 }),
                t('adminArchive.state.approval', { error: '4.2', threshold: '15' }),
            ],
            [makeProgress({ state: 'approved' }), t('adminArchive.state.publishing')],
            [makeProgress({ state: 'publishing' }), t('adminArchive.state.publishing')],
            [makeProgress({ state: 'published' }), t('adminArchive.state.published')],
            [makeProgress({ state: 'failed' }), t('adminArchive.state.failed')],
            [makeProgress({ state: 'cancelled' }), t('adminArchive.state.cancelled')],
            [makeProgress({ state: 'rejected' }), t('adminArchive.state.cancelled')],
        ];

        for (const [input, expected] of cases) {
            expect(stateText('en', input)).toBe(expected);
        }
    });

    it('badPath_handlesMissingHelpErrorScaleAndState', () => {
        expect(stateText('en', makeProgress({ state: 'needs_gcps', help: null }))).toBe(
            t('adminArchive.state.points', { note: t('adminArchive.help.low-confidence') }),
        );
        expect(stateText('en', makeProgress({ state: 'awaiting_approval', errorM: null, thresholdM: null }))).toBe(
            t('adminArchive.state.approvalNoScale', { error: '?' }),
        );
        expect(stateText('en', makeProgress({ state: null, jobStatus: 'queued' }))).toBe(t('adminArchive.state.queued'));
    });
});

describe('overallPercent', () => {
    it('happyPath_averagesRunningSharesAndCompletedSeries', () => {
        const items = [
            makeProgress({ state: 'processing', progress: 0.5 }),
            makeProgress({ state: 'published' }),
            makeProgress({ state: null, progress: 0.25 }),
        ];

        expect(overallPercent(items)).toBe(58);
    });

    it('badPath_returnsZeroForEmptyOrNullProgress', () => {
        expect(overallPercent([])).toBe(0);
        expect(overallPercent([makeProgress({ state: 'processing', progress: null }), makeProgress({ state: null, progress: null })])).toBe(
            0,
        );
    });
});
