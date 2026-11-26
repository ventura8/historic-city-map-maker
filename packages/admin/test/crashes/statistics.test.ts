import { describe, expect, it } from 'vitest';

import { CRASHES_MODULE } from '../../src/crashes/crashes.js';
import {
    createStatistics,
    NO_STATISTICS_SOURCE,
    problemOf,
    STATISTICS_INITIAL,
    type StatisticsConsent,
    type StatisticsSource,
    type StatisticsState,
} from '../../src/crashes/statistics.js';
import type { StatisticsNumbers } from '../../src/google/analytics-data.js';
import { StatisticsProblem } from '../../src/google/statistics-problem.js';
import { GoogleApiError } from '../../src/google/failure.js';
import { failure } from '../app/fakes.js';
import { contentWorld } from '../content/world.js';

/**
 * §203: the Statistics view's numbers: Google's consent on the click, the measurement id once, the numbers per period kept
 * for the session, and every failure as one plain problem.
 */

const TOKEN = { token: 'e2e-analytics-read-token', expiresAt: 4_000_000_000_000 };

function numbers(visitors: number): StatisticsNumbers {
    return {
        visitors,
        sessions: visitors,
        pages: [],
        screens: [],
        events: [],
        devices: [],
        countries: [],
        surfaces: [],
        steps: [],
        pending: null,
    };
}

async function settled(): Promise<void> {
    for (let round = 0; round < 20; round += 1) {
        await Promise.resolve();
    }
}

interface Script {
    consent?: StatisticsConsent;
    live?: boolean;
    measurementId?: string | null | Error;
    read?: (days: number) => StatisticsNumbers | Error;
}

function scripted(script: Script) {
    const asked: string[] = [];
    const reads: number[] = [];
    const reported: string[] = [];
    let granted = script.live === true;
    const source: StatisticsSource = {
        ask: () => {
            asked.push('consent');
            const consent = script.consent ?? { granted: true, access: TOKEN };
            granted = consent.granted;
            return Promise.resolve(consent);
        },
        live: () => (granted ? TOKEN : null),
        measurementId: () => {
            asked.push('measurementId');
            const id = script.measurementId === undefined ? 'G-E2E0000000' : script.measurementId;
            return id instanceof Error ? Promise.reject(id) : Promise.resolve(id);
        },
        read: (_access, _id, days) => {
            reads.push(days);
            const answer = script.read?.(days) ?? numbers(days);
            return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
        },
        report: (code) => {
            reported.push(code);
        },
    };
    let state: StatisticsState = STATISTICS_INITIAL;
    const intents = createStatistics(
        source,
        () => state,
        (patch) => {
            state = { ...state, ...patch };
        },
    );
    return { intents, asked, reads, reported, state: () => state };
}

describe('the Statistics numbers', () => {
    it('happyPath_incompleteNumbersShowAndTheirReasonIsReported_completeOnesReportNothing', async () => {
        const pending = { ...numbers(28), pending: { reason: 'notReady' as const, names: ['app_surface'] } };
        const world = scripted({ read: () => pending });
        world.intents.showNumbers();
        await settled();
        expect(world.state()).toMatchObject({ status: 'ready', numbers: { pending: { reason: 'notReady' } } });
        expect(world.reported).toEqual(['statistics_notReady']);

        const complete = scripted({});
        complete.intents.showNumbers();
        await settled();
        expect(complete.reported).toEqual([]);
    });

    it('badPath_aRefusedReadAndARefusedConsentAreReportedByTheirReason', async () => {
        const refused = scripted({ read: () => new GoogleApiError('analytics-data.batchRunReports', { kind: 'invalid', status: 400 }) });
        refused.intents.showNumbers();
        await settled();
        expect(refused.state()).toMatchObject({ status: 'error', problem: 'refused' });
        expect(refused.reported).toEqual(['statistics_refused']);

        const closed = scripted({ consent: { granted: false, failure: 'popupClosed' } });
        closed.intents.showNumbers();
        await settled();
        expect(closed.reported).toEqual(['statistics_consent']);
    });

    it('happyPath_theClickAsksGoogleOnceThenReadsAndEachPeriodIsKeptForTheSession', async () => {
        const world = scripted({});

        world.intents.showNumbers();
        await settled();
        expect(world.state()).toMatchObject({ status: 'ready', days: 28, numbers: { visitors: 28 } });

        world.intents.setDays(7);
        await settled();
        world.intents.setDays(28);
        await settled();

        expect(world.state()).toMatchObject({ status: 'ready', days: 28, numbers: { visitors: 28 } });
        expect(world.reads).toEqual([28, 7]);
        expect(world.asked).toEqual(['consent', 'measurementId']);
    });

    it('happyPath_refreshReadsThePeriodAgain_andAPeriodWithoutTokenWaitsForTheButton', async () => {
        const world = scripted({});
        world.intents.refresh();
        await settled();
        world.intents.refresh();
        await settled();
        expect(world.reads).toEqual([28, 28]);

        const fresh = scripted({ consent: { granted: false, failure: 'popupClosed' } });
        fresh.intents.setDays(90);
        expect(fresh.state()).toMatchObject({ days: 90, status: 'idle', numbers: null });
        expect(fresh.asked).toEqual([]);
    });

    it.each([
        ['popupClosed', 'consent'],
        ['scopeDenied', 'consent'],
        ['popupBlocked', 'popupBlocked'],
        ['wrongAccount', 'wrongAccount'],
        ['network', 'unavailable'],
    ] as const)('badPath_aConsent_%s_isTheProblem_%s_andNothingIsRead', async (refusal, problem) => {
        const world = scripted({ consent: { granted: false, failure: refusal } });

        world.intents.showNumbers();
        await settled();

        expect(world.state()).toMatchObject({ status: 'error', problem, numbers: null });
        expect(world.reads).toEqual([]);
    });

    it('badPath_analyticsNotSetUpOrTheServersRefusalIsSaid', async () => {
        const off = scripted({ measurementId: null });
        off.intents.showNumbers();
        await settled();
        expect(off.state()).toMatchObject({ status: 'error', problem: 'notSetUp' });

        const refused = scripted({ measurementId: failure('permission-denied', 'apiError.city.notProjectOwner') });
        refused.intents.showNumbers();
        await settled();
        expect(refused.state()).toMatchObject({ problem: 'server', notice: { key: 'apiError.city.notProjectOwner' } });
    });

    it('badPath_anOlderAnswerNeverReplacesTheNewerPeriod_andAFailedReadIsItsProblem', async () => {
        const world = scripted({ live: true });
        world.intents.setDays(7);
        world.intents.setDays(90);
        await settled();
        const failing = scripted({ live: true, read: () => new StatisticsProblem('noProperty') });
        failing.intents.setDays(7);
        await settled();

        expect(failing.state()).toMatchObject({ status: 'error', problem: 'noProperty', numbers: null });

        expect(world.state()).toMatchObject({ days: 90, status: 'ready', numbers: { visitors: 90 } });
    });
});

