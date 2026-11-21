/**
 * The order watch, `imagery.tick`'s step `orders` (`functions/src/imagery/orders/watch.ts`, `docs/research/M4-interfaces.md`
 * §1.5): the orders due asked about once a day in one USGS session, per dataset; a delivery imported by itself (by the
 * admin who ordered it) and its end noticed; reminders on days 7 and 12 and the give-up on day 90, each told once; USGS
 * failures retried sooner; and the import alone waiting while the budget guard is red or today's jobs are used up.
 */
import {
    FIRESTORE_PATHS,
    JOBS_PER_DAY,
    acquisitionState,
    notificationEventDocSchema,
    setupStatusDocSchema,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { rejectFunction } from '../../src/imagery/approve.js';
import { cancelJob } from '../../src/imagery/cancel.js';
import { endWork } from '../../src/imagery/end.js';
import { runImageryTick } from '../../src/imagery/tick.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { adminCall } from '../publish/fakes.js';
import {
    CORONA_EE_ID,
    ORDERED_BY,
    PAID,
    PAID_DECLASSII,
    after,
    cancelOrder,
    events,
    listDownload,
    order,
    seedPaid,
    stampAfter,
} from './orders-world.js';
import {
    CITY,
    NOW,
    readJob,
    readScene,
    readVersion,
    readyWorld,
    renderedVersion,
    seedGuard,
    seedJob,
    seedSetup,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB_ID = (iso: string, entityId = PAID) => `im-${Date.parse(iso).toString(36)}-${entityId}`;

/** A `usgs-import` job of the bought scene, waiting. */
function importJob(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'queued',
        params: { entityId: PAID, dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: ORDERED_BY,
        createdAt: stampAfter(0),
        layerId: 'corona-1968',
        versionId: 'im-1',
        updatedBy: ORDERED_BY,
        updatedAt: stampAfter(0),
        ...overrides,
    };
}

/** A version made from the bought scene. */
function usgsSource(): Pick<LayerVersionDoc, 'source'> {
    return { source: { kind: 'usgs', entityId: PAID, dataset: 'corona2', sensor: 'KH-4A', acquisitionDate: '1968-12-11' } };
}

/** The tick at `iso`. */
async function tickAt(world: ImageryWorld, iso: string): Promise<string[]> {
    world.deps.clock.set(iso);
    return runImageryTick(world.deps);
}

describe('an import that ended for good', () => {
    it('happyPath_aCancelledImportOffersImportAgain_andTheWatchDoesNotStartIt @S-A13-HAPPY-ORDER-FREED', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, {
            downloadAvailable: true,
            status: 'imported',
            layerId: 'corona-1968',
            order: order({ state: 'importing', importJobId: 'im-1', deliveredAt: stampAfter(0) }),
        });
        await seedJob(world, 'im-1', importJob());
        await seedVersion(world, 'im-1', renderedVersion({ layerId: 'corona-1968', jobId: 'im-1', state: 'processing' }));

        expect(await cancelJob(world.deps, CITY, 'im-1')).toBe('cancelled');

        const scene = await readScene(world, PAID);
        expect(scene).toMatchObject({ status: 'candidate', downloadAvailable: true });
        expect(scene?.layerId).toBeUndefined();
        expect(scene?.order).toBeUndefined();
        expect(scene === undefined ? undefined : acquisitionState(scene)).toBe('available');

        expect(await tickAt(world, after(1))).toEqual([]);

        expect((await readScene(world, PAID))?.status).toBe('candidate');
        expect(world.deps.documents.paths(`cities/${CITY}/jobs/`)).toEqual([`cities/${CITY}/jobs/im-1`]);
    });

    it('happyPath_aDismissedImportFreesItsOrder_withNoImportedAnnounced @S-A13-HAPPY-ORDER-FREED', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, {
            downloadAvailable: true,
            status: 'imported',
            layerId: 'corona-1968',
            order: order({ state: 'importing', importJobId: 'im-1' }),
        });
        await seedJob(world, 'im-1', importJob({ status: 'failed' }));
        await seedVersion(
            world,
            'im-1',
            renderedVersion({
                ...usgsSource(),
                layerId: 'corona-1968',
                jobId: 'im-1',
                state: 'failed',
                error: { code: 'apiError.imagery.cityNotFound' },
            }),
        );

        await rejectFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: 'im-1' }));
        expect(await tickAt(world, after(1))).toEqual([]);

        const scene = await readScene(world, PAID);
        expect(scene).toMatchObject({ status: 'candidate' });
        expect(scene?.order).toBeUndefined();
        expect((await events(world)).has(`order.imported~${CITY}~${PAID}`)).toBe(false);
    });

    it('badPath_aRejectedVersionIsNotAnnouncedImported_whileAnotherVersionKeepsTheScene @S-A13-HAPPY-ORDER-FREED', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, {
            status: 'imported',
            layerId: 'corona-1968',
            order: order({ state: 'importing', importJobId: 'im-1' }),
        });
        await seedVersion(world, 'im-1', renderedVersion({ layerId: 'corona-1968', jobId: 'im-1', state: 'rejected' }));
        await seedVersion(world, 'rg-1', renderedVersion({ layerId: 'corona-1968', jobId: 'rg-1', state: 'processing' }));

        expect(await tickAt(world, NOW)).toEqual([]);

        expect((await readScene(world, PAID))?.order?.state).toBe('importing');
        expect((await events(world)).has(`order.imported~${CITY}~${PAID}`)).toBe(false);
    });

    it('badPath_aServerSideFailureKeepsTheSceneAndItsOrder_aRetryMayYetMakeTheLayer', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, {
            downloadAvailable: true,
            status: 'imported',
            layerId: 'corona-1968',
            order: order({ state: 'importing', importJobId: 'im-1' }),
        });
        await seedJob(world, 'im-1', importJob());
        await seedVersion(world, 'im-1', renderedVersion({ layerId: 'corona-1968', jobId: 'im-1', state: 'processing' }));

        const error = { code: 'apiError.internal', message: 'x' } as const;
        await endWork(world.deps, CITY, 'im-1', { status: 'failed', versionState: 'failed', by: 'system:imagery', error });

        expect((await readVersion(world, 'im-1'))?.state).toBe('failed');
        expect(await readScene(world, PAID)).toMatchObject({ status: 'imported', layerId: 'corona-1968', order: { state: 'importing' } });
    });
});

