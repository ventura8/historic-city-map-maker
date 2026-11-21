/** A crash report as Cloud Error Reporting reads it (`functions/src/telemetry/error-event.ts`). */
import { REPORTED_ERROR_EVENT_TYPE, REPORTED_EVENT_MAX_BYTES, reportedErrorEventSchema, type ErrorReport } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { reportLocation, toReportedErrorEvent } from '../../src/telemetry/error-event.js';

const PAGE = 'https://viewer.e2e.test/bucharest/';

function report(overrides: Partial<ErrorReport> = {}): ErrorReport {
    return {
        message: 'TypeError: map is undefined',
        release: '1.2.3',
        cityId: 'bucharest',
        page: PAGE,
        viewport: { width: 360, height: 800 },
        windowClass: 'compact',
        locale: 'ro',
        fatal: false,
        source: 'window',
        ...overrides,
    };
}

/** The UTF-8 size of an event as it is logged. */
function bytesOf(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

describe('toReportedErrorEvent: the size of a logged entry', () => {
    it('badPath_theLargestReportIsLoggedWithinTheCapItsMessageCut @S-A24-BAD-TOO-LARGE', () => {
        // Multi-byte characters everywhere the schema allows them, the page named twice (the request and the location).
        const page = `https://viewer.e2e.test/${'ă'.repeat(2000)}`;
        const stack = `TypeError: ${'ș'.repeat(1000)}\n${'    at ț (https://viewer.e2e.test/a.js:1:1)\n'.repeat(160)}`.slice(0, 8000);
        const event = toReportedErrorEvent(report({ message: 'î'.repeat(1000), stack, page }), 'viewer');

        expect(bytesOf(event)).toBeLessThanOrEqual(REPORTED_EVENT_MAX_BYTES);
        expect(event.message.length).toBeGreaterThan(1000);
        expect(reportedErrorEventSchema.safeParse(event).success).toBe(true);
    });

    it('happyPath_aSmallReportIsLoggedWhole', () => {
        const event = toReportedErrorEvent(
            report({ stack: 'TypeError: map is undefined\n    at draw (https://viewer.e2e.test/a.js:1:1)' }),
            'admin',
        );

        expect(event.message).toBe('TypeError: map is undefined\n    at draw (https://viewer.e2e.test/a.js:1:1)');
    });

    it('badPath_aLimitBelowTheFixedFieldsKeepsOneCharacterOfTheMessage', () => {
        const event = toReportedErrorEvent(report(), 'viewer', 100);

        expect(event.message).toBe('T');
    });
});

describe('toReportedErrorEvent', () => {
    it('happyPath_aV8StackIsTheMessageAndItsFirstFrameTheLocation', () => {
        const stack =
            'TypeError: map is undefined\n    at draw (https://viewer.e2e.test/engine.mjs:120:7)\n    at https://viewer.e2e.test/x.js:1:1';

        const event = toReportedErrorEvent(report({ stack }), 'viewer');

        expect(reportedErrorEventSchema.safeParse(event).success).toBe(true);
        expect(event).toEqual({
            '@type': REPORTED_ERROR_EVENT_TYPE,
            message: stack,
            serviceContext: { service: 'viewer', version: '1.2.3' },
            context: {
                httpRequest: { url: PAGE },
                reportLocation: { filePath: 'https://viewer.e2e.test/engine.mjs', lineNumber: 120, functionName: 'draw' },
            },
            hcm: {
                cityId: 'bucharest',
                windowClass: 'compact',
                locale: 'ro',
                viewport: { width: 360, height: 800 },
                fatal: false,
                source: 'window',
            },
        });
    });

    it('happyPath_aFirefoxStackGetsTheMessageInFrontOfIt', () => {
        const event = toReportedErrorEvent(report({ stack: 'draw@https://viewer.e2e.test/engine.mjs:120:7\n' }), 'admin');

        expect(event.message).toBe('TypeError: map is undefined\ndraw@https://viewer.e2e.test/engine.mjs:120:7\n');
        expect(event.serviceContext.service).toBe('admin');
        expect(event.context.reportLocation).toEqual({
            filePath: 'https://viewer.e2e.test/engine.mjs',
            lineNumber: 120,
            functionName: 'draw',
        });
    });

    it('happyPath_tokensAddressesAndQueriesAreRedactedEverywhere', () => {
        const secret = ['pk', 'e2e-public-token-value'].join('.');
        const event = toReportedErrorEvent(
            report({
                message: `Tile https://api.mapbox.com/v4/x.png?access_token=${secret} failed for ana@example.test`,
                stack: `Error\n    at load (https://viewer.e2e.test/engine.mjs?token=${secret}:3:9)`,
                release: `1.2.3 ${'r'.repeat(51)} a@b.cd`,
                windowClass: 'a@b.cd b@b.cd c@b.cd d@b.cd',
                locale: 'ro a@b.cd b@b.cd',
            }),
            'viewer',
        );

        const text = JSON.stringify(event);
        expect(text).not.toContain(secret);
        expect(text).not.toContain('ana@example.test');
        expect(text).not.toContain('a@b.cd');
        expect(reportedErrorEventSchema.safeParse(event).success).toBe(true);
        expect(event.context.reportLocation).toEqual({
            filePath: 'https://viewer.e2e.test/engine.mjs',
            lineNumber: 3,
            functionName: 'load',
        });
        expect(event.serviceContext.version).toHaveLength(64);
    });

    it('happyPath_withoutAStackTheMessageAloneIsReported', () => {
        const event = toReportedErrorEvent(report({ source: 'boundary' }), 'viewer');

        expect(event.message).toBe('TypeError: map is undefined');
        expect(event.context.reportLocation).toEqual({ filePath: PAGE, lineNumber: 0, functionName: '<boundary>' });
    });

    it('badPath_aStackWithoutAReadableFrameIsLocatedAtThePage', () => {
        const event = toReportedErrorEvent(
            report({ source: 'promise', stack: 'Error: x\n    at native code\n    at <anonymous>' }),
            'viewer',
        );

        expect(event.context.reportLocation).toEqual({ filePath: PAGE, lineNumber: 0, functionName: '<promise>' });
    });
});

describe('reportLocation', () => {
    it.each([
        [
            'an anonymous Safari frame',
            '@https://viewer.e2e.test/a.js:5:2',
            { filePath: 'https://viewer.e2e.test/a.js', lineNumber: 5, functionName: '<anonymous>' },
        ],
        [
            'a V8 frame without a function',
            '    at https://viewer.e2e.test/a.js:6:1',
            { filePath: 'https://viewer.e2e.test/a.js', lineNumber: 6, functionName: '<anonymous>' },
        ],
        [
            'a frame without a line',
            'f@https://viewer.e2e.test/a.js\n g@b.js:x:1',
            { filePath: PAGE, lineNumber: 0, functionName: '<boundary>' },
        ],
        ['no stack at all', undefined, { filePath: PAGE, lineNumber: 0, functionName: '<boundary>' }],
    ])('happyPath_%s', (_case, stack, location) => {
        expect(reportLocation(stack, PAGE, 'boundary')).toEqual(location);
    });
});
