/** The M4 callables' requests and answers (docs/research/M4-interfaces.md §1.4, §4.3, §5.4). */
import { describe, expect, it } from 'vitest';

import {
    assistSuggestTitleResponseSchema,
    assistTranslateDraftRequestSchema,
    assistTranslateDraftResponseSchema,
    geocodeTaskSchema,
} from '../../src/api/assist.js';
import {
    notifyRegisterDeviceRequestSchema,
    notifySendTestResponseSchema,
    notifyUnregisterDeviceRequestSchema,
} from '../../src/api/notify.js';
import {
    usgsCancelOrderResponseSchema,
    usgsCheckOrderResponseSchema,
    usgsMarkOrderedRequestSchema,
    usgsMarkOrderedResponseSchema,
} from '../../src/api/orders.js';
import { validate } from '../../src/schemas/validation.js';

describe('the order callables', () => {
    it('happyPath_markCheckAndCancel', () => {
        expect(validate(usgsMarkOrderedRequestSchema, { cityId: 'bucharest', entityId: 'DS1105-1071DF076' }).ok).toBe(true);
        expect(validate(usgsMarkOrderedResponseSchema, { state: 'ordered', nextCheckAt: '2026-10-25T08:00:00.000Z' }).ok).toBe(true);
        expect(validate(usgsCheckOrderResponseSchema, { state: 'importing', available: true, jobId: 'job-1' }).ok).toBe(true);
        expect(validate(usgsCancelOrderResponseSchema, { state: 'needsOrder' }).ok).toBe(true);
    });

    it.each([
        ['a scene id with a slash', usgsMarkOrderedRequestSchema, { cityId: 'bucharest', entityId: 'a/b' }],
        ['a mark that answers delivered', usgsMarkOrderedResponseSchema, { state: 'delivered', nextCheckAt: '2026-10-25T08:00:00.000Z' }],
        ['a check without availability', usgsCheckOrderResponseSchema, { state: 'ordered' }],
    ] as const)('badPath_%s_isRefused', (_name, schema, value) => {
        expect(schema.safeParse(value).success).toBe(false);
    });
});

describe('the assist callables', () => {
    it('happyPath_aTranslationRequestAndItsDraft', () => {
        expect(
            validate(assistTranslateDraftRequestSchema, { cityId: 'bucharest', field: 'title', from: 'ro', to: 'en', text: 'Casa Capșa' })
                .ok,
        ).toBe(true);
        expect(
            validate(assistTranslateDraftResponseSchema, { draft: 'Capșa House', truncated: false, model: 'gemini-3.5-flash-lite' }).ok,
        ).toBe(true);
    });

    it.each([
        ['the same language both ways', { from: 'ro', to: 'ro', text: 'Casa' }],
        ['a title longer than a title', { from: 'ro', to: 'en', text: 'x'.repeat(201) }],
        ['an empty text', { from: 'ro', to: 'en', text: '   ' }],
    ])('badPath_%s_isRefused', (_name, changes) => {
        expect(validate(assistTranslateDraftRequestSchema, { cityId: 'bucharest', field: 'title', ...changes }).ok).toBe(false);
    });

    it('happyPath_aQueuedSuggestionAndItsTask', () => {
        const queued = { state: 'queued', key: 'n444268_e261025', suggestions: [], attribution: 'Data © OpenStreetMap contributors' };

        expect(validate(assistSuggestTitleResponseSchema, queued).ok).toBe(true);
        expect(validate(geocodeTaskSchema, { key: 'n444268_e261025' }).ok).toBe(true);
        expect(validate(geocodeTaskSchema, { key: '44.4,26.1' }).ok).toBe(false);
    });
});

describe('the push callables', () => {
    it('happyPath_registerUnregisterAndTest', () => {
        expect(validate(notifyRegisterDeviceRequestSchema, { token: 'fcm:abcdefghijklmnopqrstuvwxyz', lang: 'en' }).ok).toBe(true);
        expect(validate(notifyUnregisterDeviceRequestSchema, { deviceId: 'a1b2c3d4'.repeat(4) }).ok).toBe(true);
        expect(validate(notifySendTestResponseSchema, { sent: 1, removed: 0 }).ok).toBe(true);
    });

    it.each([
        ['a short token', notifyRegisterDeviceRequestSchema, { token: 'abc', lang: 'en' }],
        ['a language the admin has not', notifyRegisterDeviceRequestSchema, { token: 'fcm:abcdefghijklmnopqrstuvwxyz', lang: 'de' }],
        ['a device id that is a token', notifyUnregisterDeviceRequestSchema, { deviceId: 'fcm:abc' }],
    ] as const)('badPath_%s_isRefused', (_name, schema, value) => {
        expect(schema.safeParse(value).success).toBe(false);
    });
});