describe('asking USGS', () => {
    it('happyPath_dueOrdersAreAskedOnceADayInOneSessionPerDataset @S-A13-HAPPY-WATCH', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order() });
        await seedPaid(world, 'DS1105-1071DF077', { order: order({ state: 'reminder', remindersSent: [7], orderedAt: stampAfter(-8) }) });
        await seedPaid(world, PAID_DECLASSII, { dataset: 'declassii', sensor: 'KH-9-mapping', order: order() });
        await seedPaid(world, 'DS-NOT-DUE', { order: order({ nextCheckAt: stampAfter(2) }) });

        expect(await tickAt(world, after(1))).toEqual([]);

        expect(world.usgs.recorder.argsOf('login')).toHaveLength(1);
        expect(world.usgs.sessions.size).toBe(0);
        expect(world.scenes.recorder.argsOf('downloadOptions').map(([, dataset, ids]) => [dataset, ids])).toEqual([
            ['corona2', [PAID, 'DS1105-1071DF077']],
            ['declassii', [PAID_DECLASSII]],
        ]);
        expect((await readScene(world, PAID))?.order).toMatchObject({
            checks: 1,
            lastCheckedAt: stampAfter(1),
            nextCheckAt: stampAfter(2),
        });
        expect((await readScene(world, 'DS-NOT-DUE'))?.order?.checks).toBe(0);
        expect((await readScene(world, PAID))?.updatedBy).toBe('system:imagery');

        // The same day again: nothing is due.
        await tickAt(world, after(1, 5));
        expect(world.scenes.recorder.argsOf('downloadOptions')).toHaveLength(2);
    });

    it('happyPath_atMostFiftyOrdersAreAskedARun', async () => {
        const world = await readyWorld();
        const ids = Array.from({ length: 51 }, (_unused, index) => `DS-PAID-${String(index).padStart(2, '0')}`);
        for (const id of ids) {
            await seedPaid(world, id, { order: order() });
        }

        await tickAt(world, after(1));

        expect(world.scenes.recorder.argsOf('downloadOptions')[0]?.[2]).toHaveLength(50);
        expect((await readScene(world, 'DS-PAID-50'))?.order?.checks).toBe(0);
    });

    it('happyPath_aDeliveryIsImportedByWhoOrderedItAndItsEndNoticed @S-A13-HAPPY-WATCH', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order() });
        listDownload(world, PAID, true);

        await tickAt(world, after(1));

        const jobId = JOB_ID(after(1));
        const scene = await readScene(world, PAID);
        expect(scene?.order).toMatchObject({ state: 'importing', importJobId: jobId, deliveredAt: stampAfter(1) });
        expect(scene).toMatchObject({ status: 'imported', downloadAvailable: true, eeDatasetId: CORONA_EE_ID });
        expect(await readJob(world, jobId)).toMatchObject({ type: 'usgs-import', createdBy: ORDERED_BY, params: { entityId: PAID } });
        const delivered = (await events(world)).get(`order.delivered~${CITY}~${PAID}`);
        expect(delivered).toMatchObject({
            kind: 'order.delivered',
            severity: 'info',
            cityId: CITY,
            params: { scene: 'KH-4A Corona 1968-12-11' },
            link: `#/imagery/scene/${PAID}`,
            updatedBy: 'system:imagery',
        });

        // The pipeline runs; while the version is processing the order stays importing, once it waits for approval it is imported.
        await tickAt(world, after(1, 1));
        expect((await readScene(world, PAID))?.order?.state).toBe('importing');
        const version = await readVersion(world, jobId);
        expect(version?.state).toBe('processing');
        await seedVersion(world, jobId, renderedVersion({ ...version, state: 'awaiting_approval' }));
        await tickAt(world, after(1, 2));

        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'imported', importedAt: stampAfter(1, 2) });
        expect((await events(world)).get(`order.imported~${CITY}~${PAID}`)).toMatchObject({ link: `#/imagery/version/${jobId}` });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toHaveLength(1);
    });

    it('badPath_maintenanceRetriesSoonerAndTheDaySevenReminderIsStillSent @S-A13-BAD-USGS-DOWN', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order({ nextCheckAt: stampAfter(7) }) });
        world.scenes.recorder.failNext('downloadOptions', new UpstreamError('usgs', 'maintenance', { status: 503 }));

        await tickAt(world, after(7));

        const recorded = (await readScene(world, PAID))?.order;
        expect(recorded).toMatchObject({
            state: 'reminder',
            remindersSent: [7],
            lastError: 'apiError.usgs.maintenance',
            nextCheckAt: stampAfter(7, 6),
        });
        const reminders = [...(await events(world)).keys()];
        expect(reminders).toEqual([`order.reminder~${CITY}~${PAID}~7~${String(Date.parse(NOW))}`]);
        expect((await events(world)).get(reminders[0] ?? '')).toMatchObject({ severity: 'warning', params: { days: '7' } });
    });

    it('badPath_aRefusedLoginIsEveryOrdersFailureAndMarksSetup', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order() });
        world.usgs.recorder.failNext('login', new UpstreamError('usgs', 'unauthorized', { status: 403 }));

        await tickAt(world, after(1));

        expect((await readScene(world, PAID))?.order).toMatchObject({
            lastError: 'apiError.usgs.credentials',
            nextCheckAt: stampAfter(1, 6),
        });
        const status = await world.deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema);
        expect(status?.usgs?.state).toBe('invalid');

        // Setup's card is no longer ok: the next tick asks nothing.
        await tickAt(world, after(1, 7));
        expect(world.usgs.recorder.argsOf('login')).toHaveLength(1);
    });

    it('badPath_aFailureUsgsDidNotExplainIsUsgsNotAnswering', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order() });
        world.scenes.recorder.failNext('downloadOptions', new Error('socket hang up'));

        await tickAt(world, after(1));

        expect((await readScene(world, PAID))?.order).toMatchObject({
            lastError: 'apiError.usgs.unavailable',
            nextCheckAt: stampAfter(1, 6),
        });
    });

    it('badPath_beforeDownloadsAreApprovedNothingIsAskedButRemindersGoOut', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });

        await tickAt(world, after(7));

        expect(world.usgs.recorder.argsOf('login')).toEqual([]);
        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'reminder', checks: 0 });
    });
});

