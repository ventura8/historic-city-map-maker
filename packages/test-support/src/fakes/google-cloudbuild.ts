import { CLOUD_RUN_JOBS, INSTALLER_ACCOUNT, installLogLine, type InstallTarget } from '@hcm/shared';

import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { registryFunctions, type DeploymentState } from './google-functions.js';
import { appEngineAccount, computeAccount, grantAccountRole, holdsAccountRole, projectIam, type IamState } from './google-iam.js';
import { setJobSpec, type CloudRunState } from './google-run.js';
import { enableService, serviceEnabled, type ServiceUsageState } from './google-services.js';
import { jsonResponse, requestObject, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Build v1 for the in-app installer (`docs/research/M6-interfaces.md` §1.4, §1.10): builds are created (queued),
 * read and listed by tag, newest first. No step runs: each target's next builds play the outcome its scenario names
 * (`serverSucceeds`, `serverRetries`, `serverFailsAtFunctions`, `serverRetriesExhausted`, `serverInternalError`, the
 * same for `pipeline` and `site`), when a test applies `start` (queued → working, a retrying server build printing its
 * retry line) and `finish` (→ the outcome). A successful build changes the world as the real one would: the server's
 * functions deployed with the build's `HCM_RELEASE` and their Scheduler job; the pipeline's two Cloud Run jobs on the
 * pushed image with the release label; the public site's `release.json`. The build's log lines (Cloud Logging,
 * `google-logging.ts`) come from the same state, a stopped step's with a planted token for the redaction checks.
 *
 * Three preconditions are enforced on a server build that would succeed, in the order a functions deploy meets them:
 * `firebase-tools`' check of the installer's actAs on the App Engine default account (finding 28) and the functions'
 * packages in their source folder, which its discovery loads (finding 30: a definition with no `npm ci` in
 * `server/functions/dist` before `functions` stops there), both before the source upload; then, after it, the Cloud
 * Functions API's own check that the caller may act as the functions' build account, the Compute Engine default account
 * (finding 33: every create and update answers 403). Each stops at `functions` with the lines the live run printed.
 */

const CLOUD_BUILD: GoogleApi = { service: 'cloudbuild.googleapis.com', title: 'Cloud Build API', permission: 'cloudbuild.builds.create' };

export const BUILD_OUTCOMES = [
    'succeeds',
    'retries',
    'failsAtFetch',
    'failsAtFunctions',
    'failsAtBuild',
    'failsAtHosting',
    // Finding 28 of 2026-10-31: firebase-tools' own check before a functions deploy, the installer's actAs on the App
    // Engine default account; a server build that would succeed plays it when the IAM fake says the grant is missing.
    'failsAtActAs',
    // Finding 30 of 2026-10-31: firebase-tools' discovery loads the functions' source, so their packages must be installed
    // in it; a server build that would succeed plays it when its definition installs none before `functions`.
    'failsAtDiscovery',
    // Finding 33 of 2026-10-31: the Cloud Functions API refuses each create and update while the installer may not act as
    // the functions' build account (the Compute Engine default account); played after the two above, as the deploy meets it.
    'failsAtComputeActAs',
    'retriesExhausted',
    'internalError',
    // Finding 47 of 2026-11-01: the pipeline's `jobs` step waits out Cloud Run's request rate (its retry line), then
    // succeeds; or stops at a quota, which it names (its `quota` line).
    'retriesAtJobs',
    'failsAtJobsQuota',
] as const;

export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];

type BuildStatus = 'QUEUED' | 'WORKING' | 'SUCCESS' | 'FAILURE' | 'INTERNAL_ERROR';

interface FakeLogLine {
    readonly step: string;
    readonly text: string;
}

export interface FakeBuild {
    readonly id: string;
    readonly projectId: string;
    readonly region: string;
    readonly target: InstallTarget;
    /** The definition the admin submitted, as it sent it. */
    readonly request: Readonly<Record<string, unknown>>;
    readonly stepIds: readonly string[];
    readonly tags: readonly string[];
    readonly substitutions: Readonly<Record<string, string>>;
    outcome: BuildOutcome;
    status: BuildStatus;
    /** Index of the step under way (WORKING), or of the step a stopped build stopped at. */
    current: number;
    readonly createTime: string;
    startTime?: string;
    finishTime?: string;
    readonly log: FakeLogLine[];
}

