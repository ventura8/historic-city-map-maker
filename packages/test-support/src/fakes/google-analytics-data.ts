import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import type { AnalyticsAdminState } from './google-analytics-admin.js';
import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { jsonResponse, requestObject, route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';
import type { UpstreamRequest } from './fetch.js';

/**
 * The GA4 Data API's `batchRunReports` (`v1beta`; the Statistics view, `DECISIONS-for-review.md` §203; the answer's shape
 * as Google documents it, UNVERIFIED against the live API). A request that names a custom dimension or metric
 * (`customEvent:<name>`, `averageCustomEvent:<name>`) the property has not registered (the Analytics Admin fake's custom
 * definitions) answers 400 `INVALID_ARGUMENT`, as GA4 does. Without the `sample` scenario every report is empty (a
 * property with no data yet); with it each report gets fixed rows by its dimensions, scaled by the period's days.
 *
 * The property's metadata (`getMetadata`) lists GA4's own fields and the custom ones its reports can use: the registered
 * ones (or, with `registered`, the Statistics view's own names), none with `notReady` (registered on the Admin fake but
 * not usable yet, as GA4 does for up to 48 hours). `refuse` answers every `batchRunReports` 400 `INVALID_ARGUMENT`.
 */

export interface AnalyticsDataState {
    /** The scenario `analytics-data.sample`: the reports have rows. */
    sample: boolean;
    /** The scenario `analytics-data.registered`: every custom name counts as registered (Setup's reports were made earlier). */
    registered: boolean;
    /** The scenario `analytics-data.notReady`: the view's names are registered, but the metadata lists none of them yet. */
    notReady: boolean;
    /** The scenario `analytics-data.refuse`: every report request answers 400 `INVALID_ARGUMENT`. */
    refuse: boolean;
    /** Each request's period in days, in order (the Statistics view asks once per period). */
    readonly periods: number[];
}

export function defaultAnalyticsDataState(): AnalyticsDataState {
    return { sample: false, registered: false, notReady: false, refuse: false, periods: [] };
}

const ANALYTICS_DATA: GoogleApi = {
    service: 'analyticsdata.googleapis.com',
    title: 'Google Analytics Data API',
    permission: 'analytics.properties.runReport',
};

/** GA4's own fields the Statistics view asks for. */
const STANDARD_DIMENSIONS = ['date', 'eventName', 'pagePath', 'deviceCategory', 'country', 'newVsReturning', 'language'];
const STANDARD_METRICS = ['totalUsers', 'sessions', 'eventCount', 'screenPageViews'];
/** The Statistics view's custom names (`packages/admin/src/google/analytics-data.ts`). */
const VIEW_DIMENSIONS = ['wizard_id', 'step_id', 'error_code', 'app_surface', 'route', 'year', 'layer_id', 'photo_id'];
const VIEW_METRICS = ['duration_ms'];

type SampleRow = readonly [readonly string[], readonly number[]];

/** Fixed rows per report, keyed by its dimensions and the event it filters on (28 days' worth). */
const SAMPLES: Readonly<Record<string, readonly SampleRow[]>> = {
    '': [[[], [120, 180]]],
    'customEvent:wizard_id,customEvent:step_id|step_view': [
        [['new_city', 'names'], [10]],
        [['new_city', 'area'], [7]],
        [['new_city', 'create'], [5]],
    ],
    'customEvent:wizard_id,customEvent:step_id,customEvent:error_code|step_error': [
        [['new_city', 'area', 'apiError.invalidRequest'], [2]],
        [['new_city', 'area', 'e2e_unknown_code'], [1]],
    ],
    'customEvent:wizard_id,customEvent:step_id|step_complete': [
        [['new_city', 'names'], [30_000]],
        [['new_city', 'area'], [150_000]],
    ],
    'customEvent:app_surface|': [
        [['viewer'], [100, 150]],
        [['admin_owner'], [1, 9]],
        [['(not set)'], [19, 21]],
    ],
    'customEvent:app_surface,date|': [
        [
            ['viewer', '20261111'],
            [30, 40],
        ],
        [
            ['viewer', '20261112'],
            [50, 70],
        ],
        [
            ['admin_owner', '20261112'],
            [1, 9],
        ],
    ],
    'pagePath|': [
        [['/'], [300]],
        [['/admin/'], [40]],
    ],
    'customEvent:route|page_view': [
        [['home'], [12]],
        // An empty route and `(not set)` are page views before the admin named the screen; Statistics leaves them out.
        [[''], [8]],
        [['(not set)'], [1]],
        [['crashes'], [4]],
    ],
    'eventName|': [
        [['year_change'], [50]],
        [['photo_open'], [20]],
    ],
    'deviceCategory|': [
        [['desktop'], [80]],
        [['mobile'], [40]],
    ],
    'country|': [
        [['Romania'], [90]],
        [['Germany'], [10]],
    ],
    // Home's Visitors card (packages/admin/src/google/analytics-data.ts `SUMMARY_REPORTS`, `LOOKED_AT_REPORTS`).
    'date|': [
        [['20261111'], [40, 60]],
        [['20261112'], [80, 120]],
    ],
    'newVsReturning|': [
        [['new'], [70]],
        [['returning'], [50]],
    ],
    'language|': [
        [['Romanian'], [100]],
        [['English'], [20]],
    ],
    'customEvent:year|year_change': [
        [['1966'], [30]],
        [['1912'], [12]],
    ],
    'customEvent:layer_id|layer_toggle': [[['corona-1966'], [25]]],
    'customEvent:photo_id|photo_open': [[['gara-de-nord'], [9]]],
};

type Json = Readonly<Record<string, unknown>>;

function names(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String((item as Json)['name'])) : [];
}

