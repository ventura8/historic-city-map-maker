import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { billingEnabled, type BillingState } from './google-billing.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import type { UpstreamRequest } from './fetch.js';
import { bodyField, jsonResponse, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Service Usage v1 (the Provision cloud step's `apis` item): which APIs a project has enabled, `batchEnable` and
 * `enable` (done at once; the operation reads back as done), and the billing precondition: enabling a billed API on a
 * project without billing answers 400 `UREQ_PROJECT_BILLING_NOT_FOUND`, as Google does on Spark.
 *
 * M6 (finding 4 of `docs/research/manual-test-2026-10-25.md`): an API Google reports on still answers 403
 * `SERVICE_DISABLED` for a few minutes. The scenarios `propagation` (IAM refuses its next 3 calls once it is enabled:
 * the transport's waits of 10, 20 and 40 s see it through) and `propagationSlow` (6 calls: past the last wait) play it;
 * `identityRefused` makes `generateServiceIdentity` for Eventarc answer 403 (S-A04-BAD-IDENTITY-REFUSED).
 */

/** What a new Firebase project (Spark) has enabled. */
export const SPARK_SERVICES: readonly string[] = [
    'cloudresourcemanager.googleapis.com',
    'firebase.googleapis.com',
    'firebasehosting.googleapis.com',
    'firebaserules.googleapis.com',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'serviceusage.googleapis.com',
];

/** APIs Google enables only on a project with billing (the ones the provisioner needs; the list is not exhaustive). */
export const BILLED_SERVICES: readonly string[] = [
    'artifactregistry.googleapis.com',
    'cloudbuild.googleapis.com',
    'cloudfunctions.googleapis.com',
    'cloudscheduler.googleapis.com',
    'cloudtasks.googleapis.com',
    'eventarc.googleapis.com',
    'run.googleapis.com',
    'secretmanager.googleapis.com',
];

export interface ServiceUsageState {
    /** Project id → enabled API names. A project not listed has `SPARK_SERVICES`. */
    readonly enabled: Map<string, Set<string>>;
    /** M6: API → the `SERVICE_DISABLED` answers its calls get once it is next enabled (the propagation scenarios). */
    readonly slowToSwitchOn: Map<string, number>;
    /** M6: API → the `SERVICE_DISABLED` answers still to come (every project; the API's host names it). */
    readonly propagating: Map<string, number>;
    /** M6: the services whose `generateServiceIdentity` answers 403. */
    readonly identityRefused: Set<string>;
}

/** A fresh Service Usage world: nothing enabled beyond Spark's, nothing propagating. */
export function defaultServiceUsageState(): ServiceUsageState {
    return { enabled: new Map(), slowToSwitchOn: new Map(), propagating: new Map(), identityRefused: new Set() };
}

/**
 * M6: the `SERVICE_DISABLED` answer a call to an API still switching on gets (its host names the API), counting one
 * refusal down; undefined once the API answers (or when it never was slow). `createUpstreamFakes` asks it first.
 */
export function propagationAnswer(state: ServiceUsageState, request: UpstreamRequest): Response | undefined {
    const service = request.url.hostname;
    const left = state.propagating.get(service) ?? 0;
    if (left <= 0) {
        return undefined;
    }
    state.propagating.set(service, left - 1);
    return googleError('google/error.service-disabled', { service, title: service, permission: '' });
}

/** Whether `service` is enabled in the project (a project never seen has `SPARK_SERVICES`). */
export function serviceEnabled(state: ServiceUsageState, projectId: string, service: string): boolean {
    return (state.enabled.get(projectId) ?? new Set(SPARK_SERVICES)).has(service);
}

/** A slow API's refusals start once it is enabled. */
function armPropagation(state: ServiceUsageState, services: readonly string[]): void {
    services.forEach((service) => {
        const count = state.slowToSwitchOn.get(service);
        if (count !== undefined) {
            state.slowToSwitchOn.delete(service);
            state.propagating.set(service, count);
        }
    });
}

/** Enables `service` in the project, as a deploy or an earlier step would. */
export function enableService(state: ServiceUsageState, projectId: string, service: string): void {
    const enabled = state.enabled.get(projectId) ?? new Set(SPARK_SERVICES);
    enabled.add(service);
    state.enabled.set(projectId, enabled);
}

/** How many calls the propagation scenarios refuse (the transport waits 10, 20, 40, 60 and 60 s: five retries). */
const PROPAGATION_REFUSALS = 3;
const SLOW_PROPAGATION_REFUSALS = 6;

const SERVICE_USAGE: GoogleApi = {
    service: 'serviceusage.googleapis.com',
    title: 'Service Usage API',
    permission: 'serviceusage.services.enable',
};

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** v1beta1 `generateServiceIdentity`: the service agent's address, done at once (M6: or a refusal, by scenario). */
function identityRoute(state: ServiceUsageState, projects: GoogleProjects, nextOperation: () => string): Route {
    return route(
        'POST',
        'https://serviceusage.googleapis.com/v1beta1/projects/{project}/services/{service}:generateServiceIdentity',
        'service-usage.generateServiceIdentity',
        authenticated(SERVICE_USAGE, (_request, params) => {
            const project = projects.resolve(String(params['project']));
            const service = String(params['service']);
            if (state.identityRefused.has(service)) {
                return googleError('google/error.permission-denied', { ...SERVICE_USAGE, permission: 'serviceusage.services.use' });
            }
            return fixtureResponse('service-usage/generate-service-identity.operation', {
                values: {
                    projectNumber: project.number,
                    serviceAgent: service.replace(/\.googleapis\.com$/, ''),
                    operationId: nextOperation(),
                },
            });
        }),
    );
}

/** The named state changes of the Service Usage fake. */
function serviceUsageScenarios(state: ServiceUsageState, enabledOf: (projectId: string) => Set<string>): ServiceFake['scenarios'] {
    return {
        // The billing APIs, free to enable on Spark, already on (a project whose billing was looked at in the console):
        // step (b) then asks Google for cloud-billing only (S-A27-HAPPY).
        billingApisEnabled: () => {
            const services = enabledOf(String(FIXTURE_VALUES['projectId']));
            services.add('cloudbilling.googleapis.com');
            services.add('billingbudgets.googleapis.com');
        },
        allEnabled: () => {
            enabledOf(String(FIXTURE_VALUES['projectId']));
            state.enabled.forEach((services) => {
                BILLED_SERVICES.forEach((service) => services.add(service));
            });
        },
        // M6 (finding 4): IAM still refuses its next calls once Provision enabled it (S-A04-HAPPY-API-PROPAGATION).
        propagation: () => {
            state.slowToSwitchOn.set('iam.googleapis.com', PROPAGATION_REFUSALS);
        },
        // Past the transport's last wait (S-A04-BAD-API-STILL-DISABLED): the next run gets through.
        propagationSlow: () => {
            state.slowToSwitchOn.set('iam.googleapis.com', SLOW_PROPAGATION_REFUSALS);
        },
        // M6 (finding 12): the owner may not create Eventarc's service agent (S-A04-BAD-IDENTITY-REFUSED).
        identityRefused: () => {
            state.identityRefused.add('eventarc.googleapis.com');
        },
    };
}

/** The fake Service Usage API; `billing` decides the billing precondition. */
export function createServiceUsageFake(state: ServiceUsageState, billing: BillingState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('e2e-enable-');
    const operations = new Map<string, { readonly project: string; readonly services: readonly string[] }>();
    const enabledOf = (projectId: string): Set<string> => {
        const existing = state.enabled.get(projectId);
        if (existing !== undefined) {
            return existing;
        }
        const created = new Set(SPARK_SERVICES);
        state.enabled.set(projectId, created);
        return created;
    };
    const serviceBody = (projectSegment: string, service: string): Readonly<Record<string, unknown>> => {
        const project = projects.resolve(projectSegment);
        const name = enabledOf(project.id).has(service) ? 'service-usage/service.enabled' : 'service-usage/service.disabled';
        return fixtureBody(name, { projectNumber: project.number, service, serviceTitle: service }) as Readonly<Record<string, unknown>>;
    };
    const enable = (projectSegment: string, services: readonly string[]): Response => {
        const project = projects.resolve(projectSegment);
        if (services.length === 0) {
            return googleError('google/error.invalid-argument', SERVICE_USAGE);
        }
        const billed = services.filter((service) => BILLED_SERVICES.includes(service));
        if (billed.length > 0 && !billingEnabled(billing, project.id)) {
            return fixtureResponse('service-usage/enable.billing-required', {
                values: { projectNumber: project.number, service: billed.join(',') },
            });
        }
        services.forEach((service) => enabledOf(project.id).add(service));
        armPropagation(state, services);
        const name = `operations/acat.p2-${project.number}-${nextOperation()}`;
        operations.set(name, { project: project.id, services });
        return jsonResponse({
            name,
            done: true,
            response: { '@type': 'type.googleapis.com/google.api.serviceusage.v1.BatchEnableServicesResponse' },
        });
    };
    const operation: Route['answer'] = (_request, params) => {
        const name = `operations/${String(params['operation'])}`;
        const found = operations.get(name);
        if (found === undefined) {
            return googleError('google/error.not-found', SERVICE_USAGE);
        }
        const body = fixtureBody('service-usage/operation.done', { operationName: name }) as { response: Record<string, unknown> };
        return jsonResponse({
            ...body,
            response: { ...body.response, services: found.services.map((service) => serviceBody(found.project, service)) },
        });
    };
    const base = 'https://serviceusage.googleapis.com/v1/projects/{project}/services';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(SERVICE_USAGE, answer);
    return {
        name: 'service-usage',
        routes: [
            route(
                'POST',
                `${base}:batchEnable`,
                'service-usage.batchEnable',
                auth((request, params) => enable(String(params['project']), stringList(bodyField(request, 'serviceIds')))),
            ),
            route(
                'POST',
                `${base}/{service}:enable`,
                'service-usage.enable',
                auth((_request, params) => enable(String(params['project']), [String(params['service'])])),
            ),
            route(
                'POST',
                `${base}/{service}:disable`,
                'service-usage.disable',
                auth((_request, params) => {
                    enabledOf(projects.resolve(String(params['project'])).id).delete(String(params['service']));
                    return jsonResponse({ name: `operations/acf.p2-${nextOperation()}`, done: true, response: {} });
                }),
            ),
            route(
                'GET',
                `${base}/{service}`,
                'service-usage.get',
                auth((_request, params) => jsonResponse(serviceBody(String(params['project']), String(params['service'])))),
            ),
            route(
                'GET',
                base,
                'service-usage.list',
                auth((_request, params) => {
                    const project = projects.resolve(String(params['project']));
                    return jsonResponse({
                        services: [...enabledOf(project.id)]
                            .sort((left, right) => left.localeCompare(right))
                            .map((service) => serviceBody(project.id, service)),
                    });
                }),
            ),
            route('GET', 'https://serviceusage.googleapis.com/v1/operations/{operation*}', 'service-usage.getOperation', auth(operation)),
            identityRoute(state, projects, nextOperation),
        ],
        failure: (mode) => googleFailure(SERVICE_USAGE, mode),
        scenarios: serviceUsageScenarios(state, enabledOf),
        snapshot: () => ({
            enabled: Object.fromEntries(
                [...state.enabled].map(([project, services]) => [project, [...services].sort((left, right) => left.localeCompare(right))]),
            ),
            propagating: Object.fromEntries(state.propagating),
        }),
    };
}
