/**
 * GA4 for the admin (PLAN Addendum 2), through `firebase/analytics` on the admin's own Firebase app. Nothing loads and no
 * Google host is contacted until the admin consented **and** the web configuration has a `measurementId`; the SDK module
 * is then imported lazily (`analytics-sdk.ts`, its own chunk in the ES build). Consent Mode v2 starts denied and grants
 * `analytics_storage` only; withdrawing turns collection off at once. Like the viewer, GA4 is told the page's origin and
 * path only, never its hash, and the automatic page view is off (the shell logs one per route).
 *
 * Field measurements (docs/research/DECISIONS-for-review.md §76): the field chunk (`field-sdk.ts`: Google's `web-vitals`
 * and the event guard of `@hcm/shared`) loads with the SDK; every event is checked by that guard before GA4 sees it (its
 * schema, GA4's limits, no PII, the page's budget), and the Core Web Vitals observers start.
 */
import type { AppSurface, CityRole, FieldChunk, FieldEventName, FieldGuard, GaParams, Logger } from '@hcm/shared';

/** The parts of `firebase/analytics` the admin uses (`analytics-sdk.ts` provides the real ones). */
export interface AnalyticsSdk<App = unknown, Analytics = unknown> {
    readonly isSupported: () => Promise<boolean>;
    readonly setConsent: (settings: Readonly<Record<string, 'granted' | 'denied'>>) => void;
    readonly initializeAnalytics: (app: App, options: { readonly config: Readonly<Record<string, unknown>> }) => Analytics;
    readonly logEvent: (analytics: Analytics, name: string, params: Readonly<Record<string, string | number | boolean>>) => void;
    readonly setAnalyticsCollectionEnabled: (analytics: Analytics, enabled: boolean) => void;
}

/** Consent Mode v2 before any answer, and after a refusal or a withdrawal. */
export const CONSENT_DENIED = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
} as const;

/** After "Accept": analytics storage only. */
export const CONSENT_GRANTED = { ...CONSENT_DENIED, analytics_storage: 'granted' } as const;

export type EventParams = GaParams;

/** What the admin's telemetry sees of GA4. */
export interface AnalyticsPort {
    /** The admin's answer (or its withdrawal): collection on or off; the first grant loads nothing yet. */
    setConsent(granted: boolean): void;
    /** Sent once the SDK is ready, if the guard lets it; dropped while consent is not granted. */
    log(name: string, params: EventParams): void;
    /** A field measurement (§76): `log` with the context every one carries (`app`, `window_class`, `release`). */
    field(name: FieldEventName, params: EventParams): void;
}

export interface AnalyticsDeps<App, Analytics> {
    readonly app: App;
    readonly load: () => Promise<AnalyticsSdk<App, Analytics>>;
    readonly log: Logger;
    /** `location.origin + location.pathname`. */
    readonly pageLocation: () => string;
    /** Loads the field chunk (`loadFieldSdk` of `app.ts`). */
    readonly loadField: () => Promise<FieldChunk>;
    /** What every field measurement carries: `app`, `window_class`, `release`. */
    readonly fieldContext: () => GaParams;
    /** §203: the app and the role every event carries (`admin_owner` …; `admin` before a role is known). */
    readonly surface: () => AppSurface;
}

interface Loaded<App, Analytics> {
    readonly sdk: AnalyticsSdk<App, Analytics>;
    readonly analytics: Analytics;
    readonly guard: FieldGuard;
}

/** Google signals and ad personalisation stay off whatever the property says. */
const NO_ADVERTISING = { allow_google_signals: false, allow_ad_personalization_signals: false } as const;

/**
 * The prefix of the admin's own GA4 cookies (`hcm_admin_ga`, `hcm_admin_ga_<container>`): since M6 the public map shares
 * the admin's origin (`docs/research/M6-interfaces.md` §2.3), so the admin's withdrawal expires these and never the viewer's
 * `_ga` (`../app/telemetry.ts`).
 */
const ADMIN_COOKIE_PREFIX = 'hcm_admin';

/**
 * Both chunks, GA4 on the admin's app in Consent Mode as it stands now (`granted()`), then the Core Web Vitals observers,
 * each metric reported to `vital`; null when the browser cannot run GA4 or a chunk failed.
 */
async function startAnalytics<App, Analytics>(
    deps: AnalyticsDeps<App, Analytics>,
    granted: () => boolean,
    vital: (params: EventParams) => void,
): Promise<Loaded<App, Analytics> | null> {
    try {
        const [sdk, field] = await Promise.all([deps.load(), deps.loadField()]);
        if (!(await sdk.isSupported())) {
            deps.log.info('analytics unsupported in this browser');
            return null;
        }
        sdk.setConsent(granted() ? CONSENT_GRANTED : CONSENT_DENIED);
        const config = { send_page_view: false, page_location: deps.pageLocation(), cookie_prefix: ADMIN_COOKIE_PREFIX, ...NO_ADVERTISING };
        const analytics = sdk.initializeAnalytics(deps.app, { config });
        sdk.setAnalyticsCollectionEnabled(analytics, granted());
        field.observeVitals(vital);
        return { sdk, analytics, guard: field.createGuard() };
    } catch (error) {
        deps.log.warn('analytics failed to load', { error: String(error) });
        return null;
    }
}

/** The event checked by the guard, then logged; a dropped one is logged once per reason. */
function sendChecked<App, Analytics>(
    deps: AnalyticsDeps<App, Analytics>,
    { sdk, analytics, guard }: Loaded<App, Analytics>,
    name: string,
    params: EventParams,
): void {
    const checked = guard.check(name, { ...params, app_surface: deps.surface(), page_location: deps.pageLocation() });
    if (checked.ok) {
        sdk.logEvent(analytics, name, checked.params);
    } else if (checked.first) {
        deps.log.warn('analytics event dropped', { name, reason: checked.reason });
    }
}

/** §203: the admin's `app_surface` for the open city's role (`admin` before one is known). */
export function surfaceOf(role: CityRole | null): AppSurface {
    return role === null ? 'admin' : `admin_${role}`;
}

/** The consent-gated GA4 of the admin. */
export function createAnalytics<App, Analytics>(deps: AnalyticsDeps<App, Analytics>): AnalyticsPort {
    let granted = false;
    let loading: Promise<Loaded<App, Analytics> | null> | null = null;
    const whenLoaded = (action: (loaded: Loaded<App, Analytics>) => void): void => {
        loading
            ?.then((loaded) => {
                if (loaded !== null) {
                    action(loaded);
                }
            })
            .catch((error: unknown) => {
                deps.log.warn('analytics call failed', { error: String(error) });
            });
    };
    const port: AnalyticsPort = {
        setConsent: (next) => {
            granted = next;
            whenLoaded(({ sdk, analytics }) => {
                sdk.setConsent(next ? CONSENT_GRANTED : CONSENT_DENIED);
                sdk.setAnalyticsCollectionEnabled(analytics, next);
            });
        },
        log: (name, params) => {
            if (!granted) {
                return;
            }
            loading ??= startAnalytics(
                deps,
                () => granted,
                (params) => {
                    port.field('web_vitals', params);
                },
            );
            whenLoaded((loaded) => {
                if (granted) {
                    sendChecked(deps, loaded, name, params);
                }
            });
        },
        field: (name, params) => {
            port.log(name, { ...params, ...deps.fieldContext() });
        },
    };
    return port;
}
