/**
 * Crash reporting for the web (PLAN Addendum 2, scenario V20): uncaught errors and rejections, plus the engine's own
 * error boundaries, are POSTed to the manifest's `analytics.errorEndpoint` (the M2 `telemetry.reportError` function,
 * which feeds Cloud Error Reporting) and, after consent, sent to GA4 as `exception` events. The reporter never
 * throws, sends at most `MAX_REPORTS_PER_PAGE` reports per page and one per message per `DEDUPE_WINDOW_MS`, and
 * redacts what it sends with `redactText` of `@hcm/shared`, the rules the `telemetry.reportError` endpoint applies again
 * (docs/research/M2-interfaces.md CR-M2-4): no URL query or fragment (the hash holds the visitor's view, a tile URL the
 * access token), no token-looking strings (Mapbox, Google API keys and access tokens), no e-mail addresses. Errors the
 * page did not cause (`crashNoiseOf`: browser-injected scripts, extensions, aborted fetches) are logged with their reason
 * and never sent.
 */
import { crashNoiseOf, redactText, type Logger } from '@hcm/shared';

import type { ErrorReportPayload, ErrorSource } from './telemetry-port.js';

export const MAX_REPORTS_PER_PAGE = 5;
export const DEDUPE_WINDOW_MS = 10_000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;
/** GA4 limits a parameter value to 100 characters. */
const MAX_GA_DESCRIPTION = 100;

function messageOf(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return typeof error === 'string' ? error : 'Non-error value thrown';
}

function stackOf(error: unknown): string | undefined {
    return error instanceof Error && typeof error.stack === 'string' ? redactText(error.stack).slice(0, MAX_STACK_LENGTH) : undefined;
}

/** What the reporter knows about the page when an error happens. */
export interface ErrorContext {
    readonly cityId: string;
    readonly locale: string;
    readonly windowClass: string;
    readonly endpoint?: string;
}

export interface ErrorReporterDeps {
    readonly release: string;
    readonly log: Logger;
    readonly now: () => number;
    /** Origin and path of the page, never its query or hash. */
    readonly page: () => string;
    readonly viewport: () => { readonly width: number; readonly height: number };
    readonly post: (url: string, body: string) => Promise<unknown>;
    /** GA4 `exception` (dropped by analytics without consent). */
    readonly exception: (description: string, fatal: boolean) => void;
}

export class ErrorReporter {
    readonly #deps: ErrorReporterDeps;
    readonly #lastSent = new Map<string, number>();
    #sent = 0;
    #context: ErrorContext = { cityId: '', locale: '', windowClass: '' };

    constructor(deps: ErrorReporterDeps) {
        this.#deps = deps;
    }

    setContext(context: ErrorContext): void {
        this.#context = context;
    }

    /** Never throws; see the module comment for the limits. */
    report(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void {
        try {
            const noise = crashNoiseOf(error);
            if (noise !== null) {
                this.#deps.log.info('error not reported: the page did not cause it', { reason: noise });
                return;
            }
            const message = redactText(messageOf(error)).slice(0, MAX_MESSAGE_LENGTH);
            if (!this.#admit(message)) {
                return;
            }
            this.#deps.exception(message.slice(0, MAX_GA_DESCRIPTION), context.fatal);
            this.#post(this.#payload(message, stackOf(error), context));
        } catch (failure) {
            this.#deps.log.warn('error report failed', { error: String(failure) });
        }
    }

    /** The page budget and the per-message window. */
    #admit(message: string): boolean {
        const now = this.#deps.now();
        const last = this.#lastSent.get(message);
        if (this.#sent >= MAX_REPORTS_PER_PAGE || (last !== undefined && now - last < DEDUPE_WINDOW_MS)) {
            return false;
        }
        this.#sent += 1;
        this.#lastSent.set(message, now);
        return true;
    }

    #payload(
        message: string,
        stack: string | undefined,
        context: { readonly fatal: boolean; readonly source: ErrorSource },
    ): ErrorReportPayload {
        const { cityId, locale, windowClass } = this.#context;
        const base = { message, release: this.#deps.release, cityId, page: redactText(this.#deps.page()), viewport: this.#deps.viewport() };
        return { ...base, ...(stack === undefined ? {} : { stack }), windowClass, locale, fatal: context.fatal, source: context.source };
    }

    #post(payload: ErrorReportPayload): void {
        const endpoint = this.#context.endpoint;
        if (endpoint === undefined) {
            return;
        }
        this.#deps.post(endpoint, JSON.stringify(payload)).catch((failure: unknown) => {
            this.#deps.log.warn('error report not delivered', { error: String(failure) });
        });
    }
}

/** The `error` and `unhandledrejection` events of `target` reported to `reporter`; returns the function that stops it. */
export function installErrorHooks(target: Pick<Window, 'addEventListener' | 'removeEventListener'>, reporter: ErrorReporter): () => void {
    const onError = (event: ErrorEvent): void => {
        // A cross-origin script error carries no details ("Script error."): nothing useful to report.
        if (event.error !== null && event.error !== undefined) {
            reporter.report(event.error, { fatal: false, source: 'window' });
        }
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
        reporter.report(event.reason, { fatal: false, source: 'promise' });
    };
    target.addEventListener('error', onError);
    target.addEventListener('unhandledrejection', onRejection);
    return () => {
        target.removeEventListener('error', onError);
        target.removeEventListener('unhandledrejection', onRejection);
    };
}
