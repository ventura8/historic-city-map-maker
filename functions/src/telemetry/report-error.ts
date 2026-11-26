import { runAs } from '../global-options.js';

import { randomBytes } from 'node:crypto';

import {
    API_ERRORS,
    ERROR_REPORT_MAX_BYTES,
    HTTP_ENDPOINTS,
    apiErrorDetails,
    clientLabel,
    crashNoiseOf,
    errorReportSchema,
    validate,
    type ApiErrorCode,
    type ApiErrorDetails,
    type ErrorReport,
    type ReportedErrorEvent,
    type ValidationIssue,
    type ValidationResult,
} from '@hcm/shared';
import { onRequest } from 'firebase-functions/https';

import type { Ports } from '../ports/index.js';
import { toReportedErrorEvent } from './error-event.js';
import { createRateLimiter, type RateLimiter } from './rate-limit.js';

export type ReportErrorDeps = Pick<Ports, 'errors' | 'config' | 'clock' | 'log'>;

type ErrorService = ReportedErrorEvent['serviceContext']['service'];
type Headers = Readonly<Record<string, string>>;

/** One request to `telemetry.reportError`, as far as the handler reads it. */
export interface ReportRequest {
    readonly method: string;
    /** The `Origin` header (browsers always send it on a cross-origin POST). */
    readonly origin: string | undefined;
    /** Who is asking, for the per-client limit (the trigger takes the address Google's front end saw). */
    readonly client: string;
    /** The raw body: JSON, whether sent as `text/plain` (the engine: no preflight) or `application/json`. */
    readonly body: Uint8Array | undefined;
    /** The `User-Agent` header, reduced to `clientLabel` before it is logged (never logged whole). */
    readonly userAgent?: string | undefined;
}

/** The answer: a status, its headers and, for a refusal, the JSON `ApiErrorDetails`. */
export interface ReportResponse {
    readonly status: number;
    readonly headers: Headers;
    readonly body?: ApiErrorDetails;
}

/** Browsers may cache the preflight for an hour. */
const PREFLIGHT_MAX_AGE_SECONDS = '3600';

/** `Retry-After` of a 429: the limits count per minute. */
const RETRY_AFTER_SECONDS = '60';

/** An origin the endpoint answers: a city site's (`viewerOrigins`) or the admin's Hosting (`adminOrigins`). */
function allowedOrigin(deps: ReportErrorDeps, origin: string | undefined): string | undefined {
    const known = origin !== undefined && [...deps.config.viewerOrigins, ...deps.config.adminOrigins].includes(origin);
    return known ? origin : undefined;
}

