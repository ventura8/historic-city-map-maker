/**
 * Title suggestions (`functions/src/assist/suggest-title.ts`, `geocode.ts`; `docs/research/M4-interfaces.md` §4.2): the
 * callable answers from the cache or queues the cell once, the queue's worker asks the fake Nominatim at the cell's
 * centre with the application's User-Agent and caches at most three plain-text titles with the licence, and a refusal
 * cools every request down for ten minutes. The worker runs as Cloud Tasks would run it: `.run()` of the task function.
 */
import {
    ASSIST_GEOCODE_QUEUE,
    FIRESTORE_PATHS,
    GEOCODE_DAILY_CAP,
    GEOCODE_RATE_LIMITS,
    NOMINATIM_ATTRIBUTION,
    NOMINATIM_USER_AGENT,
    assistStateDocSchema,
    geocodeCellDocSchema,
    geocodeCellKey,
    timestampFromDate,
    type GeocodeCellDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GEOCODE_MAX_ATTEMPTS, geocodeCell, geocodeFunction, suggestionsOf } from '../../src/assist/geocode.js';
import { assistFunctions } from '../../src/assist/index.js';
import { cellAnswers, suggestTitleFunction } from '../../src/assist/suggest-title.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, m4Deps, seedCity, type M4Deps } from './world.js';

const NOW = '2026-10-24T08:30:00.000Z';
const ATHENAEUM = { lat: 44.44131, lng: 26.09732 };
const ATHENAEUM_KEY = geocodeCellKey(ATHENAEUM.lat, ATHENAEUM.lng);

function ask(deps: M4Deps, location: { readonly lat: number; readonly lng: number } = ATHENAEUM, uid = 'u-admin') {
    return suggestTitleFunction(() => deps).run(adminCall({ cityId: CITY, location }, uid));
}

/** How many of each world's queued tasks ran already. */
const drained = new WeakMap<M4Deps, number>();

/** The tasks queued since the last drain. */
function fresh(deps: M4Deps) {
    return deps.tasks.queued.slice(drained.get(deps) ?? 0);
}

/** Runs every task queued since the last drain once, as the queue would (one at a time). */
async function drainQueue(deps: M4Deps): Promise<void> {
    const tasks = fresh(deps);
    drained.set(deps, deps.tasks.queued.length);
    for (const task of tasks) {
        await geocodeCell(deps, task.payload as { key: string }, 0);
    }
}

function cell(deps: M4Deps, key = ATHENAEUM_KEY): Promise<GeocodeCellDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.geocodeCell(key), geocodeCellDocSchema);
}

async function world(): Promise<M4Deps> {
    const deps = m4Deps(NOW);
    await seedCity(deps);
    deps.admins.lookups.length = 0;
    return deps;
}

