import { INSTALLER_ACCOUNT, PIPELINE_REPOSITORY, VERTEX_DRAFTS_PERMISSIONS, VERTEX_DRAFTS_ROLE_ID } from '@hcm/shared';

import { customRoleName, type CustomRoleSpec } from '../google/iam.js';
import type { WantedBinding } from '../google/iam-policy.js';
import { projectNames, type ProjectConfig, type ServiceAccountId } from './project-config.js';

/**
 * What the provisioner creates and binds (`docs/research/M2b-interfaces.md` §3.4, §3.4.1; security review §1.1, M2
 * §4.3, `DECISIONS-for-review.md` §19b, CR-M2-5): the APIs, the secret shells, and the role table, with the M3 rows of
 * `docs/research/M3-interfaces.md` §9.4 (CR-M3-6): the event functions run the raster job's executions, and the raster
 * job reads the USGS secrets only (publishing, and so the Mapbox secret, stays in the functions).
 */

/** The APIs the `apis` item enables (`<name>.googleapis.com`). */
export const REQUIRED_APIS: readonly string[] = [
    'cloudresourcemanager',
    'serviceusage',
    'cloudbilling',
    'billingbudgets',
    'iam',
    'iamcredentials',
    'sts',
    'cloudfunctions',
    'run',
    'cloudbuild',
    'artifactregistry',
    'eventarc',
    'pubsub',
    'cloudscheduler',
    'cloudtasks',
    'secretmanager',
    'storage',
    'firebasestorage',
    'firebaseappcheck',
    'recaptchaenterprise',
    'firebaseinstallations',
    'monitoring',
    'logging',
    'clouderrorreporting',
    'orgpolicy',
    'apikeys',
    'analyticsadmin',
    // §203: the Statistics view reads GA4's numbers with the owner's read-only token (set version 4: Update the map turns it on).
    'analyticsdata',
    // M4 (docs/research/M4-interfaces.md §4.4, CR-M4-5): Vertex AI for the translation drafts, FCM's sends and the browser's
    // token registration for web push.
    'aiplatform',
    'fcm',
    'fcmregistrations',
    // M6 (docs/research/M6-interfaces.md §1.6, CR-M6-2): the in-app installer's firebase-tools checks these are on; a new
    // Firebase project has them, a self-hosted one may not (UNVERIFIED).
    'firebasehosting',
    'firebaserules',
    'firestore',
].map((name) => `${name}.googleapis.com`);

/** The Secret Manager shells; the values arrive through `setup.saveUsgs` and `setup.saveMapbox`. */
export const SECRET_IDS = ['usgs-username', 'usgs-app-token', 'mapbox-sk-bootstrap', 'mapbox-sk-tiles'] as const;

type SecretId = (typeof SECRET_IDS)[number];

/** The secrets the event functions read (the dispatcher, the publisher, the tick, the upload trigger). */
const EVENTS_SECRETS: readonly SecretId[] = ['usgs-username', 'usgs-app-token', 'mapbox-sk-tiles'];

/** The secrets the raster job reads: USGS only, never a Mapbox secret (M3 §9.4). */
const RASTER_SECRETS: readonly SecretId[] = ['usgs-username', 'usgs-app-token'];

/** One IAM policy and the bindings it must hold. */
export interface PolicyBindings {
    readonly kind: 'project' | 'bucket' | 'secret' | 'serviceAccount' | 'repository';
    /** The project id, a bucket name, a secret id, a service account's e-mail address or an Artifact Registry repository. */
    readonly resource: string;
    readonly bindings: readonly WantedBinding[];
}

