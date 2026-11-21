import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { ro } from '../../src/i18n/ro.js';
import { coded, isId, tokenValueSchema } from '../../src/schemas/primitives.js';
import { formatPath, isValidationCode, toValidationIssues, validate } from '../../src/schemas/validation.js';

type Issue = z.core.$ZodIssue;

describe('validate', () => {
    it('badPath_schemasNeverProbeEvalUnderACsp', () => {
        // S-V16-BAD-INLINE-STYLE found it: zod's `Function('')` probe was a CSP violation on every city page.
        expect(z.config().jitless).toBe(true);
        expect(validate(z.strictObject({ id: z.string() }), { id: 'x' })).toEqual({ ok: true, value: { id: 'x' } });
    });

    it('happyPath_returnsTheParsedValue', () => {
        expect(validate(z.number().int(), 3)).toEqual({ ok: true, value: 3 });
    });

    it('badPath_returnsLocalizedIssues', () => {
        expect(validate(z.strictObject({ a: z.number() }), { b: 1 })).toEqual({
            ok: false,
            issues: [
                { path: 'a', code: 'validation.required' },
                { path: 'b', code: 'validation.unknownKey' },
            ],
        });
    });
});

describe('toValidationIssues', () => {
    const issue = (code: string, extra: Record<string, unknown> = {}): Issue =>
        ({ code, path: ['x', 0], message: 'zod text', ...extra }) as unknown as Issue;

    it.each([
        ['too_small', 'validation.tooSmall'],
        ['too_big', 'validation.tooBig'],
        ['invalid_format', 'validation.format'],
        ['invalid_key', 'validation.format'],
        ['invalid_value', 'validation.value'],
        ['invalid_union', 'validation.value'],
        ['invalid_element', 'validation.value'],
        ['not_multiple_of', 'validation.value'],
        ['a_future_zod_code', 'validation.invalid'],
    ])('happyPath_zodCode_%s_maps_to_%s', (code, expected) => {
        expect(toValidationIssues([issue(code)])).toEqual([{ path: 'x[0]', code: expected }]);
    });

    it('happyPath_aCustomIssueCarriesItsCode', () => {
        expect(toValidationIssues([issue('custom', { message: 'validation.bounds' })])).toEqual([
            { path: 'x[0]', code: 'validation.bounds' },
        ]);
    });

    it('badPath_aCustomIssueWithForeignTextIsInvalid', () => {
        expect(toValidationIssues([issue('custom', { message: 'Invalid input' })])).toEqual([{ path: 'x[0]', code: 'validation.invalid' }]);
    });

    it('happyPath_missingVersusWrongType', () => {
        expect(
            toValidationIssues([issue('invalid_type', { input: undefined }), issue('invalid_type', { input: 'x' })]).map(
                (entry) => entry.code,
            ),
        ).toEqual(['validation.required', 'validation.type']);
    });
});

describe('formatPath and codes', () => {
    it.each([
        [[], ''],
        [['city'], 'city'],
        [['city', 'bounds', 0, 1], 'city.bounds[0][1]'],
        [[0, 'id'], '[0].id'],
        [[Symbol.for('s')], 'Symbol(s)'],
    ] as const)('happyPath_%j_is_%s', (path, expected) => {
        expect(formatPath(path)).toBe(expected);
    });

    it('happyPath_everyValidationKeyIsACode', () => {
        const keys = Object.keys(ro).filter((key) => key.startsWith('validation.'));

        expect(keys.length).toBeGreaterThan(10);
        expect(keys.every(isValidationCode)).toBe(true);
        expect(keys.map((key) => key.replace('validation.', 'validation.x')).some(isValidationCode)).toBe(false);
    });

    it('badPath_otherKeysAreNotCodes', () => {
        expect([isValidationCode('error.generic'), isValidationCode('validation.nope')]).toEqual([false, false]);
    });
});

describe('primitives', () => {
    it.each([
        ['bucuresti', true],
        ['a_B-9', true],
        ['x'.repeat(40), true],
        ['x'.repeat(41), false],
        ['', false],
        ['a b', false],
        ['<b>', false],
        [42, false],
    ])('happyPath_isId_%s_is_%s', (value, expected) => {
        expect(isId(value)).toBe(expected);
    });

    it('happyPath_codedOptionsWithAndWithoutPath', () => {
        expect(coded('validation.bounds')).toEqual({ message: 'validation.bounds' });
        expect(coded('validation.bounds', ['a', 1])).toEqual({ message: 'validation.bounds', path: ['a', 1] });
    });

    it.each([['#875329'], ['rgb(1 2 3 / 50%)'], ['12px'], ['Roboto Flex, sans-serif']])('happyPath_tokenValue_%s', (value) => {
        expect(tokenValueSchema.safeParse(value).success).toBe(true);
    });

    it.each([['red;}body{x'], ['"x"'], ['URL(x)'], ['a:b'], ['\\x'], ['x'.repeat(101)]])('badPath_tokenValue_%s', (value) => {
        expect(tokenValueSchema.safeParse(value).success).toBe(false);
    });
});
