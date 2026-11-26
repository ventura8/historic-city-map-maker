import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { createFakeFetch, type FakeAnswer, type FakeFetch, type UpstreamRequest } from './fetch.js';
import { createAnalyticsAdminFake, type AnalyticsAdminState } from './google-analytics-admin.js';
import { createAnalyticsDataFake, defaultAnalyticsDataState, type AnalyticsDataState } from './google-analytics-data.js';
import { createApiKeysFake, type ApiKeysState } from './google-api-keys.js';
import { createArtifactRegistryFake, defaultArtifactRegistryState, type ArtifactRegistryState } from './google-artifact-registry.js';
import { createAppCheckFake, createRecaptchaFake, type AppCheckState } from './google-app-check.js';
import { createBillingBudgetsFake, createCloudBillingFake, defaultBillingState, type BillingState } from './google-billing.js';
import { GoogleProjects } from './google-common.js';
import { createFcmFake, defaultFcmState, type FcmState } from './fcm.js';
import { createErrorReportingFake, type ErrorReportingState } from './google-errors.js';
import { createFirebaseStorageFake } from './google-firebase-storage.js';
import { createFirebaseManagementFake, type FirebaseState } from './google-firebase.js';
import { createStartWorldFake, defaultStartWorldState, type StartWorldState } from './google-hosting.js';
import { createCloudBuildFake, defaultCloudBuildState, type CloudBuildState } from './google-cloudbuild.js';
import { createCloudFunctionsFake, createCloudSchedulerFake, type DeploymentState } from './google-functions.js';
import { createIamFake, type IamState } from './google-iam.js';
import {
    createGoogleOauthFake,
    createResourceManagerFake,
    defaultIdentityState,
    type IdentityState,
    type ResourceManagerState,
} from './google-identity.js';
import { createMonitoringFake, type MonitoringState } from './google-monitoring.js';
import { createOrgPolicyFake, type OrgPolicyState } from './google-org-policy.js';
import { createLoggingFake } from './google-logging.js';
import { PolicyStore } from './google-policies.js';
import { createPubSubFake, type PubSubState } from './google-pubsub.js';
import { createCloudRunFake, type CloudRunState } from './google-run.js';
import { createSecretManagerFake, latestSecretValue, type SecretsState } from './google-secrets.js';
import { createServiceUsageFake, defaultServiceUsageState, propagationAnswer, type ServiceUsageState } from './google-services.js';
import { createCloudStorageFake, type CloudStorageState } from './google-storage.js';
import { createCloudTasksFake, type CloudTasksState } from './google-tasks.js';
import { defaultMapboxState, type MapboxState } from './mapbox-state.js';
import { createMapboxFake } from './mapbox.js';
import { createNominatimFake } from './nominatim.js';
import { createGoogleApisFake } from './google-apis.js';
import { createOverpassFake, type OverpassState } from './overpass.js';
import { matchRoute } from './routes.js';
import { FAILURE_MODES, type FailureMode, type ServiceFake, type UpstreamServiceName } from './service.js';
import { createStacFake, defaultStacState, type StacState } from './stac.js';
import { createUsgsBrowseFake } from './usgs-browse.js';
import { createUsgsFake, defaultUsgsState, type UsgsState } from './usgs.js';
import { createVertexAiFake, defaultVertexAiState, type VertexAiState } from './vertex-ai.js';

/**
 * Every fake upstream in one place (docs/research/M2-interfaces.md §7, M2b-interfaces.md §6.1): Google Cloud (OAuth
 * tokeninfo, Resource Manager, IAM, Cloud Billing, Billing Budgets, Service Usage, Firebase Management, Secret Manager,
 * Cloud Run Admin, Cloud Tasks, the Cloud Storage bucket API, Error Reporting, and for the admin's provisioner Cloud
 * Functions, Cloud Scheduler, Pub/Sub, Org Policy, Firebase Storage, reCAPTCHA Enterprise, App Check, Monitoring, API
 * Keys and Analytics Admin), Mapbox, USGS M2M and Nominatim, and for the M3 pipeline USGS's browse images, a STAC
 * catalogue of Sentinel-2 with its COGs and the Overpass API (docs/research/M3-interfaces.md §13), answering from the shared fixtures
 * with state a test can read and change. One instance is one world: a fresh Firebase project on Spark (one open
 * billing account, not linked; one web app; nothing provisioned), the Mapbox accounts of `MAPBOX_TOKENS`, the USGS
 * users of `USGS_CREDENTIALS`. Tests change it through `scenario(name)`, `fail(service, mode)` or `state` directly.
 */