describe('reminders and the give-up', () => {
    it('happyPath_daysSevenAndTwelveAreRemindedOnceEach', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });

        await tickAt(world, after(6, 23));
        expect((await events(world)).size).toBe(0);
        await tickAt(world, after(7));
        await tickAt(world, after(7, 1));
        await tickAt(world, after(12));
        await tickAt(world, after(13));

        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'reminder', remindersSent: [7, 12] });
        expect([...(await events(world)).keys()].map((id) => id.split('~')[3])).toEqual(['12', '7']);
    });

    it('happyPath_aWatchThatMissedDaySevenSendsDayTwelveOnly', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });

        await tickAt(world, after(12));

        expect((await readScene(world, PAID))?.order?.remindersSent).toEqual([12]);
        expect((await events(world)).size).toBe(1);
    });

    it('badPath_anOrderNeverDeliveredExpiresOnDayNinetyAndIsToldOnce @S-A13-BAD-EXPIRED', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order({ state: 'reminder', remindersSent: [7, 12], nextCheckAt: stampAfter(91) }) });

        await tickAt(world, after(90));
        await tickAt(world, after(92));

        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'expired', expiredAt: stampAfter(90) });
        const expired = [...(await events(world)).values()].filter((event) => event.kind === 'order.expired');
        expect(expired).toHaveLength(1);
        expect(expired[0]).toMatchObject({ params: { days: '90' }, severity: 'warning' });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toEqual([]);
    });
});

