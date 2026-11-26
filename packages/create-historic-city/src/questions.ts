/**
 * The scaffold's questions (`docs/research/M5-interfaces.md` §4.3), each asked only when no option answers it, and
 * never with `--yes` (which takes every default): the city's Romanian name, its rectangle, the theme's seed and the
 * Mapbox public token. A refused answer is asked again; an option's refused value stops the run (exit status 1). A
 * secret token is refused without ever being written or shown.
 */
import { CITY_SPAN_LIMITS, cityBoundsProblem, type CityBounds } from '@hcm/shared';

import { refusal, type Context } from './context.js';
import type { CliKey } from './i18n/index.js';

/** An answer, or why it is refused (a catalogue key and its values). */
type Parsed<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly key: CliKey; readonly params?: Readonly<Record<string, string | number>> };

interface Question<T> {
    /** The option's value, when the command line gave one. */
    readonly given: string | undefined;
    /** What Enter (or `--yes`) answers. */
    readonly fallback: string;
    readonly prompt: string;
    readonly parse: (text: string) => Parsed<T>;
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });

function valueOf<T>(context: Context, parsed: Parsed<T>): T {
    if (!parsed.ok) {
        throw refusal(context, parsed.key, parsed.params);
    }
    return parsed.value;
}

/** What the owner typed, or the default for an empty line and the end of the input. */
function typedOr(line: string | null, fallback: string): string {
    return line === null || line === '' ? fallback : line;
}

/** Asks until an answer passes; the end of the input takes the default, and a refused default stops the run. */
async function asked<T>(context: Context, question: Question<T>): Promise<T> {
    for (;;) {
        const line = await context.ports.terminal.ask(question.prompt);
        const parsed = question.parse(typedOr(line, question.fallback));
        if (parsed.ok || line === null) {
            return valueOf(context, parsed);
        }
        context.ports.terminal.say(context.t(parsed.key, parsed.params));
    }
}

/** The answer to `question`: the option's, the default with `--yes`, else the owner's. */
export function answer<T>(context: Context, question: Question<T>): Promise<T> {
    if (question.given !== undefined) {
        return Promise.resolve(valueOf(context, question.parse(question.given)));
    }
    return context.options.yes ? Promise.resolve(valueOf(context, question.parse(question.fallback))) : asked(context, question);
}

const MAX_NAME = 100;

export function parseName(text: string): Parsed<string> {
    const name = text.replace(/\s+/g, ' ').trim();
    return name === '' || name.length > MAX_NAME ? { ok: false, key: 'cli.name.empty' } : ok(name);
}

const PROBLEM_KEYS = {
    'validation.bounds': 'cli.bbox.bounds',
    'validation.tooSmall': 'cli.bbox.tooSmall',
    'validation.tooBig': 'cli.bbox.tooBig',
} as const satisfies Record<NonNullable<ReturnType<typeof cityBoundsProblem>>, CliKey>;

const NUMBER = /^-?\d{1,3}(?:\.\d+)?$/;

/** `west,south,east,north` in degrees, refused as the admin's New city refuses a rectangle. */
export function parseBounds(text: string): Parsed<CityBounds> {
    const parts = text.split(',').map((part) => part.trim());
    if (parts.length !== 4 || !parts.every((part) => NUMBER.test(part))) {
        return { ok: false, key: 'cli.bbox.format' };
    }
    const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
    const bounds = { west, south, east, north };
    const problem = cityBoundsProblem(bounds);
    return problem === null
        ? ok(bounds)
        : { ok: false, key: PROBLEM_KEYS[problem], params: { min: CITY_SPAN_LIMITS.minDeg, max: CITY_SPAN_LIMITS.maxDeg } };
}

export function boundsText(bounds: CityBounds): string {
    return [bounds.west, bounds.south, bounds.east, bounds.north].join(',');
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function parseSeed(text: string): Parsed<string> {
    return HEX_COLOR.test(text) ? ok(text.toUpperCase()) : { ok: false, key: 'cli.seed.invalid', params: { example: '#8B5E3C' } };
}

const PUBLIC_TOKEN = /^pk\.[A-Za-z0-9._-]{1,1000}$/;

/** A Mapbox public token (the template's placeholder is one too); a secret token is refused and never repeated. */
export function parseToken(text: string): Parsed<string> {
    if (text.startsWith('sk.')) {
        return { ok: false, key: 'cli.token.secret' };
    }
    return PUBLIC_TOKEN.test(text) ? ok(text) : { ok: false, key: 'cli.token.invalid' };
}
