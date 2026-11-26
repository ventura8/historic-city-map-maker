/**
 * The upstream API fixtures (docs/research/M2-interfaces.md §7): one JSON file per upstream call and outcome, the
 * single source of truth for what Google, Mapbox, USGS M2M and Nominatim answer. The functions' adapter tests, the
 * in-process fakes (`@hcm/test-support/fakes`), the e2e mock server and, later, the Python pipeline tests all read
 * these files, so an API shape is written down once.
 *
 * A file is an envelope `{call, note?, status, headers?, body? | text?}`: `call` documents the request it answers,
 * `body` is a JSON body, `text` a raw one (USGS's HTML error pages), neither for 204. Strings may hold `{{name}}`
 * placeholders, filled from `FIXTURE_VALUES` (`values.json` plus the values assembled below) and the caller's own
 * values; an unknown placeholder is an error. Every value is a generated test value that names its scenario.
 */
import { RAW_FIXTURES } from './catalog.js';
import valuesFile from './values.json' with { type: 'json' };

export type FixtureName = keyof typeof RAW_FIXTURES;

/** One upstream answer, placeholders filled. */
export interface FixtureEnvelope {
    /** The request this answers (`GET https://api.mapbox.com/tokens/v2?access_token=<token>`). */
    readonly call: string;
    readonly note?: string;
    readonly status: number;
    /** Lower-case names; `content-type` defaults to JSON for a `body`. */
    readonly headers: Readonly<Record<string, string>>;
    /** A JSON body (absent for 204 and for `text`). */
    readonly body?: unknown;
    /** A raw body: HTML or plain text. */
    readonly text?: string;
}

export type FixtureValues = Readonly<Record<string, string>>;

/**
 * A Google API key's shape (`AIza` + 35 characters), assembled at run time so the repository never holds one
 * (gitleaks). Python: `"AI" + "za" + "E2eFakeKey".ljust(35, "0")`. The same value as `E2E_FIREBASE_APP.apiKey`.
 */
const API_KEY = `${['AI', 'za'].join('')}${'E2eFakeKey'.padEnd(35, '0')}`;

function stringValues(file: Readonly<Record<string, unknown>>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(file).filter((entry): entry is [string, string] => !entry[0].startsWith('$') && typeof entry[1] === 'string'),
    );
}

/** Every placeholder's default value. */
export const FIXTURE_VALUES: FixtureValues = Object.freeze({ ...stringValues(valuesFile), apiKey: API_KEY });

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function fill(text: string, values: FixtureValues, name: string): string {
    return text.replace(PLACEHOLDER, (_match, key: string) => {
        const value = values[key];
        if (value === undefined) {
            throw new Error(`fixture ${name}: no value for {{${key}}}`);
        }
        return value;
    });
}

function fillAll(value: unknown, values: FixtureValues, name: string): unknown {
    if (typeof value === 'string') {
        return fill(value, values, name);
    }
    if (Array.isArray(value)) {
        return value.map((item: unknown) => fillAll(item, values, name));
    }
    if (typeof value === 'object' && value !== null) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillAll(item, values, name)]));
    }
    return value;
}