export interface UpstreamState {
    readonly identity: IdentityState;
    readonly resourceManager: ResourceManagerState;
    readonly iam: IamState;
    readonly billing: BillingState;
    readonly serviceUsage: ServiceUsageState;
    readonly firebase: FirebaseState;
    /** M14: the start page's world (`google-hosting.ts`). */
    readonly startWorld: StartWorldState;
    readonly secrets: SecretsState;
    readonly cloudRun: CloudRunState;
    readonly cloudTasks: CloudTasksState;
    readonly cloudStorage: CloudStorageState;
    readonly errorReporting: ErrorReportingState;
    /** The server's deployment (Cloud Functions list, Cloud Scheduler; M2b step d). */
    readonly deployment: DeploymentState;
    readonly pubsub: PubSubState;
    readonly orgPolicy: OrgPolicyState;
    readonly appCheck: AppCheckState;
    readonly monitoring: MonitoringState;
    readonly apiKeys: ApiKeysState;
    readonly analyticsAdmin: AnalyticsAdminState;
    readonly analyticsData: AnalyticsDataState;
    readonly mapbox: MapboxState;
    readonly usgs: UsgsState;
    readonly stac: StacState;
    readonly overpass: OverpassState;
    /** M4: Vertex AI Gemini's scripted drafts and FCM's pushed messages (`docs/research/M4-interfaces.md` §8). */
    readonly vertexAi: VertexAiState;
    readonly fcm: FcmState;
    /** M6: the pipeline's Docker repository and its policy (`docs/research/M6-interfaces.md` §1.6). */
    readonly artifactRegistry: ArtifactRegistryState;
    /** M6 installer: the install builds, their outcomes and the public site they published (`docs/research/M6-interfaces.md` §1.10). */
    readonly cloudBuild: CloudBuildState;
}

export interface UpstreamFakes extends FakeFetch {
    readonly state: UpstreamState;
    /** Every call of `service` answers `mode` until `fail(service, null)`. */
    fail(service: UpstreamServiceName, mode: FailureMode | null): void;
    /** Applies a named scenario (`usgs.m2mApproved`, `google.provisioned`); throws for an unknown name. */
    scenario(name: string): void;
    /** Every scenario name, sorted. */
    readonly scenarioNames: readonly string[];
    /** The state of every service as plain JSON (`/__upstream/snapshot`). */
    snapshot(): Readonly<Record<string, unknown>>;
    /** The latest value of a Secret Manager secret of `projectId` (default `demo-hcm`). */
    secretValue(secretId: string, projectId?: string): string | undefined;
}

/** Scenarios that span services: each runs the listed service scenarios in order. */
const PRESETS: Readonly<Record<string, readonly string[]>> = {
    /** The server deployed: every registry function `ACTIVE` and the `ops.tick` job scheduled (M2b step d). */
    'google.deployed': ['cloud-functions.deployed'],
    /** Everything the Provision cloud step creates, on Blaze. */
    'google.provisioned': [
        'cloud-billing.enabled',
        'service-usage.allEnabled',
        'secret-manager.provisioned',
        'cloud-storage.bucketsProvisioned',
        'cloud-tasks.queueProvisioned',
        'cloud-run.jobProvisioned',
    ],
    /**
     * The M3 imagery world on the server's side (docs/research/M3-interfaces.md §13): the secrets the harvest, the import
     * and the publisher read (the approved USGS account, the Mapbox tiles token) and both raster pipeline jobs.
     */
    'imagery.ready': ['secret-manager.provisioned', 'secret-manager.imagerySecrets', 'cloud-run.pipelineJobsProvisioned'],
    /** M6 installer: what Prepare the project made for the in-app installer (its account and the pipeline's repository). */
    'install.provisioned': ['artifact-registry.provisioned', 'cloud-build.installerAccount'],
};

