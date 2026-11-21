// M20's Import local files, the pure part (docs/research/M20-import-local.md §8): the worker's page, the city's share, what a
// request sends of the owner's edits, and progress from versions and jobs of other origins.
import type { ArchiveDoc, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { choicesOf, editsOf, importUrlOf, progressOf } from '../../src/archive/model.js';
import type { Stored } from '../../src/content/services.js';

function stored<T>(id: string, data: T): Stored<T> {
    return { id, path: `x/${id}`, data, version: '1', pending: false };
}

const SERIES = {
    seriesId: 's-000000000000',
    class: 'single',
    title: 'Plan 1911',
    year: 1911,
    files: 1,
    bytes: 1,
    action: 'import',
    encoding: 'grey',
    rights: { licence: 'PD', state: 'clear', year: '1911' },
    estimate: { maxzoom: 16, tilesBytes: 1, minutes: 1, auto: 'possible' },
    order: 0,
} as const;

describe('the archive model', () => {
    it('happyPath_aCityWithoutCentreOrNoneAtAllAndTheShare', () => {
        expect(importUrlOf(8765, undefined)).toBe('http://127.0.0.1:8765/import');
    });

    it('happyPath_aTitleClearedOrUnchangedAndTheSameYearSendNothingButTheChoice', () => {
        const archive = { series: [SERIES] } as unknown as ArchiveDoc;
        const sent = (title: string, year: string) =>
            choicesOf(archive, { [SERIES.seriesId]: { include: true, title, year, confirmedBy: null } });

        expect(sent('  ', '1911')).toEqual([{ seriesId: SERIES.seriesId, include: true }]);
        expect(sent('Plan 1911', '1912')).toEqual([{ seriesId: SERIES.seriesId, include: true, year: 1912 }]);
        expect(sent('Plan', '1770')).toBeNull();
    });

    it('badPath_anUndatedSeriesWaitsForTheOwnersYearAndAlwaysSendsIt', () => {
        const undated = { ...SERIES, year: 2026, yearLabel: '?' };
        const archive = { series: [undated] } as unknown as ArchiveDoc;

        expect(editsOf(archive, {})).toEqual({ [SERIES.seriesId]: { include: false, title: 'Plan 1911', year: '', confirmedBy: null } });
        expect(choicesOf(archive, { [SERIES.seriesId]: { include: true, title: 'Plan 1911', year: '2026', confirmedBy: null } })).toEqual([
            { seriesId: SERIES.seriesId, include: true, year: 2026 },
        ]);
    });

    it('happyPath_anImportedSeriesIsNeverChosenAgainAndOneStartedOverIsTheOwnersToChoose @S-A125-HAPPY-DELETE-VERSION', () => {
        const other = { ...SERIES, seriesId: 's-000000000001' };
        const archive = { series: [SERIES, other], jobs: { [SERIES.seriesId]: 'ar-0' } } as unknown as ArchiveDoc;
        const kept = { [SERIES.seriesId]: { include: true, title: 'Plan 1911', year: '1911', confirmedBy: null } };

        const edits = editsOf(archive, kept);

        expect([edits[SERIES.seriesId]?.include, edits[other.seriesId]?.include]).toEqual([false, true]);
        expect(choicesOf(archive, edits)).toEqual([{ seriesId: other.seriesId, include: true }]);
    });

    it('badPath_versionsOfOtherOriginsAndAReportWithoutAFigureNorACityShowNoError', () => {
        const usgs = stored('u', { state: 'processing', source: { kind: 'usgs' } } as unknown as LayerVersionDoc);
        const archive = { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: SERIES.seriesId, sheetCount: 1 };
        const report = {
            method: 'match',
            encoding: 'grey',
            paperTransparent: false,
            checkpointCount: 0,
            checksDropped: 0,
            measuredPct: 0,
            rivalClean: true,
        };
        const unmeasured = stored('a', { state: 'awaiting_approval', source: archive, archive: report } as unknown as LayerVersionDoc);

        const progress = progressOf([usgs, unmeasured], [], undefined);

        expect(Object.keys(progress)).toEqual([SERIES.seriesId]);
        expect(progress[SERIES.seriesId]).toMatchObject({ versionId: 'a', errorM: null, thresholdM: null, help: null });
    });
});
