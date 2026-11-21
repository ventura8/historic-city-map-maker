/**
 * Crash reports of the admin (PLAN Addendum 2; the engine's design, `packages/engine/src/telemetry/errors.ts`, which the
 * admin may not import): uncaught errors and rejections are POSTed to `telemetry.reportError` (`text/plain`, so no
 * preflight; `keepalive`, no credentials), which feeds Cloud Error Reporting as the `admin` service, and sent to GA4 as
 * `exception` events after consent. The reporter never throws, sends at most `MAX_REPORTS_PER_PAGE` reports per page
 * and one per message per `DEDUPE_WINDOW_MS`, and redacts with `redactText` (tokens, keys, addresses, URL queries) what
 * the endpoint redacts again. Errors the page did not cause (`crashNoiseOf`) are logged with their reason, never sent;
 * a report names the area's route (`routeOfHash`). In start-up mode there is no endpoint yet (nothing is deployed), so nothing is posted.
 */
import { crashNoiseOf, redactText, type ErrorReport, type Logger } from '@hcm/shared';

import type { Unsubscribe } from './ports.js';

export const MAX_REPORTS_PER_PAGE = 5;
export const DEDUPE_WINDOW_MS = 10_000;
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;
/** GA4 limits a parameter value to 100 characters. */
const MAX_GA_DESCRIPTION = 100;

export type ErrorSource = ErrorReport['source'];

export interface ErrorReporterDeps {
    readonly release: string;
    readonly log: Logger;
    readonly now: () => number;
    /** The crash endpoint, or null (start-up mode). */
    readonly endpoint: () => string | null;
    /** The page's origin and path (never its hash or query). */
    readonly page: () => string;
    readonly viewport: () => { readonly width: number; readonly height: number };
    /** `route`: the area's route id (`georef`), never the ids after it (`routeOfHash`). */
    readonly context: () => { readonly locale: string; readonly windowClass: string; readonly route?: string | undefined };
    readonly post: (url: string, body: string) => Promise<unknown>;
    /** GA4 `exception`, dropped without consent. */
    readonly exception: (description: string, fatal: boolean) => void;
}

function messageOf(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }
    return typeof error === 'string' ? error : 'Non-error value thrown';
}

function stackOf(error: unknown): { readonly stack?: string } {
    return error instanceof Error && typeof error.stack === 'string' ? { stack: redactText(error.stack).slice(0, MAX_STACK_LENGTH) } : {};
}

export class AdminErrorReporter {
    readonly #deps: ErrorReporterDeps;
    readonly #lastSent = new Map<string, number>();
    #sent = 0;

    constructor(deps: ErrorReporterDeps) {
        this.#deps = deps;
    }

    /** Never throws. */
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
            this.#post({ message, ...stackOf(error), ...context });
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

    #post(parts: Pick<ErrorReport, 'message' | 'stack' | 'fatal' | 'source'>): void {
        const endpoint = this.#deps.endpoint();
        if (endpoint === null) {
            return;
        }
        const { locale, windowClass, route } = this.#deps.context();
        const report: ErrorReport = {
            ...parts,
            release: this.#deps.release,
            cityId: '',
            page: redactText(this.#deps.page()),
            viewport: this.#deps.viewport(),
            windowClass,
            locale,
            ...(route === undefined ? {} : { route }),
        };
        this.#deps.post(endpoint, JSON.stringify(report)).catch((failure: unknown) => {
            this.#deps.log.warn('error report not delivered', { error: String(failure) });
        });
    }
}

/** The `error` and `unhandledrejection` events of `target` reported to `reporter`; returns the function that stops it. */
export function installErrorHooks(
    target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    reporter: Pick<AdminErrorReporter, 'report'>,
): Unsubscribe {
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

const ROUTE_ID = /^[a-z][a-z0-9-]*$/;

/** The route id of an admin hash (`#/georef/im-1` → `georef`): the area only, never the record after it. */
export function routeOfHash(hash: string): string | undefined {
    const id = hash.replace(/^#\/?/, '').split('/', 1)[0] ?? '';
    return ROUTE_ID.test(id) && id.length <= 40 ? id : undefined;
}

/** `telemetry.reportError` of the project (`M2-interfaces.md` §3.4), or the Functions emulator's in the e2e build. */
export function errorEndpointFor(projectId: string, emulators: boolean): string {
    return emulators
        ? `http://127.0.0.1:5001/${projectId}/us-central1/telemetry-reportError`
        : `https://us-central1-${projectId}.cloudfunctions.net/telemetry-reportError`;
}
