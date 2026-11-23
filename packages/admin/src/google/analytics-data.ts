import { missingParameters, NOT_SET, parametersOf, usableParameters, type StatisticsPending } from './analytics-fields.js';
import { StatisticsProblem } from './statistics-problem.js';
import { at, list, records, stringAt } from './json.js';
import { createGoogleTransport, type GoogleTransport, type GoogleTransportOptions } from './transport.js';

/**
 * The Statistics view's numbers (`#/crashes/statistics`, `DECISIONS-for-review.md` §203): read straight from the GA4
 * Data API (`v1beta` `batchRunReports`) with the owner's read-only Analytics token, for the property whose web stream
 * sends the project's measurement id (found the way Setup's Create the measurement reports finds it: the account
 * summaries, then each property's streams; `analytics-reports.ts`). The property's metadata first: a report naming a
 * measurement name GA4 cannot use yet is not asked, and the numbers say why (`analytics-fields.ts`). Then three calls per
 * period: the wizards and the apps, the overview, the devices and countries. A lazy chunk of its own (`analytics-data`):
 * fetched on the button's click only.
 */

export const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
/** What a refusal names: the GA4 role the account needs on the property. */
export const VIEWER_ROLE = 'Viewer (Google Analytics)';
/** The viewer's key actions the overview counts. */
export const KEY_EVENTS: readonly string[] = ['year_change', 'compass_reset', 'layer_toggle', 'photo_open', 'compare_open', 'share'];
const TOP = 10;

export type StatisticsDays = 7 | 28 | 90;

export type { PendingReason, StatisticsPending } from './analytics-fields.js';

export interface NamedCount {
    readonly name: string;
    readonly count: number;
}

export interface StepNumbers {
    readonly wizard: string;
    readonly step: string;
    /** People who saw the step. */
    readonly visitors: number;
    /** The average time from showing the step to finishing it, or null when nobody finished it. */
    readonly averageMs: number | null;
    /** The `step_error` codes on the step, most frequent first. */
    readonly errors: readonly NamedCount[];
}

export interface DayNumbers {
    /** `YYYYMMDD`, as GA4 names a day. */
    readonly date: string;
    readonly visitors: number;
    readonly sessions: number;
}

export interface SurfaceNumbers {
    /** `app_surface`: `viewer`, `admin_owner` … or `(not set)` for events sent before the apps tagged themselves. */
    readonly surface: string;
    readonly visitors: number;
    readonly sessions: number;
    readonly daily: readonly DayNumbers[];
}

export interface StatisticsNumbers {
    readonly visitors: number;
    readonly sessions: number;
    readonly pages: readonly NamedCount[];
    readonly screens: readonly NamedCount[];
    readonly events: readonly NamedCount[];
    readonly devices: readonly NamedCount[];
    readonly countries: readonly NamedCount[];
    readonly surfaces: readonly SurfaceNumbers[];
    readonly steps: readonly StepNumbers[];
    /** Why the apps, the admin screens or the wizards' steps are incomplete, or null when nothing is missing. */
    readonly pending: StatisticsPending | null;
    /** Home's Visitors card (the owner, 2026-11-16): the period's days, the period before it, and what was looked at. */
    readonly summary?: VisitorSummary;
}

export interface VisitorSummary {
    /** Every day of the period: visitors and sessions, oldest first. */
    readonly daily: readonly DayNumbers[];
    /** The same number of days just before the period. */
    readonly previous: { readonly visitors: number; readonly sessions: number };
    /** `new` and `returning` visitors. */
    readonly newVsReturning: readonly NamedCount[];
    readonly languages: readonly NamedCount[];
    /** The years chosen most (`year_change`), the layers turned on most (`layer_toggle`), the photos opened most (`photo_open`). */
    readonly years: readonly NamedCount[];
    readonly layers: readonly NamedCount[];
    readonly photos: readonly NamedCount[];
}

type Filter = Readonly<Record<string, unknown>>;

export interface ReportSpec {
    readonly dimensions?: readonly string[];
    readonly metrics: readonly string[];
    readonly filter?: Filter;
    readonly limit?: number;
    readonly orderBy?: string;
}

export function eventIs(value: string): Filter {
    return { filter: { fieldName: 'eventName', stringFilter: { value } } };
}

function eventIn(values: readonly string[]): Filter {
    return { filter: { fieldName: 'eventName', inListFilter: { values } } };
}

function requestOf(spec: ReportSpec, days: StatisticsDays): Readonly<Record<string, unknown>> {
    return {
        dateRanges: [{ startDate: `${String(days)}daysAgo`, endDate: 'today' }],
        dimensions: (spec.dimensions ?? []).map((name) => ({ name })),
        metrics: spec.metrics.map((name) => ({ name })),
        ...(spec.filter === undefined ? {} : { dimensionFilter: spec.filter }),
        ...(spec.orderBy === undefined ? {} : { orderBys: [{ metric: { metricName: spec.orderBy }, desc: true }] }),
        limit: spec.limit ?? 1000,
    };
}

