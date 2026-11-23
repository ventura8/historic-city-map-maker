import { FIRESTORE_PATHS, jobDocSchema, layerVersionDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { VersionPage, type VersionPageState } from '../../src/imagery/version.js';
import { approvalFigures, jobViewOf, versionViewOf } from '../../src/imagery/version-view.js';
import { failure, settle } from '../app/fakes.js';
import { answer, at, CITY, callsOf, imageryWorld, JOBS, jobDoc, VERSIONS, versionDoc } from './world.js';

const ID = 'job-1966-0712';
const MONTH = 'usage/mapbox-2026-10';

function page() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    let state: VersionPageState | null = null;
    const version = new VersionPage(world.services, world.files, (next) => {
        state = next;
    });
    return { ...world, version, state: () => state };
}

function stored<T>(id: string, data: T) {
    return { id, path: id, data, version: '', pending: false };
}

describe('the version page', () => {
    it('happyPath_theVersionItsJobItsLogAndTheMonthsUsageLive', () => {
        const { version, store, state } = page();
        store.docs.set(VERSIONS(ID), versionDoc());
        store.docs.set(JOBS(ID), jobDoc({ status: 'awaiting_approval', waitReason: 'approval', progress: 1 }));
        store.docs.set(`${FIRESTORE_PATHS.jobLogs(CITY, ID)}/000001`, {
            ...{ seq: 1, level: 'info', step: 'register', message: 'rendered' },
            ...{ updatedBy: 'system:pipeline', updatedAt: at('2026-10-20T09:01:00Z') },
        });
        store.docs.set(MONTH, {
            month: '2026-10',
            computeUnits: 4,
            computeUnitBudget: 20,
            uploadedMb: 10,
            publishes: 1,
            updatedBy: 'system:imagery',
            updatedAt: at('2026-10-20T08:00:00Z'),
        });

        version.show(ID);
        version.show(ID);

        const shown = state();
        expect(shown?.version.doc?.data).toMatchObject({ id: ID, state: 'awaiting_approval', layerId: 'kh-4a-corona-1966' });
        expect(shown?.job.doc?.data).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval', finished: false });
        expect(shown?.logs.items.map((line) => line.message)).toEqual(['rendered']);
        expect(shown?.usage).toEqual({ computeUnits: 4, computeUnitBudget: 20, overageComputeUnits: 0, reservations: {} });
        version.show(null);
        expect([state(), store.listeners()]).toEqual([null, 0]);
    });

    it('happyPath_approveRejectChooseAndStudioDoneCallTheirCallables', async () => {
        const { version, store, callables, notices } = page();
        store.docs.set(VERSIONS(ID), versionDoc());
        answer(callables, 'imagery.approve', () => ({ state: 'approved', jobId: ID }));
        answer(callables, 'imagery.reject', () => ({ state: 'rejected' }));
        answer(callables, 'imagery.choose', () => ({ state: 'awaiting_approval', studioPath: 'rasters/x/studio.tif' }));
        answer(callables, 'imagery.studioDone', () => ({ tilesetId: 'e2e.hcm-bucharest-x', layerId: 'x' }));
        answer(callables, 'imagery.retry', () => ({ status: 'queued', attempt: 1 }));
        answer(callables, 'imagery.locateAgain', () => ({ status: 'queued', attempt: 1 }));
        answer(callables, 'imagery.relayout', () => ({ jobId: 'ar-new', versionId: 'ar-new' }));
        version.show(ID);

        const done = [
            await version.approve(),
            await version.reject(),
            await version.choose('studio'),
            await version.studioDone(),
            await version.retry(),
            await version.locateAgain(),
            await version.fixTiles(),
        ];

        expect(done).toEqual([true, true, true, true, true, true, true]);
        expect(callsOf(callables, 'imagery.choose')).toEqual([{ cityId: 'bucharest', versionId: ID, choice: 'studio' }]);
        expect(callsOf(callables, 'imagery.retry')).toEqual([{ cityId: 'bucharest', jobId: ID }]);
        expect(callsOf(callables, 'imagery.locateAgain')).toEqual([{ cityId: 'bucharest', versionId: ID }]);
        expect(callsOf(callables, 'imagery.relayout')).toEqual([{ cityId: 'bucharest', versionId: ID }]);
        expect(notices.map((notice) => notice.key)).toEqual([
            'adminContent.imagery.notice.approved',
            'adminContent.imagery.notice.rejected',
            'adminContent.imagery.notice.chose.studio',
            'adminContent.imagery.notice.studioLinked',
            'adminContent.imagery.notice.retrying',
            'adminContent.imagery.notice.locating',
            'adminContent.imagery.notice.fixingTiles',
        ]);
    });
});