/** The `eventName` a report filters on with one value (`stringFilter`), else empty. */
function filteredEvent(request: Json): string {
    const filter = (request['dimensionFilter'] as Json | undefined)?.['filter'] as Json | undefined;
    const value = (filter?.['stringFilter'] as Json | undefined)?.['value'];
    return typeof value === 'string' ? value : '';
}

function registeredOf(admin: AnalyticsAdminState, property: string, kind: string): readonly string[] {
    return (admin.definitions.get(`properties/${property}/${kind}`) ?? []).map((item) => item.parameterName);
}

/** The custom names of `kind` the property's reports can use. */
function usableOf(state: AnalyticsDataState, admin: AnalyticsAdminState, property: string, kind: string): readonly string[] {
    if (state.notReady) {
        return [];
    }
    const own = kind === 'customDimensions' ? VIEW_DIMENSIONS : VIEW_METRICS;
    return [...new Set([...registeredOf(admin, property, kind), ...(state.registered ? own : [])])];
}

function metadata(state: AnalyticsDataState, admin: AnalyticsAdminState, params: RouteParams): Response {
    const property = String(params['property']);
    const field = (apiName: string, custom: boolean) => ({ apiName, uiName: apiName, customDefinition: custom });
    const metrics = usableOf(state, admin, property, 'customMetrics').flatMap((name) => [
        field(`customEvent:${name}`, true),
        field(`averageCustomEvent:${name}`, true),
    ]);
    return jsonResponse({
        name: `properties/${property}/metadata`,
        dimensions: [
            ...STANDARD_DIMENSIONS.map((name) => field(name, false)),
            ...usableOf(state, admin, property, 'customDimensions').map((name) => field(`customEvent:${name}`, true)),
        ],
        metrics: [...STANDARD_METRICS.map((name) => field(name, false)), ...metrics],
    });
}

/** Registers the view's names on the Admin fake (the scenario `notReady`: Setup ran, GA4 is not ready yet). */
function registerViewNames(admin: AnalyticsAdminState): void {
    const property = `properties/${String(FIXTURE_VALUES['analyticsPropertyId'])}`;
    const define = (kind: string, names: readonly string[]) => {
        admin.definitions.set(
            `${property}/${kind}`,
            names.map((parameterName, index) => ({
                parameterName,
                displayName: parameterName,
                scope: 'EVENT',
                name: `${property}/${kind}/${String(index + 1)}`,
            })),
        );
    };
    define('customDimensions', VIEW_DIMENSIONS);
    define('customMetrics', VIEW_METRICS);
}