describe('the import of a delivery', () => {
    it('badPath_aDeliveryWhileTheGuardIsRedWaitsThenImportsOnce @S-A13-BAD-GUARD-PAUSED', async () => {
        const world = await readyWorld();
        await seedGuard(world, 'red');
        await seedPaid(world, PAID, { order: order() });
        listDownload(world, PAID, true);

        await tickAt(world, after(1));
        expect((await readScene(world, PAID))?.order?.state).toBe('delivered');
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);

        await seedGuard(world, 'green');
        await tickAt(world, after(1, 1));
        await tickAt(world, after(1, 2));

        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([FIRESTORE_PATHS.job(CITY, JOB_ID(after(1, 1)))]);
        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'importing', importJobId: JOB_ID(after(1, 1)) });
    });

    it('badPath_aDeliveryOnceTodaysJobsAreUsedUpImportsTheNextDay @S-A13-BAD-GUARD-PAUSED', async () => {
        const world = await readyWorld();
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await seedJob(world, `job-${String(index)}`, {
                type: 'usgs-import',
                status: 'succeeded',
                params: {},
                createdBy: 'u-admin',
                createdAt: stampAfter(1),
                updatedBy: 'u-admin',
                updatedAt: stampAfter(1),
            });
        }
        await seedPaid(world, PAID, { order: order({ state: 'delivered' }) });

        await tickAt(world, after(1, 1));
        expect((await readScene(world, PAID))?.order?.state).toBe('delivered');
        await tickAt(world, after(2));
        expect((await readScene(world, PAID))?.order?.state).toBe('importing');
    });

    it('badPath_aFailedImportKeepsTheOrderImportingAndOneBrokenOrderStopsNoOther', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order({ state: 'importing', importJobId: 'im-failed' }) });
        await seedVersion(
            world,
            'im-failed',
            renderedVersion({ layerId: 'corona-1968', jobId: 'im-failed', state: 'failed', error: { code: 'apiError.internal' } }),
        );
        await seedPaid(world, 'DS-NO-JOB', { order: order({ state: 'importing' }) });
        await seedPaid(world, 'DS-GONE', { order: order({ state: 'importing', importJobId: 'im-gone' }) });
        // Imported by hand already: its import refuses, the others still move on.
        await seedPaid(world, 'DS-BROKEN', { status: 'imported', layerId: 'corona-1968', order: order({ state: 'delivered' }) });
        await seedPaid(world, 'DS-DUE', { order: order({ nextCheckAt: stampAfter(-1) }) });

        expect(await tickAt(world, NOW)).toEqual([]);

        expect((await readScene(world, PAID))?.order?.state).toBe('importing');
        expect((await readScene(world, 'DS-NO-JOB'))?.order?.state).toBe('importing');
        expect((await readScene(world, 'DS-GONE'))?.order?.state).toBe('importing');
        expect((await readScene(world, 'DS-BROKEN'))?.order?.state).toBe('delivered');
        expect((await readScene(world, 'DS-DUE'))?.order?.checks).toBe(1);
        expect(world.deps.recording.records.map((record) => record.message)).toContain('an order did not move on');
    });

    it('badPath_aNotificationThatCannotBeWrittenIsLoggedAndTheOrderStillMoves', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });
        world.deps.documents.recorder.failNext('create', new UpstreamError('firestore', 'unavailable'));

        await tickAt(world, after(7));

        expect((await readScene(world, PAID))?.order?.state).toBe('reminder');
        expect((await events(world)).size).toBe(0);
        expect(world.deps.recording.records.map((record) => record.message)).toContain('order notification not written');
    });
});

