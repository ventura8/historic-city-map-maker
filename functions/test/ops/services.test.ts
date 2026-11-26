/**
 * The `health` and `tokens` steps: due checks of the stored Mapbox token and USGS credentials, recorded on
 * `setup/status` as non-secret health, and the retirement of replaced public Mapbox tokens.
 */
import { FIRESTORE_PATHS, setupStatusDocSchema, timestampFromDate, type SetupStatusDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { checkServices, retireTokens } from '../../src/ops/services.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { hoursBefore, opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-12T09:00:00.000Z';
const at = (iso: string) => timestampFromDate(new Date(iso));

async function seedStatus(deps: OpsTestDeps, status: Partial<SetupStatusDoc>): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema, {
        updatedBy: 'u-admin',
        updatedAt: hoursBefore(NOW, 30),
        ...status,
    });
}

async function status(deps: OpsTestDeps): Promise<SetupStatusDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.setupStatus, setupStatusDocSchema);
}

async function withSecrets(deps: OpsTestDeps): Promise<OpsTestDeps> {
    await deps.secrets.write('mapbox-sk-bootstrap', 'sk.test-bootstrap-value');
    await deps.secrets.write('usgs-username', 'hcm-test-user');
    await deps.secrets.write('usgs-app-token', 'usgs-test-application-token');
    return deps;
}

describe('checkServices: Mapbox', () => {
    it('happyPath_aDailyCheckClearsAnEarlierProblem', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, {
            mapbox: { state: 'unavailable', checkedAt: hoursBefore(NOW, 25), detail: 'apiError.mapbox.unavailable', user: 'hcm-test' },
        });

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.mapbox).toEqual({ state: 'ok', checkedAt: at(NOW), user: 'hcm-test' });
        expect(await status(deps)).toMatchObject({ updatedBy: 'system:ops', updatedAt: at(NOW) });
        expect(deps.recording.records.at(-1)).toMatchObject({ message: 'services checked', data: { mapbox: 'ok', usgs: 'skipped' } });
    });

    it.each([
        ['unauthorized', { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' }],
        ['unavailable', { state: 'unavailable', detail: 'apiError.mapbox.unavailable' }],
        ['rateLimited', { state: 'unavailable', detail: 'apiError.mapbox.unavailable' }],
    ] as const)('badPath_mapbox_%s', async (failure, expected) => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok' } });
        deps.mapbox.recorder.failNext('retrieveToken', new UpstreamError('mapbox', failure));

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.mapbox).toEqual({ ...expected, checkedAt: at(NOW) });
    });

    it.each([
        ['checked an hour ago', { state: 'ok', checkedAt: hoursBefore(NOW, 1) }],
        ['never configured', { state: 'missing' }],
    ] as const)('badPath_notDue_%s', async (_name, mapbox) => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox });

        await checkServices(deps, new Date(NOW));

        expect(deps.mapbox.recorder.calls).toEqual([]);
        expect((await status(deps))?.updatedBy).toBe('u-admin');
    });

    it('badPath_dueWithoutTheSecretIsSkipped', async () => {
        const deps = opsDeps(NOW);
        await seedStatus(deps, { mapbox: { state: 'ok' } });

        await checkServices(deps, new Date(NOW));

        expect(deps.mapbox.recorder.calls).toEqual([]);
    });

    it('badPath_noSetupStatusNothingToCheck', async () => {
        const deps = await withSecrets(opsDeps(NOW));

        await checkServices(deps, new Date(NOW));

        expect([deps.mapbox.recorder.calls, deps.usgs.recorder.calls, await status(deps)]).toEqual([[], [], undefined]);
    });

    it('badPath_aStatusDeletedMeanwhileIsNotRecreated', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok' } });
        const mapbox = {
            ...deps.mapbox,
            retrieveToken: async (token: string) => {
                await deps.documents.delete(FIRESTORE_PATHS.setupStatus);
                return deps.mapbox.retrieveToken(token);
            },
        };

        await checkServices({ ...deps, mapbox }, new Date(NOW));

        expect(await status(deps)).toBeUndefined();
    });

    it('badPath_aFailureThatIsNoUpstreamErrorFailsTheStep', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok' } });
        deps.mapbox.recorder.failNext('retrieveToken', new Error('bug'));

        await expect(checkServices(deps, new Date(NOW))).rejects.toThrow('bug');
    });
});

