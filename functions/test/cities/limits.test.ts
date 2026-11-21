/**
 * Each city's share of the project's budgets (M5-interfaces §1.8): the compute units of a month (the publish guard),
 * the AI drafts of a month and the title suggestions of a day, counted in `cities/{city}/usage/{month}` beside the
 * project's own counters; a city without limits is held by the project's caps alone.
 */
import {
    DEFAULT_NEW_CITY_LIMITS,
    FIRESTORE_PATHS,
    cityUsageDocSchema,
    geocodeCellKey,
    timestampFromDate,
    type CityUsageDoc,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { suggestTitleFunction } from '../../src/assist/suggest-title.js';
import { translateDraftFunction } from '../../src/assist/translate-draft.js';
import { runPublishTask } from '../../src/imagery/publish.js';
import { failureOf } from '../admin/world.js';
import { CITY as ASSIST_CITY, m4Deps, seedCity as seedAssistCity, type M4Deps } from '../assist/world.js';
import {
    CITY,
    NOW,
    at,
    goldenGeoref,
    goldenOutput,
    readJob,
    readVersion,
    readyWorld,
    renderedVersion,
    seedCity,
    seedJob,
    seedVersion,
    type ImageryWorld,
} from '../imagery/world.js';
import { adminCall } from '../publish/fakes.js';

const JOB = 'job-1966-0712';
const LAYER = 'kh-4a-corona-1966';

function awaitingJob(): JobDoc {
    return {
        type: 'usgs-import',
        status: 'awaiting_approval',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: LAYER,
        versionId: JOB,
        waitReason: 'approval',
        machine: 'std',
        attempt: 1,
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
    };
}

/** An approved version over 100 km²: 4 compute units at z16, within the project's free month. */
async function approvedWorld(computeUnitsPerMonth: number): Promise<ImageryWorld> {
    const world = await readyWorld();
    await seedCity(world, { limits: { ...DEFAULT_NEW_CITY_LIMITS, computeUnitsPerMonth } });
    await seedJob(world, JOB, awaitingJob());
    const version = renderedVersion({
        output: { ...goldenOutput(), areaKm2: 100 },
        georef: { ...goldenGeoref(), checkpointCount: 3 },
        state: 'approved',
        approval: { auto: false, by: 'u-admin', at: at(NOW) },
    });
    await seedVersion(world, JOB, { ...version, jobId: JOB });
    world.deps.blobs.put('private', version.output?.cogPath ?? 'x', new Uint8Array(4096).fill(7), { contentType: 'image/tiff' });
    return world;
}

function start(world: ImageryWorld) {
    return runPublishTask(world.deps, { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 });
}

function cityUsage(
    documents: ImageryWorld['deps']['documents'] | M4Deps['documents'],
    cityId: string,
    month: string,
): Promise<CityUsageDoc | undefined> {
    return documents.get(FIRESTORE_PATHS.cityUsage(cityId, month), cityUsageDocSchema);
}

describe('the city share of compute units', () => {
    it('badPath_aPublishOverTheCitysShareWaitsThoughTheProjectHasRoom @S-A52-BAD-CITY-OVER', async () => {
        const world = await approvedWorld(3);

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved', guard: { verdict: 'city-over', available: 3 } });
        expect(await readJob(world, JOB)).toMatchObject({ waitReason: 'compute-units' });
        expect(world.tilesets.recorder.calls).toEqual([]);
    });

    it('happyPath_withinTheCitysShareThePublishGoesOnAndTheShareHoldsItsEstimate @S-A52-BAD-CITY-OVER', async () => {
        const world = await approvedWorld(5);

        await start(world);

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'publishing' });
        await expect(cityUsage(world.deps.documents, CITY, '2026-10')).resolves.toMatchObject({
            reservations: { [JOB]: { computeUnits: 4 } },
            computeUnits: 0,
        });
    });
});

describe('the city share of AI drafts and title suggestions', () => {
    const NOW_M4 = '2026-10-24T08:30:00.000Z';

    async function assistWorld(limits: Partial<typeof DEFAULT_NEW_CITY_LIMITS>): Promise<M4Deps> {
        const deps = m4Deps(NOW_M4);
        await seedAssistCity(deps, { limits: { ...DEFAULT_NEW_CITY_LIMITS, ...limits } });
        return deps;
    }

    function draft(deps: M4Deps) {
        const data = { cityId: ASSIST_CITY, field: 'title', from: 'ro', to: 'en', text: 'Ateneul Român' };
        return translateDraftFunction(() => deps).run(adminCall(data));
    }

    function ask(deps: M4Deps, location: { readonly lat: number; readonly lng: number }) {
        return suggestTitleFunction(() => deps).run(adminCall({ cityId: ASSIST_CITY, location }));
    }

    it('badPath_aCitysAiRequestsStopAtItsMonthlyShare', async () => {
        const deps = await assistWorld({ aiRequestsPerMonth: 1 });

        await expect(draft(deps)).resolves.toMatchObject({ truncated: false });
        const failure = await failureOf(draft(deps));

        expect(failure).toMatchObject({ details: { code: 'apiError.assist.monthlyCap' } });
        await expect(cityUsage(deps.documents, ASSIST_CITY, '2026-10')).resolves.toMatchObject({ aiRequests: 1 });
    });

    it('badPath_aCitysTitleSuggestionsStopAtItsDailyShareAndCountAgainTheNextDay', async () => {
        const deps = await assistWorld({ geocodeCellsPerDay: 1 });
        const first = { lat: 44.44131, lng: 26.09732 };
        const second = { lat: 44.4355, lng: 26.1025 };

        await expect(ask(deps, first)).resolves.toMatchObject({ state: 'queued' });
        await expect(ask(deps, second)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.dailyCap' });
        deps.clock.set('2026-10-25T00:00:01.000Z');
        await expect(ask(deps, second)).resolves.toMatchObject({ state: 'queued', key: geocodeCellKey(second.lat, second.lng) });

        await expect(cityUsage(deps.documents, ASSIST_CITY, '2026-10')).resolves.toMatchObject({
            geocodeDay: '2026-10-25',
            geocodeToday: 1,
        });
    });

    it('happyPath_aStoredCounterOfTheMonthIsKept', async () => {
        const deps = await assistWorld({ aiRequestsPerMonth: 5 });
        await deps.documents.set(FIRESTORE_PATHS.cityUsage(ASSIST_CITY, '2026-10'), cityUsageDocSchema, {
            month: '2026-10',
            computeUnits: 2,
            aiRequests: 4,
            updatedBy: 'system:imagery',
            updatedAt: timestampFromDate(new Date(NOW_M4)),
        });

        await draft(deps);

        await expect(cityUsage(deps.documents, ASSIST_CITY, '2026-10')).resolves.toMatchObject({ computeUnits: 2, aiRequests: 5 });
    });
});
