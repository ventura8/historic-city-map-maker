/**
 * `setup.saveUsgs` (onboarding review §2C; scenario A07) against the fake USGS M2M and Secret Manager: the credentials
 * are checked with `login-token` and `permissions` (and always logged out), stored in Secret Manager only, and the
 * card shows the M2M role: `ok` once approved, `pending` (checked again every six hours) before, `unavailable` during
 * maintenance. A refused token stores nothing.
 */
import { FIRESTORE_PATHS, USGS_RECHECK_HOURS } from '@hcm/shared';
import { fixtureResponse } from '@hcm/test-support/api-fixtures';
import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { saveUsgs } from '../../src/setup/save-usgs.js';
import { ADMIN, NOW, createWorld, rejection, type World } from './world.js';

const CHECKED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };
const NEXT_CHECK = { seconds: Date.parse(NOW) / 1000 + USGS_RECHECK_HOURS * 3600, nanoseconds: 0 };

type Credentials = (typeof USGS_CREDENTIALS)[keyof typeof USGS_CREDENTIALS];

function save(world: World, credentials: Credentials = USGS_CREDENTIALS.approved, expiresOn?: string) {
    return saveUsgs(world.deps, ADMIN, { ...credentials, ...(expiresOn === undefined ? {} : { expiresOn }) });
}

/** USGS answers `endpoint` with `response`. */
function answering(world: World, endpoint: string, response: () => Response): void {
    world.intercept = (_method, url) =>
        url.hostname === 'm2m.cr.usgs.gov' && url.pathname.endsWith(`/${endpoint}`) ? response() : undefined;
}

function stored(world: World): readonly (string | undefined)[] {
    return [world.upstream.secretValue('usgs-username'), world.upstream.secretValue('usgs-app-token')];
}

