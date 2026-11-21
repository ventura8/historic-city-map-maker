/**
 * GA4 through the Firebase JS SDK (PLAN Addendum 2), loaded lazily and only when the manifest has a `measurementId`
 * (and the Firebase app ids, CR-9) **and** the visitor granted consent. Before that no Firebase code runs and no Google
 * host is contacted (scenario V19). Withdrawing consent turns collection off at once, drops every later event and
 * expires GA4's cookies. Events carry ids and flags only (no PII); the page GA4 is told about is the page's origin and
 * path, never its hash (the visitor's view, after *My location* their position) or query: `page_location` and
 * `page_path` are set on the configuration and `page_location` on every event, and the automatic page view is off.
 *
 * Firebase Performance Monitoring is not part of the public viewer: it sends `location.href` up to the first `?`, so
 * the whole hash, and cannot be told otherwise (docs/research/DECISIONS-for-review.md §18a; the admin may use it).
 *
 * Field measurements (§76): with the SDK comes a second lazy chunk (`field-sdk.ts`: Google's `web-vitals` and the
 * event guard of `@hcm/shared`). Every event is checked by that guard before GA4 sees it (its schema, GA4's limits,
 * no position or PII, the page's budget), and the Core Web Vitals observers start. Field measurements made before
 * consent (the boot's timings) wait in memory, at most {@link MAX_PENDING}, and are sent once consent is granted;
 * a refusal or a withdrawal forgets them.
 */
import type { FieldChunk, FieldGuard, GaParams, Logger } from '@hcm/shared';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Analytics as GaAnalytics, AnalyticsSettings, ConsentSettings } from 'firebase/analytics';

import { CONSENT_DENIED, CONSENT_GRANTED } from './consent.js';
import type { ConsentState, FieldEvent, FirebaseAppIds, TelemetryEvent } from './telemetry-port.js';

/** The Firebase functions the viewer uses; `firebase-sdk.ts` (a lazy chunk) provides the real ones. */
export interface FirebaseSdk {
    readonly initializeApp: (options: FirebaseOptions, name: string) => FirebaseApp;
    readonly isSupported: () => Promise<boolean>;
    readonly setConsent: (settings: ConsentSettings) => void;
    readonly initializeAnalytics: (app: FirebaseApp, options: AnalyticsSettings) => GaAnalytics;
    readonly logEvent: (analytics: GaAnalytics, name: string, params: Readonly<Record<string, string | number | boolean>>) => void;
    readonly setAnalyticsCollectionEnabled: (analytics: GaAnalytics, enabled: boolean) => void;
}

/**
 * The viewer's own named Firebase app: the page's default app stays free for an embedding page's own Firebase (only
 * Performance Monitoring needed the default app, docs/LESSONS.md #9).
 */
export const FIREBASE_APP_NAME = 'hcm-viewer';

export interface AnalyticsConfig {
    readonly measurementId: string;
    readonly firebase: FirebaseAppIds;
}

export interface AnalyticsDeps {
    readonly loadSdk: () => Promise<FirebaseSdk>;
    readonly log: Logger;
    /** `location.origin + location.pathname`. */
    readonly pageLocation: () => string;
    /** `location.pathname`. */
    readonly pagePath: () => string;
    /** Expires GA4's cookies (`cookies.ts`); never throws. */
    readonly clearCookies: () => void;
    /** Loads the field chunk (`field-sdk.ts`: web-vitals and the event guard). */
    readonly loadField: () => Promise<FieldChunk>;
    /** What every field measurement carries when it is sent: `app`, `window_class`, `release`. */
    readonly fieldContext: () => GaParams;
}

/** Field measurements held before consent (or before the manifest's ids) at most. */
export const MAX_PENDING = 30;

interface Loaded {
    readonly sdk: FirebaseSdk;
    readonly analytics: GaAnalytics;
    readonly guard: FieldGuard;
}

type GaEvent = TelemetryEvent | { readonly name: 'exception'; readonly description: string; readonly fatal: boolean };

function isField(event: GaEvent | FieldEvent): event is FieldEvent {
    return 'params' in event;
}

/** Per event name, its GA4 parameters; an event without parameters is absent. */
const GA_PARAMS: { readonly [N in GaEvent['name']]?: (event: Extract<GaEvent, { readonly name: N }>) => GaParams } = {
    layer_toggle: (event) => ({ layer_id: event.layerId, visible: event.visible }),
    year_change: (event) => ({ year: event.year ?? 'today' }),
    photo_open: (event) => ({ photo_id: event.photoId }),
    poi_open: (event) => ({ poi_id: event.poiId }),
    story_open: (event) => ({ story_id: event.storyId }),
    locale_change: (event) => ({ locale: event.locale }),
    theme_change: (event) => ({ theme: event.theme }),
    input_device: (event) => ({ device: event.device }),
    exception: (event) => ({ description: event.description, fatal: event.fatal }),
};

/** A telemetry event as GA4 receives it: snake_case parameters, ids and flags only. */
export function gaParams(event: GaEvent): GaParams {
    const params = GA_PARAMS[event.name] as ((event: GaEvent) => GaParams) | undefined;
    return params === undefined ? {} : params(event);
}

/** A change from granted to denied: the only change that expires cookies (a first "Decline" leaves the page's alone). */
function isWithdrawal(previous: ConsentState, next: ConsentState): boolean {
    return previous === 'granted' && next === 'denied';
}

export class AnalyticsLoader {
    readonly #deps: AnalyticsDeps;
    #config: AnalyticsConfig | null = null;
    #consent: ConsentState = 'unknown';
    #loading: Promise<Loaded | null> | null = null;
    #pending: FieldEvent[] = [];

    constructor(deps: AnalyticsDeps) {
        this.#deps = deps;
    }

