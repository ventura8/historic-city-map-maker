/**
 * The viewer's `TelemetryPort`: consent (`consent.ts`), the consent-gated Firebase analytics (`analytics.ts`, its SDK
 * a lazy chunk; GA4's cookies expired on withdrawal by `cookies.ts`), crash reporting (`errors.ts`) and the field
 * measurements (`field.ts`, sent through analytics; their web-vitals chunk `field-sdk.ts`) behind one object. The store
 * passes it the manifest's ids with `setContext`; `destroy` removes the global error and page-hide hooks and every
 * listener.
 */
import { privacySignal, type FieldChunk, type Logger, type PrivacyNavigator } from '@hcm/shared';
import type { Unsubscribe } from '@hcm/ui/map';

import type { PreferenceStorage } from '../core/preferences.js';
import { extraImports } from '../extras/imports.js';
import { AnalyticsLoader, type FirebaseSdk } from './analytics.js';
import { ConsentStore, type ConsentValue } from './consent.js';
import { expireAnalyticsCookies, type CookieJar } from './cookies.js';
import { ErrorReporter, installErrorHooks } from './errors.js';
import { FieldRecorder, type FieldClock } from './field.js';
import { Settle, YEAR_SETTLE_MS } from './settle.js';
import type { ConsentState, ErrorSource, Measurement, TelemetryContext, TelemetryEvent, TelemetryPort } from './telemetry-port.js';

/** The parts of `window` telemetry uses: the page's address without its hash, and its cookies (GA4's, on withdrawal). */
export interface TelemetryWindow extends Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'> {
    readonly location: Pick<Location, 'origin' | 'pathname' | 'hostname'>;
    readonly document: CookieJar;
    /** Do Not Track and Global Privacy Control: either one counts as a refusal until the visitor accepts (§200). */
    readonly navigator?: PrivacyNavigator;
}

export interface TelemetryDeps {
    readonly window: TelemetryWindow;
    readonly storage: PreferenceStorage;
    /** POSTs a crash report (text body, so no CORS preflight). */
    readonly fetch: (url: string, init: RequestInit) => Promise<unknown>;
    readonly log: Logger;
    /** `ENGINE_VERSION`: the release a crash belongs to. */
    readonly release: string;
    /** The configured city, when the embed configuration names one (the stored consent is per city). */
    readonly cityId?: string;
    /** Loads the Firebase SDK chunk; the default is the dynamic import of `firebase-sdk.ts`. */
    readonly loadSdk?: () => Promise<FirebaseSdk>;
    /** Loads the field chunk (web-vitals and the event guard); the default is the dynamic import of `field-sdk.ts`. */
    readonly loadField?: () => Promise<FieldChunk>;
    readonly now?: () => number;
    /** `performance`: the field measurements' clock (milliseconds since the navigation started) and marks. */
    readonly performance?: FieldClock;
}

/** The lazy chunk with firebase/app and firebase/analytics (docs/research/M1-interfaces.md CR-10). */
export async function loadFirebaseSdk(): Promise<FirebaseSdk> {
    const chunk = await extraImports.firebaseSdk();
    return chunk.firebaseSdk;
}

/** The lazy chunk with web-vitals and the event guard (§76), fetched with the Firebase SDK after consent. */
export async function loadFieldSdk(): Promise<FieldChunk> {
    const chunk = await extraImports.fieldSdk();
    return chunk.fieldSdk;
}

/** Expires GA4's cookies; a page whose cookies cannot be read (a sandboxed frame) only logs it. */
function clearAnalyticsCookies(page: TelemetryWindow, log: Logger): void {
    try {
        const names = expireAnalyticsCookies(page.document, page.location);
        log.info('analytics cookies expired', { count: names.length });
    } catch (error) {
        log.warn('analytics cookies not expired', { error: String(error) });
    }
}

class Telemetry implements TelemetryPort {
    readonly #consent: ConsentStore;
    readonly #analytics: AnalyticsLoader;
    readonly #errors: ErrorReporter;
    readonly #uninstall: () => void;
    readonly #field: FieldRecorder;
    /** The timeline's last year change, sent once the year stays (`settle.ts`): a drag is one event. */
    readonly #year: Settle<TelemetryEvent>;
    #windowClass = 'compact';
    #pageViewed = false;
    #destroyed = false;

