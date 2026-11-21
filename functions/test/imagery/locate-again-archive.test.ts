/**
 * `imagery.locateAgain` on an archive series parked for points (M22, `docs/research/M22-help-calibrate.md` §13.2): it places itself
 * again from `place`, which also makes its stitched picture for the georeferencer (one parked before that had none).
 */
import type { JobDoc, LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { locateAgainFunction } from '../../src/imagery/locate-again.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    needsGcpsVersion,
    readJob,
    readVersion,
    readyWorld,
    seedJob,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'ar-mw993zri-s-4054e55659a3';
const DONE = 'done' as const;

function parkedSeries(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'archive-series',
        status: 'awaiting_gcps',
        waitReason: 'gcps',
        params: {
            archiveId: 'ar-0123456789abcdef',
            seriesId: 's-4054e55659a3',
            class: 'pieces',
            sheets: 64,
            encoding: 'colour',
            order: 0,
            referenceLayerIds: [],
        },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'plan-1895',
        versionId: JOB,
        attempt: 1,
        steps: { gather: { status: DONE }, place: { status: DONE }, export: { status: 'pending' } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function parkedVersion(): LayerVersionDoc {
    const rest = omit(needsGcpsVersion(), ['scan', 'georef', 'reference']);
    return {
        ...rest,
        layerId: 'plan-1895',
        jobId: JOB,
        origin: 'archive',
        source: { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-4054e55659a3', sheetCount: 64 },
        help: { reason: 'low-confidence', note: 'These pieces could not be placed.', at: at(NOW) },
    };
}

async function world(job: Partial<JobDoc> = {}): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedJob(ready, JOB, parkedSeries(job));
    await seedVersion(ready, JOB, parkedVersion());
    return ready;
}

function locateAgain(ready: ImageryWorld) {
    return locateAgainFunction(() => ready.deps).run(adminCall({ cityId: CITY, versionId: JOB }));
}

describe('imagery.locateAgain: an archive series parked for points', () => {
    it('happyPath_itPlacesItselfAgainFromPlaceWhatItGatheredKept @S-A122-HAPPY-PLACE-AGAIN', async () => {
        const ready = await world();

        await expect(locateAgain(ready)).resolves.toEqual({ status: 'queued', attempt: 1 });

        const job = await readJob(ready, JOB);
        expect(job?.steps).toEqual({ gather: { status: DONE }, place: { status: 'pending' }, export: { status: 'pending' } });
        const version = await readVersion(ready, JOB);
        expect(version?.state).toBe('processing');
        expect(version?.help).toBeUndefined();
    });

    // Finding of 2026-11-14 (1864 and 1871 Pappasoglu): a search never drops the pairs the owner saved; `place` fits them.
    it('happyPath_theOwnersSavedPairsStayForPlaceToFit @S-A122-HAPPY-PLACE-AGAIN-KEEPS-PAIRS', async () => {
        const ready = await world();
        const georef = { ...goldenGeoref(), method: 'gcps' as const };
        await seedVersion(ready, JOB, { ...parkedVersion(), georef });

        await locateAgain(ready);

        expect((await readVersion(ready, JOB))?.georef).toEqual(georef);
    });

    it('badPath_aSeriesAskedToStopIsNotPlacedAgain @S-A122-BAD-PLACE-AGAIN-CANCELLED', async () => {
        const ready = await world({ cancelRequested: true });

        expect(await failureOf(locateAgain(ready))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(ready, JOB))?.status).toBe('awaiting_gcps');
    });
});