/** The Google service agents the role table binds, from `generateServiceIdentity` and Cloud Storage's own read. */
export interface ServiceAgents {
    /** `service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com` */
    readonly firebaseStorage: string;
    /** `service-<number>@gs-project-accounts.iam.gserviceaccount.com` */
    readonly cloudStorage: string;
    /**
     * M6 (finding 12, `docs/research/M6-interfaces.md` §1.6): `service-<number>@gcp-sa-pubsub.iam.gserviceaccount.com`,
     * generated before the first install with Eventarc's (whose roles Google grants it when it is made), so neither is
     * still propagating when the event triggers deploy.
     */
    readonly pubsub: string;
    /**
     * The Compute Engine default account (`<number>-compute@developer.gserviceaccount.com`) when the project has one (a
     * GET; 404: undefined): a first functions deploy wants it to invoke and receive events (firebase-tools'
     * `ensureServiceAgentRoles`), and the installer may read the project's policy but never write it. It is also the
     * functions' build account (finding 33, {@link buildAccountBindings}). Undefined: nothing is bound to it.
     */
    readonly computeDefault: string | undefined;
    /**
     * Finding 28 of `docs/research/manual-test-2026-10-25.md (live test 2026-10-31)`: the App Engine default account
     * (`<project>@appspot.gserviceaccount.com`) when the project has one. firebase-tools checks, before any functions
     * deploy, that the deploying account may act as it (`checkServiceAccountIam`), so the installer gets Service Account
     * User on that one account, never project-wide (`DECISIONS-for-review.md` §75). Undefined: nothing to grant.
     */
    readonly appEngineDefault: string | undefined;
}

function grants(member: string, roles: readonly string[]): WantedBinding[] {
    return roles.map((role) => ({ role, member }));
}

/**
 * M4 (`docs/research/M4-interfaces.md` §4.4, CR-M4-5): `assist.translateDraft` and the setup self-test call Vertex AI;
 * `notify.registerDevice` and `notify.sendTest` send through FCM. UNVERIFIED (§10): that `firebasecloudmessaging.admin` is
 * the narrowest role holding `cloudmessaging.messages.create`.
 */

/**
 * The project's custom roles, made by the `iam` item before the role table binds them (`DECISIONS-for-review.md` §57g):
 * Vertex AI's predefined `roles/aiplatform.user` would also let the functions' account start billable custom jobs and
 * deploy endpoints; the drafts and the self-test only call `generateContent` and `countTokens` of a publisher model.
 */
export interface CustomRoleEntry {
    readonly id: string;
    readonly spec: CustomRoleSpec;
}

/**
 * M6 (`docs/research/M6-interfaces.md` §1.2, CR-M6-2): what the in-app installer needs beyond its predefined roles.
 * `roles/run.admin` would let it replace any Cloud Run service's code, `roles/resourcemanager.projectIamAdmin` grant
 * anything, `roles/artifactregistry.repoAdmin` on the project delete repositories (DECISIONS-for-review.md §67).
 */
const INSTALLER_ROLE_ID = 'hcmInstaller';
const INSTALLER_PERMISSIONS: readonly string[] = [
    // Finding 28: firebase-tools' `checkHttpIam` refuses a deploy that creates an HTTPS function without this permission
    // on the project (roles/cloudfunctions.developer lacks it; gen 2's invoker itself goes through run.services.setIamPolicy).
    'cloudfunctions.functions.setIamPolicy',
    // Finding 28: before every functions deploy firebase-tools reads the region of each event trigger's source
    // (`ensureTriggerRegions`): the Firestore database's metadata and each Storage trigger's bucket; a refused read stops
    // the deploy ("Can't find the storage bucket region"). Read-only metadata, the narrowest permissions holding them.
    'datastore.databases.getMetadata',
    'storage.buckets.get',
    'run.services.get',
    'run.services.getIamPolicy',
    'run.services.setIamPolicy',
    'run.jobs.create',
    'run.jobs.get',
    'run.jobs.update',
    'run.operations.get',
    'resourcemanager.projects.getIamPolicy',
    'artifactregistry.repositories.get',
    'artifactregistry.repositories.update',
];