/** One row of a report: its dimension values and its metric values as numbers. */
interface Row {
    readonly dims: readonly string[];
    readonly values: readonly number[];
}

export function rowsOf(report: unknown): readonly Row[] {
    return records(at(report, 'rows')).map((row) => ({
        dims: list(row['dimensionValues']).map((value) => stringAt(value, 'value') ?? ''),
        values: list(row['metricValues']).map((value) => Number(stringAt(value, 'value') ?? '0') || 0),
    }));
}

/** A row's dimension `index`, empty when absent. */
export function dim(row: Row, index: number): string {
    return row.dims[index] ?? '';
}

/** A row's metric `index`, zero when absent. */
export function num(row: Row, index: number): number {
    return row.values[index] ?? 0;
}

export function counts(report: unknown): readonly NamedCount[] {
    return rowsOf(report).map((row) => ({ name: dim(row, 0), count: num(row, 0) }));
}

function fieldsOf(spec: ReportSpec): readonly string[] {
    return [...(spec.dimensions ?? []), ...spec.metrics];
}

/** One period's question: its days and the custom parameters the property's reports can use. */
export interface Ask {
    readonly days: StatisticsDays;
    readonly usable: ReadonlySet<string>;
}

/** The reports of `specs` in order; a report naming a parameter GA4 cannot use is not asked and reads as empty. */
export async function batch(
    transport: GoogleTransport,
    property: string,
    specs: readonly ReportSpec[],
    ask: Ask,
): Promise<readonly unknown[]> {
    const asks = (spec: ReportSpec): boolean => parametersOf(fieldsOf(spec)).every((name) => ask.usable.has(name));
    const asked = specs.filter(asks);
    const queue = asked.length === 0 ? [] : [...(await runReports(transport, property, asked, ask.days))];
    return specs.map((spec) => (asks(spec) ? queue.shift() : undefined) ?? {});
}

async function runReports(
    transport: GoogleTransport,
    property: string,
    specs: readonly ReportSpec[],
    days: StatisticsDays,
): Promise<readonly unknown[]> {
    const answer = await transport.call({
        operation: 'analytics-data.batchRunReports',
        method: 'POST',
        url: `${DATA_API}/${property}:batchRunReports`,
        body: { requests: specs.map((spec) => requestOf(spec, days)) },
        role: VIEWER_ROLE,
    });
    return list(at(answer, 'reports'));
}

const WIZARD_REPORTS: readonly ReportSpec[] = [
    { dimensions: ['customEvent:wizard_id', 'customEvent:step_id'], metrics: ['totalUsers'], filter: eventIs('step_view') },
    {
        dimensions: ['customEvent:wizard_id', 'customEvent:step_id', 'customEvent:error_code'],
        metrics: ['eventCount'],
        filter: eventIs('step_error'),
        orderBy: 'eventCount',
    },
    {
        dimensions: ['customEvent:wizard_id', 'customEvent:step_id'],
        metrics: ['averageCustomEvent:duration_ms'],
        filter: eventIs('step_complete'),
    },
    { dimensions: ['customEvent:app_surface'], metrics: ['totalUsers', 'sessions'] },
    { dimensions: ['customEvent:app_surface', 'date'], metrics: ['totalUsers', 'sessions'] },
];

const OVERVIEW_REPORTS: readonly ReportSpec[] = [
    { metrics: ['totalUsers', 'sessions'] },
    { dimensions: ['pagePath'], metrics: ['screenPageViews'], orderBy: 'screenPageViews', limit: TOP },
    { dimensions: ['customEvent:route'], metrics: ['eventCount'], filter: eventIs('page_view'), orderBy: 'eventCount', limit: TOP },
    { dimensions: ['eventName'], metrics: ['eventCount'], filter: eventIn(KEY_EVENTS), orderBy: 'eventCount' },
    { dimensions: ['deviceCategory'], metrics: ['totalUsers'], orderBy: 'totalUsers', limit: TOP },
];

const PLACE_REPORTS: readonly ReportSpec[] = [{ dimensions: ['country'], metrics: ['totalUsers'], orderBy: 'totalUsers', limit: TOP }];

/** Every custom parameter the view's reports name. */
const WANTED: readonly string[] = parametersOf([...WIZARD_REPORTS, ...OVERVIEW_REPORTS, ...PLACE_REPORTS].flatMap(fieldsOf));

const keyOf = (wizard: string, step: string): string => `${wizard}/${step}`;