/** The public site the site build published (`release.json`: what the e2e Hosting answers). */
interface HostingRelease {
    readonly release: string;
    /** The site's build time (finding 39 of 2026-11-01), when its release has one. */
    readonly releaseTime?: number;
    readonly variant: 'public' | 'start-up';
}

export interface CloudBuildState {
    /** Build id → build, in creation order. */
    readonly builds: Map<string, FakeBuild>;
    /** Each target's outcome for its next builds (default `succeeds`). */
    readonly outcomes: Map<InstallTarget, BuildOutcome>;
    /** The public site's release, once a site build succeeded. */
    hosting: HostingRelease | null;
}

export function defaultCloudBuildState(): CloudBuildState {
    return { builds: new Map(), outcomes: new Map(), hosting: null };
}

/** The world a successful build changes. */
export interface BuildWorld {
    readonly deployment: DeploymentState;
    readonly serviceUsage: ServiceUsageState;
    readonly cloudRun: CloudRunState;
    /** The IAM fake's projects: `installerAccount` adds the installer's account as Prepare the project makes it. */
    readonly iam: IamState;
}

const SERVICE_ACCOUNT_USER = 'roles/iam.serviceAccountUser';

function installerMember(projectId: string): string {
    return `serviceAccount:${INSTALLER_ACCOUNT}@${projectId}.iam.gserviceaccount.com`;
}

/** Google's default accounts the installer acts as: the App Engine one (finding 28), the Compute Engine one (finding 33). */
function defaultAccounts(projectId: string, projectNumber: string): readonly string[] {
    return [appEngineAccount(projectId), computeAccount(projectNumber)];
}

/**
 * The installer's account in `projectId`, as Provision's `service-accounts` and `iam` items make it (a map set up in an
 * earlier session): with its Service Account User role on each of Google's default accounts the project has.
 */
function addInstallerAccount(iam: IamState, projectId: string): void {
    const project = projectIam(iam, projectId);
    project.accounts.set(INSTALLER_ACCOUNT, 'Cloud Build: the in-app installer');
    defaultAccounts(projectId, project.number)
        .filter((account) => project.googleAccounts.has(account))
        .forEach((account) => {
            grantAccountRole(project, account, SERVICE_ACCOUNT_USER, installerMember(projectId));
        });
}

/**
 * Whether the installer lacks `iam.serviceAccounts.actAs` on Google's account `account(number)` of the project, which
 * exists. Provision never grants it project-wide, so the account's own policy decides. A world with no IAM state of the
 * project had no Prepare the project: nothing to check. The App Engine account: firebase-tools' `checkServiceAccountIam`
 * (`lib/deploy/functions/checkIam.js`, before any functions deploy; a check that errors, as for a missing account, is
 * skipped). The Compute Engine account: the Cloud Functions API, for each function it builds (finding 33).
 */
function lacksActAs(iam: IamState, projectId: string, account: (projectNumber: string) => string): boolean {
    const project = iam.projects.get(projectId);
    const email = project === undefined ? '' : account(project.number);
    if (project?.googleAccounts.has(email) !== true) {
        return false;
    }
    return !holdsAccountRole(project, email, SERVICE_ACCOUNT_USER, installerMember(projectId));
}

/** The functions' source in the server's tarball, as the build's working folders name it. */
const FUNCTIONS_SOURCE_DIR = 'server/functions/dist';

/** An `npm ci` in the functions' source folder. */
function installsFunctionPackages(step: Readonly<Record<string, unknown>>): boolean {
    return step['entrypoint'] === 'npm' && step['dir'] === FUNCTIONS_SOURCE_DIR && strings(step['args'])[0] === 'ci';
}

/**
 * firebase-tools' discovery (`lib/deploy/functions/prepare.js` `loadCodebases`, `runtimes/node`): it resolves
 * `firebase-functions` from the source folder and runs its binary, which loads `index.js`; the tarball carries no
 * `node_modules`, so a definition without an install there before its `functions` step stops at it (a definition
 * with no `functions` step deploys none).
 */
function lacksFunctionPackages(request: Readonly<Record<string, unknown>>): boolean {
    const steps = stepObjects(request);
    const functions = steps.findIndex((step) => step['id'] === 'functions');
    return functions !== -1 && !steps.slice(0, functions).some(installsFunctionPackages);
}