describe('races', () => {
    it('badPath_anOrderTakenBackWhileUsgsIsAskedIsLeftAlone', async () => {
        const world = await readyWorld();
        await seedPaid(world, PAID, { order: order() });
        listDownload(world, PAID, true);
        const ask = world.deps.scenes.downloadOptions.bind(world.deps.scenes);
        const racing: ImageryWorld = {
            ...world,
            deps: {
                ...world.deps,
                scenes: {
                    ...world.deps.scenes,
                    downloadOptions: async (...args) => {
                        await cancelOrder(world);
                        return ask(...args);
                    },
                },
            },
        };

        racing.deps.clock.set(after(1));
        await runImageryTick(racing.deps);

        expect((await readScene(world, PAID))?.order).toBeUndefined();
        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
        expect((await events(world)).size).toBe(0);
    });

    it('badPath_anOrderThatMovedOnMeanwhileIsNotRemindedTwice', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });
        const transaction = world.deps.documents.transaction.bind(world.deps.documents);
        const racing: ImageryWorld = {
            ...world,
            deps: {
                ...world.deps,
                documents: Object.assign(Object.create(world.deps.documents) as typeof world.deps.documents, {
                    transaction: async <R>(work: Parameters<typeof transaction<R>>[0]): Promise<R> => {
                        await seedPaid(world, PAID, { order: order({ state: 'reminder', remindersSent: [7] }) });
                        return transaction(work);
                    },
                }),
            },
        };

        racing.deps.clock.set(after(7));
        await runImageryTick(racing.deps);

        expect((await readScene(world, PAID))?.order?.remindersSent).toEqual([7]);
        expect((await events(world)).size).toBe(0);
    });

    it('badPath_anEventAlreadyWrittenIsNotWrittenAgain', async () => {
        const world = await readyWorld();
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        await seedPaid(world, PAID, { order: order() });
        const id = `order.reminder~${CITY}~${PAID}~7~${String(Date.parse(NOW))}`;
        await world.deps.documents.create(FIRESTORE_PATHS.notificationEvent(id), notificationEventDocSchema, {
            kind: 'order.reminder',
            severity: 'warning',
            cityId: CITY,
            params: { scene: 'KH-4A Corona 1968-12-11', days: '7' },
            link: `#/imagery/scene/${PAID}`,
            createdAt: stampAfter(-1),
            updatedBy: 'system:imagery',
            updatedAt: stampAfter(-1),
        });

        await tickAt(world, after(7));

        expect((await events(world)).get(id)?.createdAt).toEqual(stampAfter(-1));
        expect(world.deps.recording.records.map((record) => record.message)).not.toContain('order notification not written');
    });
});