export const CUSTOM_ROLES: readonly CustomRoleEntry[] = [
    {
        id: VERTEX_DRAFTS_ROLE_ID,
        spec: {
            title: 'Historic City Map Maker: Vertex AI drafts',
            description: 'generateContent and countTokens of the pinned Gemini model, for the RO-EN translation drafts',
            includedPermissions: VERTEX_DRAFTS_PERMISSIONS,
        },
    },
    {
        id: INSTALLER_ROLE_ID,
        spec: {
            title: 'Historic City Map Maker: in-app installer',
            description:
                'Cloud Run invokers and jobs, the project policy read, the pipeline repository: what hcm-installer needs beyond its roles',
            includedPermissions: INSTALLER_PERMISSIONS,
        },
    },
];
/**
 * M6 (finding 17 of `docs/research/manual-test-2026-10-25.md`): Eventarc delivers the Firestore, Storage and Pub/Sub
 * events with the function's own account, Cloud Scheduler calls `ops.tick` and `imagery.tick` with an OIDC token of
 * theirs and a task queue's tasks carry the enqueuer's: each needs `run.routes.invoke`. Project-wide, as granted by hand
 * on 2026-10-25 (both accounts only ever call this project's functions; per service is §67b).
 */
const INVOKER_ROLE = 'roles/run.invoker';
const FCM_SENDER_ROLE = 'roles/firebasecloudmessaging.admin';
/**
 * Finding 74 of 2026-11-03 (set version 3): the worker's callables (`worker.image`, `worker.hello`, `worker.claim`,
 * `worker.pairCode`) read which image the job `raster-pipeline` runs (`run.jobs.get`), read-only.
 */
const FN_ADMIN_PROJECT_ROLES = [
    'roles/datastore.user',
    'roles/firebaseauth.admin',
    'roles/firebase.viewer',
    'roles/errorreporting.viewer',
    'roles/cloudtasks.enqueuer',
    'roles/run.viewer',
    FCM_SENDER_ROLE,
    INVOKER_ROLE,
];
/**
 * M3: the dispatcher starts and follows the raster job's executions (`run.jobs.runWithOverrides`, `run.executions.get`).
 * M4: `notify.onEvent` pushes the notifications through FCM.
 */
const FN_EVENTS_PROJECT_ROLES = [
    'roles/datastore.user',
    'roles/eventarc.eventReceiver',
    'roles/cloudtasks.enqueuer',
    'roles/run.jobsExecutorWithOverrides',
    'roles/run.viewer',
    FCM_SENDER_ROLE,
    INVOKER_ROLE,
];
const DEPLOYER_PROJECT_ROLES = [
    'roles/firebasehosting.admin',
    'roles/firebaserules.admin',
    'roles/datastore.indexAdmin',
    'roles/cloudfunctions.developer',
    'roles/cloudscheduler.admin',
    'roles/cloudtasks.queueAdmin',
    'roles/serviceusage.serviceUsageConsumer',
    'roles/firebase.viewer',
];
/**
 * M6 (`docs/research/M6-interfaces.md` §1.2): the in-app installer's builds (`hcm-installer@`), project-wide; the custom
 * role `hcmInstaller`, the repository's writer role and the accounts it deploys as are bound apart.
 */
const INSTALLER_PROJECT_ROLES = [
    'roles/cloudfunctions.developer',
    'roles/firebaserules.admin',
    'roles/datastore.indexAdmin',
    'roles/cloudscheduler.admin',
    'roles/cloudtasks.queueAdmin',
    'roles/serviceusage.serviceUsageConsumer',
    'roles/firebase.viewer',
    'roles/firebasehosting.admin',
    // A build that runs as a user-specified account writes its log to Cloud Logging only.
    'roles/logging.logWriter',
];
const FN_ADMIN_SECRET_ROLES = [
    'roles/secretmanager.secretAccessor',
    'roles/secretmanager.secretVersionAdder',
    'roles/secretmanager.secretVersionManager',
];

/**
 * What a first functions deploy wants of the service agents (firebase-tools' `ensureServiceAgentRoles`): the Pub/Sub
 * agent may mint tokens, the compute default account may invoke and receive events. Bound here, so the installer, which
 * reads the project's policy but may not write it, finds them in place (M6-interfaces §1.2).
 */
function firstDeployBindings(agents: ServiceAgents): WantedBinding[] {
    const compute =
        agents.computeDefault === undefined
            ? []
            : grants(`serviceAccount:${agents.computeDefault}`, [INVOKER_ROLE, 'roles/eventarc.eventReceiver']);
    return [...grants(`serviceAccount:${agents.pubsub}`, ['roles/iam.serviceAccountTokenCreator']), ...compute];
}

