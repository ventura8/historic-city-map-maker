/**
 * `export.start` (`functions/src/export/start.ts`, M5 §5.3; behaviour A53): a city's owner records an export and queues
 * its build; a city never published, a red guard, an export under way, the day's exports used up and an editor are
 * refused, and nothing is recorded or queued.
 */
import { EXPORT_QUEUE, FIRESTORE_PATHS, opsGuardDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { exportIdFor, exportStartFunction, exportTaskId } from '../../src/export/start.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, NOW, OWNER, exportWorld, publish, readExport, seedCity, seedExport, type ExportWorld } from './world.js';

const TODAY = 'x-20261102';

function start(world: ExportWorld, data: unknown = { cityId: CITY, rasters: false }) {
    return exportStartFunction(() => world).run(adminCall(data, OWNER));
}

async function publishedWorld(...args: Parameters<typeof exportWorld>): Promise<ExportWorld> {
    const world = exportWorld(...args);
    await seedCity(world);
    publish(world);
    return world;
}

describe('export.start', () => {
    it('happyPath_aCityOwnerQueuesTheExport', async () => {
        const world = await publishedWorld();

        await expect(start(world, { cityId: CITY, rasters: true })).resolves.toEqual({ exportId: `${TODAY}-1` });

        expect(await readExport(world, `${TODAY}-1`)).toEqual({
            state: 'queued',
            requestedBy: OWNER,
            rasters: true,
            engineVersion: '1.0.0',
            createdAt: timestampFromDate(new Date(NOW)),
            updatedBy: OWNER,
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect(world.tasks.queued).toEqual([
            { queue: EXPORT_QUEUE, payload: { cityId: CITY, exportId: `${TODAY}-1` }, options: { id: `${CITY}--${TODAY}-1` } },
        ]);
    });

    it('happyPath_theDaysSecondExportAfterAFinishedOneIsNumberedTwo', async () => {
        const world = await publishedWorld();
        await seedExport(world, `${TODAY}-1`, { state: 'ready' });

        await expect(start(world)).resolves.toEqual({ exportId: `${TODAY}-2` });
    });

    it('happyPath_anExportStuckPastItsBuildTimeNoLongerBlocks', async () => {
        const world = await publishedWorld();
        await seedExport(world, 'x-20261101-1', { state: 'building', createdAt: timestampFromDate(new Date('2026-11-01T09:00:00Z')) });

        await expect(start(world)).resolves.toEqual({ exportId: `${TODAY}-1` });
    });

    it('badPath_anExportUnderWayIsBusy', async () => {
        const world = await publishedWorld();
        await seedExport(world, `${TODAY}-1`, { state: 'building' });

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.export.busy' } });
        expect(world.tasks.queued).toEqual([]);
    });

    it('badPath_twoOwnersRacingForTheSameExportGetBusy', async () => {
        const world = await publishedWorld();
        // The other owner's export was created between this one's count and its create.
        const count = world.documents.count.bind(world.documents);
        world.documents.count = async (...args) => {
            const before = await count(...args);
            await seedExport(world, `${TODAY}-1`, { state: 'ready' });
            return before;
        };

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.export.busy' } });
        expect(world.tasks.queued).toEqual([]);
    });

    it('badPath_theFourthExportOfTheDayIsRefused @S-A53-BAD-DAILY-LIMIT', async () => {
        const world = await publishedWorld();
        for (const ordinal of [1, 2, 3]) {
            await seedExport(world, `${TODAY}-${String(ordinal)}`, {
                state: ordinal === 3 ? 'failed' : 'ready',
                error: 'apiError.internal',
            });
        }

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({
            code: 'resource-exhausted',
            details: { code: 'apiError.export.dailyLimit', params: { limit: '3' } },
        });
        expect(await readExport(world, `${TODAY}-4`)).toBeUndefined();
    });

    it('badPath_theCitysOwnShareOfExportsHolds @S-A53-BAD-DAILY-LIMIT', async () => {
        const world = exportWorld();
        await seedCity(world, {
            limits: { computeUnitsPerMonth: 0, rasterJobsPerDay: 0, aiRequestsPerMonth: 0, geocodeCellsPerDay: 0, exportsPerDay: 1 },
        });
        publish(world);
        await seedExport(world, `${TODAY}-1`, { state: 'ready' });

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.export.dailyLimit', params: { limit: '1' } } });
    });

    it('badPath_anEditorCannotExport @S-A53-BAD-EDITOR', async () => {
        const world = await publishedWorld({ projectRole: 'admin', cities: { [CITY]: 'editor' } });

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.city.notOwner', params: { cityId: CITY } } });
        expect(world.documents.paths(FIRESTORE_PATHS.cityExports(CITY))).toEqual([]);
    });

    it('badPath_anAdminOfAnotherCityIsNotAMember', async () => {
        const world = await publishedWorld({ projectRole: 'admin', cities: { cluj: 'owner' } });

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.city.notMember', params: { cityId: CITY } } });
    });

    it('badPath_aCityNeverPublishedIsRefused', async () => {
        const world = exportWorld();
        await seedCity(world);

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.export.noManifest' } });
        expect(world.tasks.queued).toEqual([]);
    });

    it('badPath_aCityWithoutItsDocumentIsNotFound', async () => {
        const world = exportWorld();
        publish(world);

        await expect(failureOf(start(world))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it('badPath_aRedBudgetGuardPausesExports', async () => {
        const world = await publishedWorld();
        await world.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'red',
            reason: 'budget',
            updatedBy: 'system:ops',
            updatedAt: timestampFromDate(new Date(NOW)),
        });

        await expect(failureOf(start(world))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('badPath_aTaskThatCannotBeQueuedLeavesAFailedRecord', async () => {
        const world = await publishedWorld();
        world.tasks.enqueue = () => Promise.reject(new Error('Cloud Tasks is down'));

        const failure = await failureOf(start(world));

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.unavailable' } });
        expect(await readExport(world, `${TODAY}-1`)).toMatchObject({
            state: 'failed',
            error: 'apiError.unavailable',
            updatedBy: 'system:export',
        });
    });

    it('badPath_anInvalidRequestIsRefusedBeforeAnyRead', async () => {
        const world = await publishedWorld();

        await expect(failureOf(start(world, { cityId: CITY }))).resolves.toMatchObject({ details: { code: 'apiError.invalidRequest' } });
    });
});

describe('the export ids', () => {
    it('happyPath_theDayAndItsOrdinal_andTheTaskNamesTheCity', () => {
        expect(exportIdFor(new Date('2026-01-09T23:59:59Z'), 3)).toBe('x-20260109-3');
        expect(exportTaskId('cluj', 'x-20260109-3')).toBe('cluj--x-20260109-3');
    });
});