    /** The manifest's ids; without the Firebase app ids analytics stays off (CR-9). */
    configure(measurementId: string | undefined, firebase: FirebaseAppIds | undefined): void {
        if (this.#config !== null || measurementId === undefined) {
            return;
        }
        if (firebase === undefined) {
            this.#deps.log.warn('analytics off: the manifest has no Firebase app ids', { measurementId });
            return;
        }
        this.#config = { measurementId, firebase };
        this.#flush();
    }

    /**
     * Withdrawing turns collection off at once and expires GA4's cookies, again once the SDK has applied it (gtag.js
     * may still have written them while it loaded); granting again (after a withdrawal) turns collection back on.
     */
    setConsent(consent: ConsentState): void {
        const withdrawn = this.#config !== null && isWithdrawal(this.#consent, consent);
        this.#consent = consent;
        if (consent === 'unknown') {
            return;
        }
        if (withdrawn) {
            this.#deps.clearCookies();
        }
        if (consent === 'denied') {
            this.#pending = [];
        }
        this.#flush();
        this.#whenLoaded((loaded) => {
            toggleCollection(loaded, consent === 'granted');
            if (withdrawn) {
                this.#deps.clearCookies();
            }
        });
    }

    /**
     * Sends `event` once the SDK is ready, if the guard lets it; dropped without configuration or consent (also if consent
     * goes in between), except a field measurement, which waits for both unless consent was refused.
     */
    send(event: GaEvent | FieldEvent): void {
        const config = this.#config;
        if (config === null || this.#consent !== 'granted') {
            this.#hold(event);
            return;
        }
        this.#loading ??= this.#start(config);
        this.#whenLoaded((loaded) => {
            if (this.#consent === 'granted') {
                this.#log(loaded, event);
            }
        });
    }

    #hold(event: GaEvent | FieldEvent): void {
        if (isField(event) && this.#consent !== 'denied' && this.#pending.length < MAX_PENDING) {
            this.#pending.push(event);
        }
    }

    /** The held field measurements, once the ids are known and consent is granted. */
    #flush(): void {
        if (this.#config === null || this.#consent !== 'granted') {
            return;
        }
        const pending = this.#pending;
        this.#pending = [];
        for (const event of pending) {
            this.send(event);
        }
    }

    /** The event checked by the guard (`@hcm/shared`), then logged; a dropped one is logged once per reason. */
    #log(loaded: Loaded, event: GaEvent | FieldEvent): void {
        const params = isField(event) ? { ...event.params, ...this.#deps.fieldContext() } : gaParams(event);
        // §203: every event names its app, so the owner's Statistics view counts the map's visitors apart from the admin's.
        const checked = loaded.guard.check(event.name, { ...params, app_surface: 'viewer', page_location: this.#deps.pageLocation() });
        if (checked.ok) {
            loaded.sdk.logEvent(loaded.analytics, event.name, checked.params);
        } else if (checked.first) {
            this.#deps.log.warn('analytics event dropped', { name: event.name, reason: checked.reason });
        }
    }

    /** Runs `action` once the SDK has loaded (never if it is not loading or failed); a throwing SDK call is logged. */
    #whenLoaded(action: (loaded: Loaded) => void): void {
        this.#loading
            ?.then((loaded) => {
                if (loaded !== null) {
                    action(loaded);
                }
            })
            .catch((error: unknown) => {
                this.#deps.log.warn('analytics call failed', { error: String(error) });
            });
    }

    /** Both chunks, GA4 initialised, then the Core Web Vitals observers (once per page). */
    async #start(config: AnalyticsConfig): Promise<Loaded | null> {
        try {
            const [sdk, field] = await Promise.all([this.#deps.loadSdk(), this.#deps.loadField()]);
            if (!(await sdk.isSupported())) {
                this.#deps.log.info('analytics unsupported in this browser');
                return null;
            }
            const loaded = { ...initialize(sdk, config, this.#deps, this.#consent === 'granted'), guard: field.createGuard() };
            field.observeVitals((params) => {
                this.send({ name: 'web_vitals', params });
            });
            return loaded;
        } catch (error) {
            this.#deps.log.warn('analytics failed to load', { error: String(error) });
            return null;
        }
    }
}

/** Google signals and ad personalisation stay off whatever the property says (Consent Mode denies ad storage too). */
const NO_ADVERTISING = { allow_google_signals: false, allow_ad_personalization_signals: false } as const;

/**
 * Consent first (Consent Mode v2, as it stands now: the visitor may have withdrawn while the chunk loaded), then GA4
 * on the viewer's named app with the hash-free page location and without the automatic page view.
 */
function initialize(sdk: FirebaseSdk, config: AnalyticsConfig, deps: AnalyticsDeps, granted: boolean): Omit<Loaded, 'guard'> {
    const app = sdk.initializeApp({ ...config.firebase, measurementId: config.measurementId }, FIREBASE_APP_NAME);
    sdk.setConsent(granted ? CONSENT_GRANTED : CONSENT_DENIED);
    const page = { page_location: deps.pageLocation(), page_path: deps.pagePath() };
    const analytics = sdk.initializeAnalytics(app, { config: { send_page_view: false, ...page, ...NO_ADVERTISING } });
    sdk.setAnalyticsCollectionEnabled(analytics, granted);
    return { sdk, analytics };
}

/** Consent Mode v2 and GA4 collection on or off. */
function toggleCollection(loaded: Omit<Loaded, 'guard'>, enabled: boolean): void {
    loaded.sdk.setConsent(enabled ? CONSENT_GRANTED : CONSENT_DENIED);
    loaded.sdk.setAnalyticsCollectionEnabled(loaded.analytics, enabled);
}
