import type { ListGroupsResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CRASH_PAGE_SIZE, CRASHES_MODULE } from '../../src/crashes/crashes.js';
import { failure } from '../app/fakes.js';
import { contentWorld } from '../content/world.js';

function group(id: string, count: number): ListGroupsResponse['groups'][number] {
    return {
        groupId: id,
        message: `TypeError: ${id} <script>`,
        service: 'admin',
        version: '1.2.3',
        count,
        firstSeen: '2026-10-10T10:00:00.000Z',
        lastSeen: '2026-10-17T10:00:00.000Z',
        resolution: 'OPEN',
    };
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('the crash reports area', () => {
    it('happyPath_theWeeksGroupsThenMoreThenAnotherPeriod', async () => {
        const { services, callables } = contentWorld();
        callables.answer('telemetry.listGroups', (request) => {
            const { hours, pageToken } = request as { readonly hours: number; readonly pageToken?: string };
            if (hours === 24) {
                return { groups: [group('today', 1)] };
            }
            return pageToken === undefined ? { groups: [group('a', 5)], nextPageToken: 'next' } : { groups: [group('b', 2)] };
        });
        const crashes = CRASHES_MODULE.create(services);

        crashes.open([]);
        crashes.open([]);
        await settled();
        await crashes.intents.more();
        const week = crashes.state.groups.map((item) => item.groupId);
        await crashes.intents.more();
        crashes.intents.select('b');
        crashes.intents.setPeriod(24);
        await settled();

        expect(week).toEqual(['a', 'b']);
        expect(crashes.state).toMatchObject({ period: 24, status: 'ready', selected: null, nextPageToken: null });
        expect(crashes.state.groups.map((item) => item.groupId)).toEqual(['today']);
        expect(callables.calls.map((call) => call.request)).toEqual([
            { hours: 168, pageSize: CRASH_PAGE_SIZE },
            { hours: 168, pageSize: CRASH_PAGE_SIZE, pageToken: 'next' },
            { hours: 24, pageSize: CRASH_PAGE_SIZE },
        ]);
        expect([CRASHES_MODULE.area, crashes.hasUnsavedChanges()]).toEqual(['crashes', false]);
    });

    it('badPath_aDisabledErrorReportingIsExplainedAndTryAgainAsksAgain', async () => {
        const { services, callables } = contentWorld();
        callables.fail(
            'telemetry.listGroups',
            failure('failed-precondition', 'apiError.cloud.apiDisabled', { api: 'clouderrorreporting.googleapis.com' }),
        );
        const crashes = CRASHES_MODULE.create(services);
        crashes.open([]);
        await settled();
        expect(crashes.state).toMatchObject({ status: 'error', apiDisabled: true, failure: { key: 'apiError.cloud.apiDisabled' } });

        callables.fail('telemetry.listGroups', failure('unavailable', 'apiError.errorReporting.unavailable'));
        crashes.intents.retry();
        await settled();

        expect(crashes.state).toMatchObject({
            status: 'error',
            apiDisabled: false,
            failure: { key: 'apiError.errorReporting.unavailable' },
        });
    });

    it('badPath_anOlderAnswerNeverReplacesANewerOne', async () => {
        const { services, callables } = contentWorld();
        const answers: ((value: ListGroupsResponse) => void)[] = [];
        callables.answer(
            'telemetry.listGroups',
            () =>
                new Promise<ListGroupsResponse>((resolve) => {
                    answers.push(resolve);
                }),
        );
        const crashes = CRASHES_MODULE.create(services);
        crashes.open([]);
        crashes.intents.setPeriod(720);
        await settled();

        answers[1]?.({ groups: [group('month', 9)] });
        answers[0]?.({ groups: [group('week', 1)] });
        await settled();

        expect(crashes.state.groups.map((item) => item.groupId)).toEqual(['month']);
        crashes.destroy();
        expect(crashes.state.groups).toEqual([]);
    });

    it('happyPath_closingLetsTheNextVisitReadAgain', async () => {
        const { services, callables } = contentWorld();
        callables.answer('telemetry.listGroups', () => ({ groups: [] }));
        const crashes = CRASHES_MODULE.create(services);
        let heard = 0;
        const stop = crashes.subscribe(() => {
            heard += 1;
        });

        crashes.open([]);
        await settled();
        crashes.close();
        crashes.open([]);
        await settled();
        stop();

        expect(callables.named('telemetry.listGroups')).toBe(2);
        expect(heard).toBeGreaterThan(0);
    });
});
