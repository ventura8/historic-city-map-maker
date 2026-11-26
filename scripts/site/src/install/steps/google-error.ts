/**
 * What a refused Google call's body says, for the install builds' step scripts (finding 47 of 2026-11-01: the `jobs`
 * step printed `HTTP 429` and nothing else, so the reason was lost). Google's error JSON (`error.status`,
 * `error.message`, `google.rpc.ErrorInfo` with its `reason` and `metadata`, `google.rpc.QuotaFailure` with its
 * violations) is reduced to one line for the build's log, redacted of tokens, keys, signed URLs' queries and e-mail
 * addresses (`redactText` of `@hcm/shared`, and any bearer header), and a 429 or `RESOURCE_EXHAUSTED` is classified:
 * a request rate (an `ErrorInfo` reason `RATE_LIMIT_EXCEEDED`, or no details at all) may be tried again; a quota (a
 * `QuotaFailure`, or any other reason) may not, and is named.
 */
import { redactText } from '@hcm/shared';

const ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo';
const QUOTA_FAILURE = 'type.googleapis.com/google.rpc.QuotaFailure';
/** The `ErrorInfo` reasons of a per-minute request rate, waiting being the fix ('': no reason given). */
const RATE_REASONS: ReadonlySet<string> = new Set(['', 'RATE_LIMIT_EXCEEDED']);
/** The longest summary a log line carries. */
const MAX_SUMMARY = 900;

type Json = Readonly<Record<string, unknown>>;

/** A quota Google named: the API, the metric and the limit (each as Google wrote it, or '' when it named none). */
export interface NamedQuota {
    readonly service: string;
    readonly metric: string;
    readonly limit: string;
}

/** A refused call's body, read. */
export interface GoogleRefusal {
    /** One redacted line: `RESOURCE_EXHAUSTED: <message>; ErrorInfo …; QuotaFailure …`, or '' for an empty body. */
    readonly summary: string;
    /** `rate` (try again later), `quota` (a limit: not tried again) or null (not an exhaustion). */
    readonly exhaustion: 'rate' | 'quota' | null;
    /** The quota a `quota` exhaustion names (its names, or '' for those Google left out), else null. */
    readonly quota: NamedQuota | null;
}

function record(value: unknown): Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function records(value: unknown): Json[] {
    return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** `key=value` of every string entry of `metadata`. */
function pairs(metadata: unknown): string {
    return Object.entries(record(metadata))
        .map(([key, value]) => `${key}=${text(value)}`)
        .join(' ');
}

function infoLine(detail: Json): string {
    return `ErrorInfo ${text(detail['reason'])} ${pairs(detail['metadata'])}`.trim();
}

/** A string or a number as text (a violation's `quotaValue` may be either), else ''. */
function scalar(value: unknown): string {
    return typeof value === 'number' ? String(value) : text(value);
}

function violationLine(violation: Json): string {
    const named = ['subject', 'quotaMetric', 'quotaId', 'quotaValue', 'description'].map((key) => scalar(violation[key]));
    return `QuotaFailure ${named.filter((part) => part !== '').join(' ')}`;
}

/** Google's text without a bearer header, a token, a key, a URL's query or an e-mail address. */
export function redactGoogleText(value: string): string {
    return redactText(value.replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]'));
}

/** The first of `values` that is not empty, else ''. */
function first(...values: readonly unknown[]): string {
    return values.map(text).find((value) => value !== '') ?? '';
}

function namedQuota(metadata: Json, violation: Json, fallbackService: string): NamedQuota {
    return {
        service: first(metadata['service'], violation['apiService'], fallbackService),
        metric: first(metadata['quota_metric'], violation['quotaMetric'], violation['subject']),
        limit: first(metadata['quota_limit'], violation['quotaId'], violation['description']),
    };
}

function exhaustionOf(httpStatus: number, status: string, reason: string, violations: number): GoogleRefusal['exhaustion'] {
    if (httpStatus !== 429 && status !== 'RESOURCE_EXHAUSTED') {
        return null;
    }
    return violations === 0 && RATE_REASONS.has(reason) ? 'rate' : 'quota';
}

/** The refusal `body` (Google's error JSON, or anything else) of a call to `host` that answered `httpStatus`. */
export function readRefusal(httpStatus: number, body: unknown, host: string): GoogleRefusal {
    const error = record(record(body)['error']);
    const details = records(error['details']);
    const infos = details.filter((detail) => detail['@type'] === ERROR_INFO);
    const violations = details.filter((detail) => detail['@type'] === QUOTA_FAILURE).flatMap((detail) => records(detail['violations']));
    const status = text(error['status']);
    const parts = [
        [status, text(error['message'])].filter((part) => part !== '').join(': '),
        ...infos.map(infoLine),
        ...violations.map(violationLine),
    ];
    const info = record(infos[0]);
    const exhaustion = exhaustionOf(httpStatus, status, text(info['reason']), violations.length);
    return {
        summary: redactGoogleText(parts.filter((part) => part !== '').join('; ')).slice(0, MAX_SUMMARY),
        exhaustion,
        quota: exhaustion === 'quota' ? namedQuota(record(info['metadata']), record(violations[0]), host) : null,
    };
}
