import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import type { FirebaseState } from './google-firebase.js';
import { applyMask, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The Google Analytics Admin API's enhanced-measurement settings of the GA4 web stream (CR-M2-37,
 * `docs/research/M2b-interfaces.md` §3.3 g; the `v1alpha` version is **UNVERIFIED**): the stream exists once Google
 * Analytics is linked to the e2e project (Firebase Management's `analyticsLinked`), with history-change page views on.
 *
 * §76f (`v1beta`, as Google documents it; the answers' shapes UNVERIFIED against the live API): the owner's account
 * summaries (the linked property, or none with `analytics-admin.otherAccount`: the property belongs to an account the
 * owner cannot see), the property's web stream with the project's measurement id, and its custom dimensions and metrics,
 * listed and created (a parameter registered twice answers 409 `ALREADY_EXISTS`, as GA4 does).
 */

/** A custom dimension or metric as the fake keeps it. */
type CustomDefinition = Readonly<Record<string, unknown>> & { readonly parameterName: string };

export interface AnalyticsAdminState {
    /** `properties/<id>/dataStreams/<id>` → its settings as last written. */
    readonly settings: Map<string, Readonly<Record<string, unknown>>>;
    /** §76f: `properties/<id>/customDimensions` or `…/customMetrics` → what is registered. */
    readonly definitions: Map<string, CustomDefinition[]>;
    /** §76f: the owner's account sees no property (the scenario `analytics-admin.otherAccount`). */
    otherAccount: boolean;
}

const V1BETA = 'https://analyticsadmin.googleapis.com/v1beta';
const PROPERTY = String(FIXTURE_VALUES['analyticsPropertyId']);

/** The definitions of `kind` on `property`, made on first use. */
function definitionsOf(state: AnalyticsAdminState, property: string, kind: string): CustomDefinition[] {
    const key = `properties/${property}/${kind}`;
    const found = state.definitions.get(key) ?? [];
    state.definitions.set(key, found);
    return found;
}

/** `POST …/{kind}`: a new definition, or 409 for a parameter already registered as either kind. */
function createDefinition(state: AnalyticsAdminState, property: string, kind: string, body: Readonly<Record<string, unknown>>): Response {
    const parameterName = String(body['parameterName']);
    const taken = ['customDimensions', 'customMetrics'].some((other) =>
        definitionsOf(state, property, other).some((item) => item.parameterName === parameterName),
    );
    if (taken) {
        return googleError('google/error.already-exists', ANALYTICS_ADMIN);
    }
    const list = definitionsOf(state, property, kind);
    const created: CustomDefinition = { ...body, parameterName, name: `properties/${property}/${kind}/${String(list.length + 1)}` };
    list.push(created);
    return jsonResponse(created);
}

const ANALYTICS_ADMIN: GoogleApi = {
    service: 'analyticsadmin.googleapis.com',
    title: 'Google Analytics Admin API',
    permission: 'analytics.properties.update',
};

/** The fake Analytics Admin API over the Firebase Management fake's analytics link. */
export function createAnalyticsAdminFake(state: AnalyticsAdminState, firebase: FirebaseState): ServiceFake {
    const linked = (): boolean => firebase.projects.get(String(FIXTURE_VALUES['projectId']))?.measurementId !== undefined;
    const keyOf = (params: RouteParams): string => `properties/${String(params['property'])}/dataStreams/${String(params['stream'])}`;
    const current = (params: RouteParams): Readonly<Record<string, unknown>> =>
        state.settings.get(keyOf(params)) ??
        (fixtureBody('analytics-admin/enhanced-measurement-settings.get', {
            analyticsPropertyId: String(params['property']),
            streamId: String(params['stream']),
        }) as Record<string, unknown>);
    const withStream = (answer: () => Response): Response => (linked() ? answer() : googleError('google/error.not-found', ANALYTICS_ADMIN));
    const patch: Route['answer'] = (request, params) =>
        withStream(() => {
            const updated = applyMask(current(params), requestObject(request), request.url.searchParams.get('updateMask'));
            state.settings.set(keyOf(params), updated);
            return jsonResponse(updated);
        });
    const url = 'https://analyticsadmin.googleapis.com/v1alpha/properties/{property}/dataStreams/{stream}/enhancedMeasurementSettings';
    const measurementId = (): string => String(firebase.projects.get(String(FIXTURE_VALUES['projectId']))?.measurementId);
    const summaries = (): Readonly<Record<string, unknown>> =>
        linked() && !state.otherAccount
            ? {
                  accountSummaries: [
                      {
                          account: 'accounts/300000001',
                          displayName: 'Historic City Map',
                          propertySummaries: [{ property: `properties/${PROPERTY}`, displayName: 'Historic City Map' }],
                      },
                  ],
              }
            : {};
    const streams = (params: RouteParams): Readonly<Record<string, unknown>> => ({
        dataStreams: [
            {
                name: `properties/${String(params['property'])}/dataStreams/500000001`,
                type: 'WEB_DATA_STREAM',
                webStreamData: { measurementId: measurementId() },
            },
        ],
    });
    const definitionRoutes = (kind: 'customDimensions' | 'customMetrics'): Route[] => [
        route(
            'GET',
            `${V1BETA}/properties/{property}/${kind}`,
            `analytics-admin.${kind}.list`,
            authenticated(ANALYTICS_ADMIN, (_request, params) =>
                jsonResponse({ [kind]: definitionsOf(state, String(params['property']), kind) }),
            ),
        ),
        route(
            'POST',
            `${V1BETA}/properties/{property}/${kind}`,
            `analytics-admin.${kind}.create`,
            authenticated(ANALYTICS_ADMIN, (request, params) =>
                createDefinition(state, String(params['property']), kind, requestObject(request)),
            ),
        ),
    ];
    return {
        name: 'analytics-admin',
        routes: [
            route(
                'GET',
                `${V1BETA}/accountSummaries`,
                'analytics-admin.accountSummaries.list',
                authenticated(ANALYTICS_ADMIN, () => jsonResponse(summaries())),
            ),
            route(
                'GET',
                `${V1BETA}/properties/{property}/dataStreams`,
                'analytics-admin.dataStreams.list',
                authenticated(ANALYTICS_ADMIN, (_request, params) => withStream(() => jsonResponse(streams(params)))),
            ),
            ...definitionRoutes('customDimensions'),
            ...definitionRoutes('customMetrics'),
            route(
                'GET',
                url,
                'analytics-admin.enhancedMeasurementSettings.get',
                authenticated(ANALYTICS_ADMIN, (_request, params) => withStream(() => jsonResponse(current(params)))),
            ),
            route('PATCH', url, 'analytics-admin.enhancedMeasurementSettings.patch', authenticated(ANALYTICS_ADMIN, patch)),
        ],
        failure: (mode) => googleFailure(ANALYTICS_ADMIN, mode),
        scenarios: {
            otherAccount: () => {
                state.otherAccount = true;
            },
        },
        snapshot: () => ({ settings: Object.fromEntries(state.settings), definitions: Object.fromEntries(state.definitions) }),
    };
}