/** The admin's folder on Hosting since M6 (`docs/research/M6-interfaces.md` §2.3): the public map is at the root. */
function isAdminPath(pathname: string): boolean {
    return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** The page's address, or undefined when it is none (the schema keeps it an http(s) address already). */
function pageUrl(page: string): URL | undefined {
    try {
        return new URL(page);
    } catch {
        return undefined;
    }
}

/**
 * The Error Reporting service of a report from `origin`: since M6 the viewer and the admin share the Hosting origins, so
 * the page decides (S-A24-HAPPY-SAME-ORIGIN): under `/admin/` on an admin origin the admin, else on a viewer origin the
 * viewer, else on an admin origin the admin (a pre-M6 admin at the root). A page that is not on its request's `Origin`
 * is no report of that site: none (S-A24-BAD-PAGE-ORIGIN-MISMATCH).
 */
function serviceOf(config: ReportErrorDeps['config'], origin: string, page: string): ErrorService | undefined {
    const url = pageUrl(page);
    if (url?.origin !== origin) {
        return undefined;
    }
    if (isAdminReport(config, origin, url.pathname)) {
        return 'admin';
    }
    return config.viewerOrigins.includes(origin) ? 'viewer' : undefined;
}

/** An admin origin's page under `/admin/`, or any page of an admin origin that serves no viewer. */
function isAdminReport(config: ReportErrorDeps['config'], origin: string, pathname: string): boolean {
    return config.adminOrigins.includes(origin) && (isAdminPath(pathname) || !config.viewerOrigins.includes(origin));
}

function refusal(code: ApiErrorCode, headers: Headers, issues?: readonly ValidationIssue[]): ReportResponse {
    return { status: API_ERRORS[code].httpStatus, headers, body: apiErrorDetails(code, undefined, issues) };
}

function parseReport(body: Uint8Array): ValidationResult<ErrorReport> {
    let input: unknown;
    try {
        input = JSON.parse(new TextDecoder().decode(body));
    } catch {
        return { ok: false, issues: [{ path: '', code: 'validation.json' }] };
    }
    return validate(errorReportSchema, input);
}

/** A POST from an allowed origin: size, then rate, then shape, then its page; one structured log entry when all pass. */
function accept(deps: ReportErrorDeps, limiter: RateLimiter, request: ReportRequest, origin: string): ReportResponse {
    const cors: Headers = { 'access-control-allow-origin': origin, vary: 'Origin' };
    const body = request.body ?? new Uint8Array();
    if (body.byteLength > ERROR_REPORT_MAX_BYTES) {
        return refusal('apiError.telemetry.tooLarge', cors);
    }
    if (!limiter.allow(request.client, deps.clock.now())) {
        return refusal('apiError.rateLimited', { ...cors, 'retry-after': RETRY_AFTER_SECONDS });
    }
    const report = parseReport(body);
    if (!report.ok) {
        deps.log.warn('crash report refused: invalid body', { fields: report.issues.map((issue) => issue.path).join(',') });
        return refusal('apiError.invalidRequest', cors, report.issues);
    }
    return deliver(deps, report.value, { origin, cors, userAgent: request.userAgent });
}

/** The reason a report is no crash of the page's (an older page sends it unfiltered), else null. */
function noiseOf(report: ErrorReport): string | null {
    const name = report.message.split(':', 1)[0] ?? '';
    return crashNoiseOf({ name, message: report.message, stack: report.stack ?? '' });
}

/** A valid report: logged for Error Reporting as its page's service, or refused when its page is not on its origin. */
function deliver(
    deps: ReportErrorDeps,
    report: ErrorReport,
    { origin, cors, userAgent }: { readonly origin: string; readonly cors: Headers; readonly userAgent: string | undefined },
): ReportResponse {
    const service = serviceOf(deps.config, origin, report.page);
    if (service === undefined) {
        return refusal('apiError.telemetry.origin', cors);
    }
    const noise = noiseOf(report);
    if (noise !== null) {
        deps.log.info('crash report dropped: the page did not cause it', { reason: noise, service, release: report.release });
        return { status: 204, headers: cors };
    }
    deps.errors.report(toReportedErrorEvent(report, service, undefined, userAgent === undefined ? undefined : clientLabel(userAgent)));
    return { status: 204, headers: cors };
}

/**
 * `telemetry.reportError` (public HTTPS; `docs/research/M2-interfaces.md` §3.4; S-A24-*): the crash endpoint of the
 * viewer and the admin. A preflight from an allowed origin → 204 with the CORS headers; any other method but POST →
 * 405; an origin outside `viewerOrigins` and `adminOrigins` → 403 `telemetry.origin` without CORS headers; a body over
 * 16 KiB → 413 before parsing; over the rate limits → 429 with `Retry-After`; a body `errorReportSchema` refuses →
 * 400 with the issues (logged with the refused fields); a report whose page is not on its `Origin` → 403
 * `telemetry.origin` (M6); a report `crashNoiseOf` names noise → 204, dropped with its reason in the log; otherwise the
 * redacted `ReportedErrorEvent` is logged for Cloud Error Reporting, with the browser's `clientLabel` (never its
 * User-Agent), as the viewer's or the admin's by its page (`serviceOf`) → 204.
 * Nothing is written to Firestore; besides the accepted report only a refused body (its fields, after the rate limit) and a
 * dropped noise report (its reason) are logged, so a flood from a foreign origin costs no logging.
 */
export function handleErrorReport(deps: ReportErrorDeps, limiter: RateLimiter, request: ReportRequest): ReportResponse {
    const allowed = allowedOrigin(deps, request.origin);
    if (request.method === 'OPTIONS' && allowed !== undefined) {
        return {
            status: 204,
            headers: {
                'access-control-allow-origin': allowed,
                'access-control-allow-methods': 'POST',
                'access-control-allow-headers': 'content-type',
                'access-control-max-age': PREFLIGHT_MAX_AGE_SECONDS,
                vary: 'Origin',
            },
        };
    }
    if (request.method !== 'POST') {
        return { status: 405, headers: { allow: 'POST, OPTIONS' } };
    }
    return allowed === undefined ? refusal('apiError.telemetry.origin', {}) : accept(deps, limiter, request, allowed);
}

/** The parts of the express request and response the endpoint uses (firebase-functions passes express objects). */
export interface HttpRequest {
    readonly method: string;
    readonly ip?: string | undefined;
    readonly rawBody?: Uint8Array;
    get(name: string): string | undefined;
}

export interface HttpResponse {
    status(code: number): this;
    set(headers: Headers): this;
    json(body: unknown): unknown;
    end(): unknown;
}

/** The last hop of `X-Forwarded-For`: the one Google's front end appends (a client may forge the earlier ones). */
function lastHop(forwardedFor: string | undefined): string {
    return forwardedFor?.split(',').at(-1)?.trim() ?? '';
}

/** The client of the per-client limit, else the socket address. It only ever lives in the limiter, salted and hashed. */
function clientOf(request: HttpRequest): string {
    const forwarded = lastHop(request.get('x-forwarded-for'));
    return forwarded === '' ? (request.ip ?? 'unknown') : forwarded;
}

/** The express handler: the request in, {@link handleErrorReport}'s answer out. */
export function serveErrorReports(getDeps: () => ReportErrorDeps, limiter: RateLimiter) {
    return (request: HttpRequest, response: HttpResponse): void => {
        const answer = handleErrorReport(getDeps(), limiter, {
            method: request.method,
            origin: request.get('origin'),
            client: clientOf(request),
            body: request.rawBody,
            userAgent: request.get('user-agent'),
        });
        response.status(answer.status).set(answer.headers);
        if (answer.body === undefined) {
            response.end();
        } else {
            response.json(answer.body);
        }
    };
}

/** The `telemetry-reportError` HTTPS function: public, no CORS middleware (the handler answers CORS itself). */
export function reportErrorFunction(getDeps: () => ReportErrorDeps) {
    const limiter = createRateLimiter(randomBytes(16).toString('hex'));
    const { maxInstances } = HTTP_ENDPOINTS['telemetry.reportError'];
    return onRequest({ maxInstances, invoker: 'public', ...runAs('telemetry.reportError') }, serveErrorReports(getDeps, limiter));
}