describe('assist.suggestTitle and the geocoding queue', () => {
    it('happyPath_twoAdminsAskingOneCellQueueOneTaskAndOneNominatimCall @S-A45-HAPPY-GEOCODE-QUEUE', async () => {
        const deps = await world();

        const first = await ask(deps);
        const second = await ask(deps, { lat: ATHENAEUM.lat + 0.00002, lng: ATHENAEUM.lng }, 'u-second');

        expect(first).toEqual({ state: 'queued', key: ATHENAEUM_KEY, suggestions: [], attribution: NOMINATIM_ATTRIBUTION });
        expect(second).toEqual(first);
        expect(deps.tasks.queued).toEqual([
            {
                queue: ASSIST_GEOCODE_QUEUE,
                payload: { key: ATHENAEUM_KEY },
                options: { id: `${ATHENAEUM_KEY}-${String(Date.parse(NOW))}` },
            },
        ]);

        await drainQueue(deps);

        const calls = deps.upstream.callsTo('nominatim.reverse');
        expect(calls).toHaveLength(1);
        expect(calls[0]?.headers['user-agent']).toBe(NOMINATIM_USER_AGENT);
        expect(new URL(String(calls[0]?.url)).searchParams.get('lat')).toBe('44.4413');
        expect(new URL(String(calls[0]?.url)).searchParams.get('lon')).toBe('26.0973');
        await expect(cell(deps)).resolves.toMatchObject({
            state: 'ready',
            suggestions: [
                { ro: 'Ateneul Român', en: 'Romanian Athenaeum' },
                { ro: 'Strada Benjamin Franklin, Sector 1' },
                { ro: 'Sector 1' },
            ],
            attribution: NOMINATIM_ATTRIBUTION,
            answeredAt: timestampFromDate(new Date(NOW)),
            expiresAt: timestampFromDate(new Date('2027-01-22T08:30:00.000Z')),
            updatedBy: 'system:assist',
        });

        const cached = await ask(deps);
        expect(cached).toMatchObject({ state: 'ready', suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }, {}, {}] });
        expect(fresh(deps)).toEqual([]);
        expect(deps.upstream.callsTo('nominatim.reverse')).toHaveLength(1);
    });

    it('happyPath_theQueueAsksOneASecondOneAtATimeAndRetriesOnce', () => {
        const options = geocodeFunction(() => m4Deps(NOW)).__endpoint;

        expect(options.taskQueueTrigger).toMatchObject({
            rateLimits: { ...GEOCODE_RATE_LIMITS },
            retryConfig: { maxAttempts: GEOCODE_MAX_ATTEMPTS, minBackoffSeconds: 10 },
        });
        expect(options.serviceAccountEmail).toBe('fn-events@demo-hcm.iam.gserviceaccount.com');
    });

    it('badPath_aRefusalCoolsEveryRequestDownForTenMinutes @S-A45-BAD-GEOCODE-COOLDOWN', async () => {
        const deps = await world();
        deps.upstream.fail('nominatim', 'rateLimited');
        await ask(deps);

        await drainQueue(deps);

        const until = timestampFromDate(new Date('2026-10-24T08:40:00.000Z'));
        await expect(cell(deps)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.rateLimited', expiresAt: until });
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toMatchObject({
            nominatimCoolUntil: until,
        });

        const other = { lat: 44.4325, lng: 26.07 };
        await expect(ask(deps, other)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.rateLimited' });
        await expect(ask(deps)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.rateLimited' });
        expect(fresh(deps)).toEqual([]);
        expect(deps.upstream.callsTo('nominatim.reverse')).toHaveLength(1);

        deps.upstream.fail('nominatim', null);
        deps.clock.set('2026-10-24T08:40:01.000Z');
        await expect(ask(deps, other)).resolves.toMatchObject({ state: 'queued' });
        await drainQueue(deps);
        await expect(cell(deps, geocodeCellKey(other.lat, other.lng))).resolves.toMatchObject({
            state: 'ready',
            suggestions: [{ ro: 'Cotroceni' }],
        });
    });

    it('badPath_anOutageIsRetriedOnceThenTheAdminTypes', async () => {
        const deps = await world();
        deps.upstream.fail('nominatim', 'unavailable');
        await ask(deps);
        const [task] = deps.tasks.queued;

        await expect(geocodeCell(deps, task?.payload as { key: string }, 0)).rejects.toBeInstanceOf(UpstreamError);
        await expect(cell(deps)).resolves.toMatchObject({ state: 'queued' });

        await geocodeCell(deps, task?.payload as { key: string }, 1);

        await expect(cell(deps)).resolves.toMatchObject({
            state: 'failed',
            error: 'apiError.assist.unavailable',
            expiresAt: timestampFromDate(new Date('2026-10-24T08:40:00.000Z')),
        });
        // An outage cools nothing down: the state only counts the cell queued today.
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toEqual({
            queuedDay: '2026-10-24',
            queuedToday: 1,
            updatedBy: 'system:assist',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        deps.clock.set('2026-10-24T08:35:00.000Z');
        await expect(ask(deps)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.unavailable' });
    });
});

describe('assist.suggestTitle: the daily cap and a queue that refuses', () => {
    it('badPath_pastTodaysCapNothingIsQueuedUntilTheNextDay @S-A45-BAD-DAILY-CAP', async () => {
        const deps = await world();
        await deps.documents.set(FIRESTORE_PATHS.assistState, assistStateDocSchema, {
            ...{ queuedDay: '2026-10-24', queuedToday: GEOCODE_DAILY_CAP - 1 },
            ...{ updatedBy: 'system:assist', updatedAt: timestampFromDate(new Date(NOW)) },
        });
        await expect(ask(deps)).resolves.toMatchObject({ state: 'queued' });

        const other = { lat: 44.4325, lng: 26.07 };
        await expect(ask(deps, other)).resolves.toEqual({
            state: 'failed',
            key: geocodeCellKey(other.lat, other.lng),
            suggestions: [],
            attribution: NOMINATIM_ATTRIBUTION,
            error: 'apiError.assist.dailyCap',
        });
        await expect(cell(deps, geocodeCellKey(other.lat, other.lng))).resolves.toBeUndefined();
        expect(deps.tasks.queued).toHaveLength(1);

        // A refusal's cool-down keeps the day's count; the next UTC day counts from one again.
        deps.upstream.fail('nominatim', 'rateLimited');
        await drainQueue(deps);
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toMatchObject({
            queuedToday: GEOCODE_DAILY_CAP,
        });
        deps.upstream.fail('nominatim', null);
        deps.clock.set('2026-10-25T00:00:01.000Z');
        await expect(ask(deps, other)).resolves.toMatchObject({ state: 'queued' });
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toMatchObject({
            queuedDay: '2026-10-25',
            queuedToday: 1,
        });
    });

    it('badPath_aTaskThatCannotBeQueuedTakesItsCellBackSoAskingAgainQueuesIt', async () => {
        const deps = await world();
        deps.tasks.recorder.failNext('enqueue', new UpstreamError('cloud-tasks', 'unavailable'));

        expect(await failureOf(ask(deps))).toMatchObject({ code: 'unavailable', details: { code: 'apiError.unavailable' } });
        await expect(cell(deps)).resolves.toBeUndefined();

        await expect(ask(deps)).resolves.toMatchObject({ state: 'queued' });
        expect(deps.tasks.queued).toHaveLength(1);
    });
});

describe('assist.suggestTitle and the geocoding queue: the edges', () => {
    it('badPath_aPlaceOutsideTheCityIsRefusedAndAnUnknownCityIsNotFound', async () => {
        const deps = await world();

        await expect(failureOf(ask(deps, { lat: 47, lng: 26.1 }))).resolves.toMatchObject({
            code: 'invalid-argument',
            details: { code: 'apiError.invalidRequest', issues: [{ path: 'location', code: 'validation.outsideCity' }] },
        });
        const unknown = suggestTitleFunction(() => deps).run(adminCall({ cityId: 'nowhere', location: ATHENAEUM }));
        await expect(failureOf(unknown)).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
        expect(deps.tasks.queued).toEqual([]);
    });

    it('badPath_aCellStillQueuedFromTwoMinutesAgoIsQueuedAgain', async () => {
        const deps = await world();
        await ask(deps);

        deps.clock.set('2026-10-24T08:31:59.000Z');
        await expect(ask(deps)).resolves.toMatchObject({ state: 'queued' });
        expect(deps.tasks.queued).toHaveLength(1);

        deps.clock.set('2026-10-24T08:32:00.000Z');
        await ask(deps);
        expect(deps.tasks.queued).toHaveLength(2);
    });

    it('badPath_anotherAdminsQueuedCellFoundInTheTransactionQueuesNothingMore', async () => {
        const deps = await world();
        await ask(deps);
        const late: M4Deps = {
            ...deps,
            documents: {
                ...deps.documents,
                get: (path, schema) => (path.startsWith('assistGeocodes/') ? Promise.resolve(undefined) : deps.documents.get(path, schema)),
            },
        };

        await expect(ask(late)).resolves.toMatchObject({ state: 'queued' });
        expect(deps.tasks.queued).toHaveLength(1);
    });

    it('badPath_aCellAnsweredWhileNominatimWasAskedIsLeftAsAnswered', async () => {
        const deps = await world();
        await ask(deps);
        const answered = { ...(await cell(deps)), state: 'ready', suggestions: [{ ro: 'Ateneu' }] } as GeocodeCellDoc;
        const racing: M4Deps = {
            ...deps,
            geocoder: {
                ...deps.geocoder,
                reverse: async (request) => {
                    await deps.documents.set(FIRESTORE_PATHS.geocodeCell(ATHENAEUM_KEY), geocodeCellDocSchema, answered);
                    return deps.geocoder.reverse(request);
                },
            },
        };

        await geocodeCell(racing, { key: ATHENAEUM_KEY }, 0);

        await expect(cell(deps)).resolves.toEqual(answered);
    });

    it('badPath_aTaskForACellAnsweredMeanwhileOrMalformedAsksNobody', async () => {
        const deps = await world();
        await geocodeCell(deps, { key: ATHENAEUM_KEY }, 0);
        await geocodeCell(deps, { key: 'n1_x2' }, 0);

        expect(deps.upstream.callsTo('nominatim.reverse')).toEqual([]);
    });

    it('badPath_aTaskDuringTheCoolDownFailsItsCellWithoutAsking', async () => {
        const deps = await world();
        await ask(deps);
        await deps.documents.set(FIRESTORE_PATHS.assistState, assistStateDocSchema, {
            nominatimCoolUntil: timestampFromDate(new Date('2026-10-24T08:35:00.000Z')),
            updatedBy: 'system:assist',
            updatedAt: timestampFromDate(new Date(NOW)),
        });

        await drainQueue(deps);

        await expect(cell(deps)).resolves.toMatchObject({ state: 'failed', error: 'apiError.assist.rateLimited' });
        expect(deps.upstream.callsTo('nominatim.reverse')).toEqual([]);
    });

    it('badPath_aRefusedTaskPayloadIsLoggedAndDropped', async () => {
        const deps = await world();
        const fn = assistFunctions(() => deps).geocode;

        await fn.run({ data: { key: 'not a key' } } as Parameters<typeof fn.run>[0]);

        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'error', message: 'geocode task refused' });
    });

    it('happyPath_theTaskFunctionAnswersTheCell', async () => {
        const deps = await world();
        await ask(deps);
        const fn = geocodeFunction(() => deps);

        await fn.run({ data: { key: ATHENAEUM_KEY }, retryCount: 0 } as Parameters<typeof fn.run>[0]);

        await expect(cell(deps)).resolves.toMatchObject({ state: 'ready' });
    });
});

describe('suggestionsOf', () => {
    it.each([
        ['nothing found', undefined, []],
        ['a road without its area', { road: 'Calea Victoriei', licence: 'l' }, [{ ro: 'Calea Victoriei' }]],
        [
            'an English name equal to the Romanian, repeats and blanks',
            { name: 'Piața Romană', nameEn: 'Piața Romană', road: 'Piața Romană', area: ' ', licence: 'l' },
            [{ ro: 'Piața Romană' }],
        ],
        [
            'a name with markup and control characters stays plain text within 200',
            { name: `<b>Hanul\u0007 lui Manuc</b>${'x'.repeat(300)}`, licence: 'l' },
            [{ ro: expect.stringMatching(/^<b>Hanul lui Manuc<\/b>x+$/) as unknown as string }],
        ],
    ])('%s', (_name, place, expected) => {
        const suggestions = suggestionsOf(place);

        expect(suggestions).toEqual(expected);
        expect(suggestions.every((suggestion) => suggestion.ro.length <= 200)).toBe(true);
    });
});

describe('cellAnswers', () => {
    it('happyPath_onlyAStoredCellThatHasNotExpiredAnswers', () => {
        const stored: GeocodeCellDoc = {
            state: 'ready',
            suggestions: [],
            attribution: NOMINATIM_ATTRIBUTION,
            requestedAt: timestampFromDate(new Date(NOW)),
            expiresAt: timestampFromDate(new Date('2026-10-25T00:00:00.000Z')),
            updatedBy: 'system:assist',
            updatedAt: timestampFromDate(new Date(NOW)),
        };

        expect(cellAnswers(undefined, new Date(NOW))).toBe(false);
        expect(cellAnswers(stored, new Date(NOW))).toBe(true);
        expect(cellAnswers(stored, new Date('2026-10-26T00:00:00.000Z'))).toBe(false);
    });
});
