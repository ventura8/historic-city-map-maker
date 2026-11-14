import { jobDocSchema, layerVersionDocSchema, usgsSceneDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { Stored } from '../../src/content/services.js';
import {
    DEFAULT_FILTERS,
    harvestIsStale,
    jobProgressOf,
    orNull,
    sceneItemOf,
    versionItemOf,
    visibleScenes,
    type SceneItem,
} from '../../src/imagery/model.js';
import { at, jobDoc, sceneDoc, versionDoc } from './world.js';

function stored<T>(id: string, data: T): Stored<T> {
    return { id, path: `x/${id}`, data, version: '2026-10-20T09:00:00.000Z', pending: false };
}

function scene(id: string, overrides: Record<string, unknown> = {}): SceneItem {
    return sceneItemOf(stored(id, usgsSceneDocSchema.parse(sceneDoc(id, overrides))));
}

describe('a scene as the list shows it', () => {
    it('happyPath_theHarvestsFieldsWithTheCornersAndTheBrowseCopy', () => {
        const item = scene('DS1', {
            displayId: 'DS1035-1057DA023',
            cloudCover: 12,
            corners: {
                nw: { lat: 44.6, lng: 25.9 },
                ne: { lat: 44.6, lng: 26.3 },
                se: { lat: 44.3, lng: 26.3 },
                sw: { lat: 44.3, lng: 25.9 },
            },
            browse: { state: 'copied', path: 'usgs-browse/corona2/DS1.jpg' },
            status: 'imported',
            layerId: 'kh-4a-1966',
        });

        expect(item).toMatchObject({
            ...{ id: 'DS1', displayId: 'DS1035-1057DA023', sensorName: 'KH-4A Corona', year: 1966, cloudCover: 12, score: 80 },
            browse: { state: 'copied', path: 'usgs-browse/corona2/DS1.jpg', error: null },
            layerId: 'kh-4a-1966',
        });
        expect(item.corners?.[0]).toEqual([25.9, 44.6]);
        expect(item.footprint).toHaveLength(4);
    });

    it('happyPath_aSceneWithoutTheOptionalFieldsReadsAsNone', () => {
        const item = scene('DS2', { browse: { state: 'failed', error: 'apiError.imagery.browseUnavailable' } });

        expect([item.displayId, item.cloudCover, item.corners, item.layerId, item.browse.path, item.browse.error]).toEqual([
            'DS2',
            null,
            null,
            null,
            null,
            'apiError.imagery.browseUnavailable',
        ]);
        expect(orNull(undefined)).toBeNull();
        expect([item.unusable, item.cloudCity]).toEqual([null, null]);
    });

    it('happyPath_theOwnersMarkAndTheCloudsOverTheCity', () => {
        const item = scene('DS3', {
            status: 'rejected',
            unusable: { reason: 'clouds', at: at('2026-11-13T12:00:00Z') },
            cloudEstimate: { percent: 46, version: 1 },
        });

        expect([item.status, item.unusable, item.cloudCity]).toEqual(['rejected', 'clouds', 46]);
    });
});

describe('the filters', () => {
    const scenes = [
        scene('free-old', { acquisitionDate: '1966-07-12', rank: { score: 60, reasons: [], version: 1 } }),
        scene('free-best', {
            acquisitionDate: '1978-03-30',
            dataset: 'declassii',
            sensor: 'KH-9-mapping',
            rank: { score: 90, reasons: [], version: 1 },
        }),
        scene('paid', { downloadAvailable: false, rank: { score: 99, reasons: [], version: 1 } }),
        scene('rejected', { status: 'rejected', rank: { score: 70, reasons: [], version: 1 } }),
        scene('free-tie', { acquisitionDate: '1965-01-01', rank: { score: 60, reasons: [], version: 1 } }),
    ];

    it('happyPath_freeFirstThenTheScoreThenTheOldestRejectedHidden', () => {
        expect(visibleScenes(scenes, DEFAULT_FILTERS).map((item) => item.id)).toEqual(['free-best', 'free-tie', 'free-old']);
        expect(visibleScenes(scenes, { ...DEFAULT_FILTERS, freeOnly: false, hideRejected: false }).map((item) => item.id)).toEqual([
            'free-best',
            'rejected',
            'free-tie',
            'free-old',
            'paid',
        ]);
    });

    it('happyPath_datasetsAndYearsNarrowTheList', () => {
        expect(visibleScenes(scenes, { ...DEFAULT_FILTERS, datasets: ['declassii'] }).map((item) => item.id)).toEqual(['free-best']);
        expect(visibleScenes(scenes, { ...DEFAULT_FILTERS, fromYear: 1966, toYear: 1970 }).map((item) => item.id)).toEqual(['free-old']);
    });
});

describe('versions and jobs', () => {
    it('happyPath_aVersionWaitingForApprovalNeedsTheAdmin', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());
        const item = versionItemOf(stored('job-1966-0712', doc));

        expect(item).toMatchObject({
            id: 'job-1966-0712',
            layerId: 'kh-4a-corona-1966',
            year: 1966,
            state: 'awaiting_approval',
            needsYou: true,
        });
        expect(item.checkpointRmseM).toBe(doc.georef?.checkpointRmseM);
        expect(
            versionItemOf(stored('p', { ...doc, state: 'publishing', approval: { auto: true, by: 'system:imagery', at: doc.updatedAt } })),
        ).toMatchObject({
            needsYou: false,
        });
    });

    it('badPath_anArgonFrameImportedAsCoronaIsNamedArgonAndSetAsideTooCoarse', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());
        const source = { ...(versionDoc()['source'] as Record<string, unknown>), entityId: 'DS09059A041MC015' };
        const label = { ro: 'KH-4A Corona, 21 august 1963', en: 'KH-4A Corona, 21 August 1963' };
        const argon = layerVersionDocSchema.parse(versionDoc({ label, source }));

        const item = versionItemOf(stored('argon', argon));

        expect(item).toMatchObject({ tooCoarse: true, needsYou: false });
        expect(item.label).toEqual({ ro: 'KH-5 Argon, 21 august 1963', en: 'KH-5 Argon, 21 August 1963' });
        expect(versionItemOf(stored('corona', doc))).toMatchObject({ tooCoarse: false });
    });

    it('happyPath_aVersionTheGuardStoppedWaitsForTheAdminUnlessDeferred', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());
        const approved = { ...doc, state: 'approved' as const, approval: { auto: true, by: 'system:imagery', at: doc.updatedAt } };
        const guard = { verdict: 'over' as const, available: 2, checkedAt: doc.updatedAt };

        const needs = (version: typeof approved) => versionItemOf(stored('v', version)).needsYou;

        expect(needs({ ...approved, guard })).toBe(true);
        expect(needs({ ...approved, guard: { ...guard, verdict: 'tileset-limit' } })).toBe(true);
        expect(needs({ ...approved, guard: { ...guard, choice: 'studio' } })).toBe(true);
        expect(needs({ ...approved, guard: { ...guard, choice: 'defer', deferUntil: doc.updatedAt } })).toBe(false);
        expect(needs({ ...approved, guard: { ...guard, verdict: 'within' } })).toBe(false);
        expect(needs(approved)).toBe(false);
    });

    it('happyPath_aJobsProgressAndWaitAndItsAttempts', () => {
        const waiting = jobDocSchema.parse(
            jobDoc({
                status: 'waiting_usgs',
                waitReason: 'usgs-maintenance',
                retryAt: { seconds: 1_760_000_000, nanoseconds: 0 },
                attempt: 2,
            }),
        );
        const fresh = jobDocSchema.parse(jobDoc({ progress: undefined, step: undefined }));

        expect(jobProgressOf(stored('w', waiting))).toMatchObject({
            ...{ status: 'waiting_usgs', waitReason: 'usgs-maintenance', attempt: 2 },
            retryAt: '2025-10-09T08:53:20.000Z',
        });
        expect(jobProgressOf(stored('f', fresh))).toMatchObject({
            progress: null,
            step: null,
            waitReason: null,
            retryAt: null,
            attempt: 0,
        });
    });

    it('happyPath_aHarvestOlderThanThirtyDaysOrNoneIsStale', () => {
        const now = Date.parse('2026-10-20T09:00:00Z');

        expect(harvestIsStale(null, now, 30)).toBe(true);
        expect(harvestIsStale('2026-09-01T00:00:00Z', now, 30)).toBe(true);
        expect(harvestIsStale('2026-10-10T00:00:00Z', now, 30)).toBe(false);
    });
});