describe('checkServices: USGS', () => {
    it('happyPath_anApprovedRoleTurnsAPendingCheckOk', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, {
            usgs: { state: 'pending', role: 'search', nextCheckAt: hoursBefore(NOW, 1), tokenExpiresAt: at('2027-01-01T00:00:00.000Z') },
        });

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.usgs).toEqual({
            state: 'ok',
            role: 'download',
            checkedAt: at(NOW),
            tokenExpiresAt: at('2027-01-01T00:00:00.000Z'),
        });
        expect(deps.usgs.recorder.calls.map((call) => call.method)).toEqual(['login', 'permissions', 'logout']);
    });

    it('happyPath_stillWaitingIsCheckedAgainInSixHours @S-A03-BAD-USGS-STILL-PENDING', async () => {
        const deps = await withSecrets(opsDeps(NOW, { permissions: ['search'] }));
        await seedStatus(deps, { usgs: { state: 'pending' } });

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.usgs).toEqual({
            state: 'pending',
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            checkedAt: at(NOW),
            nextCheckAt: at('2026-10-12T15:00:00.000Z'),
        });
    });

    it('badPath_aLoginRefusedForMissingM2mAccessStaysPending', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { usgs: { state: 'pending', role: 'search', nextCheckAt: hoursBefore(NOW, 1) } });
        deps.usgs.recorder.failNext('login', new UpstreamError('usgs', 'forbidden'));

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.usgs).toEqual({
            state: 'pending',
            role: 'search',
            detail: 'apiError.usgs.accessPending',
            checkedAt: at(NOW),
            nextCheckAt: at('2026-10-12T15:00:00.000Z'),
        });
    });

    it('badPath_aPendingCheckNotYetDueWaits', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { usgs: { state: 'pending', nextCheckAt: at('2026-10-12T10:00:00.000Z') } });

        await checkServices(deps, new Date(NOW));

        expect(deps.usgs.recorder.calls).toEqual([]);
    });

    it.each([
        ['unauthorized', 'login', { state: 'invalid', detail: 'apiError.usgs.credentials' }, ['login']],
        [
            'maintenance',
            'login',
            { state: 'unavailable', detail: 'apiError.usgs.maintenance', nextCheckAt: at('2026-10-12T15:00:00.000Z') },
            ['login'],
        ],
        [
            'rateLimited',
            'permissions',
            { state: 'unavailable', detail: 'apiError.rateLimited', nextCheckAt: at('2026-10-12T15:00:00.000Z') },
            ['login', 'permissions', 'logout'],
        ],
        [
            'unavailable',
            'permissions',
            { state: 'unavailable', detail: 'apiError.usgs.unavailable', nextCheckAt: at('2026-10-12T15:00:00.000Z') },
            ['login', 'permissions', 'logout'],
        ],
    ] as const)('badPath_usgs_%s_at_%s', async (failure, method, expected, calls) => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { usgs: { state: 'ok', role: 'download', checkedAt: hoursBefore(NOW, 48) } });
        deps.usgs.recorder.failNext(method, new UpstreamError('usgs', failure));

        await checkServices(deps, new Date(NOW));

        expect((await status(deps))?.usgs).toEqual({ ...expected, role: 'download', checkedAt: at(NOW) });
        expect(deps.usgs.recorder.calls.map((call) => call.method)).toEqual(calls);
    });

    it.each([
        ['unavailable, its retry time passed', { state: 'unavailable', nextCheckAt: hoursBefore(NOW, 1) }, true],
        ['unavailable, its retry time to come', { state: 'unavailable', nextCheckAt: at('2026-10-12T10:00:00.000Z') }, false],
        ['unavailable without a retry time, checked two days ago', { state: 'unavailable', checkedAt: hoursBefore(NOW, 48) }, true],
        [
            'invalid, checked an hour ago (a new paste fixes it)',
            { state: 'invalid', checkedAt: hoursBefore(NOW, 1), nextCheckAt: hoursBefore(NOW, 1) },
            false,
        ],
    ] as const)('happyPath_usgsIsCheckedAgainWhen_%s', async (_name, usgs, checked) => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { usgs });

        await checkServices(deps, new Date(NOW));

        expect(deps.usgs.recorder.calls.length > 0).toBe(checked);
    });

    it('badPath_withoutBothCredentialsNothingIsChecked', async () => {
        const deps = opsDeps(NOW);
        await deps.secrets.write('usgs-username', 'hcm-test-user');
        await seedStatus(deps, { usgs: { state: 'ok', checkedAt: hoursBefore(NOW, 48) } });

        await checkServices(deps, new Date(NOW));

        expect(deps.usgs.recorder.calls).toEqual([]);
    });
});