/** The project's bindings (the compute default account's builder role is {@link buildAccountBindings}' own). */
function projectBindings(project: ProjectConfig, agents: ServiceAgents): PolicyBindings {
    const names = projectNames(project);
    return {
        kind: 'project',
        resource: project.projectId,
        bindings: [
            ...grants(names.member('fn-admin'), [...FN_ADMIN_PROJECT_ROLES, customRoleName(project.projectId, VERTEX_DRAFTS_ROLE_ID)]),
            ...grants(names.member('fn-events'), FN_EVENTS_PROJECT_ROLES),
            ...grants(names.member('job-raster'), ['roles/datastore.user']),
            // CR-M5-7: GitHub Actions only for a project that names a repository.
            ...(project.github === undefined ? [] : grants(names.member('gh-deployer'), DEPLOYER_PROJECT_ROLES)),
            ...grants(names.member(INSTALLER_ACCOUNT), [...INSTALLER_PROJECT_ROLES, customRoleName(project.projectId, INSTALLER_ROLE_ID)]),
            ...grants(`serviceAccount:${agents.firebaseStorage}`, ['roles/firebaserules.firestoreServiceAgent']),
            ...grants(`serviceAccount:${agents.cloudStorage}`, ['roles/pubsub.publisher']),
            ...firstDeployBindings(agents),
        ],
    };
}

/**
 * M6 (§1.2): the installer pushes the pipeline's image to the repository `hcm`, and only there. Kept by the
 * `artifact-registry` item with the repository (finding 31 of 2026-10-31): only the optional imagery pipeline needs
 * either, so the `iam` item, which the server needs, never waits for them.
 */
export function repositoryBindings(project: ProjectConfig): PolicyBindings {
    return {
        kind: 'repository',
        resource: PIPELINE_REPOSITORY,
        bindings: grants(projectNames(project).member(INSTALLER_ACCOUNT), ['roles/artifactregistry.writer']),
    };
}

/**
 * M7 (`docs/research/M7-local-worker.md` §1.1, §10.5): anyone may pull the pipeline's image from the repository `hcm`, so
 * the owner's computer runs the local worker with Docker alone (the image is the open-source pipeline: no secret, no
 * configuration). An organisation policy that refuses `allUsers` leaves it private; the panel names the alternative
 * (`gcloud auth configure-docker`).
 */
export const PUBLIC_PULL: WantedBinding = { role: 'roles/artifactregistry.reader', member: 'allUsers' };

function bucketBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    const writers = (accounts: readonly ServiceAccountId[]): WantedBinding[] =>
        accounts.flatMap((account) => grants(names.member(account), ['roles/storage.objectAdmin']));
    return [
        { kind: 'bucket', resource: names.privateBucket, bindings: writers(['fn-admin', 'fn-events', 'job-raster']) },
        { kind: 'bucket', resource: names.publicBucket, bindings: writers(['fn-admin', 'fn-events']) },
    ];
}

/** Who reads `secret` besides the admin functions: the event functions, the raster job (USGS only). */
function secretReaders(project: ProjectConfig, secret: SecretId): WantedBinding[] {
    const names = projectNames(project);
    const readers = [
        ...(EVENTS_SECRETS.includes(secret) ? [names.member('fn-events')] : []),
        ...(RASTER_SECRETS.includes(secret) ? [names.member('job-raster')] : []),
    ];
    return readers.flatMap((member) => grants(member, ['roles/secretmanager.secretAccessor']));
}

function secretBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    return SECRET_IDS.map((secret) => ({
        kind: 'secret' as const,
        resource: secret,
        bindings: [...grants(names.member('fn-admin'), FN_ADMIN_SECRET_ROLES), ...secretReaders(project, secret)],
    }));
}

/**
 * `iam.serviceAccountUser` on the function accounts: each for itself (Cloud Tasks OIDC), the deployer for all of them.
 * `fn-crash@` runs the public crash endpoint and holds no role anywhere (`DECISIONS-for-review.md` §42f): only the
 * deployers may act as it, to deploy the function. M6 (§1.2): the in-app installer deploys as each of them too, never
 * project-wide.
 */
