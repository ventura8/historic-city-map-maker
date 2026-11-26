/**
 * This browser's push registration (`packages/admin/src/inbox/push-device.ts`; `docs/research/M4-interfaces.md` §5.4):
 * the record names the admin it belongs to, anything else under the key is no record, and sign-out unregisters the
 * admin's own registration from this browser (best effort) and forgets it, never another admin's. Generated test values.
 */
import { describe, expect, it } from 'vitest';

import { PUSH_DEVICE_KEY, pushDeviceOf, rememberPushDevice, storedPushDevice, unregisterOnSignOut } from '../../src/inbox/push-device.js';
import { FakeCallables, MemoryStore, failure } from '../app/fakes.js';

const DEVICE = 'd'.repeat(32);

describe('the push registration this browser keeps', () => {
    it('happyPath_aRecordIsItsAdminsOnly', () => {
        const local = new MemoryStore();
        rememberPushDevice(local, 'admin-a', DEVICE);

        expect(storedPushDevice(local)).toEqual({ uid: 'admin-a', deviceId: DEVICE });
        expect(pushDeviceOf(local, 'admin-a')).toBe(DEVICE);
        expect(pushDeviceOf(local, 'admin-b')).toBeNull();
        expect(pushDeviceOf(local, null)).toBeNull();
    });

    it.each([
        ['an older version’s bare id', DEVICE],
        ['text that is no JSON', '{oops'],
        ['JSON that is no object', 'null'],
        ['an object without a device id', JSON.stringify({ uid: 'admin-a' })],
    ])('badPath_%s_isNoRecord', (_name, raw) => {
        const local = new MemoryStore();
        local.set(PUSH_DEVICE_KEY, raw);

        expect(storedPushDevice(local)).toBeNull();
        expect(pushDeviceOf(local, 'admin-a')).toBeNull();
    });
});

describe('sign-out', () => {
    it('happyPath_theAdminsOwnRegistrationIsUnregisteredAndForgotten', async () => {
        const local = new MemoryStore();
        const callables = new FakeCallables();
        callables.answer('notify.unregisterDevice', () => ({ removed: true }));
        rememberPushDevice(local, 'admin-a', DEVICE);

        await unregisterOnSignOut({ local, callables, uid: 'admin-a' });

        expect(callables.calls.map((call) => [call.name, call.request])).toEqual([['notify.unregisterDevice', { deviceId: DEVICE }]]);
        expect(storedPushDevice(local)).toBeNull();
    });

    it('badPath_anUnreachableServerStillForgetsTheRecord', async () => {
        const local = new MemoryStore();
        const callables = new FakeCallables();
        callables.fail('notify.unregisterDevice', failure('unavailable', 'apiError.unavailable'));
        rememberPushDevice(local, 'admin-a', DEVICE);

        await expect(unregisterOnSignOut({ local, callables, uid: 'admin-a' })).resolves.toBeUndefined();

        expect(storedPushDevice(local)).toBeNull();
    });

    it.each([
        ['another admin’s registration', 'admin-b'],
        ['nobody signed in', null],
    ])('badPath_%s_isLeftAsItIs', async (_name, uid) => {
        const local = new MemoryStore();
        const callables = new FakeCallables();
        rememberPushDevice(local, 'admin-a', DEVICE);

        await unregisterOnSignOut({ local, callables, uid });

        expect(callables.calls).toEqual([]);
        expect(storedPushDevice(local)).toEqual({ uid: 'admin-a', deviceId: DEVICE });
    });
});