const ENVELOPE_KEYS = new Set(['call', 'note', 'status', 'headers', 'body', 'text']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> {
    return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

type EnvelopeRule = readonly [problem: string, holds: (raw: Readonly<Record<string, unknown>>) => boolean];

const ENVELOPE_RULES: readonly EnvelopeRule[] = [
    ['call and an integer status are required', (raw) => typeof raw['call'] === 'string' && Number.isInteger(raw['status'])],
    ['body and text exclude each other', (raw) => !('body' in raw && 'text' in raw)],
    ['headers must map names to strings', (raw) => !('headers' in raw) || isStringRecord(raw['headers'])],
];

/** The envelope's problems: unknown keys, a missing call or status, both a body and a text, non-string headers. */
function envelopeProblems(raw: Readonly<Record<string, unknown>>): string[] {
    const unknownKeys = Object.keys(raw)
        .filter((key) => !ENVELOPE_KEYS.has(key))
        .map((key) => `unknown key ${key}`);
    return [...unknownKeys, ...ENVELOPE_RULES.filter(([, holds]) => !holds(raw)).map(([problem]) => problem)];
}

function envelope(name: FixtureName, raw: unknown): Readonly<Record<string, unknown>> {
    const problems = isRecord(raw) ? envelopeProblems(raw) : ['not an object'];
    if (!isRecord(raw) || problems.length > 0) {
        throw new Error(`fixture ${name} is not an envelope: ${problems.join('; ')}`);
    }
    return raw;
}

function headersOf(raw: Readonly<Record<string, unknown>>): Record<string, string> {
    const declared = isStringRecord(raw['headers']) ? raw['headers'] : {};
    const lowered = Object.fromEntries(Object.entries(declared).map(([key, value]) => [key.toLowerCase(), value]));
    return 'body' in raw && lowered['content-type'] === undefined
        ? { 'content-type': 'application/json; charset=utf-8', ...lowered }
        : lowered;
}

/** The names of every fixture, sorted. */
export const FIXTURE_NAMES: readonly FixtureName[] = Object.freeze(
    (Object.keys(RAW_FIXTURES) as FixtureName[]).sort((left, right) => left.localeCompare(right)),
);

/** The fixture `name` with its placeholders filled from `FIXTURE_VALUES` overridden by `values` (a fresh copy). */
export function fixture(name: FixtureName, values: FixtureValues = {}): FixtureEnvelope {
    const raw = envelope(name, RAW_FIXTURES[name]);
    const filled = fillAll(raw, { ...FIXTURE_VALUES, ...values }, name) as Readonly<Record<string, unknown>>;
    return {
        call: String(filled['call']),
        ...(typeof filled['note'] === 'string' ? { note: filled['note'] } : {}),
        status: Number(filled['status']),
        headers: headersOf(filled),
        ...('body' in filled ? { body: filled['body'] } : {}),
        ...(typeof filled['text'] === 'string' ? { text: filled['text'] } : {}),
    };
}

/** The JSON body of a fixture (throws for a fixture without one). */
export function fixtureBody(name: FixtureName, values: FixtureValues = {}): unknown {
    const found = fixture(name, values);
    if (!('body' in found)) {
        throw new Error(`fixture ${name} has no JSON body`);
    }
    return found.body;
}

export interface FixtureResponseOptions {
    readonly values?: FixtureValues;
    /** Merged into an object body (shallow), after the placeholders are filled. */
    readonly merge?: Readonly<Record<string, unknown>>;
    /** Replaces the body entirely. */
    readonly body?: unknown;
    readonly status?: number;
    readonly headers?: Readonly<Record<string, string>>;
}

function patchedBody(found: FixtureEnvelope, options: FixtureResponseOptions): unknown {
    if ('body' in options) {
        return options.body;
    }
    return options.merge !== undefined && isRecord(found.body) ? { ...found.body, ...options.merge } : found.body;
}

/** A null-body status: `new Response` refuses a body for these. */
function isNullBodyStatus(status: number): boolean {
    return status === 204 || status === 205 || status === 304;
}

/** The response text: the fixture's raw text, or its (patched) JSON body. */
function payloadOf(found: FixtureEnvelope, options: FixtureResponseOptions): string {
    if (found.text !== undefined && !('body' in options)) {
        return found.text;
    }
    const body = patchedBody(found, options);
    return body === undefined ? '' : JSON.stringify(body);
}

/** The fixture as a fetch `Response` (a new one per call: a body is read once). */
export function fixtureResponse(name: FixtureName, options: FixtureResponseOptions = {}): Response {
    const found = fixture(name, options.values);
    const status = options.status ?? found.status;
    const init = { status, headers: { ...found.headers, ...options.headers } };
    return new Response(isNullBodyStatus(status) ? null : payloadOf(found, options), init);
}