describe('setup.saveUsgs', () => {
    it('happyPath_anApprovedAccountIsGreenWithTheDownloadRole', async () => {
        const world = createWorld();

        const response = await save(world);

        expect(response).toEqual({ usgs: { state: 'ok', checkedAt: '2026-10-11T08:30:00.000Z', role: 'download' } });
        expect(stored(world)).toEqual([USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken]);
        expect(world.upstream.calls.filter((call) => call.operation.startsWith('usgs')).map((call) => call.operation)).toEqual([
            'usgs.login-token',
            'usgs.permissions',
            'usgs.logout',
        ]);
        expect(world.status()).toMatchObject({
            usgs: { state: 'ok', role: 'download', checkedAt: CHECKED },
            secretsRev: 1,
            updatedBy: ADMIN.uid,
        });
        expect(world.status()?.usgs).not.toHaveProperty('nextCheckAt');
        expect(JSON.stringify(world.status()) + world.logged()).not.toContain(USGS_CREDENTIALS.approved.applicationToken);
    });

    it('badPath_anAccountAwaitingApprovalIsPendingAndCheckedAgainInSixHours', async () => {
        const world = createWorld();

        await expect(save(world, USGS_CREDENTIALS.pending)).resolves.toEqual({
            usgs: {
                state: 'pending',
                checkedAt: '2026-10-11T08:30:00.000Z',
                role: 'search',
                detail: 'apiError.usgs.accessPending',
                pendingSince: '2026-10-11T08:30:00.000Z',
                nextCheckAt: '2026-10-11T14:30:00.000Z',
            },
        });
        expect(world.status()?.usgs).toEqual({
            state: 'pending',
            checkedAt: CHECKED,
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            pendingSince: CHECKED,
            nextCheckAt: NEXT_CHECK,
        });
        expect(stored(world)).toEqual([USGS_CREDENTIALS.pending.username, USGS_CREDENTIALS.pending.applicationToken]);
    });

    it('badPath_anAccountWithoutM2mAccessIsPendingToo', async () => {
        const world = createWorld();
        answering(world, 'login-token', () =>
            fixtureResponse('usgs/login-token.auth-invalid', { merge: { errorCode: 'AUTH_UNAUTHORIZED' } }),
        );

        await expect(save(world)).resolves.toMatchObject({
            usgs: { state: 'pending', role: 'search', detail: 'apiError.usgs.accessPending' },
        });
        expect(world.upstream.callsTo('usgs.logout')).toEqual([]);
    });

    it('happyPath_theTokenExpiryIsKeptForTheReminder', async () => {
        const world = createWorld();

        await expect(save(world, USGS_CREDENTIALS.approved, '2027-10-11')).resolves.toMatchObject({
            usgs: { tokenExpiresAt: '2027-10-11T00:00:00.000Z' },
        });
    });

    it.each([
        ['an expired token (HTML 403)', USGS_CREDENTIALS.expired],
        ['unknown credentials (AUTH_INVALID)', USGS_CREDENTIALS.unknown],
    ])('badPath_%s_isRefusedAndNothingIsStored', async (_label, credentials) => {
        const world = createWorld();

        await expect(rejection(save(world, credentials))).resolves.toMatchObject({ code: 'apiError.usgs.credentials' });
        expect(stored(world)).toEqual([undefined, undefined]);
        expect(world.status()?.usgs).toEqual({ state: 'invalid', detail: 'apiError.usgs.credentials', checkedAt: CHECKED });
    });

    it('badPath_aSecondFailureReplacesTheFirstReason', async () => {
        const world = createWorld();
        world.upstream.fail('secret-manager', 'forbidden');
        await rejection(save(world));
        world.upstream.fail('secret-manager', null);

        await rejection(save(world, USGS_CREDENTIALS.unknown));

        expect(world.status()?.usgs).toEqual({ state: 'invalid', detail: 'apiError.usgs.credentials', checkedAt: CHECKED });
    });

    it('badPath_aBadPasteNeverHidesAPendingApproval', async () => {
        const world = createWorld();
        await save(world, USGS_CREDENTIALS.pending);

        await rejection(save(world, USGS_CREDENTIALS.expired));

        expect(world.status()?.usgs?.state).toBe('pending');
        expect(stored(world)[0]).toBe(USGS_CREDENTIALS.pending.username);
    });

    it('badPath_aRefusedKeyAfterLoginIsACredentialsProblemAndTheKeyIsLoggedOut', async () => {
        const world = createWorld();
        answering(world, 'permissions', () => fixtureResponse('usgs/error.api-key-invalid'));

        await expect(rejection(save(world))).resolves.toMatchObject({ code: 'apiError.usgs.credentials' });
        expect(world.upstream.callsTo('usgs.logout')).toHaveLength(1);
    });

    it.each([
        ['maintenance', 'apiError.usgs.maintenance'],
        ['unavailable', 'apiError.usgs.unavailable'],
        ['rateLimited', 'apiError.rateLimited'],
    ] as const)('badPath_%s_keepsTheCredentialsAndChecksAgainLater', async (mode, detail) => {
        const world = createWorld();
        world.upstream.fail('usgs', mode);

        await expect(save(world)).resolves.toEqual({
            usgs: { state: 'unavailable', checkedAt: '2026-10-11T08:30:00.000Z', detail, nextCheckAt: '2026-10-11T14:30:00.000Z' },
        });
        expect(stored(world)).toEqual([USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken]);
    });

    it('badPath_maintenanceDuringThePermissionsCheckIsUnavailable', async () => {
        const world = createWorld();
        answering(world, 'permissions', () => fixtureResponse('usgs/maintenance.html-503'));

        await expect(save(world)).resolves.toMatchObject({ usgs: { state: 'unavailable', detail: 'apiError.usgs.maintenance' } });
        expect(world.upstream.callsTo('usgs.logout')).toHaveLength(1);
    });

    it('badPath_secretsThatCannotBeSavedAreReported', async () => {
        const world = createWorld({ provisioned: false });

        await expect(rejection(save(world))).resolves.toMatchObject({ code: 'apiError.secrets.unavailable' });
        expect(world.status()?.usgs).toMatchObject({ state: 'invalid', detail: 'apiError.secrets.unavailable' });
    });

    it('badPath_anUnknownErrorCodeIsAnUnexpectedFailureAndNotRecorded', async () => {
        const world = createWorld();
        answering(world, 'login-token', () =>
            fixtureResponse('usgs/login-token.auth-invalid', { merge: { errorCode: 'VERSION_UNKNOWN' } }),
        );

        await expect(rejection(save(world))).resolves.toEqual(new UpstreamError('usgs', 'invalid', { status: 500 }));
        expect(world.status()).toBeUndefined();
    });
});

// M6 setup-ux (docs/research/M6-interfaces.md §4.1, S-A59-HAPPY-APPROVAL-PENDING): since when the approval is awaited.
describe('setup.saveUsgs: the approval awaited', () => {
    it('badPath_aNewTokenKeepsTheDayTheApprovalWaitsSinceAndTheApprovalEndsIt', async () => {
        const world = createWorld();
        const earlier = { seconds: CHECKED.seconds - 86_400, nanoseconds: 0 };
        world.documents.seed(FIRESTORE_PATHS.setupStatus, {
            usgs: { state: 'pending', role: 'search', detail: 'apiError.usgs.accessPending', pendingSince: earlier, postponedAt: earlier },
            updatedBy: ADMIN.uid,
            updatedAt: earlier,
        });

        await save(world, USGS_CREDENTIALS.pending);
        expect(world.status()?.usgs).toMatchObject({ state: 'pending', pendingSince: earlier });
        // A saved token ends Do it later (M6 setup-ux): the record is the check's own.
        expect(world.status()?.usgs).not.toHaveProperty('postponedAt');

        await save(world, USGS_CREDENTIALS.approved);
        expect(world.status()?.usgs).not.toHaveProperty('pendingSince');
    });
});
