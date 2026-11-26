import { at, records, stringAt } from './json.js';
import { createGoogleTransport, type GoogleTransport, type GoogleTransportOptions } from './transport.js';

/**
 * Step (g)'s Create the measurement reports (`DECISIONS-for-review.md` §76f, the user's decision of 2026-11-01): the
 * field measurements' parameters (`docs/ARCHITECTURE.md` → *Field measurements*, `docs/ADMIN_GUIDE.*.md`) registered
 * as custom dimensions and metrics of the project's GA4 property, so GA4's reports and explorations can use them. The
 * property is the one whose web stream has the project's measurement id, found through the Google Analytics Admin API
 * (`v1beta`: account summaries, then each property's data streams). Idempotent: a parameter already registered (as a
 * dimension or a metric) is skipped. A lazy chunk of its own (`analytics-reports`): fetched on the button's click only.
 */

const API = 'https://analyticsadmin.googleapis.com/v1beta';
const ROLE = 'roles/analytics.editor';

/** The event-scoped custom dimensions: the parameters reports group by. */
export const FIELD_DIMENSIONS: readonly string[] = [
    'metric_name',
    'metric_rating',
    'debug_target',
    'window_class',
    'release',
    'phase',
    'step',
    'outcome',
    'area',
    'target',
    'error_kind',
    // The wizard funnels and the errors shown (§200): which wizard, which step, which code, which action.
    'wizard_id',
    'step_id',
    'error_code',
    'action',
    'code',
    'route',
    'device',
    // Which app and which role sent an event (§203: the Statistics view's visitors per app and role).
    'app_surface',
    // Home's Visitors card (§238): the years chosen, the layers turned on, the photos opened.
    'year',
    'layer_id',
    'photo_id',
];

/** The event-scoped custom metrics and their units: the numbers reports add up or average. */
export const FIELD_METRICS: Readonly<Record<string, 'MILLISECONDS' | 'STANDARD'>> = {
    metric_value: 'MILLISECONDS',
    duration_ms: 'MILLISECONDS',
    error_count: 'STANDARD',
    attempt: 'STANDARD',
};

export interface MeasurementReports {
    readonly created: number;
    readonly skipped: number;
}

/** The GA4 properties (`properties/<id>`) the signed-in account can see, read with `role` named on a refusal. */
export async function visibleProperties(transport: GoogleTransport, role: string): Promise<readonly string[]> {
    const summaries = await transport.pages(
        { operation: 'analytics-admin.accountSummaries.list', url: `${API}/accountSummaries`, role },
        'accountSummaries',
    );
    return summaries.flatMap((summary) => records(at(summary, 'propertySummaries'))).map((item) => String(item['property']));
}

/**
 * The property (`properties/<id>`) whose web stream sends `measurementId`, among `properties` (also the Statistics view's
 * way to it, with the read-only scope: `analytics-data.ts`).
 */
export async function propertyOf(
    transport: GoogleTransport,
    measurementId: string,
    properties: readonly string[],
    role: string = ROLE,
): Promise<string | undefined> {
    for (const property of properties) {
        const streams = await transport.pages(
            { operation: 'analytics-admin.dataStreams.list', url: `${API}/${property}/dataStreams`, role },
            'dataStreams',
        );
        if (streams.some((stream) => stringAt(stream, 'webStreamData', 'measurementId') === measurementId)) {
            return property;
        }
    }
    return undefined;
}

/**
 * The parameter names registered on `property` as custom dimensions or metrics (also the Statistics view's way to tell a
 * name GA4 does not know from one it knows but cannot report on yet: `analytics-data.ts`).
 */
export async function registeredParameters(transport: GoogleTransport, property: string, role: string): Promise<ReadonlySet<string>> {
    const listed = async (kind: string): Promise<readonly unknown[]> =>
        transport.pages({ operation: `analytics-admin.${kind}.list`, url: `${API}/${property}/${kind}`, role }, kind);
    const items = [...(await listed('customDimensions')), ...(await listed('customMetrics'))];
    return new Set(items.map((item) => stringAt(item, 'parameterName')).filter((name): name is string => name !== undefined));
}

/**
 * Registers every field parameter not registered yet on the property of `measurementId`; null when no property the
 * owner can see sends it.
 */
export async function createMeasurementReports(options: GoogleTransportOptions, measurementId: string): Promise<MeasurementReports | null> {
    const transport = createGoogleTransport(options);
    const property = await propertyOf(transport, measurementId, await visibleProperties(transport, ROLE));
    if (property === undefined) {
        return null;
    }
    const existing = await registeredParameters(transport, property, ROLE);
    const wanted = [
        ...FIELD_DIMENSIONS.map((name) => ['customDimensions', { parameterName: name, displayName: name, scope: 'EVENT' }] as const),
        ...Object.entries(FIELD_METRICS).map(
            ([name, measurementUnit]) =>
                ['customMetrics', { parameterName: name, displayName: name, scope: 'EVENT', measurementUnit }] as const,
        ),
    ];
    const missing = wanted.filter(([, body]) => !existing.has(body.parameterName));
    for (const [kind, body] of missing) {
        await transport.call({
            operation: `analytics-admin.${kind}.create`,
            method: 'POST',
            url: `${API}/${property}/${kind}`,
            body,
            role: ROLE,
        });
    }
    return { created: missing.length, skipped: wanted.length - missing.length };
}
