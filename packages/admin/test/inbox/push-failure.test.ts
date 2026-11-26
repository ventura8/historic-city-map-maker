/**
 * Why push did not start (`packages/admin/src/inbox/push-failure.ts`; finding 46 of docs/research/manual-test-2026-10-25.md):
 * the SDK's code kept, FCM's refusal named, one reason line per family, and no id, token or key in what is logged.
 */
import { describe, expect, it } from 'vitest';

import { fcmRefusalOf, PushFailure, pushFailureOf, pushReason, redactIds } from '../../src/inbox/push-failure.js';

describe('pushFailureOf', () => {
    it('happyPath_aFirebaseErrorKeepsItsCodeAndItsErrorInfoWithoutIds', () => {
        const failure = pushFailureOf({
            code: 'installations/request-failed',
            message: 'Installations: Create Installation request failed with error "403 PERMISSION_DENIED"',
            customData: { errorInfo: 'Requests to this API firebaseinstallations method are blocked for key AIzaSyE2e0123456789' },
        });

        expect(failure).toBeInstanceOf(PushFailure);
        expect(failure.code).toBe('installations/request-failed');
        expect(failure.info).toBe('Requests to this API firebaseinstallations method are blocked for key [id]');
    });

    it('badPath_anythingElseIsUnknownWithItsMessage', () => {
        expect(pushFailureOf(new Error('chunk failed to load'))).toMatchObject({ code: 'push/unknown', info: 'chunk failed to load' });
        expect(pushFailureOf({ code: 'Messaging/<b>', message: 42 })).toMatchObject({ code: 'push/unknown', info: '' });
        expect(pushFailureOf(null)).toMatchObject({ code: 'push/unknown', info: '' });
        const own = new PushFailure('push/no-service-worker');
        expect(pushFailureOf(own)).toBe(own);
    });

    it('badPath_aLongTextIsCutAndEveryIdReplaced', () => {
        expect(redactIds('fid cXg2c2RkZGRk0 token e2e-fcm-token:x-browser-0001 CreateRegistration')).toBe(
            'fid [id] token [id] CreateRegistration',
        );
        expect(redactIds('x'.repeat(300))).toHaveLength(200);
    });
});

describe('fcmRefusalOf and pushReason', () => {
    it('happyPath_fcmsCodeIsNamed_andEachFamilyHasItsLine', () => {
        expect(fcmRefusalOf({ key: 'apiError.notify.deviceInvalid', params: { reason: 'UNREGISTERED' } })).toBe('fcm/UNREGISTERED');
        expect(pushReason('fcm/UNREGISTERED')).toEqual({
            key: 'adminContent.notify.push.reason.fcmRefused',
            params: { code: 'fcm/UNREGISTERED' },
        });
        expect(
            [
                'messaging/permission-blocked',
                'messaging/fid-registration-failed',
                'push/worker-registration-failed',
                'messaging/unsupported-browser',
                'messaging/fid-registration-idb-schema-unavailable',
                'installations/request-failed',
                'push/unknown',
            ].map((code) => pushReason(code).key),
        ).toEqual([
            'adminContent.notify.push.reason.permission',
            'adminContent.notify.push.reason.registration',
            'adminContent.notify.push.reason.worker',
            'adminContent.notify.push.reason.unsupported',
            'adminContent.notify.push.reason.storage',
            'adminContent.notify.push.reason.installations',
            'adminContent.notify.push.reason.other',
        ]);
    });

    it('badPath_anOlderServerNamesNoReason_andOtherFailuresAreNoRefusal', () => {
        expect(fcmRefusalOf({ key: 'apiError.notify.deviceInvalid' })).toBe('fcm/UNSPECIFIED');
        expect(fcmRefusalOf({ key: 'apiError.notify.deviceInvalid', params: { reason: 'not a code' } })).toBe('fcm/UNSPECIFIED');
        expect(fcmRefusalOf({ key: 'apiError.unavailable' })).toBeNull();
    });
});