function serviceAccountBindings(project: ProjectConfig): PolicyBindings[] {
    const names = projectNames(project);
    const user = (member: string): WantedBinding => ({ role: 'roles/iam.serviceAccountUser', member });
    const installer = user(names.member(INSTALLER_ACCOUNT));
    const deployers = project.github === undefined ? [installer] : [user(names.member('gh-deployer')), installer];
    // M5 (CR-M5-8): `export.download` signs its address as `fn-admin` itself (IAM signBlob), which needs this role on itself.
    const signer: WantedBinding = { role: 'roles/iam.serviceAccountTokenCreator', member: names.member('fn-admin') };
    return [
        { kind: 'serviceAccount', resource: names.email('fn-admin'), bindings: [user(names.member('fn-admin')), signer, ...deployers] },
        { kind: 'serviceAccount', resource: names.email('fn-events'), bindings: [user(names.member('fn-events')), ...deployers] },
        { kind: 'serviceAccount', resource: names.email('fn-crash'), bindings: deployers },
        { kind: 'serviceAccount', resource: names.email('job-raster'), bindings: deployers },
    ];
}

/**
 * Finding 28: the installer may act as the App Engine default account, which firebase-tools requires before a functions
 * deploy; a resource-level binding on that one account, and none when the project has no such account.
 */
function appEngineBindings(project: ProjectConfig, agents: ServiceAgents): PolicyBindings[] {
    if (agents.appEngineDefault === undefined) {
        return [];
    }
    const binding: WantedBinding = { role: 'roles/iam.serviceAccountUser', member: projectNames(project).member(INSTALLER_ACCOUNT) };
    return [{ kind: 'serviceAccount', resource: agents.appEngineDefault, bindings: [binding] }];
}

/**
 * The role Google documents for a user-specified build account of Cloud Functions gen 2 and Cloud Run source builds
 * ("Cloud Build Service Account"): it reads the uploaded source, pushes the image to the region's `gcf-artifacts`
 * repository (`artifactregistry.repositories.uploadArtifacts`, `createOnPush`) and writes the build's log
 * (`logging.logEntries.create`), so it needs neither `roles/logging.logWriter` nor `roles/artifactregistry.writer` beside it
 * (`DECISIONS-for-review.md` §75g).
 */
const BUILDER_ROLE = 'roles/cloudbuild.builds.builder';

/**
 * Finding 33 of `docs/research/manual-test-2026-10-25.md` (live test 2026-10-31, `DECISIONS-for-review.md` §75g, the
 * user's decision "Act-as + narrow its role"): Cloud Functions gen 2 builds each function as the Compute Engine default
 * account (firebase-tools names no build account), and the Cloud Functions API refuses a create or update whose caller
 * may not act as it (403 `iam.serviceaccounts.actAs`). In the order the `iam` item writes them: (1) the installer's
 * Service Account User on that one account's own policy, never project-wide; (2) {@link BUILDER_ROLE} for the account on
 * the project, so (3) its `roles/editor` can go (`items-iam.ts`). None when the project has no such account.
 */
export function buildAccountBindings(project: ProjectConfig, computeDefault: string | undefined): PolicyBindings[] {
    if (computeDefault === undefined) {
        return [];
    }
    const actAs: WantedBinding = { role: 'roles/iam.serviceAccountUser', member: projectNames(project).member(INSTALLER_ACCOUNT) };
    return [
        { kind: 'serviceAccount', resource: computeDefault, bindings: [actAs] },
        { kind: 'project', resource: project.projectId, bindings: grants(`serviceAccount:${computeDefault}`, [BUILDER_ROLE]) },
    ];
}

/** Every policy the `iam` item keeps (§3.4.1), project first; the build account's are {@link buildAccountBindings}. */
export function roleTable(project: ProjectConfig, agents: ServiceAgents): PolicyBindings[] {
    return [
        projectBindings(project, agents),
        ...bucketBindings(project),
        ...secretBindings(project),
        ...serviceAccountBindings(project),
        ...appEngineBindings(project, agents),
    ];
}
