/**
 * The order callables (`functions/src/imagery/orders/{mark,check-now,take-back}.ts`, `docs/research/M4-interfaces.md`
 * §1.4): "I ordered it" records the admin's purchase in EarthExplorer once USGS confirms the scene still has to be bought,
 * "Check now" does for one order what the daily watch does (a delivery starts the import at once), "Take the mark back"
 * removes an order USGS has not delivered. Every refusal leaves the scene as it was.
 */
import { FIRESTORE_PATHS, JOBS_PER_DAY, setupStatusDocSchema, usgsSceneDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import {
    CORONA_EE_ID,
    ORDERED_BY,
    PAID,
    after,
    cancelOrder,
    checkOrder,
    events,
    listDownload,
    markOrdered,
    order,
    seedPaid,
    stampAfter,
} from './orders-world.js';
import { CITY, NOW, at, readJob, readScene, readVersion, readyWorld, seedGuard, seedJob, seedSetup, type ImageryWorld } from './world.js';

const MAINTENANCE = new UpstreamError('usgs', 'maintenance', { status: 503 });

async function paidWorld(overrides: Parameters<typeof seedPaid>[2] = {}): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedPaid(world, PAID, overrides);
    return world;
}

describe('usgs.markOrdered', () => {
    it('happyPath_iOrderedItRecordsTheOrderForTheWatch', async () => {
        const world = await paidWorld();
        listDownload(world, PAID, false);

        const response = await markOrdered(world);

        expect(response).toEqual({ state: 'ordered', nextCheckAt: after(1) });
        const scene = await readScene(world, PAID);
        expect(scene?.order).toEqual({
            state: 'ordered',
            orderedAt: at(NOW),
            orderedBy: 'u-admin',
            checks: 0,
            nextCheckAt: stampAfter(1),
            remindersSent: [],
        });
        expect(scene).toMatchObject({ eeDatasetId: CORONA_EE_ID, downloadAvailable: false, updatedBy: 'u-admin', updatedAt: at(NOW) });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toEqual([[expect.any(String), 'corona2', [PAID]]]);
        expect(world.usgs.sessions.size).toBe(0);
    });

    it('badPath_aSceneUsgsNowOffersBecomesFreeInsteadOfOrdered @S-A13-BAD-MARK-AVAILABLE-REFUSED', async () => {
        const world = await paidWorld();
        listDownload(world, PAID, true);

        const failure = await failureOf(markOrdered(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.usgs.alreadyAvailable' } });
        const scene = await readScene(world, PAID);
        expect(scene?.order).toBeUndefined();
        expect(scene).toMatchObject({ downloadAvailable: true, eeDatasetId: CORONA_EE_ID, updatedBy: 'system:imagery' });
        expect(scene?.rank.reasons[0]).toEqual({ code: 'free' });
    });

    it('badPath_aWatchedOrderOrAnImportedOrAFreeSceneIsNotMarked @S-A13-BAD-MARK-AVAILABLE-REFUSED', async () => {
        const world = await paidWorld({ order: order() });
        await seedPaid(world, 'DS-IMPORTED', { status: 'imported', layerId: 'corona-1968' });
        await seedPaid(world, 'DS-FREE', { downloadAvailable: true });

        expect(await failureOf(markOrdered(world))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        expect(await failureOf(markOrdered(world, 'DS-IMPORTED'))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        expect(await failureOf(markOrdered(world, 'DS-FREE'))).toMatchObject({ details: { code: 'apiError.usgs.alreadyAvailable' } });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toEqual([]);
        expect((await readScene(world, PAID))?.order).toEqual(order());
    });

    it('happyPath_usgsNotAnsweringStillRecordsTheMark', async () => {
        const world = await paidWorld({ dataset: 'declassiii', sensor: 'KH-9-pan' });
        world.scenes.recorder.failNext('downloadOptions', MAINTENANCE);

        await expect(markOrdered(world)).resolves.toMatchObject({ state: 'ordered' });

        const scene = await readScene(world, PAID);
        expect(scene?.order?.state).toBe('ordered');
        expect(scene?.eeDatasetId).toBeUndefined();
        expect(world.usgs.sessions.size).toBe(0);
    });

    it('happyPath_beforeDownloadsAreApprovedUsgsIsNotAsked', async () => {
        const world = await paidWorld({ eeDatasetId: CORONA_EE_ID });
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });

        await expect(markOrdered(world)).resolves.toMatchObject({ state: 'ordered' });

        expect(world.usgs.recorder.argsOf('login')).toEqual([]);
        expect((await readScene(world, PAID))?.eeDatasetId).toBe(CORONA_EE_ID);
    });

    it('happyPath_anExpiredOrderIsOrderedAgainFromTheStart', async () => {
        const world = await paidWorld({
            order: order({ state: 'expired', orderedAt: stampAfter(-95), remindersSent: [7, 12], checks: 90 }),
        });
        listDownload(world, PAID, false);

        await markOrdered(world);

        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'ordered', orderedAt: at(NOW), checks: 0, remindersSent: [] });
    });

    it('badPath_anUnknownSceneOrCityOrUsgsNotSetUp', async () => {
        const world = await paidWorld();

        expect(await failureOf(markOrdered(world, 'DS-NONE'))).toMatchObject({ code: 'not-found' });
        await seedSetup(world, { usgs: { state: 'missing' } });
        expect(await failureOf(markOrdered(world))).toMatchObject({ details: { code: 'apiError.usgs.notConfigured' } });
    });

    it('badPath_whatChangedWhileUsgsWasAskedIsReadAgain', async () => {
        const world = await paidWorld();
        const path = FIRESTORE_PATHS.usgsScene(CITY, PAID);
        const ask = world.deps.scenes.downloadOptions.bind(world.deps.scenes);
        const racing = (change: () => Promise<void>): ImageryWorld => ({
            ...world,
            deps: {
                ...world.deps,
                scenes: {
                    ...world.deps.scenes,
                    downloadOptions: async (...args) => {
                        await change();
                        return ask(...args);
                    },
                },
            },
        });
        const scene = await world.deps.documents.get(path, usgsSceneDocSchema);
        if (scene === undefined) {
            throw new Error('the paid scene was not seeded');
        }

        // Another admin marked it meanwhile; then it was deleted meanwhile.
        const marked = racing(() => world.deps.documents.set(path, usgsSceneDocSchema, { ...scene, order: order() }));
        expect(await failureOf(markOrdered(marked))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        await world.deps.documents.set(path, usgsSceneDocSchema, scene);
        const deleted = racing(() => world.deps.documents.delete(path));
        expect(await failureOf(markOrdered(deleted))).toMatchObject({ code: 'not-found' });
    });
});

describe('usgs.checkOrder', () => {
    it('happyPath_checkNowAfterExpiryFindsTheDeliveryAndImportsAsUsual @S-A13-BAD-EXPIRED', async () => {
        const world = await paidWorld({ order: order({ state: 'expired', orderedAt: stampAfter(-91), expiredAt: stampAfter(-1) }) });
        listDownload(world, PAID, true);

        const response = await checkOrder(world);

        const jobId = `im-${Date.parse(NOW).toString(36)}-${PAID}`;
        expect(response).toEqual({ state: 'importing', available: true, jobId });
        expect(await readJob(world, jobId)).toMatchObject({ type: 'usgs-import', status: 'queued', createdBy: ORDERED_BY });
        expect(await readVersion(world, jobId)).toMatchObject({ state: 'processing', origin: 'usgs' });
        const scene = await readScene(world, PAID);
        expect(scene).toMatchObject({ status: 'imported', downloadAvailable: true, eeDatasetId: CORONA_EE_ID });
        expect(scene?.order).toMatchObject({ state: 'importing', importJobId: jobId, checks: 1, deliveredAt: at(NOW) });
        expect([...(await events(world)).keys()]).toEqual([`order.delivered~${CITY}~${PAID}`]);
    });

    it('happyPath_checkNowBeforeUsgsDeliversSaysSo', async () => {
        const world = await paidWorld({ order: order({ state: 'reminder', remindersSent: [7], lastError: 'apiError.usgs.maintenance' }) });
        listDownload(world, PAID, false);

        await expect(checkOrder(world)).resolves.toEqual({ state: 'reminder', available: false });

        const recorded = (await readScene(world, PAID))?.order;
        expect(recorded).toMatchObject({ checks: 1, lastCheckedAt: at(NOW), nextCheckAt: stampAfter(1) });
        expect(recorded?.lastError).toBeUndefined();
        expect((await readScene(world, PAID))?.updatedBy).toBe('u-admin');
    });

    it('happyPath_fromOrderPageImportsWhenM2mStillSaysUnavailable', async () => {
        const world = await paidWorld({ order: order({ state: 'reminder', remindersSent: [7] }) });
        listDownload(world, PAID, false);

        const response = await checkOrder(world, PAID, true);

        const jobId = `im-${Date.parse(NOW).toString(36)}-${PAID}`;
        expect(response).toEqual({ state: 'importing', available: true, jobId });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toHaveLength(0);
        expect(await readJob(world, jobId)).toMatchObject({ type: 'usgs-import', status: 'queued' });
        expect((await readScene(world, PAID))?.downloadAvailable).toBe(true);
    });

    it('badPath_checkNowTwiceWithinAMinuteAsksUsgsOnce @S-A13-BAD-CHECK-NOW-TOO-OFTEN', async () => {
        const world = await paidWorld({ order: order() });
        listDownload(world, PAID, false);
        await checkOrder(world);

        world.deps.clock.set(new Date(Date.parse(NOW) + 59_000).toISOString());
        const failure = await failureOf(checkOrder(world));

        expect(failure).toMatchObject({ code: 'resource-exhausted', details: { code: 'apiError.rateLimited' } });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toHaveLength(1);
        world.deps.clock.set(new Date(Date.parse(NOW) + 61_000).toISOString());
        await expect(checkOrder(world)).resolves.toMatchObject({ available: false });
    });

    it('badPath_checkNowDuringMaintenanceRecordsItAndSaysSo', async () => {
        const world = await paidWorld({ order: order() });
        world.scenes.recorder.failNext('downloadOptions', MAINTENANCE);

        const failure = await failureOf(checkOrder(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.usgs.maintenance' } });
        expect((await readScene(world, PAID))?.order).toMatchObject({
            state: 'ordered',
            checks: 1,
            lastError: 'apiError.usgs.maintenance',
            nextCheckAt: stampAfter(0, 6),
        });
    });

    it('badPath_aRefusedTokenMarksSetupsUsgsCard', async () => {
        const world = await paidWorld({ order: order() });
        world.usgs.recorder.failNext('login', new UpstreamError('usgs', 'unauthorized', { status: 403 }));

        const failure = await failureOf(checkOrder(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.usgs.credentials' } });
        expect((await readScene(world, PAID))?.order?.lastError).toBe('apiError.usgs.credentials');
        const status = await world.deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema);
        expect(status?.usgs).toMatchObject({ state: 'invalid', detail: 'apiError.usgs.credentials' });
    });

    it('badPath_onlyAnOpenOrderIsCheckedOnceDownloadsAreApproved', async () => {
        const world = await paidWorld();
        await seedPaid(world, 'DS-DELIVERED', { order: order({ state: 'delivered' }) });

        expect(await failureOf(checkOrder(world))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        expect(await failureOf(checkOrder(world, 'DS-DELIVERED'))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        await seedPaid(world, PAID, { order: order() });
        await seedSetup(world, { usgs: { state: 'pending', role: 'search' } });
        expect(await failureOf(checkOrder(world))).toMatchObject({ details: { code: 'apiError.usgs.accessPending' } });
        expect(world.scenes.recorder.argsOf('downloadOptions')).toEqual([]);
    });

    it('badPath_aDeliveryWhileTheGuardIsRedWaitsForTheTick @S-A13-BAD-GUARD-PAUSED', async () => {
        const world = await paidWorld({ order: order() });
        await seedGuard(world, 'red');
        listDownload(world, PAID, true);

        await expect(checkOrder(world)).resolves.toEqual({ state: 'delivered', available: true });

        expect(world.deps.documents.paths(FIRESTORE_PATHS.jobs(CITY))).toEqual([]);
        expect((await readScene(world, PAID))?.order?.state).toBe('delivered');
    });

    it('badPath_aDeliveryOnceTodaysJobsAreUsedUpWaitsToo @S-A13-BAD-GUARD-PAUSED', async () => {
        const world = await paidWorld({ order: order() });
        for (let index = 0; index < JOBS_PER_DAY; index += 1) {
            await seedJob(world, `job-${String(index)}`, {
                type: 'usgs-import',
                status: 'succeeded',
                params: {},
                createdBy: 'u-admin',
                createdAt: at(NOW),
                updatedBy: 'u-admin',
                updatedAt: at(NOW),
            });
        }
        listDownload(world, PAID, true);

        await expect(checkOrder(world)).resolves.toEqual({ state: 'delivered', available: true });
        expect((await readScene(world, PAID))?.order?.state).toBe('delivered');
    });
});

describe('usgs.cancelOrder', () => {
    it('happyPath_theMarkIsTakenBackAndTheSceneKeepsTheRest @S-A13-HAPPY-TAKE-BACK', async () => {
        const world = await paidWorld({
            order: order({ state: 'reminder', remindersSent: [7] }),
            eeDatasetId: CORONA_EE_ID,
            note: 'Greșeală.',
        });

        await expect(cancelOrder(world)).resolves.toEqual({ state: 'needsOrder' });

        const scene = await readScene(world, PAID);
        expect(scene?.order).toBeUndefined();
        expect(scene).toMatchObject({ eeDatasetId: CORONA_EE_ID, note: 'Greșeală.', updatedBy: 'u-admin', status: 'candidate' });
    });

    it('badPath_aDeliveredOrderOrNoneCannotBeTakenBack', async () => {
        const world = await paidWorld();
        await seedPaid(world, 'DS-IMPORTING', { order: order({ state: 'importing', importJobId: 'im-1' }) });

        expect(await failureOf(cancelOrder(world))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        expect(await failureOf(cancelOrder(world, 'DS-IMPORTING'))).toMatchObject({ details: { code: 'apiError.usgs.orderState' } });
        expect(await failureOf(cancelOrder(world, 'DS-NONE'))).toMatchObject({ code: 'not-found' });
        expect((await readScene(world, 'DS-IMPORTING'))?.order?.state).toBe('importing');
    });
});