describe('retireTokens', () => {
    const old1 = { tokenId: 'old1', retireAt: hoursBefore(NOW, 1) };
    const later = { tokenId: 'later', retireAt: at('2026-10-12T09:05:00.000Z') };
    const retiring = [old1, { tokenId: 'old2', retireAt: hoursBefore(NOW, 2) }, later];

    it('happyPath_tokensPastTheirTimeAreDeleted @S-A06-HAPPY-OLD-TOKEN-RETIRED', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test', retiring } });

        await retireTokens(deps, new Date(NOW));

        expect(deps.mapbox.recorder.argsOf('deleteToken')).toEqual([
            ['hcm-test', 'old1'],
            ['hcm-test', 'old2'],
        ]);
        expect((await status(deps))?.mapbox?.retiring).toEqual([later]);
    });

    it('happyPath_theLastRetiredTokenEmptiesTheList', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test', retiring: [old1] } });

        await retireTokens(deps, new Date(NOW));

        expect((await status(deps))?.mapbox).toEqual({ state: 'ok', user: 'hcm-test' });
    });

    it('badPath_aTokenMapboxDidNotDeleteStaysAndFailsTheStep', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test', retiring } });
        deps.mapbox.recorder.failNext('deleteToken', new UpstreamError('mapbox', 'unavailable'));

        await expect(retireTokens(deps, new Date(NOW))).rejects.toMatchObject({ code: 'apiError.mapbox.unavailable' });

        expect((await status(deps))?.mapbox?.retiring?.map((token) => token.tokenId)).toEqual(['old1', 'later']);
    });

    it.each([
        ['no Mapbox user', { state: 'ok', retiring }, true],
        ['no bootstrap token', { state: 'ok', user: 'hcm-test', retiring }, false],
    ] as const)('badPath_%s_isNotConfigured', async (_name, mapbox, secrets) => {
        const deps = secrets ? await withSecrets(opsDeps(NOW)) : opsDeps(NOW);
        await seedStatus(deps, { mapbox });

        await expect(retireTokens(deps, new Date(NOW))).rejects.toMatchObject({ code: 'apiError.mapbox.notConfigured' });
    });

    it('badPath_nothingDueTouchesNothing', async () => {
        const deps = opsDeps(NOW);
        await seedStatus(deps, { mapbox: { state: 'ok', retiring: [later] } });

        await retireTokens(deps, new Date(NOW));
        await retireTokens(opsDeps(NOW), new Date(NOW));

        expect(deps.mapbox.recorder.calls).toEqual([]);
    });

    it('badPath_aDeletionFailingWithABugFailsTheStep', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test', retiring } });
        deps.mapbox.recorder.failNext('deleteToken', new Error('bug'));

        await expect(retireTokens(deps, new Date(NOW))).rejects.toThrow('bug');
    });

    it('badPath_aRetiringListRemovedMeanwhileStaysRemoved', async () => {
        const deps = await withSecrets(opsDeps(NOW));
        await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test', retiring: [old1] } });
        const mapbox = {
            ...deps.mapbox,
            deleteToken: async (user: string, secret: string, tokenId: string) => {
                await seedStatus(deps, { mapbox: { state: 'ok', user: 'hcm-test' } });
                return deps.mapbox.deleteToken(user, secret, tokenId);
            },
        };

        await retireTokens({ ...deps, mapbox }, new Date(NOW));

        expect((await status(deps))?.mapbox).toEqual({ state: 'ok', user: 'hcm-test' });
    });
});
