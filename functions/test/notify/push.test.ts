/**
 * The push callables (`functions/src/notify/devices.ts`, `docs/research/M4-interfaces.md` §5.4) against the fake FCM: a
 * browser's token is stored only after FCM accepted it in a dry run, at most five per admin (the oldest replaced), push
 * is turned on with the default kinds unless the admin chose others; a test notification reaches the caller's own
 * devices; FCM's own failures say which role or API is missing.
 */
import {
    DEFAULT_PUSH_KINDS,
    FIRESTORE_PATHS,
    PUSH_DEVICES_MAX,
    notifySettingsDocSchema,
    pushDeviceDocSchema,
    timestampFromDate,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    FCM_ROLE,
    deviceIdOf,
    pushFailure,
    registerDeviceFunction,
    sendTestFunction,
    unregisterDeviceFunction,
} from '../../src/notify/devices.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { m4Deps, seedAdmin, type M4Deps } from '../assist/world.js';
import { adminCall } from '../publish/fakes.js';
import { fcmToken } from '../support/m4-upstreams.js';

const NOW = '2026-10-24T08:30:00.000Z';

function register(deps: M4Deps, token: string, lang: 'ro' | 'en' = 'ro', uid = 'u-admin') {
    return registerDeviceFunction(() => deps).run(adminCall({ token, lang }, uid));
}