describe('problemOf', () => {
    const google = (kind: 'forbidden' | 'unauthorized' | 'notFound' | 'invalid' | 'unavailable', extra: object = {}): GoogleApiError =>
        new GoogleApiError('analytics-data.batchRunReports', { kind, status: 400, ...extra });

    it('happyPath_eachGoogleFailureIsItsPlainProblem', () => {
        expect(problemOf(google('forbidden', { api: 'analyticsdata.googleapis.com' })).problem).toBe('apiDisabled');
        expect(problemOf(google('forbidden')).problem).toBe('noAccess');
        expect(problemOf(google('unauthorized')).problem).toBe('consent');
        expect(problemOf(google('notFound')).problem).toBe('noProperty');
        expect(problemOf(google('invalid')).problem).toBe('refused');
        expect(problemOf(google('unavailable', { host: 'analyticsdata.googleapis.com' })).problem).toBe('blocked');
        expect(problemOf(google('unavailable')).problem).toBe('unavailable');
    });

    it('badPath_ourOwnProblemsAndAnythingElse', () => {
        expect(problemOf(new StatisticsProblem('noAccess'))).toEqual({ problem: 'noAccess', notice: null });
        expect(problemOf(failure('failed-precondition', 'apiError.analytics.noWebApp')).problem).toBe('notSetUp');
        expect(problemOf(failure('unavailable', 'apiError.unavailable', { host: 'x' }))).toEqual({
            problem: 'server',
            notice: { key: 'apiError.unavailable', params: { host: 'x' } },
        });
        expect(problemOf(new TypeError('bug'))).toEqual({ problem: 'unavailable', notice: null });
    });
});

describe('the crashes area with the Statistics view', () => {
    it('happyPath_thePeriodMovesTheErrorGroupsToo_andRefreshListsThemAgain', async () => {
        const { services, callables } = contentWorld();
        callables.answer('telemetry.listGroups', () => ({ groups: [] }));
        const crashes = CRASHES_MODULE.create(services);
        crashes.open([]);
        await settled();

        crashes.intents.setStatisticsDays(28);
        await settled();
        crashes.intents.setStatisticsDays(7);
        await settled();
        crashes.intents.refreshStatistics();
        await settled();

        expect(callables.calls.map((call) => (call.request as { readonly hours: number }).hours)).toEqual([168, 720, 168, 168]);
        expect(crashes.state.statistics).toMatchObject({ days: 7 });
    });

    it('badPath_withoutASourceTheButtonSaysGoogleCouldNotBeAsked', async () => {
        const { services } = contentWorld({ statistics: null });
        const crashes = CRASHES_MODULE.create(services);

        crashes.intents.showNumbers();
        await settled();

        expect(crashes.state.statistics).toMatchObject({ status: 'error', problem: 'unavailable' });
        await expect(NO_STATISTICS_SOURCE.measurementId()).resolves.toBeNull();
        await expect(NO_STATISTICS_SOURCE.read(TOKEN, 'G-E2E0000000', 7)).rejects.toMatchObject({
            name: 'StatisticsProblem',
            problem: 'noProperty',
        });
    });

    it('happyPath_aPeriodWithTheSameErrorPeriodListsNothingAgain', async () => {
        const { services, callables } = contentWorld();
        callables.answer('telemetry.listGroups', () => ({ groups: [] }));
        const crashes = CRASHES_MODULE.create(services);
        crashes.intents.setStatisticsDays(28);
        await settled();
        crashes.intents.setStatisticsDays(90);
        await settled();

        expect(callables.calls).toHaveLength(1);
    });
});
