/** Notifications (M4, behaviours A46 and A47; docs/research/M4-interfaces.md §5): events, inbox items, settings, devices. */
import { describe, expect, it } from 'vitest';

import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import {
    DEFAULT_PUSH_KINDS,
    inboxItemDocSchema,
    NOTIFICATION_KINDS,
    NOTIFICATION_SPECS,
    notificationEventDocSchema,
    notificationEventId,
    notifySettingsDocSchema,
    paramsIn,
    pushDeviceDocSchema,
    crashCounterDocSchema,
    wantsPush,
} from '../../src/schemas/notifications.js';
import { validate } from '../../src/schemas/validation.js';

const NOW = timestampFromDate(new Date('2026-10-24T08:00:00Z'));
const STAMP = { updatedBy: 'system:notify', updatedAt: NOW };

const event = {
    kind: 'order.reminder',
    severity: 'warning',
    cityId: 'bucharest',
    params: { days: '7', scene: 'KH-4B Corona, 11 December 1968' },
    link: '#/imagery/scene/DS1105-1071DF076',
    createdAt: NOW,
    ...STAMP,
};

describe('notification documents', () => {
    it('happyPath_anEventAndItsInboxItemValidate', () => {
        expect(validate(notificationEventDocSchema, { ...event, fannedOutAt: NOW, recipients: 2 }).ok).toBe(true);
        expect(validate(inboxItemDocSchema, { ...event, read: true, readAt: NOW, pushedAt: NOW }).ok).toBe(true);
    });

    it.each([
        ['a link to another site', { link: 'https://example.test/' }],
        ['a javascript link', { link: 'javascript:alert(1)' }],
        ['an unknown kind', { kind: 'order.paid' }],
        ['a city id with capitals', { cityId: 'Bucharest' }],
        ['too many parameters', { params: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`p${'x'.repeat(index)}`, 'v'])) }],
    ])('badPath_%s_isRefused', (_name, changes) => {
        expect(validate(notificationEventDocSchema, { ...event, ...changes }).ok).toBe(false);
    });

    it('happyPath_settingsAndADeviceValidate', () => {
        expect(validate(notifySettingsDocSchema, { push: true, pushKinds: ['job.failed'], ...STAMP }).ok).toBe(true);
        expect(validate(pushDeviceDocSchema, { token: 'fcm:abcdefghijklmnopqrstuvwxyz', lang: 'ro', createdAt: NOW, ...STAMP }).ok).toBe(
            true,
        );
    });

    it.each([
        ['a kind twice', notifySettingsDocSchema, { push: true, pushKinds: ['job.failed', 'job.failed'], ...STAMP }],
        ['a token with markup', pushDeviceDocSchema, { token: '<script>abcdefghijklmnopqrstu', lang: 'ro', createdAt: NOW, ...STAMP }],
    ] as const)('badPath_%s_isRefused', (_name, schema, document) => {
        expect(schema.safeParse(document).success).toBe(false);
    });
});

describe('event ids', () => {
    it('happyPath_theSameOccurrenceGetsTheSameId', () => {
        expect(notificationEventId('order.reminder', 'bucharest', 'DS1105-1071DF076', '7')).toBe(
            'order.reminder~bucharest~DS1105-1071DF076~7',
        );
    });

    it.each([
        ['no parts', []],
        ['a part with a slash', ['a/b']],
        ['five parts', ['a', 'b', 'c', 'd', 'e']],
    ])('badPath_%s_throws', (_name, parts) => {
        expect(() => notificationEventId('job.failed', ...parts)).toThrow(RangeError);
    });
});

describe('what is pushed', () => {
    it('happyPath_theDefaultsAreTheKindsMarkedForPush', () => {
        expect(DEFAULT_PUSH_KINDS).toEqual(NOTIFICATION_KINDS.filter((kind) => NOTIFICATION_SPECS[kind].push));
        expect(DEFAULT_PUSH_KINDS).toContain('order.reminder');
        expect(DEFAULT_PUSH_KINDS).toContain('layer.needsPoints');
        expect(DEFAULT_PUSH_KINDS).not.toContain('order.imported');
    });

    it.each([
        [undefined, false],
        [{ push: false, pushKinds: ['job.failed'] }, false],
        [{ push: true, pushKinds: ['budget.paused'] }, false],
        [{ push: true, pushKinds: ['job.failed'] }, true],
    ] as const)('happyPath_settings_%j_push_aFailedJob_%s', (settings, pushed) => {
        expect(
            wantsPush(settings === undefined ? undefined : { push: settings.push, pushKinds: [...settings.pushKinds] }, 'job.failed'),
        ).toBe(pushed);
    });
});

describe('parameters per language (CR-M4-8)', () => {
    const params = { label: 'Bucureşti 1966', labelEn: 'Bucharest 1966', count: '12' };

    it('happyPath_englishReadersGetTheEnglishParameter', () => {
        expect(paramsIn('en', params)).toEqual({ label: 'Bucharest 1966', count: '12' });
    });

    it('happyPath_romanianReadersGetTheirOwnAndNoEnglishKey', () => {
        expect(paramsIn('ro', params)).toEqual({ label: 'Bucureşti 1966', count: '12' });
    });

    it('badPath_anEnglishReaderWithoutAnEnglishTextGetsTheOnlyOne', () => {
        expect(paramsIn('en', { label: 'Bucureşti' })).toEqual({ label: 'Bucureşti' });
    });
});

describe('the crash-spike baseline (CR-M4-8)', () => {
    it('happyPath_aBaselineValidates', () => {
        expect(validate(crashCounterDocSchema, { baseline: 3, baselineAt: NOW, lastTotal: 5, ...STAMP }).ok).toBe(true);
    });

    it('badPath_aNegativeCountIsRefused', () => {
        expect(validate(crashCounterDocSchema, { baseline: -1, baselineAt: NOW, lastTotal: 5, ...STAMP }).ok).toBe(false);
    });
});