/** Each step's people, average time and error codes, from the three wizard reports. */
function stepsOf(views: unknown, errors: unknown, times: unknown): readonly StepNumbers[] {
    const averages = new Map(rowsOf(times).map((row) => [keyOf(dim(row, 0), dim(row, 1)), num(row, 0)]));
    const codes = new Map<string, NamedCount[]>();
    for (const row of rowsOf(errors)) {
        const key = keyOf(dim(row, 0), dim(row, 1));
        codes.set(key, [...(codes.get(key) ?? []), { name: dim(row, 2), count: num(row, 0) }]);
    }
    return rowsOf(views).map((row) => {
        const key = keyOf(dim(row, 0), dim(row, 1));
        return {
            wizard: dim(row, 0),
            step: dim(row, 1),
            visitors: num(row, 0),
            averageMs: averages.get(key) ?? null,
            errors: codes.get(key) ?? [],
        };
    });
}

/** Each app's totals with its days in order. */
function surfacesOf(totals: unknown, daily: unknown): readonly SurfaceNumbers[] {
    const days = rowsOf(daily);
    return rowsOf(totals).map((row) => {
        const surface = dim(row, 0);
        const own = days
            .filter((day) => dim(day, 0) === surface)
            .map((day) => ({ date: dim(day, 1), visitors: num(day, 0), sessions: num(day, 1) }))
            .sort((left, right) => left.date.localeCompare(right.date));
        return { surface, visitors: num(row, 0), sessions: num(row, 1), daily: own };
    });
}

/** The property of `measurementId`, or a {@link StatisticsProblem}: no property at all is no access, another one is no property. */
async function findProperty(transport: GoogleTransport, measurementId: string): Promise<string> {
    // Setup's own chunk (`analytics-reports`), fetched as it is: sharing it statically would move it into `editor-shared`.
    const { propertyOf, visibleProperties } = await import('./analytics-reports.js');
    const properties = await visibleProperties(transport, VIEWER_ROLE);
    if (properties.length === 0) {
        throw new StatisticsProblem('noAccess');
    }
    const property = await propertyOf(transport, measurementId, properties, VIEWER_ROLE);
    if (property === undefined) {
        throw new StatisticsProblem('noProperty');
    }
    return property;
}

/** Reads Home's Visitors card with the same property and names (`analytics-summary.ts` `summaryOf`). */
type SummaryReader = (transport: GoogleTransport, property: string, ask: Ask) => Promise<VisitorSummary>;

/** Every number of the Statistics view for the last `days`; rejects with a `GoogleApiError` or a {@link StatisticsProblem}. */
export async function readStatistics(
    options: GoogleTransportOptions,
    measurementId: string,
    days: StatisticsDays,
    summary?: SummaryReader,
): Promise<StatisticsNumbers> {
    const transport = createGoogleTransport(options);
    const property = await findProperty(transport, measurementId);
    const usable = await usableParameters(transport, property, VIEWER_ROLE);
    const ask: Ask = { days, usable };
    const [views, errors, times, surfaceTotals, surfaceDays] = await batch(transport, property, WIZARD_REPORTS, ask);
    const [totals, pages, screens, events, devices] = await batch(transport, property, OVERVIEW_REPORTS, ask);
    const [countries] = await batch(transport, property, PLACE_REPORTS, ask);
    const total = rowsOf(totals)[0] ?? { dims: [], values: [] };
    const read = {
        visitors: num(total, 0),
        sessions: num(total, 1),
        // A page view without a screen name is the public map's, or the admin's before `route` was registered.
        // An empty `route` is a page view before the admin registered the screen name (same as `(not set)`: no label to show).
        ...{ pages: counts(pages), screens: counts(screens).filter((item) => item.name !== NOT_SET && item.name !== '') },
        ...{ events: counts(events), devices: counts(devices), countries: counts(countries) },
        surfaces: surfacesOf(surfaceTotals, surfaceDays),
        steps: stepsOf(views, errors, times),
        // Home's Visitors card: the caller's reader (the lazy `analytics-summary` chunk), when given.
        ...(summary === undefined ? {} : { summary: await summary(transport, property, ask) }),
    };
    const pending = (await missingParameters(transport, { property, role: VIEWER_ROLE }, WANTED, usable)) ?? noValues(read);
    if (pending !== null) {
        options.log.warn('statistics incomplete', { property, reason: pending.reason, names: pending.names.join(',') });
    }
    return { ...read, pending };
}

/** Every name usable but none carried yet: no wizard step, no admin screen and no app but `(not set)`. */
function noValues(read: Omit<StatisticsNumbers, 'pending'>): StatisticsPending | null {
    const empty = read.steps.length === 0 && read.screens.length === 0 && read.surfaces.every((item) => item.surface === NOT_SET);
    return empty ? { reason: 'noData', names: [] } : null;
}