describe('notify.registerDevice', () => {
    it('happyPath_aTokenFcmAcceptsIsStoredWithItsKindAndPushTurnsOnWithTheDefaults @S-A47-HAPPY-TOKEN', async () => {
        const deps = m4Deps(NOW);
        const token = fcmToken('laptop');

        await expect(register(deps, token, 'en')).resolves.toEqual({ deviceId: deviceIdOf(token) });

        await expect(deps.documents.get(FIRESTORE_PATHS.pushDevice('u-admin', deviceIdOf(token)), pushDeviceDocSchema)).resolves.toEqual({
            token,
            kind: 'token',
            lang: 'en',
            createdAt: timestampFromDate(new Date(NOW)),
            updatedBy: 'u-admin',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        await expect(deps.documents.get(FIRESTORE_PATHS.notifySettings('u-admin'), notifySettingsDocSchema)).resolves.toMatchObject({
            push: true,
            pushKinds: DEFAULT_PUSH_KINDS,
        });
        expect(deps.upstream.state.fcm.messages).toEqual([]);
        // Finding 50 of 2026-11-01: the dry run addressed the registration token as `message.token`.
        expect(JSON.parse(String(deps.upstream.callsTo('fcm.send')[0]?.body))).toEqual({ validate_only: true, message: { token } });
        expect(deviceIdOf(token)).toMatch(/^[a-f0-9]{32}$/);
    });

    it('happyPath_theKindsAnAdminChoseStayAndARegisteredDeviceKeepsItsAge', async () => {
        const deps = m4Deps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.notifySettings('u-admin'), notifySettingsDocSchema, {
            push: false,
            pushKinds: ['budget.paused'],
            createdAt: timestampFromDate(new Date('2026-10-01T00:00:00.000Z')),
            updatedBy: 'u-admin',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        const token = fcmToken('laptop');
        await register(deps, token);
        deps.clock.set('2026-10-25T08:30:00.000Z');

        await register(deps, token, 'en');

        await expect(deps.documents.get(FIRESTORE_PATHS.notifySettings('u-admin'), notifySettingsDocSchema)).resolves.toMatchObject({
            push: true,
            pushKinds: ['budget.paused'],
            createdAt: timestampFromDate(new Date('2026-10-01T00:00:00.000Z')),
        });
        await expect(
            deps.documents.get(FIRESTORE_PATHS.pushDevice('u-admin', deviceIdOf(token)), pushDeviceDocSchema),
        ).resolves.toMatchObject({
            lang: 'en',
            createdAt: timestampFromDate(new Date(NOW)),
        });
    });

    it('happyPath_aSixthBrowserReplacesTheOldest', async () => {
        const deps = m4Deps(NOW);
        const tokens = Array.from({ length: PUSH_DEVICES_MAX + 1 }, (_, index) => fcmToken(`browser${String(index)}`));
        for (const [index, token] of tokens.entries()) {
            deps.clock.set(new Date(Date.parse(NOW) + index * 60_000).toISOString());
            await register(deps, token);
        }

        const stored = deps.documents.paths('admins/u-admin/pushDevices/');
        expect(stored).toHaveLength(PUSH_DEVICES_MAX);
        expect(stored).not.toContain(`admins/u-admin/pushDevices/${deviceIdOf(String(tokens[0]))}`);
    });

    it('happyPath_aSharedBrowserRegisteredByAnotherAdminStopsGettingTheirs @S-A47-BAD-SHARED-BROWSER', async () => {
        const deps = m4Deps(NOW);
        await seedAdmin(deps, 'u-admin', { role: 'owner' });
        await seedAdmin(deps, 'u-second');
        const token = fcmToken('shared');
        const laptop = fcmToken('laptop');
        await register(deps, token, 'ro', 'u-second');
        await register(deps, laptop, 'ro', 'u-second');

        await register(deps, token, 'en', 'u-admin');

        expect(deps.documents.paths('admins/u-second/pushDevices/')).toEqual([`admins/u-second/pushDevices/${deviceIdOf(laptop)}`]);
        expect(deps.documents.paths('admins/u-admin/pushDevices/')).toEqual([`admins/u-admin/pushDevices/${deviceIdOf(token)}`]);
    });

    it('badPath_aTokenFcmRefusesIsNeverStored @S-A47-BAD-FCM-REASON-NAMED', async () => {
        const deps = m4Deps(NOW);
        const token = fcmToken('stale');
        deps.upstream.state.fcm.invalid.add(token);

        // Finding 46 of 2026-11-01: FCM's own code reaches the admin as the refusal's reason, and the log; never the token.
        await expect(failureOf(register(deps, token))).resolves.toMatchObject({
            code: 'invalid-argument',
            details: { code: 'apiError.notify.deviceInvalid', params: { reason: 'INVALID_ARGUMENT' } },
        });
        expect(deps.documents.paths('admins/')).toEqual([]);
        const logged = deps.recording.records.find((record) => record.message === 'push device refused by FCM');
        expect(logged?.data).toMatchObject({ reason: 'INVALID_ARGUMENT' });
        expect(JSON.stringify(deps.recording.records)).not.toContain(token);
    });

    it.each([
        ['forbidden', 'apiError.cloud.permission', { role: FCM_ROLE }],
        ['apiDisabled', 'apiError.cloud.apiDisabled', { api: 'fcm.googleapis.com' }],
        ['unavailable', 'apiError.unavailable', undefined],
        ['rateLimited', 'apiError.rateLimited', undefined],
    ] as const)('badPath_fcmIn_%s_answers_%s', async (mode, code, params) => {
        const deps = m4Deps(NOW);
        deps.upstream.fail('fcm', mode);

        const failure = await failureOf(register(deps, fcmToken('laptop')));

        expect(failure).toMatchObject({ details: { code } });
        expect((failure.details as { params?: unknown }).params).toEqual(params);
    });
});

describe('notify.registerDevice: what a device is (finding 50 of 2026-11-01)', () => {
    it('happyPath_aRegistrationWhoseDryRunSaysUnregisteredIsRecordedAndTheFirstSendDecides @S-A47-HAPPY-DRY-RUN-UNREGISTERED @S-A47-BAD-TOKEN-UNREGISTERED', async () => {
        const deps = m4Deps(NOW);
        const token = fcmToken('fresh');
        deps.upstream.state.fcm.unregistered.add(token);

        // Finding 50 of 2026-11-01: FCM's dry run called a registration the browser had just made unregistered.
        await expect(register(deps, token)).resolves.toEqual({ deviceId: deviceIdOf(token) });

        expect(deps.documents.paths('admins/u-admin/pushDevices/')).toEqual([`admins/u-admin/pushDevices/${deviceIdOf(token)}`]);
        const logged = deps.recording.records.find((record) => record.message === 'push device recorded although FCM refused its dry run');
        expect(logged?.data).toMatchObject({ uid: 'u-admin', kind: 'token', reason: 'UNREGISTERED' });
        expect(JSON.stringify(deps.recording.records)).not.toContain(token);
        // FCM still does not know it when the test is sent: the device is forgotten then.
        await expect(sendTestFunction(() => deps).run(adminCall({}))).resolves.toEqual({ sent: 0, removed: 1 });
        expect(deps.documents.paths('admins/u-admin/pushDevices/')).toEqual([]);
    });

    it('happyPath_aDeviceRecordedBeforeFinding50IsSentToAsAnInstallationId @S-A47-HAPPY-LEGACY-FID', async () => {
        const deps = m4Deps(NOW);
        const fid = fcmToken('legacy');
        const stamp = timestampFromDate(new Date(NOW));
        await deps.documents.set(FIRESTORE_PATHS.pushDevice('u-admin', deviceIdOf(fid)), pushDeviceDocSchema, {
            ...{ token: fid, lang: 'ro', createdAt: stamp, updatedBy: 'u-admin', updatedAt: stamp },
        });

        await expect(sendTestFunction(() => deps).run(adminCall({}))).resolves.toEqual({ sent: 1, removed: 0 });

        expect(deps.upstream.state.fcm.messages).toMatchObject([{ token: fid, kind: 'fid' }]);
        // A browser that says it registered an installation id is checked and stored as one.
        const browser = fcmToken('browser');
        await registerDeviceFunction(() => deps).run(adminCall({ token: browser, kind: 'fid', lang: 'en' }));
        await expect(
            deps.documents.get(FIRESTORE_PATHS.pushDevice('u-admin', deviceIdOf(browser)), pushDeviceDocSchema),
        ).resolves.toMatchObject({
            kind: 'fid',
        });
    });
});

describe('notify.unregisterDevice and notify.sendTest', () => {
    it('happyPath_aTestReachesTheCallersDevicesAndAnUnregisteredOneIsForgotten @S-A47-HAPPY-TOKEN', async () => {
        const deps = m4Deps(NOW);
        const [kept, gone] = [fcmToken('kept'), fcmToken('gone')];
        await register(deps, kept, 'en');
        await register(deps, gone);
        await register(deps, fcmToken('other'), 'ro', 'u-second');
        deps.upstream.state.fcm.unregistered.add(gone);

        await expect(sendTestFunction(() => deps).run(adminCall({}))).resolves.toEqual({ sent: 1, removed: 1 });

        expect(deps.upstream.state.fcm.messages).toEqual([
            {
                token: kept,
                kind: 'token',
                notification: {
                    title: 'Notifications',
                    body: 'Test notification: notifications work on this device.',
                    tag: `test-${String(Date.parse(NOW))}`,
                },
                link: 'https://demo-hcm.web.app/#/inbox',
            },
        ]);
        expect(deps.documents.paths('admins/u-admin/pushDevices/')).toEqual([`admins/u-admin/pushDevices/${deviceIdOf(kept)}`]);
    });

    it('happyPath_aBrowserTurnedOffIsRemovedOnceThenNothingIsLeft', async () => {
        const deps = m4Deps(NOW);
        const token = fcmToken('laptop');
        await register(deps, token);
        const unregister = () => unregisterDeviceFunction(() => deps).run(adminCall({ deviceId: deviceIdOf(token) }));

        await expect(unregister()).resolves.toEqual({ removed: true });
        await expect(unregister()).resolves.toEqual({ removed: false });
        await expect(sendTestFunction(() => deps).run(adminCall({}))).resolves.toEqual({ sent: 0, removed: 0 });
    });

    it('badPath_anFcmOutageDuringTheTestSaysSo', async () => {
        const deps = m4Deps(NOW);
        await register(deps, fcmToken('laptop'));
        deps.upstream.fail('fcm', 'forbidden');

        await expect(failureOf(sendTestFunction(() => deps).run(adminCall({})))).resolves.toMatchObject({
            details: { code: 'apiError.cloud.permission' },
        });
    });
});

describe('pushFailure', () => {
    it('happyPath_anythingButAnUpstreamFailurePassesThrough', () => {
        const error = new Error('boom');

        expect(pushFailure(error)).toBe(error);
        expect(pushFailure(new UpstreamError('fcm', 'invalid'))).toMatchObject({ code: 'apiError.unavailable' });
    });
});
