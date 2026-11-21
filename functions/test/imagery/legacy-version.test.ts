/**
 * A layer version its schema refuses (finding of 2026-11-12: a KH-9 frame the pipeline stored unvalidated with `scan.width` 258,271,
 * over `MAX_SCAN_PIXELS`, lesson 332) can still be ended by its owner: Reject and Cancel read it without the refused fields
 * (`layerVersionReadSchema`), end it and its job, and write it back valid; the layer is no longer busy. A valid version ends as before.
 * Delete this version reads it the same way: a cancelled one goes with its job.
 */
import { FIRESTORE_PATHS, MAX_SCAN_PIXELS, type JobDoc, type LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { rejectFunction } from '../../src/imagery/approve.js';
import { cancelJob } from '../../src/imagery/cancel.js';
import { deleteVersionFunction } from '../../src/imagery/delete-version.js';
import { refuseBusyLayer } from '../../src/imagery/limits.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, at, needsGcpsVersion, readJob, readVersion, readyWorld, seedJob, seedVersion, type ImageryWorld } from './world.js';

const JOB = 'im-mvya873z-D3C1202-200149F039';
const LAYER = 'kh-9-hexagon-2-februarie-1972';
const WIDE = MAX_SCAN_PIXELS + 58_271;

function parkedJob(): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_gcps',
        waitReason: 'gcps',
        params: { entityId: 'D3C1202-200149F039', dataset: 'declassiii', sensor: 'KH-9-pan' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    };
}

function version(): LayerVersionDoc {
    return needsGcpsVersion({ origin: 'usgs', layerId: LAYER, jobId: JOB });
}

/** The version as an older release stored it: its scan and its points wider than today's limit. */
function legacy(): Record<string, unknown> {
    const valid = version();
    const pixel = { x: WIDE, y: 0 };
    const gcp = { id: 'c1', enabled: true, origin: 'manual', pixel, geo: { lat: 44.32, lng: 25.84 } };
    return { ...valid, scan: { ...valid.scan, width: WIDE }, georef: { transform: 'affine', method: 'corners', gcps: [gcp] } };
}

async function world(stored: 'legacy' | 'valid' | 'broken'): Promise<ImageryWorld> {
    const w = await readyWorld();
    await seedJob(w, JOB, parkedJob());
    const path = FIRESTORE_PATHS.layerVersion(CITY, JOB);
    if (stored === 'valid') {
        await seedVersion(w, JOB, version());
    } else {
        w.deps.documents.seed(path, stored === 'legacy' ? legacy() : { ...legacy(), layerId: 'Not An Id!' });
    }
    return w;
}

describe('a version its schema refuses', () => {
    it('happyPath_theOwnerRejectsItItsJobEndsAndTheLayerIsFree @S-A12-HAPPY-LEGACY-VERSION-ENDS', async () => {
        const w = await world('legacy');
        await expect(refuseBusyLayer(w.deps.documents, CITY, LAYER)).rejects.toMatchObject({ code: 'apiError.layers.busy' });

        await expect(rejectFunction(() => w.deps).run(adminCall({ cityId: CITY, versionId: JOB }))).resolves.toEqual({ state: 'rejected' });

        const ended = await readVersion(w, JOB);
        expect(ended).toMatchObject({ state: 'rejected', layerId: LAYER, updatedBy: 'u-admin' });
        expect([ended?.scan, ended?.georef]).toEqual([undefined, undefined]);
        expect(await readJob(w, JOB)).toMatchObject({ status: 'cancelled' });
        await expect(refuseBusyLayer(w.deps.documents, CITY, LAYER)).resolves.toBeUndefined();
    });

    it('happyPath_aCancelOfItsJobEndsItToo @S-A12-HAPPY-LEGACY-VERSION-ENDS', async () => {
        const w = await world('legacy');

        expect(await cancelJob(w.deps, CITY, JOB)).toBe('cancelled');

        expect((await readVersion(w, JOB))?.state).toBe('cancelled');
        expect((await readJob(w, JOB))?.status).toBe('cancelled');
    });

    it('happyPath_deleteThisVersionRemovesACancelledOneWithItsJob @S-A125-HAPPY-DELETE-VERSION', async () => {
        const w = await readyWorld();
        await seedJob(w, JOB, { ...parkedJob(), status: 'cancelled', waitReason: undefined, cancelRequested: true });
        w.deps.documents.seed(FIRESTORE_PATHS.layerVersion(CITY, JOB), { ...legacy(), state: 'cancelled' });

        await expect(deleteVersionFunction(() => w.deps).run(adminCall({ cityId: CITY, versionId: JOB }))).resolves.toEqual({
            deleted: true,
        });

        expect(await readVersion(w, JOB)).toBeUndefined();
        expect(await readJob(w, JOB)).toBeUndefined();
        await expect(refuseBusyLayer(w.deps.documents, CITY, LAYER)).resolves.toBeUndefined();
    });

    it('happyPath_aValidVersionEndsUnchangedButForItsState', async () => {
        const w = await world('valid');

        await rejectFunction(() => w.deps).run(adminCall({ cityId: CITY, versionId: JOB }));

        expect(await readVersion(w, JOB)).toEqual({ ...version(), state: 'rejected', updatedBy: 'u-admin', updatedAt: at(NOW) });
    });

    it('badPath_aVersionWhoseRequiredFieldsFailIsStillRefusedAndNothingChanges @S-A12-BAD-LEGACY-VERSION-UNREADABLE', async () => {
        const w = await world('broken');

        const failure = await failureOf(rejectFunction(() => w.deps).run(adminCall({ cityId: CITY, versionId: JOB })));

        expect(failure).toMatchObject({ details: { code: 'apiError.internal' } });

        expect((await readJob(w, JOB))?.status).toBe('awaiting_gcps');
    });
});
