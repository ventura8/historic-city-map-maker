/**
 * A crash report as Cloud Error Reporting reads it (`docs/research/M2-interfaces.md` §3.4): every free-text value
 * redacted again (the body comes from outside), `message` = the stack with the error's message, and a
 * `context.reportLocation` always, so errors whose stack Error Reporting cannot parse (Firefox, Safari) are grouped
 * by their first frame or, without one, by the page. `context.httpRequest.userAgent` is the browser's `clientLabel`
 * (`Firefox 145 mobile`), which Error Reporting and the admin's Crashes page show; `hcm.route` the area or panel.
 */
import { REPORTED_ERROR_EVENT_TYPE, REPORTED_EVENT_MAX_BYTES, redactText, type ErrorReport, type ReportedErrorEvent } from '@hcm/shared';

/**
 * `reportedErrorEventSchema` limits. A redacted value can be longer than the report's (`[redacted]` replaces an
 * address as short as `a@b.cd`), so every value is cut to its limit after redaction.
 */
const MAX = { message: 10_000, url: 2048, functionName: 200, version: 64, windowClass: 32, locale: 16, client: 60 } as const;

const ANONYMOUS = '<anonymous>';

type ReportLocation = ReportedErrorEvent['context']['reportLocation'];
type ErrorService = ReportedErrorEvent['serviceContext']['service'];
type HttpRequest = ReportedErrorEvent['context']['httpRequest'];

interface FrameParts {
    readonly functionName: string;
    readonly location: string;
}

/** V8: `at fn (url:line:col)` or `at url:line:col`, the leading `at ` already removed. */
function v8Frame(frame: string): FrameParts {
    const open = frame.lastIndexOf(' (');
    return frame.endsWith(')') && open > 0
        ? { functionName: frame.slice(0, open), location: frame.slice(open + 2, -1) }
        : { functionName: ANONYMOUS, location: frame };
}

/** Firefox and Safari: `fn@url:line:col`, or `@url:line:col` for an anonymous function. */
function geckoFrame(line: string): FrameParts | undefined {
    const at = line.indexOf('@');
    return at < 0 ? undefined : { functionName: line.slice(0, at) || ANONYMOUS, location: line.slice(at + 1) };
}

/**
 * `url:line:col` into the file and the line; undefined when the location has no line number. The frame is read before
 * redaction (which drops a URL's query together with the `:line:col` after it), its parts are redacted after.
 */
function located(parts: FrameParts): ReportLocation | undefined {
    const column = parts.location.lastIndexOf(':');
    const line = parts.location.lastIndexOf(':', column - 1);
    const lineNumber = Number(parts.location.slice(line + 1, column));
    if (line <= 0 || !Number.isSafeInteger(lineNumber) || lineNumber < 0) {
        return undefined;
    }
    return {
        filePath: redactText(parts.location.slice(0, line)).slice(0, MAX.url),
        lineNumber,
        functionName: redactText(parts.functionName).slice(0, MAX.functionName),
    };
}

function parseFrame(line: string): ReportLocation | undefined {
    const trimmed = line.trim();
    const parts = trimmed.startsWith('at ') ? v8Frame(trimmed.slice(3)) : geckoFrame(trimmed);
    return parts === undefined ? undefined : located(parts);
}

/**
 * The first stack frame with a file and a line, else the page itself (line 0) named after where the error was caught.
 * `stack` is the report's own (unredacted), `page` already redacted and cut to its limit.
 */
export function reportLocation(stack: string | undefined, page: string, source: ErrorReport['source']): ReportLocation {
    const frame = (stack ?? '')
        .split('\n')
        .map(parseFrame)
        .find((location) => location !== undefined);
    return frame ?? { filePath: page, lineNumber: 0, functionName: `<${source}>` };
}

/** Error Reporting reads the stack from `message`; Firefox and Safari stacks do not repeat the error's message. */
function stackMessage(message: string, stack: string | undefined): string {
    if (stack === undefined) {
        return message;
    }
    return stack.includes(message) ? stack : `${message}\n${stack}`;
}

/** The UTF-8 size of the event as it is logged. */
function loggedBytes(event: ReportedErrorEvent): number {
    return new TextEncoder().encode(JSON.stringify(event)).byteLength;
}

/**
 * The event within `REPORTED_EVENT_MAX_BYTES` (the worst-case logging cost, `DECISIONS-for-review.md` §42f): redaction can
 * lengthen a value and the page is named twice, so an event over the limit loses the end of its `message` (each character
 * cut removes at least one byte; a second pass covers a cut in the middle of an escaped character).
 */
function fitted(event: ReportedErrorEvent, limit: number): ReportedErrorEvent {
    let fitting = event;
    let excess = loggedBytes(fitting) - limit;
    while (excess > 0 && fitting.message.length > 1) {
        fitting = { ...fitting, message: fitting.message.slice(0, Math.max(1, fitting.message.length - excess)) };
        excess = loggedBytes(fitting) - limit;
    }
    return fitting;
}

/**
 * The `ReportedErrorEvent` of a validated report from `service` (decided by the report's origin, never its body), at most
 * `limit` bytes as logged.
 */
export function toReportedErrorEvent(
    report: ErrorReport,
    service: ErrorService,
    limit: number = REPORTED_EVENT_MAX_BYTES,
    client?: string,
): ReportedErrorEvent {
    const stack = report.stack === undefined ? undefined : redactText(report.stack);
    const page = redactText(report.page).slice(0, MAX.url);
    return fitted(
        eventOf(report, service, stack, { url: page, ...(client === undefined ? {} : { userAgent: client.slice(0, MAX.client) }) }),
        limit,
    );
}

function eventOf(report: ErrorReport, service: ErrorService, stack: string | undefined, request: HttpRequest): ReportedErrorEvent {
    const page = request.url;
    return {
        '@type': REPORTED_ERROR_EVENT_TYPE,
        message: stackMessage(redactText(report.message), stack).slice(0, MAX.message),
        serviceContext: { service, version: redactText(report.release).slice(0, MAX.version) },
        context: { httpRequest: request, reportLocation: reportLocation(report.stack, page, report.source) },
        hcm: {
            cityId: report.cityId,
            windowClass: redactText(report.windowClass).slice(0, MAX.windowClass),
            locale: redactText(report.locale).slice(0, MAX.locale),
            viewport: report.viewport,
            fatal: report.fatal,
            source: report.source,
            ...(report.route === undefined ? {} : { route: report.route }),
        },
    };
}