describe('the version page: dismissing and what it cannot stop', () => {
    it('happyPath_aFailedVersionIsDismissedThroughReject', async () => {
        const { version, store, callables, notices } = page();
        store.docs.set(VERSIONS(ID), versionDoc({ state: 'failed', error: { code: 'apiError.imagery.mtsRefused' } }));
        answer(callables, 'imagery.reject', () => ({ state: 'rejected' }));
        version.show(ID);

        await expect(version.reject()).resolves.toBe(true);

        expect(callsOf(callables, 'imagery.reject')).toEqual([{ cityId: 'bucharest', versionId: ID }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.dismissed']);
    });

    it('badPath_aJobMapboxIsProcessingIsNotAskedToStop', async () => {
        const { version, store } = page();
        store.docs.set(
            VERSIONS(ID),
            versionDoc({ state: 'publishing', approval: { auto: true, by: 'system:imagery', at: at('2026-10-20T08:00:00Z') } }),
        );
        store.docs.set(JOBS(ID), jobDoc({ status: 'mts_processing', mapboxJobId: 'mts-1' }));
        version.show(ID);

        await expect(version.cancel()).resolves.toBe(false);
        expect(store.docs.get(JOBS(ID))?.['cancelRequested']).toBeUndefined();
    });

    it('badPath_aRefusalStaysOnTheCardAndASecondActionWaitsForTheFirst', async () => {
        const { version, store, callables, state } = page();
        store.docs.set(VERSIONS(ID), versionDoc());
        let release: () => void = () => undefined;
        callables.answer(
            'imagery.approve' as never,
            (() =>
                new Promise((_resolve, reject) => {
                    release = () => {
                        reject(failure('failed-precondition', 'apiError.imagery.versionState'));
                    };
                })) as never,
        );
        version.show(ID);

        const approving = version.approve();
        const second = await version.reject();
        release();
        const first = await approving;

        expect([first, second]).toEqual([false, false]);
        expect(state()?.refusal).toEqual({ key: 'apiError.imagery.versionState' });
        expect(state()?.acting).toBeNull();
    });

    it('happyPath_theStudioFileIsSavedUnderItsTilesetsName', async () => {
        const { version, store, files, state } = page();
        store.docs.set(VERSIONS(ID), versionDoc());
        version.show(ID);
        const missing = await version.download();
        files.put('rasters/bucharest/kh-4a-corona-1966/job-1966-0712/studio.tif');

        const saved = await version.download();

        expect([missing, saved]).toEqual([false, true]);
        expect(files.saved).toEqual([
            { path: 'rasters/bucharest/kh-4a-corona-1966/job-1966-0712/studio.tif', name: 'hcm-bucharest-kh-4a-corona-1966.tif' },
        ]);
        expect(state()?.downloaded).toBe(true);
    });

    it('badPath_aVersionWithoutAStudioFileOrNoPageDownloadsNothing', async () => {
        const { version, store } = page();
        const doc = versionDoc();
        const output = { ...(doc['output'] as Record<string, unknown>) };
        delete output['studioPath'];
        store.docs.set(VERSIONS(ID), { ...doc, output });

        const closed = await version.download();
        version.show(ID);

        expect([closed, await version.download(), await version.approve()]).toEqual([false, false, false]);
    });
});

describe('the version page: cancelling and its read', () => {
    it('happyPath_cancelAsksAnUnfinishedJobToStopOnceAndAFinishedOneNot', async () => {
        const { version, store, notices } = page();
        store.docs.set(JOBS(ID), jobDoc());
        version.show(ID);

        const asked = await version.cancel();
        const again = await version.cancel();
        store.docs.set(JOBS('done'), jobDoc({ status: 'succeeded' }));
        version.show('done');
        const finished = await version.cancel();

        expect([asked, again, finished]).toEqual([true, false, false]);
        expect(store.writes).toEqual([{ kind: 'update', path: JOBS(ID), fields: { cancelRequested: true }, expected: null }]);
        expect(notices).toEqual([{ key: 'adminContent.jobs.cancelRequested' }]);
    });

    it('badPath_aDeniedReadOfTheVersionMakesTheShellAsk', () => {
        const { version, store, denials } = page();
        version.show(ID);

        store.fail(VERSIONS(ID), { kind: 'denied', code: 'permission-denied' });

        expect([denials.count, version.state?.version.status]).toEqual([1, 'error']);
    });

    it('badPath_aRefusedCancellationSaysSoAndTheListenersComeBack', async () => {
        const { version, store, state } = page();
        store.docs.set(JOBS(ID), jobDoc());
        store.outcomes.push({ ok: false, reason: 'denied' });
        version.show(ID);

        const refused = await version.cancel();
        store.fail(VERSIONS(ID), { kind: 'failed', code: 'internal' });
        const failed = state()?.version.status;
        version.retryListeners();

        expect(refused).toBe(false);
        expect(state()?.refusal).toEqual({ key: 'adminContent.imagery.notice.cancelRefused' });
        expect([failed, state()?.version.status]).toEqual(['error', 'ready']);
        await settle();
    });
});

describe('a version and its job as the page reads them', () => {
    it('happyPath_theStepsInTheirTypesOrderAndAnUnknownErrorCodeIsInternal', () => {
        const job = jobDocSchema.parse(
            jobDoc({
                status: 'failed',
                steps: { fetch: { status: 'done' }, extract: { status: 'failed' } },
                error: { code: 'usgs.down', message: 'USGS did not answer' },
            }),
        );
        const coded = jobDocSchema.parse(
            jobDoc({ status: 'failed', error: { code: 'apiError.imagery.noMatch', message: 'too few', params: { pairs: '3' } } }),
        );

        const view = jobViewOf(stored(ID, job));
        expect(view.steps.slice(0, 3)).toEqual([
            { name: 'fetch', status: 'done', transfer: null },
            { name: 'extract', status: 'failed', transfer: null },
            { name: 'stitch', status: 'pending', transfer: null },
        ]);
        expect(view.error).toEqual({ notice: { key: 'apiError.internal' }, message: 'USGS did not answer' });
        expect(jobViewOf(stored(ID, coded)).error?.notice).toEqual({ key: 'apiError.imagery.noMatch', params: { pairs: '3' } });
        expect(
            jobViewOf(stored(ID, jobDocSchema.parse(jobDoc({ error: { code: 'apiError.unavailable', message: 'x' } })))).error?.notice,
        ).toEqual({
            key: 'apiError.unavailable',
        });
    });

    it('happyPath_aRunningDownloadShowsItsBytesOfTheTotalOrItsBytesAlone', () => {
        const view = (fetch: Record<string, unknown>) =>
            jobViewOf(stored(ID, jobDocSchema.parse(jobDoc({ status: 'running', step: 'fetch', steps: { fetch } })))).steps[0]?.transfer;

        expect(view({ status: 'running', bytes: 1_200_000_000, totalBytes: 3_400_000_000 })).toEqual({
            received: 1_200_000_000,
            total: 3_400_000_000,
        });
        expect(view({ status: 'running', bytes: 5_000_000 })).toEqual({ received: 5_000_000, total: null });
        // Before its first report, and once done (its bytes are then the delivery's size), nothing is shown.
        expect(view({ status: 'running' })).toBeNull();
        expect(view({ status: 'done', bytes: 3_400_000_000 })).toBeNull();
    });

    it('happyPath_whatAJobViewSaysOfItsRetryMapboxAndARefusedUpload', () => {
        const view = (overrides: Record<string, unknown>) => jobViewOf(stored(ID, jobDocSchema.parse(jobDoc(overrides))));
        const failed = { status: 'failed', layerId: 'kh-4a-corona-1966', attempt: 1, error: { code: 'apiError.internal', message: 'x' } };

        expect(view(failed)).toMatchObject({ retryable: true, atMapbox: false, refusedUpload: false });
        expect(view({ ...failed, error: { code: 'apiError.mapbox.missingScopes', message: 'x' } }).retryable).toBe(false);
        expect(view({ status: 'mts_processing', mapboxJobId: 'mts-1' }).atMapbox).toBe(true);
        expect(view({ status: 'mts_processing', steps: { publish: { status: 'running' } } }).atMapbox).toBe(true);
        expect(view({ status: 'mts_processing', steps: { upload: { status: 'done' } } }).atMapbox).toBe(false);
        const refused = {
            type: 'geotiff-import',
            status: 'failed',
            layerId: undefined,
            error: { code: 'apiError.imagery.notTiff', message: 'x' },
        };
        expect(view(refused)).toMatchObject({ refusedUpload: true, retryable: false });
    });

    it('happyPath_theApprovalFiguresAgainstTheMonthAndTheThreshold', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());
        const view = versionViewOf(stored(ID, doc));
        const usage = { computeUnits: 18, computeUnitBudget: 20, overageComputeUnits: 0, reservations: { other: { computeUnits: 1 } } };

        const figures = approvalFigures(view, usage, 15);

        expect(view.estimate).toBeGreaterThan(0);
        expect(figures).toMatchObject({ available: 1, thresholdM: 15 });
        expect(figures.fits).toBe((view.estimate ?? 0) <= 1);
        expect(approvalFigures({ ...view, georef: null, estimate: null }, undefined, 15)).toMatchObject({
            ...{ checkpointRmseM: null, overThreshold: true, available: 20 },
            ...{ estimate: null, fits: true },
        });
        const stepless = jobDocSchema.parse(jobDoc({ steps: undefined, type: 'republish' }));
        expect(jobViewOf(stored('r', stepless)).steps.map((step) => step.status)).toEqual([
            'pending',
            'pending',
            'pending',
            'pending',
            'pending',
        ]);
    });

    it('happyPath_aVersionWithItsGuardApprovalAndErrorAndOneWithNone', () => {
        const base = layerVersionDocSchema.parse(versionDoc());
        const guarded = {
            ...base,
            estimate: { computeUnits: 3.5, precision: '30cm' as const, areaKm2: 100, at: base.updatedAt },
            guard: {
                verdict: 'over' as const,
                available: 1,
                overageUsd: 2.25,
                choice: 'defer' as const,
                deferUntil: at('2026-11-01T00:00:00Z'),
                checkedAt: base.updatedAt,
            },
            approval: { auto: false, by: 'admin-uid', at: base.updatedAt },
            error: { code: 'apiError.imagery.mtsRefused' as const, params: { reason: 'recipe' } },
        };
        const bare = {
            ...base,
            state: 'processing' as const,
            output: undefined,
            georef: undefined,
            scan: undefined,
            error: { code: 'apiError.internal' as const },
        };

        const full = versionViewOf(stored(ID, guarded));
        const empty = versionViewOf(stored(ID, bare));

        expect(full).toMatchObject({
            estimate: 3.5,
            guard: { verdict: 'over', available: 1, overageUsd: 2.25, choice: 'defer', deferUntil: '2026-11-01T00:00:00.000Z' },
            approval: { auto: false, by: 'admin-uid' },
            error: { key: 'apiError.imagery.mtsRefused', params: { reason: 'recipe' } },
        });
        expect(empty).toMatchObject({
            output: null,
            georef: null,
            estimate: null,
            guard: null,
            approval: null,
            hasScan: false,
            error: { key: 'apiError.internal' },
            rights: null,
        });
    });
});