/** A token and a secret planted in a stopped step's log: the admin must redact both (S-A55-BAD-BUILD-FAILED). */
export const PLANTED_LOG_SECRETS = ['ya29.e2e-planted-access-token-0001', 'sk.e2e-planted-mapbox-secret-0001-abcdefgh'] as const;

/** The release an older site build published (S-A57-HAPPY-UPDATE). */
export const OLDER_SITE_RELEASE = '0.9.0+e2e0000';

/** The image digest a pipeline build pushes. */
export const PIPELINE_DIGEST = `sha256:${'e2'.repeat(32)}`;

const TARGETS: readonly InstallTarget[] = ['server', 'pipeline', 'site'];

function targetOf(tags: readonly string[]): InstallTarget | undefined {
    return TARGETS.find((target) => tags.includes(`hcm-${target}`));
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The definition's steps, each as an object (anything else as an empty one). */
function stepObjects(request: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>[] {
    const steps = Array.isArray(request['steps']) ? (request['steps'] as unknown[]) : [];
    return steps.map((step) => (typeof step === 'object' && step !== null ? (step as Record<string, unknown>) : {}));
}

function stepIdsOf(request: Readonly<Record<string, unknown>>): string[] {
    return stepObjects(request).map((step) => (typeof step['id'] === 'string' ? step['id'] : ''));
}

function substitutionsOf(request: Readonly<Record<string, unknown>>): Record<string, string> {
    const value = request['substitutions'];
    const entries = typeof value === 'object' && value !== null ? Object.entries(value) : [];
    return Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** The step a stopping outcome stops at (the last step for an exhausted retry, which `verify` ends). */
function stopStep(build: FakeBuild): number {
    const stops: Partial<Record<BuildOutcome, string>> = {
        failsAtFetch: 'fetch',
        failsAtFunctions: 'functions',
        failsAtBuild: 'build',
        failsAtHosting: 'hosting',
        failsAtActAs: 'functions',
        failsAtDiscovery: 'functions',
        failsAtComputeActAs: 'functions',
        retriesExhausted: 'verify',
        failsAtJobsQuota: 'jobs',
    };
    const step = stops[build.outcome];
    return step === undefined ? build.stepIds.length - 1 : Math.max(0, build.stepIds.indexOf(step));
}

function now(): string {
    return new Date().toISOString();
}

function retryLines(attempt: number): FakeLogLine[] {
    return [
        { step: 'functions', text: 'Error: Permission denied while using the Eventarc Service Agent. This may take a few minutes.' },
        { step: 'functions', text: installLogLine({ event: 'retry', attempt, waitSeconds: 60 * attempt, reason: 'eventarcAgent' }) },
    ];
}

/** What firebase-tools prints when the installer may not act as the App Engine default account (finding 28). */
function actAsLines(projectId: string): FakeLogLine[] {
    const lines = [
        `Error: Missing permissions required for functions deploy. You must have permission iam.serviceAccounts.ActAs on service account ${appEngineAccount(projectId)}.`,
        'To address this error, ask a project Owner to assign your account the "Service Account User" role from this URL:',
        `https://console.cloud.google.com/iam-admin/iam?project=${projectId}`,
    ];
    return lines.map((text) => ({ step: 'functions', text }));
}

/**
 * What firebase-tools 15.34.2 printed live (Cloud Build f92cec75, finding 33) when the Cloud Functions API refused the
 * functions' builds: for each function the API's 403 and the tool's two lines (`functionsOpLogReject`, the fabricator's
 * `Failed to …`), then its summary, so the step's last lines name the functions only.
 */
function computeActAsLines(build: FakeBuild): FakeLogLine[] {
    const account = `projects/-/serviceAccounts/${computeAccount(String(FIXTURE_VALUES['projectNumber']))}`;
    const denied = `⚠  functions: HTTP Error: 403, Caller is missing permission 'iam.serviceaccounts.actAs' on service account ${account}. Grant the role 'roles/iam.serviceAccountUser' to the caller on the service account ${account}.`;
    const resource = (name: string): string => `projects/${build.projectId}/locations/${build.region}/functions/${name}`;
    const names = registryFunctions();
    const lines = [
        ...names.flatMap((name) => [
            denied,
            `⚠  functions:  failed to create function ${resource(name)}`,
            `Failed to create function ${resource(name)}`,
        ]),
        'Functions deploy had errors with the following functions:',
        ...names.map((name) => `\t${name}(${build.region})`),
        'Error: There was an error deploying functions',
    ];
    return lines.map((text) => ({ step: 'functions', text }));
}

/** What firebase-tools 15.34.2 printed live when the functions' source had no packages (finding 30). */
export const DISCOVERY_FAILURE_LINES = [
    "⚠  functions: Couldn't find firebase-functions package in your source code. Have you run 'npm install'?",
    'i  functions: Loading and analyzing source code for codebase default to determine what to deploy',
    'Error: An unexpected error has occurred.',
] as const;

function failureLines(step: string): FakeLogLine[] {
    const [token, secret] = PLANTED_LOG_SECRETS;
    return [
        { step, text: `Error: ${step} failed` },
        { step, text: `Authorization: Bearer ${token}` },
        { step, text: `MAPBOX_TOKEN=${secret}` },
        { step, text: `The ${step} step exited with status 1.` },
    ];
}

/** `verify` names the two functions an exhausted retry left out (the registry's first two). */
function missingLines(): FakeLogLine[] {
    return registryFunctions()
        .slice(0, 2)
        .map((name) => ({ step: 'verify', text: installLogLine({ event: 'missing', name }) }));
}

/** The jobs' Run Admin v2 address of the build's project, as the `jobs` step prints it. */
function jobsUrl(build: FakeBuild): string {
    return `https://run.googleapis.com/v2/projects/${build.projectId}/locations/${build.region}/jobs`;
}

/** What `run-jobs` prints when Cloud Run refuses a create for its request rate and it waits (finding 47). */
function jobsRateLines(build: FakeBuild): FakeLogLine[] {
    const refusal = `POST ${jobsUrl(build)}: HTTP 429 RESOURCE_EXHAUSTED: Quota exceeded for quota metric 'Write requests'; ErrorInfo RATE_LIMIT_EXCEEDED service=run.googleapis.com`;
    return [
        { step: 'jobs', text: `jobs: ${refusal}: trying again in 30 s` },
        { step: 'jobs', text: installLogLine({ event: 'retry', attempt: 1, waitSeconds: 30, reason: 'quota' }) },
    ];
}

/** The quota the fake Cloud Run names (`cloud-run/jobs.create.quota-exceeded`). */
const JOBS_QUOTA = {
    service: 'run.googleapis.com',
    metric: 'run.googleapis.com/cpu_allocation',
    limit: 'CpuAllocPerProjectRegion',
} as const;

/** What `run-jobs` prints when Cloud Run refuses a create for a quota: the line naming it, its event, the step's error. */
function jobsQuotaLines(build: FakeBuild): FakeLogLine[] {
    const lines = [
        `jobs: Google Cloud refused raster-pipeline for the quota ${JOBS_QUOTA.metric} (limit ${JOBS_QUOTA.limit}) of ${JOBS_QUOTA.service}. ` +
            'A free-trial project has lower quotas: upgrade the account, or ask for a higher quota on the Quotas page, then try again.',
        installLogLine({ event: 'quota', ...JOBS_QUOTA }),
        `run-jobs: GoogleCallError: POST ${jobsUrl(build)}: HTTP 429 RESOURCE_EXHAUSTED: Quota exceeded; ErrorInfo RESOURCE_QUOTA_EXCEEDED`,
    ];
    return lines.map((text) => ({ step: 'jobs', text }));
}

/** The outcomes that start at a later step and print a retry there: the step and its lines. */
const RETRY_STARTS: Partial<Record<BuildOutcome, { readonly step: string; readonly lines: (build: FakeBuild) => FakeLogLine[] }>> = {
    retries: { step: 'functions', lines: () => retryLines(1) },
    retriesExhausted: { step: 'functions', lines: () => retryLines(1) },
    retriesAtJobs: { step: 'jobs', lines: jobsRateLines },
};

function start(build: FakeBuild): void {
    if (build.status !== 'QUEUED') {
        return;
    }
    build.status = 'WORKING';
    build.startTime = now();
    build.log.push({ step: 'fetch', text: `fetch: ${build.target} checked and unpacked` });
    const retrying = RETRY_STARTS[build.outcome];
    build.current = retrying === undefined ? 0 : Math.max(0, build.stepIds.indexOf(retrying.step));
    build.log.push(...(retrying?.lines(build) ?? []));
}

/** The lines of the outcomes whose log is the tool's own, not the generic failure's. */
const OWN_STOP_LINES: Partial<Record<BuildOutcome, (build: FakeBuild) => FakeLogLine[]>> = {
    retriesExhausted: () => [...retryLines(2), ...retryLines(3), ...missingLines()],
    failsAtActAs: (build) => actAsLines(build.projectId),
    failsAtDiscovery: () => DISCOVERY_FAILURE_LINES.map((text) => ({ step: 'functions', text })),
    failsAtComputeActAs: computeActAsLines,
    failsAtJobsQuota: jobsQuotaLines,
};

function stopLines(build: FakeBuild): FakeLogLine[] {
    const own = OWN_STOP_LINES[build.outcome];
    if (own !== undefined) {
        return own(build);
    }
    return build.outcome.startsWith('failsAt') ? failureLines(build.stepIds[stopStep(build)] ?? 'fetch') : [];
}

const SUCCESSFUL_OUTCOMES: ReadonlySet<BuildOutcome> = new Set<BuildOutcome>(['succeeds', 'retries', 'retriesAtJobs']);

function finalStatus(outcome: BuildOutcome): BuildStatus {
    if (outcome === 'internalError') {
        return 'INTERNAL_ERROR';
    }
    return SUCCESSFUL_OUTCOMES.has(outcome) ? 'SUCCESS' : 'FAILURE';
}

/**
 * A server build's preconditions in the order the deploy meets them: firebase-tools' actAs check (finding 28) and its
 * discovery (finding 30) before the source upload, the Cloud Functions API's actAs check on the build account after it
 * (finding 33).
 */
const PRECONDITIONS: readonly (readonly [BuildOutcome, (build: FakeBuild, world: BuildWorld) => boolean])[] = [
    ['failsAtActAs', (build, world) => lacksActAs(world.iam, build.projectId, () => appEngineAccount(build.projectId))],
    ['failsAtDiscovery', (build) => lacksFunctionPackages(build.request)],
    ['failsAtComputeActAs', (build, world) => lacksActAs(world.iam, build.projectId, computeAccount)],
];

/** A server build that would succeed stops at the first precondition it fails. */
function checkPreconditions(build: FakeBuild, world: BuildWorld): void {
    if (build.target !== 'server' || finalStatus(build.outcome) !== 'SUCCESS') {
        return;
    }
    build.outcome = PRECONDITIONS.find(([, fails]) => fails(build, world))?.[0] ?? build.outcome;
}

/** The build ends as its outcome says, and a success changes the world. */
function finish(build: FakeBuild, state: CloudBuildState, world: BuildWorld): void {
    start(build);
    if (build.status !== 'WORKING') {
        return;
    }
    checkPreconditions(build, world);
    build.status = finalStatus(build.outcome);
    build.current = stopStep(build);
    build.finishTime = now();
    build.log.push(...stopLines(build));
    if (build.status === 'SUCCESS') {
        succeed(build, state, world);
    }
}

/** The build's `_RELEASE_TIME` (finding 39 of 2026-11-01): whole seconds, or undefined for a release without one. */
function releaseTimeOf(build: FakeBuild): number | undefined {
    const text = build.substitutions['_RELEASE_TIME'] ?? '';
    return /^\d{1,10}$/.test(text) ? Number(text) : undefined;
}

/** `{releaseTime}` when there is one, else nothing (what a record of the release adds). */
function timedOf(releaseTime: number | undefined): { readonly releaseTime?: number } {
    return releaseTime === undefined ? {} : { releaseTime };
}

/** The pipeline jobs' labels: the release's slug and, when it has one, its build time (as the `jobs` step writes them). */
function jobLabels(slug: string, releaseTime: number | undefined): Record<string, string> {
    return releaseTime === undefined ? { 'hcm-release': slug } : { 'hcm-release': slug, 'hcm-release-time': String(releaseTime) };
}

function succeed(build: FakeBuild, state: CloudBuildState, world: BuildWorld): void {
    const release = build.substitutions['_RELEASE'] ?? '';
    const slug = build.substitutions['_SLUG'] ?? '';
    const releaseTime = releaseTimeOf(build);
    const timed = timedOf(releaseTime);
    if (build.target === 'server') {
        world.deployment.deployment = 'deployed';
        world.deployment.schedulerJob = true;
        world.deployment.release = release;
        delete world.deployment.releaseTime;
        Object.assign(world.deployment, timed);
        // A server build deploys every function of the registry (a server from before M6 lacked some).
        delete world.deployment.lacking;
        enableService(world.serviceUsage, build.projectId, 'cloudfunctions.googleapis.com');
        return;
    }
    if (build.target === 'pipeline') {
        // The `push` step names the digest it pushed (M7: the admin records it for the local worker's command).
        build.log.push({ step: 'push', text: installLogLine({ event: 'image', digest: PIPELINE_DIGEST }) });
        const image = `${build.region}-docker.pkg.dev/${build.projectId}/hcm/pipeline@${PIPELINE_DIGEST}`;
        Object.values(CLOUD_RUN_JOBS).forEach((job) => {
            setJobSpec(world.cloudRun, `${build.projectId}/${build.region}/${job}`, { labels: jobLabels(slug, releaseTime), image });
        });
        return;
    }
    state.hosting = { release, ...timed, variant: 'public' };
}

/** The step under way's status, or the step a stopped build stopped at: the build's own. */
function currentStatus(build: FakeBuild): string {
    return build.status === 'SUCCESS' ? 'SUCCESS' : build.status;
}

function stepStatus(build: FakeBuild, index: number): string {
    if (build.status === 'QUEUED' || index > build.current) {
        return 'QUEUED';
    }
    return index < build.current ? 'SUCCESS' : currentStatus(build);
}

/** A build as Google answers it. */
function buildBody(build: FakeBuild): Record<string, unknown> {
    return {
        id: build.id,
        projectId: build.projectId,
        status: build.status,
        createTime: build.createTime,
        ...(build.startTime === undefined ? {} : { startTime: build.startTime }),
        ...(build.finishTime === undefined ? {} : { finishTime: build.finishTime }),
        steps: build.stepIds.map((id, index) => ({ id, status: stepStatus(build, index) })),
        tags: build.tags,
        substitutions: build.substitutions,
        serviceAccount: build.request['serviceAccount'],
        options: build.request['options'],
    };
}

/** A request that is not a build definition the installer would send. */
function refusal(request: Readonly<Record<string, unknown>>): boolean {
    const tags = strings(request['tags']);
    return stepIdsOf(request).length === 0 || !tags.includes('hcm-install') || targetOf(tags) === undefined;
}

/** The server build's steps before finding 30 (2026-10-31), as the live admin `1.0.0+60fe650` submitted them. */
const PRE_PACKAGES_SERVER_STEPS = ['fetch', 'tools', 'rules', 'functions', 'verify'].map((id) => ({ id }));

type CreateElsewhere = (target: InstallTarget, outcome: BuildOutcome, steps?: readonly Record<string, unknown>[]) => void;

function scenarioTable(state: CloudBuildState, world: BuildWorld, create: CreateElsewhere) {
    const outcomes = Object.fromEntries(
        TARGETS.flatMap((target) =>
            BUILD_OUTCOMES.map((outcome) => [
                `${target}${outcome[0]?.toUpperCase() ?? ''}${outcome.slice(1)}`,
                () => {
                    state.outcomes.set(target, outcome);
                },
            ]),
        ),
    );
    return {
        ...outcomes,
        /** Every queued build starts (a retrying server build prints its first retry). */
        start: () => {
            state.builds.forEach((build) => {
                start(build);
            });
        },
        /** Every build that runs ends as its outcome says. */
        finish: () => {
            state.builds.forEach((build) => {
                finish(build, state, world);
            });
        },
        /** The installer's account of the demo project, for a map whose Prepare the project ran in an earlier session. */
        installerAccount: () => {
            addInstallerAccount(world.iam, String(FIXTURE_VALUES['projectId']));
        },
        /** A site build of an older release published the public variant (S-A57-HAPPY-UPDATE). */
        siteOlderRelease: () => {
            state.hosting = { release: OLDER_SITE_RELEASE, variant: 'public' };
        },
        /** A server build queued from another tab (S-A55-BAD-SECOND-BUILD). */
        serverQueuedElsewhere: () => {
            create('server', 'succeeds');
        },
        /** A pipeline build still queued from an earlier visit (S-A55-BAD-UPDATE-STALE-RECORD). */
        pipelineQueuedElsewhere: () => {
            create('pipeline', 'succeeds');
        },
        /**
         * A server build an admin from before finding 30 queued (S-A55-BAD-NO-FUNCTIONS-PACKAGES): its steps, without
         * `packages`, so firebase-tools' discovery stops it at `functions` once it finishes.
         */
        serverQueuedWithoutPackages: () => {
            create('server', 'succeeds', PRE_PACKAGES_SERVER_STEPS);
        },
    };
}

/** The fake Cloud Build API. */
export function createCloudBuildFake(state: CloudBuildState, world: BuildWorld, projects: GoogleProjects): ServiceFake {
    const nextBuild = sequence('0e2e0b1d-0000-4000-8000-', 12);
    const nextOperation = sequence('e2e-build-op-');
    const add = (projectId: string, region: string, request: Readonly<Record<string, unknown>>, outcome: BuildOutcome): FakeBuild => {
        const tags = strings(request['tags']);
        const build: FakeBuild = {
            ...{ id: nextBuild(), projectId, region, target: targetOf(tags) ?? 'server', request, stepIds: stepIdsOf(request), tags },
            ...{ substitutions: substitutionsOf(request), outcome, status: 'QUEUED', current: 0, createTime: now(), log: [] },
        };
        state.builds.set(build.id, build);
        return build;
    };
    const create: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        if (!serviceEnabled(world.serviceUsage, project.id, CLOUD_BUILD.service)) {
            return googleError('google/error.service-disabled', CLOUD_BUILD, { projectNumber: project.number });
        }
        const body = requestObject(request);
        if (refusal(body)) {
            return googleError('google/error.invalid-argument', CLOUD_BUILD);
        }
        const target = targetOf(strings(body['tags'])) ?? 'server';
        const build = add(project.id, String(params['region']), body, state.outcomes.get(target) ?? 'succeeds');
        return jsonResponse({
            name: `projects/${project.number}/locations/${String(params['region'])}/operations/${nextOperation()}`,
            metadata: { '@type': 'type.googleapis.com/google.devtools.cloudbuild.v1.BuildOperationMetadata', build: buildBody(build) },
        });
    };
    const get: Route['answer'] = (_request, params) => {
        const build = state.builds.get(String(params['build']));
        return build === undefined ? googleError('google/error.not-found', CLOUD_BUILD) : jsonResponse(buildBody(build));
    };
    const list: Route['answer'] = (request) => {
        const tag = /^tags="([\w.-]+)"$/.exec(request.url.searchParams.get('filter') ?? '')?.[1];
        const size = Number(request.url.searchParams.get('pageSize') ?? 25);
        const builds = [...state.builds.values()].filter((build) => tag === undefined || build.tags.includes(tag)).reverse();
        return jsonResponse({ builds: builds.slice(0, size).map(buildBody) });
    };
    const base = 'https://cloudbuild.googleapis.com/v1/projects/{project}/locations/{region}/builds';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(CLOUD_BUILD, answer);
    const elsewhere: CreateElsewhere = (target, outcome, steps = [{ id: 'fetch' }]) => {
        const projectId = String(FIXTURE_VALUES['projectId']);
        const request = { tags: ['hcm-install', `hcm-${target}`, 'hcm-r-elsewhere'], steps, substitutions: {} };
        add(projectId, String(FIXTURE_VALUES['region']), request, outcome);
    };
    return {
        name: 'cloud-build',
        routes: [
            route('GET', `${base}/{build}`, 'cloud-build.builds.get', auth(get)),
            route('GET', base, 'cloud-build.builds.list', auth(list)),
            route('POST', base, 'cloud-build.builds.create', auth(create)),
        ],
        failure: (mode) => googleFailure(CLOUD_BUILD, mode),
        scenarios: scenarioTable(state, world, elsewhere),
        snapshot: () => ({
            builds: [...state.builds.values()].map((build) => ({ ...buildBody(build), target: build.target, request: build.request })),
            hosting: state.hosting,
        }),
    };
}
