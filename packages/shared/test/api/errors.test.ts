import { describe, expect, it } from 'vitest';

import {
    API_ERRORS,
    apiErrorDetails,
    apiErrorDetailsSchema,
    apiErrorFromFailure,
    apiErrorParamsSchema,
    FUNCTIONS_ERROR_STATUSES,
    MAX_ERROR_ISSUES,
} from '../../src/api/errors.js';
import { en } from '../../src/i18n/api/en.js';
import { API_ERROR_CODES, isApiErrorCode, translateApiError } from '../../src/i18n/api/index.js';
import { ro } from '../../src/i18n/api/ro.js';

describe('API error codes', () => {
    it('happyPath_everyCodeHasAStatusAndBothMessages', () => {
        expect(Object.keys(API_ERRORS)).toEqual(API_ERROR_CODES);
        expect(Object.keys(en)).toEqual(Object.keys(ro));
        for (const code of API_ERROR_CODES) {
            expect(FUNCTIONS_ERROR_STATUSES).toContain(API_ERRORS[code].status);
        }
    });

    it('happyPath_statusesMapToTheirHttpStatusAndRetry', () => {
        expect(API_ERRORS['apiError.notAdmin']).toEqual({ status: 'permission-denied', httpStatus: 403, retryable: false });
        expect(API_ERRORS['apiError.usgs.maintenance']).toEqual({ status: 'unavailable', httpStatus: 503, retryable: true });
        expect(API_ERRORS['apiError.rateLimited']).toEqual({ status: 'resource-exhausted', httpStatus: 429, retryable: true });
        expect(API_ERRORS['apiError.telemetry.tooLarge']).toEqual({ status: 'invalid-argument', httpStatus: 413, retryable: false });
    });

    it('happyPath_translatesWithParameters', () => {
        expect(translateApiError('en', 'apiError.mapbox.missingScopes', { scopes: 'tokens:write' })).toBe(
            'The token lacks these scopes: tokens:write. Create it again with all of them.',
        );
        expect(translateApiError('ro', 'apiError.notAdmin')).toBe('Acest cont Google nu administrează harta.');
    });

    it('badPath_anUnknownPlaceholderStaysVisible', () => {
        expect(translateApiError('ro', 'apiError.claim.notOwner')).toContain('{projectId}');
    });

    it('badPath_anAsideWithoutItsValueIsDropped_withItsValueItIsFilled', () => {
        expect(translateApiError('en', 'apiError.history.invalidSnapshot')).toBe(
            'The earlier version is no longer valid and cannot be restored.',
        );
        expect(translateApiError('en', 'apiError.history.invalidSnapshot', { count: '2' })).toBe(
            'The earlier version is no longer valid and cannot be restored (problems: 2).',
        );
        expect(translateApiError('en', 'apiError.invalidRequest', { count: '2' })).toBe(
            'The server refused a value of this form (the log names the field). Correct it and try again.',
        );
    });

    it.each([
        ['apiError.internal', true],
        ['validation.required', false],
        ['toString', false],
        [42, false],
    ])('isApiErrorCode_%s', (value, expected) => {
        expect(isApiErrorCode(value)).toBe(expected);
    });
});

describe('apiErrorDetails', () => {
    it('happyPath_aCodeAloneAndWithParameters', () => {
        expect(apiErrorDetails('apiError.notFound')).toEqual({ code: 'apiError.notFound' });
        expect(apiErrorDetails('apiError.cloud.permission', { role: 'roles/firebase.viewer' })).toEqual({
            code: 'apiError.cloud.permission',
            params: { role: 'roles/firebase.viewer' },
        });
    });

    it('badPath_invalidRequestCarriesTheFirstIssuesAndTheirCount', () => {
        const issues = Array.from({ length: MAX_ERROR_ISSUES + 5 }, (_, index) => ({
            path: `f${String(index)}`,
            code: 'validation.required' as const,
        }));

        const details = apiErrorDetails('apiError.invalidRequest', undefined, issues);

        expect(details.params).toEqual({ count: String(MAX_ERROR_ISSUES + 5) });
        expect(details.issues).toHaveLength(MAX_ERROR_ISSUES);
        expect(apiErrorDetailsSchema.safeParse(details).success).toBe(true);
    });

    it.each([
        ['details without a code', {}],
        ['an unknown code', { code: 'apiError.nope' }],
        [
            'markup-free but too many parameters',
            { code: 'apiError.internal', params: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`p${'x'.repeat(i)}`, 'v'])) },
        ],
        [
            'an issue code that is no validation code',
            { code: 'apiError.invalidRequest', issues: [{ path: 'x', code: 'apiError.internal' }] },
        ],
    ])('badPath_%s_isRefused', (_name, details) => {
        expect(apiErrorDetailsSchema.safeParse(details).success).toBe(false);
    });

    it('badPath_aParameterNameWithDigitsIsRefused', () => {
        expect(apiErrorParamsSchema.safeParse({ p1: 'x' }).success).toBe(false);
    });
});

describe('apiErrorFromFailure', () => {
    it('happyPath_theServersDetailsWin', () => {
        expect(apiErrorFromFailure('functions/permission-denied', { code: 'apiError.claim.notOwner', params: { projectId: 'p' } })).toEqual(
            {
                code: 'apiError.claim.notOwner',
                params: { projectId: 'p' },
            },
        );
    });

    it.each([
        ['functions/unauthenticated', 'apiError.unauthenticated'],
        ['functions/permission-denied', 'apiError.notAdmin'],
        ['not-found', 'apiError.notFound'],
        ['functions/aborted', 'apiError.conflict'],
        ['functions/resource-exhausted', 'apiError.rateLimited'],
        ['functions/unavailable', 'apiError.unavailable'],
        ['functions/deadline-exceeded', 'apiError.unavailable'],
        ['functions/invalid-argument', 'apiError.invalidRequest'],
        ['functions/internal', 'apiError.internal'],
        [undefined, 'apiError.internal'],
    ])('badPath_withoutDetails_%s_fallsBackTo_%s', (status, code) => {
        expect(apiErrorFromFailure(status, { message: 'old server' })).toEqual({ code });
    });
});

describe('the join refusals (docs/research/M8-join-interfaces.md §4)', () => {
    it.each([
        [
            'apiError.imagery.joinMixedFrames',
            {},
            'Only frames of one date and one camera can be joined.',
            'Se pot uni doar cadre din aceeași zi și de la aceeași cameră.',
        ],
        [
            'apiError.imagery.joinPartHeld',
            { frame: 'F039' },
            'Frame F039 is being joined; reject or cancel the join first.',
            'Cadrul F039 este în curs de unire; respinge sau anulează mai întâi unirea.',
        ],
        [
            'apiError.imagery.joinSeamTooFar',
            { a: 'F039', b: 'F040' },
            'Frames F039 and F040 are too far apart to join; fix the points of one.',
            'Cadrele F039 și F040 sunt prea departe pentru a fi unite; corectează punctele unuia.',
        ],
    ] as const)('happyPath_%s_readsInBothLanguages', (code, params, en, ro) => {
        expect(translateApiError('en', code, params)).toBe(en);
        expect(translateApiError('ro', code, params)).toBe(ro);
    });
});