/** A custom field (`customEvent:x`, `averageCustomEvent:x`) the property's reports cannot use, or undefined. */
function unregistered(
    state: AnalyticsDataState,
    admin: AnalyticsAdminState,
    property: string,
    fields: readonly string[],
): string | undefined {
    const registered = new Set(['customDimensions', 'customMetrics'].flatMap((kind) => usableOf(state, admin, property, kind)));
    return fields
        .map((field) => /^(?:average)?[cC]ustomEvent:(\w+)$/.exec(field)?.[1])
        .find((name) => name !== undefined && !registered.has(name));
}

/** `<n>daysAgo` as n; `today` (or anything else) as 0. */
function ago(value: unknown): number {
    return Number(/^(\d+)daysAgo$/.exec(String(value))?.[1] ?? '0');
}

/** A request's length in days (the period before the current one has as many); 28 without a range. */
function daysOf(request: Json): number {
    const ranges = Array.isArray(request['dateRanges']) ? (request['dateRanges'] as Json[]) : [];
    const range = ranges[0] ?? { startDate: '28daysAgo', endDate: 'today' };
    const start = ago(range['startDate']);
    const end = ago(range['endDate']);
    return end === 0 ? start : start - end + 1;
}

function reportOf(state: AnalyticsDataState, request: Json): Json {
    const dimensions = names(request['dimensions']);
    const metrics = names(request['metrics']);
    const key = dimensions.length === 0 ? '' : `${dimensions.join(',')}|${filteredEvent(request)}`;
    const scale = daysOf(request) / 28;
    const rows = state.sample ? (SAMPLES[key] ?? []) : [];
    return {
        dimensionHeaders: dimensions.map((name) => ({ name })),
        metricHeaders: metrics.map((name) => ({ name, type: 'TYPE_INTEGER' })),
        ...(rows.length === 0
            ? {}
            : {
                  rows: rows.map(([values, numbers]) => ({
                      dimensionValues: values.map((value) => ({ value })),
                      metricValues: numbers.map((number) => ({ value: String(Math.round(number * scale)) })),
                  })),
              }),
        rowCount: rows.length,
        kind: 'analyticsData#runReport',
    };
}

function batch(state: AnalyticsDataState, admin: AnalyticsAdminState, request: UpstreamRequest, params: RouteParams): Response {
    const requests = (requestObject(request)['requests'] as Json[] | undefined) ?? [];
    const property = String(params['property']);
    const missing = requests
        .map((item) => unregistered(state, admin, property, [...names(item['dimensions']), ...names(item['metrics'])]))
        .find((name) => name !== undefined);
    if (state.refuse || missing !== undefined) {
        return googleError('google/error.invalid-argument', ANALYTICS_DATA);
    }
    state.periods.push(...requests.map(daysOf));
    return jsonResponse({ reports: requests.map((item) => reportOf(state, item)), kind: 'analyticsData#batchRunReports' });
}

/** The fake GA4 Data API over the Analytics Admin fake's custom definitions. */
export function createAnalyticsDataFake(state: AnalyticsDataState, admin: AnalyticsAdminState): ServiceFake {
    return {
        name: 'analytics-data',
        routes: [
            route(
                'POST',
                'https://analyticsdata.googleapis.com/v1beta/properties/{property}:batchRunReports',
                'analytics-data.batchRunReports',
                authenticated(ANALYTICS_DATA, (request, params) => batch(state, admin, request, params)),
            ),
            route(
                'GET',
                'https://analyticsdata.googleapis.com/v1beta/properties/{property}/metadata',
                'analytics-data.getMetadata',
                authenticated(ANALYTICS_DATA, (_request, params) => metadata(state, admin, params)),
            ),
        ],
        failure: (mode) => googleFailure(ANALYTICS_DATA, mode),
        scenarios: {
            sample: () => {
                state.sample = true;
            },
            registered: () => {
                state.registered = true;
            },
            unregistered: () => {
                state.registered = false;
            },
            notReady: () => {
                state.notReady = true;
                registerViewNames(admin);
            },
            refuse: () => {
                state.refuse = true;
            },
        },
        snapshot: () => ({ ...state, periods: [...state.periods] }),
    };
}
