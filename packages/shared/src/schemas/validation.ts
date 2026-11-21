/**
 * Validation helpers that speak the UI's language: every problem is a `{path, code}` pair whose code
 * is a `validation.*` i18n key, so the viewer, the admin and the CLI tools show the same localized
 * message (`translate(locale, issue.code)`) without ever showing zod's English text.
 */
import type { z } from 'zod';

import { manifestSchema, type Manifest } from './manifest.js';
import type { ValidationCode } from './primitives.js';

export interface ValidationIssue {
    /** Where, in the dotted form `city.bounds[0][1]` (`''` for the value itself). */
    readonly path: string;
    readonly code: ValidationCode;
}

/** A zod schema of `T`, named here so ports and packages without their own zod dependency can type one. */
export type Schema<T> = z.ZodType<T>;

export type ValidationResult<T> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

type Issue = z.core.$ZodIssue;

/**
 * Every `validation.*` code, the catalogues' keys of that family by name (`validation.test.ts` checks they are the same):
 * not read from `ro.ts`, which the engine's build leaves empty (its texts are fetched, DECISIONS-for-review.md §218).
 */
const CODES = new Set<string>(
    [
        'required type tooSmall tooBig format value unknownKey httpsOnly assetUrl bounds zoomRange centerOutside duplicateId',
        'outsideCity yearRange datePart dateImpossible dateRange markdownLink cssValue tileTemplate manifestSource json ringClosed',
        'reference invalid',
    ]
        .join(' ')
        .split(' ')
        .map((name) => `validation.${name}`),
);

/** True for every `validation.*` key of the catalogues. */
export function isValidationCode(value: string): value is ValidationCode {
    return CODES.has(value);
}

const BY_ZOD_CODE: ReadonlyMap<string, ValidationCode> = new Map<string, ValidationCode>([
    ['too_small', 'validation.tooSmall'],
    ['too_big', 'validation.tooBig'],
    ['invalid_format', 'validation.format'],
    ['invalid_key', 'validation.format'],
    ['invalid_value', 'validation.value'],
    ['invalid_union', 'validation.value'],
    ['invalid_element', 'validation.value'],
    ['not_multiple_of', 'validation.value'],
]);

/** A refinement's message is its code (`coded()`); a foreign message falls back to `validation.invalid`. */
function customCode(message: string): ValidationCode {
    return isValidationCode(message) ? message : 'validation.invalid';
}

/** A required value that is absent: `validate` asks zod to report the input, which is then `undefined`. */
function isMissing(issue: Issue): boolean {
    return Object.hasOwn(issue, 'input') && issue.input === undefined;
}

function codeOf(issue: Issue): ValidationCode {
    if (isMissing(issue)) {
        return 'validation.required';
    }
    if (issue.code === 'custom') {
        return customCode(issue.message);
    }
    return issue.code === 'invalid_type' ? 'validation.type' : (BY_ZOD_CODE.get(issue.code) ?? 'validation.invalid');
}

/** `['city', 'bounds', 0, 1]` → `city.bounds[0][1]`. */
export function formatPath(path: readonly PropertyKey[]): string {
    return path
        .map((key) => (typeof key === 'number' ? `[${String(key)}]` : `.${String(key)}`))
        .join('')
        .replace(/^\./, '');
}

/** zod issues as localized `{path, code}` pairs; an unknown key becomes one issue at that key's path. */
export function toValidationIssues(issues: readonly Issue[]): ValidationIssue[] {
    return issues.flatMap((issue) =>
        issue.code === 'unrecognized_keys'
            ? issue.keys.map((key): ValidationIssue => ({ path: formatPath([...issue.path, key]), code: 'validation.unknownKey' }))
            : [{ path: formatPath(issue.path), code: codeOf(issue) }],
    );
}

/** Validates `input` with `schema`; never throws. */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
    const result = schema.safeParse(input, { reportInput: true });
    return result.success ? { ok: true, value: result.data } : { ok: false, issues: toValidationIssues(result.error.issues) };
}

/** A parsed manifest object against the strict v1 schema. */
export function validateManifest(input: unknown): ValidationResult<Manifest> {
    return validate(manifestSchema, input);
}

/** Manifest JSON text: a syntax error is the single issue `validation.json`. */
export function parseManifestJson(text: string): ValidationResult<Manifest> {
    let input: unknown;
    try {
        input = JSON.parse(text);
    } catch {
        return { ok: false, issues: [{ path: '', code: 'validation.json' }] };
    }
    return validateManifest(input);
}
