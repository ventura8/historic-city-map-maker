import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { applyMask, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Monitoring v3 notification channels and alert policies, for the `crash-alerts` doctor item and the crash e-mail
 * switch (`docs/research/M2b-interfaces.md` §3.3 g, §3.4 item 12). A fresh project has neither; `crashAlertsProvisioned`
 * adds the crash alert policy the doctor creates, enabled (the switch's own specs start from it).
 */

/** The display name the doctor gives the crash alert policy (packages/admin/src/provision/items-extra.ts). */
const CRASH_POLICY_NAME = 'historic-city-map new crash reports';

export interface MonitoringState {
    /** Project id → its notification channels (the API's shape). */
    readonly channels: Map<string, Readonly<Record<string, unknown>>[]>;
    /** Project id → its alert policies. */
    readonly policies: Map<string, Readonly<Record<string, unknown>>[]>;
}

const MONITORING: GoogleApi = {
    service: 'monitoring.googleapis.com',
    title: 'Cloud Monitoring API',
    permission: 'monitoring.alertPolicies.create',
};

type Collection = Map<string, Readonly<Record<string, unknown>>[]>;

/** The fake Monitoring API. */
export function createMonitoringFake(state: MonitoringState, projects: GoogleProjects): ServiceFake {
    const nextChannel = sequence('1000000000000000', 4);
    const nextPolicy = sequence('2000000000000000', 4);
    const listOf = (collection: Collection, params: RouteParams): Readonly<Record<string, unknown>>[] => {
        const id = projects.resolve(String(params['project'])).id;
        const items = collection.get(id) ?? [];
        collection.set(id, items);
        return items;
    };
    const createChannel: Route['answer'] = (request, params) => {
        const projectId = projects.resolve(String(params['project'])).id;
        const channel = {
            ...(fixtureBody('monitoring/notification-channel.get', { projectId, channelId: nextChannel() }) as Record<string, unknown>),
            ...requestObject(request),
        };
        listOf(state.channels, params).push(channel);
        return jsonResponse(channel);
    };
    const createPolicy: Route['answer'] = (request, params) => {
        const projectId = projects.resolve(String(params['project'])).id;
        const policy = {
            ...(fixtureBody('monitoring/alert-policy.get', { projectId, alertPolicyId: nextPolicy() }) as Record<string, unknown>),
            ...requestObject(request),
        };
        listOf(state.policies, params).push(policy);
        return jsonResponse(policy);
    };
    const patchPolicy: Route['answer'] = (request, params) => {
        const policies = listOf(state.policies, params);
        const index = policies.findIndex((policy) => String(policy['name']).endsWith(`/alertPolicies/${String(params['policy'])}`));
        const policy = policies[index];
        if (policy === undefined) {
            return googleError('google/error.not-found', MONITORING);
        }
        policies[index] = applyMask(policy, requestObject(request), request.url.searchParams.get('updateMask'));
        return jsonResponse(policies[index]);
    };
    const base = 'https://monitoring.googleapis.com/v3/projects/{project}';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(MONITORING, answer);
    return {
        name: 'monitoring',
        routes: [
            route(
                'GET',
                `${base}/notificationChannels`,
                'monitoring.notificationChannels.list',
                auth((_request, params) => jsonResponse({ notificationChannels: listOf(state.channels, params) })),
            ),
            route('POST', `${base}/notificationChannels`, 'monitoring.notificationChannels.create', auth(createChannel)),
            route(
                'GET',
                `${base}/alertPolicies`,
                'monitoring.alertPolicies.list',
                auth((_request, params) => jsonResponse({ alertPolicies: listOf(state.policies, params) })),
            ),
            route('POST', `${base}/alertPolicies`, 'monitoring.alertPolicies.create', auth(createPolicy)),
            route('PATCH', `${base}/alertPolicies/{policy}`, 'monitoring.alertPolicies.patch', auth(patchPolicy)),
        ],
        failure: (mode) => googleFailure(MONITORING, mode),
        scenarios: {
            crashAlertsProvisioned: () => {
                const projectId = String(FIXTURE_VALUES['projectId']);
                const policies = state.policies.get(projectId) ?? [];
                const policy = fixtureBody('monitoring/alert-policy.get', {
                    projectId,
                    alertPolicyId: nextPolicy(),
                    displayName: CRASH_POLICY_NAME,
                });
                state.policies.set(projectId, [
                    ...policies.filter((existing) => existing['displayName'] !== CRASH_POLICY_NAME),
                    policy as Record<string, unknown>,
                ]);
            },
        },
        snapshot: () => ({ channels: Object.fromEntries(state.channels), policies: Object.fromEntries(state.policies) }),
    };
}
