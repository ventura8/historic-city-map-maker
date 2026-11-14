/**
 * `telemetry.listGroups` (`functions/src/telemetry/list-groups.ts`, M2-interfaces §3.4) through its callable's
 * `.run()`, Error Reporting scripted (`fakeErrors`), the admin check answered by a scripted directory.
 */
import { createLogger, type ListGroupsResponse } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { describe, expect, it } from 'vitest';

import type { ErrorReporter } from '../../src/ports/error-reporter.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { ERROR_REPORTING_VIEWER_ROLE, LIST_GROUPS_LIMITS, listGroupsFunction } from '../../src/telemetry/list-groups.js';
import { createRateLimiter, type RateLimiter } from '../../src/telemetry/rate-limit.js';
import { callableRequest, failureOf, fakeErrors, googleToken } from '../admin/world.js';
import { fakeAdmins } from '../support/fakes.js';

const PAGE: ListGroupsResponse = {
    groups: [
        {
            groupId: 'e2e-group-1',
            message: 'TypeError: tile https://api.mapbox.com/x.png?access_token=e2e-value failed for ana@example.test',
            service: 'viewer',
            version: '1.0.0',
            count: 3,
            frames: ['at tile (https://viewer.e2e.test/engine.mjs?k=e2e-value:3:1)'],
            page: 'https://viewer.e2e.test/?mail=ana@example.test',
            firstSeen: '2026-10-11T08:00:00.000Z',
            lastSeen: '2026-10-12T08:00:00.000Z',
            resolution: 'OPEN',
        },
    ],
    nextPageToken: 'e2e-next-page',
};

const NOW = new Date('2026-11-13T10:00:00.000Z');

function listGroups(errors: ErrorReporter, limiter?: RateLimiter) {
    const recording = createRecordingSink();
    const log = createLogger('functions', { sink: recording.sink });
    const deps = { errors, log, clock: { now: () => NOW }, admins: fakeAdmins(['u-admin']) };
    const auth = { uid: 'u-admin', token: googleToken('admin@example.test', { admin: true }) };
    const callable = listGroupsFunction(() => deps, limiter);
    const run = () => callable.run(callableRequest({ hours: 24, pageSize: 20 }, auth));
    return { call: run(), run, recording };
}

describe('telemetry.listGroups', () => {
    it('happyPath_theCrashPanelGetsTheGroupsRedacted', async () => {
        const errors = fakeErrors(PAGE);
        const { call } = listGroups(errors);

        const page = await call;

        expect(errors.requests).toEqual([{ hours: 24, pageSize: 20 }]);
        expect(page.nextPageToken).toBe('e2e-next-page');
        expect(page.groups[0]?.message).toBe('TypeError: tile https://api.mapbox.com/x.png failed for [redacted]');
        expect(JSON.stringify(page.groups[0]?.frames)).not.toContain('e2e-value');
        expect(page.groups[0]?.page).toBe('https://viewer.e2e.test/');
    });

    it('happyPath_aGroupWithoutFramesOrPageKeepsNone', async () => {
        const bare = {
            groupId: 'e2e-group-2',
            message: 'TypeError: x is undefined',
            service: 'admin',
            count: 1,
            firstSeen: '2026-10-11T08:00:00.000Z',
            lastSeen: '2026-10-11T08:00:00.000Z',
            resolution: 'OPEN',
        } as const;
        const { call } = listGroups(fakeErrors({ groups: [bare] }));

        const page = await call;

        expect(page.groups[0]).not.toHaveProperty('frames');
        expect(page.groups[0]).not.toHaveProperty('page');
    });

    it('badPath_aGroupOfFirefoxForIosReaderScriptIsNoiseAndLeftOut @S-A22-BAD-NOISE-GROUP', async () => {
        // Admin sweep 2026-11-14: "Can't find variable: __firefox__" came from the browser's own reader script, not our code.
        const injected = {
            ...{ groupId: 'e2e-group-3', message: "ReferenceError: Can't find variable: __firefox__", service: 'viewer', count: 1 },
            ...{ firstSeen: '2026-11-11T08:00:00.000Z', lastSeen: '2026-11-11T08:00:00.000Z', resolution: 'OPEN' as const },
        };
        const { call, recording } = listGroups(fakeErrors({ groups: [injected, ...PAGE.groups] }));

        const page = await call;

        expect(page.groups.map((group) => group.groupId)).toEqual(['e2e-group-1']);
        expect(JSON.stringify(recording.records)).toContain('injected');
    });

    it('badPath_aMissingRoleNamesTheRole', async () => {
        const { call, recording } = listGroups(fakeErrors(new UpstreamError('error-reporting', 'forbidden', { status: 403 })));

        await expect(failureOf(call)).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.cloud.permission', params: { role: ERROR_REPORTING_VIEWER_ROLE } },
        });
        expect(recording.records[0]?.data).toEqual({ failure: 'forbidden', status: 403 });
    });

    it('badPath_aDisabledApiIsNamed', async () => {
        const disabled = new UpstreamError('error-reporting', 'forbidden', { status: 403, api: 'clouderrorreporting.googleapis.com' });
        const { call } = listGroups(fakeErrors(disabled));

        await expect(failureOf(call)).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } },
        });
    });

    it.each(['unavailable', 'rateLimited', 'invalid'] as const)('badPath_anErrorReporting_%s_offersRetry', async (failure) => {
        const { call } = listGroups(fakeErrors(new UpstreamError('error-reporting', failure)));

        await expect(failureOf(call)).resolves.toMatchObject({ details: { code: 'apiError.errorReporting.unavailable' } });
    });

    it('badPath_anAdminPastTheMinutesLimitIsRefusedWithoutAskingErrorReporting', async () => {
        const errors = fakeErrors(PAGE);
        const limiter = createRateLimiter('e2e-salt', LIST_GROUPS_LIMITS);
        const { call, run, recording } = listGroups(errors, limiter);
        await call;
        for (let index = 1; index < LIST_GROUPS_LIMITS.perClientPerMinute; index += 1) {
            await run();
        }

        await expect(failureOf(run())).resolves.toMatchObject({ details: { code: 'apiError.rateLimited' } });
        expect(errors.requests).toHaveLength(LIST_GROUPS_LIMITS.perClientPerMinute);
        expect(recording.records.at(-1)?.message).toBe('error reporting groups limited');
    });

    it('badPath_aSignedInNonAdminGetsNoGroupAndErrorReportingIsNotAsked', async () => {
        const errors = fakeErrors(PAGE);
        const deps = { errors, log: createLogger('functions', { minLevel: 'error' }), clock: { now: () => NOW }, admins: fakeAdmins([]) };
        const auth = { uid: 'u-visitor', token: googleToken('visitor@example.test') };

        const refused = failureOf(listGroupsFunction(() => deps).run(callableRequest({ hours: 24, pageSize: 20 }, auth)));

        await expect(refused).resolves.toMatchObject({ code: 'permission-denied' });
        expect(errors.requests).toEqual([]);
    });

    it('badPath_aBugIsAnInternalError', async () => {
        const { call } = listGroups({ ...fakeErrors(), listGroups: () => Promise.reject(new TypeError('adapter bug')) });

        await expect(failureOf(call)).resolves.toMatchObject({ code: 'internal', details: { code: 'apiError.internal' } });
    });
});
