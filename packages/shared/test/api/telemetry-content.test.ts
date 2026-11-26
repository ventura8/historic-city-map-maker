import { describe, expect, it } from 'vitest';

import {
    buildManifestTaskSchema,
    manifestTaskId,
    MANIFEST_DEBOUNCE_SECONDS,
    rebuildManifestResponseSchema,
} from '../../src/api/content.js';
import {
    errorReportSchema,
    listGroupsRequestSchema,
    listGroupsResponseSchema,
    REPORTED_ERROR_EVENT_TYPE,
    reportedErrorEventSchema,
} from '../../src/api/telemetry.js';
import { validate } from '../../src/schemas/validation.js';

/** What the engine's ErrorReporter sends (packages/engine/src/telemetry/errors.ts). */
const report = {
    message: 'TypeError: x is undefined',
    stack: 'TypeError: x is undefined\n    at load (https://ventura8.github.io/engine/engine.mjs:1:2)',
    release: '0.0.0',
    cityId: 'bucuresti',
    page: 'https://ventura8.github.io/bucurestiuldisparut.github.io/',
    viewport: { width: 360, height: 800 },
    windowClass: 'compact',
    locale: 'ro',
    fatal: false,
    source: 'window',
};

describe('error reports', () => {
    it('happyPath_theEnginesReportValidates', () => {
        expect(validate(errorReportSchema, report)).toMatchObject({ ok: true });
    });

    it('happyPath_aReportBeforeTheManifestLoaded', () => {
        expect(validate(errorReportSchema, { ...report, cityId: '', locale: '', windowClass: '' })).toMatchObject({ ok: true });
    });

    it.each([
        ['a page with its hash', { ...report, page: 'https://ventura8.github.io/#15/44.4/26.1' }, 'page'],
        ['a page with a query', { ...report, page: 'https://ventura8.github.io/?lang=en' }, 'page'],
        ['an unknown source', { ...report, source: 'console' }, 'source'],
        ['an extra field', { ...report, email: 'a@example.test' }, 'email'],
        ['a city id with a slash', { ...report, cityId: 'a/b' }, 'cityId'],
        ['an empty message', { ...report, message: '' }, 'message'],
    ])('badPath_%s', (_name, input, path) => {
        const result = validate(errorReportSchema, input);

        expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain(path);
    });

    it('happyPath_theStructuredLogEntry', () => {
        const event = {
            '@type': REPORTED_ERROR_EVENT_TYPE,
            message: report.stack,
            serviceContext: { service: 'viewer', version: report.release },
            context: {
                httpRequest: { url: report.page },
                reportLocation: { filePath: report.page, lineNumber: 0, functionName: 'unknown' },
            },
            hcm: { cityId: 'bucuresti', windowClass: 'compact', locale: 'ro', viewport: report.viewport, fatal: false, source: 'window' },
        };

        expect(validate(reportedErrorEventSchema, event)).toMatchObject({ ok: true });
        expect(validate(reportedErrorEventSchema, { ...event, serviceContext: { service: 'pipeline', version: '1' } })).toMatchObject({
            ok: false,
        });
    });

    it('happyPath_listGroups', () => {
        expect(validate(listGroupsRequestSchema, { hours: 24, pageSize: 20 })).toMatchObject({ ok: true });
        expect(
            validate(listGroupsResponseSchema, {
                groups: [
                    {
                        groupId: 'CNrA7p',
                        message: 'TypeError: x is undefined',
                        service: 'viewer',
                        count: 3,
                        firstSeen: '2026-10-12T08:30:00.000Z',
                        lastSeen: '2026-10-12T09:30:00.000Z',
                        resolution: 'OPEN',
                    },
                ],
            }),
        ).toMatchObject({ ok: true });
    });

    it('badPath_listGroupsOverAnUnsupportedWindow', () => {
        expect(validate(listGroupsRequestSchema, { hours: 48, pageSize: 20 })).toMatchObject({ ok: false });
    });
});

describe('manifest builds', () => {
    it('happyPath_writesOfOneWindowShareATaskId', () => {
        const start = new Date(Date.UTC(2026, 9, 12, 8, 30, 0));
        const later = new Date(start.getTime() + (MANIFEST_DEBOUNCE_SECONDS - 1) * 1000);

        expect(manifestTaskId('bucuresti', start)).toBe(manifestTaskId('bucuresti', later));
        expect(manifestTaskId('bucuresti', start)).toMatch(/^manifest-bucuresti-\d+$/);
    });

    it('badPath_theNextWindowGetsANewTask', () => {
        const start = new Date(Date.UTC(2026, 9, 12, 8, 30, 0));
        const next = new Date(start.getTime() + MANIFEST_DEBOUNCE_SECONDS * 1000);

        expect(manifestTaskId('bucuresti', next)).not.toBe(manifestTaskId('bucuresti', start));
    });

    it('happyPath_taskAndResponse', () => {
        expect(validate(buildManifestTaskSchema, { cityId: 'bucuresti', requestedVersion: 3, full: false })).toMatchObject({ ok: true });
        expect(validate(rebuildManifestResponseSchema, { requestedVersion: 3, queued: false })).toMatchObject({ ok: true });
    });

    it('badPath_aTaskForVersionZero', () => {
        expect(validate(buildManifestTaskSchema, { cityId: 'bucuresti', requestedVersion: 0, full: true })).toEqual({
            ok: false,
            issues: [{ path: 'requestedVersion', code: 'validation.tooSmall' }],
        });
    });
});