describe('M20 rights on a version view', () => {
    it('happyPath_rightsSummaryForConfirmAndApprove @S-A120-HAPPY-CONFIRM-RIGHTS', () => {
        const base = layerVersionDocSchema.parse(versionDoc());
        const waiting = {
            ...base,
            rights: {
                licence: 'unknown' as const,
                state: 'needs-confirmation' as const,
                year: '1977',
                note: 'Confirm where it came from.',
            },
        };
        const cleared = {
            ...waiting,
            rights: {
                ...waiting.rights,
                licence: 'permission' as const,
                state: 'clear' as const,
                confirmedBy: 'Idei Urbane',
                confirmedAt: base.updatedAt,
            },
        };

        expect(versionViewOf(stored(ID, waiting)).rights).toEqual({
            state: 'needs-confirmation',
            licence: 'unknown',
            year: '1977',
            note: 'Confirm where it came from.',
            confirmedBy: null,
            allowPublish: false,
        });
        expect(versionViewOf(stored(ID, cleared)).rights).toMatchObject({
            state: 'clear',
            licence: 'permission',
            confirmedBy: 'Idei Urbane',
            allowPublish: true,
        });
    });
});

describe('a job lost in a step as the page reads it (findings 60 and 61 of 2026-11-02)', () => {
    it('badPath_aStepAFailedJobLeftRunningIsFailedAndAMessageThatIsOnlyTheCodeIsNotShown @S-A16-BAD-FAILED-STEP', () => {
        // Findings 60 and 61 of 2026-11-02: the tick failed a job whose run died in georef (out of memory on xl), writing the
        // code as the message.
        const georef = { status: 'running', bytes: 5_000_000 };
        const job = jobDocSchema.parse(
            jobDoc({
                status: 'failed',
                steps: { fetch: { status: 'done' }, georef },
                error: { code: 'apiError.imagery.outOfMemory', message: 'apiError.imagery.outOfMemory' },
            }),
        );

        const view = jobViewOf(stored(ID, job));

        expect(view.steps.find((step) => step.name === 'georef')).toEqual({ name: 'georef', status: 'failed', transfer: null });
        expect(view.error).toEqual({ notice: { key: 'apiError.imagery.outOfMemory' }, message: '' });
        const other = jobDocSchema.parse(
            jobDoc({ status: 'failed', error: { code: 'apiError.internal', message: 'apiError.unavailable' } }),
        );
        expect(jobViewOf(stored(ID, other)).error?.message).toBe('');
        // The owner's rule of 2026-11-13: an archive series' missing files show the plain sentence alone, never the archive's id.
        const missing = jobDocSchema.parse(
            jobDoc({
                status: 'failed',
                error: { code: 'apiError.imagery.archiveMissing', message: 'no record of ar-0123456789abcdef on this computer' },
            }),
        );
        expect(jobViewOf(stored(ID, missing)).error).toEqual({ notice: { key: 'apiError.imagery.archiveMissing' }, message: '' });
        // A running job's running step stays running.
        expect(jobViewOf(stored(ID, jobDocSchema.parse(jobDoc({ status: 'running', steps: { georef } })))).steps[5]?.status).toBe(
            'running',
        );
    });
});