    constructor(deps: TelemetryDeps) {
        const page = (): string => `${deps.window.location.origin}${deps.window.location.pathname}`;
        this.#consent = new ConsentStore(deps.storage, deps.log, deps.cityId, privacySignal(deps.window.navigator));
        this.#analytics = new AnalyticsLoader({
            loadSdk: deps.loadSdk ?? loadFirebaseSdk,
            log: deps.log,
            pageLocation: page,
            pagePath: () => deps.window.location.pathname,
            clearCookies: () => {
                clearAnalyticsCookies(deps.window, deps.log);
            },
            loadField: deps.loadField ?? loadFieldSdk,
            fieldContext: () => ({ app: 'viewer', window_class: this.#windowClass, release: deps.release }),
        });
        this.#field = new FieldRecorder(deps.performance ?? globalThis.performance, (event) => {
            this.#analytics.send(event);
        });
        this.#analytics.setConsent(this.#consent.state);
        this.#year = new Settle((event) => {
            this.#analytics.send(event);
        }, YEAR_SETTLE_MS);
        this.#errors = new ErrorReporter({
            release: deps.release,
            log: deps.log,
            now: deps.now ?? (() => Date.now()),
            page,
            viewport: () => ({ width: deps.window.innerWidth, height: deps.window.innerHeight }),
            post: (url, body) =>
                deps.fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' }),
            exception: (description, fatal) => {
                this.#analytics.send({ name: 'exception', description, fatal });
            },
        });
        const uninstallErrors = installErrorHooks(deps.window, this.#errors);
        const flush = (): void => {
            this.#field.flush();
            this.#year.flush();
        };
        deps.window.addEventListener('pagehide', flush);
        deps.window.addEventListener('visibilitychange', flush);
        this.#uninstall = () => {
            uninstallErrors();
            deps.window.removeEventListener('pagehide', flush);
            deps.window.removeEventListener('visibilitychange', flush);
        };
        this.#consent.onChange((consent) => {
            this.#consentChanged(consent);
        });
    }

    get consent(): ConsentState {
        return this.#consent.state;
    }

    setConsent(consent: ConsentValue): void {
        if (!this.#destroyed) {
            this.#consent.set(consent);
        }
    }

    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe {
        return this.#consent.onChange(listener);
    }

    logEvent(event: TelemetryEvent): void {
        if (this.#destroyed) {
            return;
        }
        this.#pageViewed ||= event.name === 'page_view';
        if (event.name === 'year_change') {
            this.#year.hold(event);
        } else {
            this.#analytics.send(event);
        }
    }

    measure(measurement: Measurement): void {
        if (!this.#destroyed) {
            this.#field.record(measurement);
        }
    }

    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void {
        if (!this.#destroyed) {
            this.#errors.report(error, context);
        }
    }

    /** Analytics is configured before the city's stored consent is read, so a stored "granted" applies at once. */
    setContext(context: TelemetryContext): void {
        this.#windowClass = context.windowClass;
        this.#analytics.configure(context.measurementId, context.firebase);
        this.#consent.setCity(context.cityId);
        this.#errors.setContext({
            cityId: context.cityId,
            locale: context.locale,
            windowClass: context.windowClass,
            ...(context.errorEndpoint === undefined ? {} : { endpoint: context.errorEndpoint }),
        });
    }

    /** A page viewed before the visitor accepted is counted once they accept. */
    #consentChanged(consent: ConsentState): void {
        this.#analytics.setConsent(consent);
        if (consent === 'granted' && this.#pageViewed) {
            this.#analytics.send({ name: 'page_view' });
        }
    }

    /** Removes the error hooks and the listeners; every later call does nothing. */
    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.#year.cancel();
        this.#uninstall();
        this.#consent.destroy();
    }
}

export function createTelemetry(deps: TelemetryDeps): TelemetryPort {
    return new Telemetry(deps);
}