function initialState(): UpstreamState {
    return {
        identity: defaultIdentityState(),
        resourceManager: { policies: new Map(), allowedMemberDomains: undefined, parent: undefined },
        iam: { projects: new Map() },
        billing: defaultBillingState(),
        serviceUsage: defaultServiceUsageState(),
        firebase: { projects: new Map(), fresh: false, added: new Set(), signInOn: false },
        startWorld: defaultStartWorldState(),
        secrets: { projects: new Map(), policies: new PolicyStore() },
        cloudRun: { jobs: new Set(), executions: new Map() },
        cloudTasks: { queues: new Map() },
        cloudStorage: { buckets: new Map(), publicAccessPrevented: false, legacyRolesRefused: false },
        errorReporting: { groups: new Map() },
        deployment: { deployment: 'none', schedulerJob: false },
        pubsub: { topics: new Set(), policies: new PolicyStore() },
        orgPolicy: { noDefaultGrants: false },
        appCheck: { keys: new Map(), configs: new Map() },
        monitoring: { channels: new Map(), policies: new Map() },
        apiKeys: { projects: new Map() },
        analyticsAdmin: { settings: new Map(), definitions: new Map(), otherAccount: false },
        analyticsData: defaultAnalyticsDataState(),
        mapbox: defaultMapboxState(),
        usgs: defaultUsgsState(),
        stac: defaultStacState(),
        overpass: { answer: undefined },
        vertexAi: defaultVertexAiState(),
        fcm: defaultFcmState(),
        artifactRegistry: defaultArtifactRegistryState(),
        cloudBuild: defaultCloudBuildState(),
    };
}

function services(state: UpstreamState): readonly ServiceFake[] {
    const projects = new GoogleProjects();
    return [
        createGoogleOauthFake(state.identity),
        createStartWorldFake(state.startWorld, state.firebase, projects),
        createResourceManagerFake(state.identity, state.resourceManager, projects, state.startWorld),
        createIamFake(state.iam, projects),
        createCloudBillingFake(state.billing, projects),
        createBillingBudgetsFake(state.billing),
        createServiceUsageFake(state.serviceUsage, state.billing, projects),
        createFirebaseManagementFake(state.firebase, projects),
        createSecretManagerFake(state.secrets, projects),
        createCloudRunFake(state.cloudRun, projects),
        createCloudTasksFake(state.cloudTasks, projects),
        createCloudStorageFake(state.cloudStorage, projects),
        createErrorReportingFake(state.errorReporting, projects),
        createCloudFunctionsFake(state.deployment, state.serviceUsage, projects),
        createCloudSchedulerFake(state.deployment, projects),
        createPubSubFake(state.pubsub, projects),
        createOrgPolicyFake(state.orgPolicy, state.resourceManager, state.cloudStorage, projects),
        createFirebaseStorageFake(state.cloudStorage, state.billing, projects),
        createRecaptchaFake(state.appCheck, projects),
        createAppCheckFake(state.appCheck, projects),
        createMonitoringFake(state.monitoring, projects),
        createApiKeysFake(state.apiKeys, projects),
        createAnalyticsAdminFake(state.analyticsAdmin, state.firebase),
        createAnalyticsDataFake(state.analyticsData, state.analyticsAdmin),
        createMapboxFake(state.mapbox),
        createUsgsFake(state.usgs),
        createUsgsBrowseFake(),
        createStacFake(state.stac),
        createOverpassFake(state.overpass),
        createNominatimFake(),
        createGoogleApisFake(),
        createVertexAiFake(state.vertexAi),
        createFcmFake(state.fcm),
        createArtifactRegistryFake(state.artifactRegistry, projects),
        createCloudBuildFake(
            state.cloudBuild,
            { deployment: state.deployment, serviceUsage: state.serviceUsage, cloudRun: state.cloudRun, iam: state.iam },
            projects,
        ),
        createLoggingFake(state.cloudBuild),
    ];
}