describe('what calibration measured, as the page reads it (M9)', () => {
    it('happyPath_whatCalibrationMeasured_andAVersionItNeverSaw', () => {
        const base = layerVersionDocSchema.parse(versionDoc());
        const georef = { method: 'auto', transform: 'affine', gcps: [], checkpointKind: 'held-out' };
        const calibration = { how: 'votes', tiles: { agreed: 712, tried: 946 }, crossValidatedM: 16.3, coveredPct: 62 };
        const view = versionViewOf(stored(ID, { ...base, georef, calibration } as never));

        expect(view.calibration).toEqual(calibration);
        expect(view.georef?.checkpointKind).toBe('held-out');
        expect(versionViewOf(stored(ID, { ...base, calibration: { how: 'none', refusal: 'no-votes' } } as never)).calibration).toEqual({
            how: 'none',
            refusal: 'no-votes',
        });
        expect(versionViewOf(stored(ID, { ...base, calibration: undefined })).calibration).toBeNull();
    });
});

describe('a job view at its attempt cap (live report of 2026-11-12)', () => {
    it('happyPath_aLocalRunAtItsCapOffersTryAgain_aCloudRunDoesNot @S-A12-HAPPY-LOCAL-RETRY-PAST-CAP @S-A12-BAD-CLOUD-RETRY-AT-CAP', () => {
        const view = (overrides: Record<string, unknown>) => jobViewOf(stored(ID, jobDocSchema.parse(jobDoc(overrides))));
        const atCap = { status: 'failed', layerId: 'kh-4a-corona-1966', attempt: 3, error: { code: 'apiError.internal', message: 'x' } };

        expect(view({ ...atCap, runOn: 'local' }).retryable).toBe(true);
        expect(view({ ...atCap, runOn: 'cloud' }).retryable).toBe(false);
        expect(view(atCap).retryable).toBe(false);
    });

    it('happyPath_redrawSendsTheVersionsOwnPointsAgain @S-A16-HAPPY-REDRAW', async () => {
        const { version, store, callables, notices } = page();
        const doc = versionDoc();
        store.docs.set(VERSIONS(ID), { ...doc, crop: [{ lat: 44.4, lng: 26.0 }, { lat: 44.5, lng: 26.0 }, { lat: 44.5, lng: 26.1 }] });
        answer(callables, 'imagery.saveGcps', () => ({ jobId: 'rg-new', versionId: 'rg-new', resumed: false }));
        version.show(ID);

        expect(await version.redraw()).toBe(true);
        const georef = (doc as { georef: { transform: string; gcps: unknown[] } }).georef;
        expect(callsOf(callables, 'imagery.saveGcps')).toEqual([
            { cityId: CITY, versionId: ID, transform: georef.transform, gcps: georef.gcps, crop: [{ lat: 44.4, lng: 26.0 }, { lat: 44.5, lng: 26.0 }, { lat: 44.5, lng: 26.1 }] },
        ]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.redrawing']);
    });

    it('badPath_aVersionWithNoPointsIsNotRedrawn @S-A16-BAD-REDRAW', async () => {
        const { version, store, callables } = page();
        const doc = { ...versionDoc() } as Record<string, unknown>;
        delete doc['georef'];
        store.docs.set(VERSIONS(ID), doc);
        version.show(ID);

        expect(await version.redraw()).toBe(false);
        expect(callsOf(callables, 'imagery.saveGcps')).toEqual([]);
    });
});
