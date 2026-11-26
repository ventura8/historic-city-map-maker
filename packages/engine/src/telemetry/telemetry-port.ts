/**
 * What the viewer store sees of analytics and crash reporting (docs/research/M1-interfaces.md §6, PLAN Addendum 2).
 * `createTelemetry` (`telemetry.ts`) implements it: consent (`consent.ts`), the consent-gated Firebase loader
 * (`analytics.ts`) and the error reporter (`errors.ts`).
 */
import type { ErrorReport, FieldEventName, GaParams, ViewerPhase } from '@hcm/shared';
import type { MapErrorKind, Unsubscribe } from '@hcm/ui/map';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export type TelemetryEvent =
    | { readonly name: 'page_view' }
    | { readonly name: 'layer_toggle'; readonly layerId: string; readonly visible: boolean }
    | { readonly name: 'year_change'; readonly year: number | null }
    | { readonly name: 'photo_open'; readonly photoId: string }
    | { readonly name: 'poi_open'; readonly poiId: string }
    | { readonly name: 'share' }
    | { readonly name: 'compare_open' }
    | { readonly name: 'story_open'; readonly storyId: string }
    | { readonly name: 'locale_change'; readonly locale: string }
    | { readonly name: 'theme_change'; readonly theme: string }
    /** The compass turned the map back to north (V64); a pad or a console's browser first used on the page (V65). */
    | { readonly name: 'compass_reset' }
    | { readonly name: 'input_device'; readonly device: 'gamepad' | 'console' };

/**
 * A field measurement as GA4 receives it (docs/ARCHITECTURE.md → *Field measurements*): its parameters without the
 * context (`app`, `window_class`, `release`), which telemetry adds when it is sent.
 */
export interface FieldEvent {
    readonly name: FieldEventName;
    readonly params: GaParams;
}

/** Why the viewer has no map: WebGL `unsupported` or `context_lost`, or the map failed (`webgl`, `style`, `container`). */
type MapUnavailable = 'unsupported' | 'context_lost' | 'webgl' | 'style' | 'container';

/**
 * What the boot and the store report of the viewer's own performance (`FieldRecorder` of `field.ts` times them): the
 * boot's phases, a failed manifest, a map that is unavailable, the map's errors by kind, and the two waits of the visitor
 * (`start` and `end` of `photo`: the click to the decoded thumbnail; of `compare`: the click to the second map).
 */
export type Measurement =
    | { readonly kind: 'phase'; readonly phase: ViewerPhase }
    | { readonly kind: 'manifest_error'; readonly code: string; readonly retryable: boolean }
    | { readonly kind: 'map_unavailable'; readonly reason: MapUnavailable }
    | { readonly kind: 'map_error'; readonly errorKind: MapErrorKind }
    /** An error toast the visitor was shown, by its catalogue key (never its words). */
    | { readonly kind: 'ui_error'; readonly code: string }
    | { readonly kind: 'start'; readonly what: 'photo' | 'compare' }
    | { readonly kind: 'end'; readonly what: 'photo' | 'compare'; readonly ok: boolean };

/** Where an error was caught: `window`, `promise` or `boundary` (`ERROR_SOURCES` of `@hcm/shared`). */
export type ErrorSource = ErrorReport['source'];

/** The Firebase web app identifiers `initializeApp` needs besides the measurement id (public values; CR-9). */
export interface FirebaseAppIds {
    readonly apiKey: string;
    readonly appId: string;
    readonly projectId: string;
}

/**
 * What telemetry learns once the manifest has loaded, and again whenever the language or the window class changes:
 * the city (it namespaces the stored consent), the analytics ids and the error endpoint of the manifest.
 */
export interface TelemetryContext {
    readonly cityId: string;
    readonly locale: string;
    readonly windowClass: string;
    readonly measurementId?: string;
    readonly errorEndpoint?: string;
    readonly firebase?: FirebaseAppIds;
}

export interface TelemetryPort {
    readonly consent: ConsentState;
    /** Stored under `hcm:<cityId>:consent`; withdrawing stops every later analytics request (V19). */
    setConsent(consent: 'granted' | 'denied'): void;
    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe;
    /** Dropped unless consent is granted and the manifest has a measurementId; the Firebase SDK loads lazily on the first one. */
    logEvent(event: TelemetryEvent): void;
    /**
     * Never throws. Redacted (createLogger's rules plus URL queries), at most 5 per page and one per message per 10 s,
     * POSTed to `analytics.errorEndpoint` when set; a GA4 `exception` event too when consent is granted (V20).
     */
    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void;
    /** engine-core addition (CR-8): the store passes the manifest's ids and the live locale and window class. */
    setContext?(context: TelemetryContext): void;
    /** §76: a field measurement, timed now and sent only after consent (held in memory until then, never stored). */
    measure?(measurement: Measurement): void;
    destroy(): void;
}

/**
 * The body sent to `telemetry.reportError` (M2 HTTPS function): `ErrorReport` of `@hcm/shared`, the schema the endpoint
 * validates (docs/research/M2-interfaces.md CR-M2-4). No PII: no hash, no query, no visitor position; `page` is
 * `location.origin + location.pathname`.
 */
export type ErrorReportPayload = ErrorReport;