function scenarioTable(fakes: readonly ServiceFake[]): Map<string, () => void> {
    const table = new Map<string, () => void>();
    for (const fake of fakes) {
        for (const [name, apply] of Object.entries(fake.scenarios)) {
            table.set(`${fake.name}.${name}`, apply);
        }
    }
    for (const [name, steps] of Object.entries(PRESETS)) {
        table.set(name, () => {
            steps.forEach((step) => table.get(step)?.());
        });
    }
    return table;
}

/** Throws unless `service` exists and has failure `mode` (`null` clears, always allowed for a known service). */
function checkFailure(fakes: readonly ServiceFake[], service: UpstreamServiceName, mode: FailureMode | null): void {
    const fake = fakes.find((candidate) => candidate.name === service);
    if (fake === undefined) {
        throw new Error(`unknown upstream service ${service}`);
    }
    if (mode !== null && (!FAILURE_MODES.includes(mode) || fake.failure(mode) === undefined)) {
        throw new Error(`${service} has no failure mode ${mode}`);
    }
}

/**
 * The hosts only servers call (the Functions emulator, the raster pipeline): USGS (M2M has no CORS; browse images are
 * copied server-side; deliveries are signed), the STAC catalogue, its COG bucket and Overpass; since M4 Nominatim (one
 * request a second through the server's queue), Vertex AI (server-side only, security review §0.9) and FCM's send API.
 * The e2e admin pages may never reach them (docs/research/M3-interfaces.md §3.4, §13, M4-interfaces.md §8): their
 * firewall blocks them although a fake answers them.
 */
export const SERVER_ONLY_HOSTS: readonly string[] = [
    'm2m.cr.usgs.gov',
    'dds.cr.usgs.gov',
    'ims.cr.usgs.gov',
    'landsatlook.usgs.gov',
    'earth-search.aws.element84.com',
    'sentinel-cogs.s3.us-west-2.amazonaws.com',
    'overpass-api.de',
    'nominatim.openstreetmap.org',
    'us-central1-aiplatform.googleapis.com',
    'fcm.googleapis.com',
];

/** Every host a fake answers (the e2e admin tier forwards these to the mock APIs, but `SERVER_ONLY_HOSTS`). */
export function upstreamHosts(): readonly string[] {
    return [...new Set(services(initialState()).flatMap((fake) => fake.routes.map((candidate) => candidate.host)))].sort((left, right) =>
        left.localeCompare(right),
    );
}

/** A fresh world of fake upstreams with its recording `fetch`. */
export function createUpstreamFakes(): UpstreamFakes {
    const state = initialState();
    const fakes = services(state);
    const failures = new Map<UpstreamServiceName, FailureMode>();
    const scenarios = scenarioTable(fakes);
    // A failure mode on, else (M6, finding 4) an API Google is still switching on (the propagation scenarios), refuses first.
    const refusal = (fake: ServiceFake, request: UpstreamRequest): Response | undefined => {
        const mode = failures.get(fake.name);
        return (mode === undefined ? undefined : fake.failure(mode)) ?? propagationAnswer(state.serviceUsage, request);
    };
    const handle = async (request: UpstreamRequest): Promise<FakeAnswer | undefined> => {
        for (const fake of fakes) {
            const found = matchRoute(fake.routes, request);
            if (found !== undefined) {
                return {
                    operation: found.route.operation,
                    response: refusal(fake, request) ?? (await found.route.answer(request, found.params)),
                };
            }
        }
        return undefined;
    };
    const fetchFake = createFakeFetch(handle);
    return {
        ...fetchFake,
        state,
        fail: (service, mode) => {
            checkFailure(fakes, service, mode);
            if (mode === null) {
                failures.delete(service);
            } else {
                failures.set(service, mode);
            }
        },
        scenario: (name) => {
            const apply = scenarios.get(name);
            if (apply === undefined) {
                throw new Error(`unknown upstream scenario ${name}`);
            }
            apply();
        },
        scenarioNames: [...scenarios.keys()].sort((left, right) => left.localeCompare(right)),
        snapshot: () => Object.fromEntries(fakes.map((fake) => [fake.name, fake.snapshot()])),
        secretValue: (secretId, projectId = String(FIXTURE_VALUES['projectId'])) => latestSecretValue(state.secrets, projectId, secretId),
    };
}
