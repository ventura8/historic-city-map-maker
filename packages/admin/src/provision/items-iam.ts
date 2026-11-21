import { isGoogleFailure } from '../google/failure.js';
import {
    ensureBindings,
    heldBindings,
    missingBindings,
    removeBindings,
    type PolicyAccess,
    type WantedBinding,
} from '../google/iam-policy.js';
import type { AdminMessageKey } from '../google/failure.js';
import type { CustomRole, IdentityResource } from '../google/iam.js';
import { matchesSpec, sameSet, type JsonObject } from '../google/json.js';
import { eachInTurn, lacking, ok, type Observation, type ProvisionContext, type ProvisionItemSpec } from './item.js';
import {
    buildAccountBindings,
    CUSTOM_ROLES,
    roleTable,
    type CustomRoleEntry,
    type PolicyBindings,
    type ServiceAgents,
} from './resources.js';

/**
 * The `iam` item (the project's custom roles first, M4; then the role table of `docs/research/M2b-interfaces.md` §3.4.1
 * on the project, the buckets, the secrets and the service accounts) and the `workload-identity` item (the GitHub pool and its `site-master` provider, whose
 * condition admits only the repository's `master` branch in the `deploy` environment, and the deployer's binding).
 * M6 (`docs/research/M6-interfaces.md` §1.6, CR-M6-2): the Eventarc and Pub/Sub service identities are generated before
 * the table (finding 12), which gains `roles/run.invoker` for the function accounts (finding 17), the installer's rows and
 * the pipeline repository's policy. Since 2026-10-31 (`DECISIONS-for-review.md` §75b) it also takes `roles/editor` away
 * from the App Engine default account on the project's policy, last; since §75g (finding 33) the installer may act as
 * the Compute Engine default account, which builds the functions, and that account trades `roles/editor` for the
 * Cloud Build builder role.
 */

/** Google's default accounts of the project, each when it exists (a GET each; a 404 means nothing to do, not a failure). */
interface DefaultAccounts {
    /** `<number>-compute@developer.gserviceaccount.com`: the functions' build account (finding 33, §75g). */
    readonly compute: string | undefined;
    /** `<project>@appspot.gserviceaccount.com`: made with the App Engine app, so a project may lack it (finding 28). */
    readonly appEngine: string | undefined;
}

async function existing({ clients, project }: ProvisionContext, email: string): Promise<string | undefined> {
    return (await clients.iam.serviceAccountExists(project.projectId, email)) ? email : undefined;
}

async function defaultAccounts(context: ProvisionContext): Promise<DefaultAccounts> {
    const { projectId, projectNumber } = context.project;
    return {
        compute: await existing(context, `${projectNumber}-compute@developer.gserviceaccount.com`),
        appEngine: await existing(context, `${projectId}@appspot.gserviceaccount.com`),
    };
}

/** The service agents by their documented names: the doctor never creates them, the fix does first. */
function conventionalAgents(context: ProvisionContext, accounts: DefaultAccounts): ServiceAgents {
    const { projectNumber } = context.project;
    return {
        firebaseStorage: `service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`,
        cloudStorage: `service-${projectNumber}@gs-project-accounts.iam.gserviceaccount.com`,
        pubsub: `service-${projectNumber}@gcp-sa-pubsub.iam.gserviceaccount.com`,
        computeDefault: accounts.compute,
        appEngineDefault: accounts.appEngine,
    };
}

/** How each kind of policy of the role table is read and written. */
const POLICY_ACCESS: Readonly<Record<PolicyBindings['kind'], (context: ProvisionContext, resource: string) => PolicyAccess>> = {
    project: ({ clients, project }) => clients.resourceManager.projectPolicy(project.projectId),
    bucket: ({ clients }, resource) => clients.storage.bucketPolicy(resource),
    secret: ({ clients, project }, resource) => clients.secretManager.secretPolicy(project.projectId, resource),
    serviceAccount: ({ clients, project }, resource) => clients.iam.serviceAccountPolicy(project.projectId, resource),
    // M6 (§1.2): the installer's writer role on the pipeline's repository only (the `artifact-registry` item's, finding 31).
    repository: ({ clients, project }, resource) => clients.artifactRegistry.repositoryPolicy(project.projectId, project.region, resource),
};

function policyAccess(context: ProvisionContext, policy: PolicyBindings): PolicyAccess {
    return POLICY_ACCESS[policy.kind](context, policy.resource);
}

/** The bindings a policy lacks; a resource that does not exist yet lacks them all. */
async function lackingBindings(access: PolicyAccess, wanted: readonly WantedBinding[]): Promise<readonly WantedBinding[]> {
    try {
        return missingBindings(await access.read(), wanted);
    } catch (error) {
        if (isGoogleFailure(error, 'notFound')) {
            return wanted;
        }
        throw error;
    }
}

/**
 * Creates the service agents first (their bindings name them; Eventarc's has no binding of ours, Google grants it its
 * role when it is made, minutes before a first deploy needs it), then merges every policy's bindings in.
 */
async function bindAll(context: ProvisionContext, accounts: DefaultAccounts): Promise<void> {
    const { clients, project } = context;
    const identity = (service: string): Promise<string> => clients.serviceUsage.serviceIdentity(project.projectNumber, service);
    await identity('eventarc.googleapis.com');
    const agents: ServiceAgents = {
        firebaseStorage: await identity('firebasestorage.googleapis.com'),
        cloudStorage: await clients.storage.serviceAgent(project.projectId),
        pubsub: await identity('pubsub.googleapis.com'),
        computeDefault: accounts.compute,
        appEngineDefault: accounts.appEngine,
    };
    await bindEach(context, roleTable(project, agents));
}

/** Merges each policy's bindings in, one policy after the other, in the order given. */
function bindEach(context: ProvisionContext, policies: readonly PolicyBindings[]): Promise<void> {
    return eachInTurn(policies, (policy) => ensureBindings(policyAccess(context, policy), policy.bindings));
}

/** A custom role as it is and what it lacks: nothing, to be made, or to be undeleted or given its permissions. */
interface RoleFinding {
    readonly entry: CustomRoleEntry;
    readonly found: CustomRole | undefined;
}

function roleRight(role: CustomRole, entry: CustomRoleEntry): boolean {
    return !role.deleted && sameSet(role.includedPermissions, entry.spec.includedPermissions);
}

/** `role:<id>` for each custom role that is missing, deleted or holds other permissions. */
function rolesLacking(findings: readonly RoleFinding[]): string[] {
    return findings.filter(({ entry, found }) => found === undefined || !roleRight(found, entry)).map(({ entry }) => `role:${entry.id}`);
}

/** Makes or repairs every custom role that lacks something, before any binding names it. */
async function fixRoles(context: ProvisionContext, findings: readonly RoleFinding[]): Promise<void> {
    const { clients, project } = context;
    await eachInTurn(findings, async ({ entry, found }) => {
        if (found === undefined) {
            await clients.iam.createRole(project.projectId, entry.id, entry.spec);
        } else if (!roleRight(found, entry)) {
            await clients.iam.repairRole(found, entry.spec);
        }
    });
}

/** `<prefix><kind>:<resource>` for each policy that lacks one of its bindings. */
async function policiesLacking(context: ProvisionContext, policies: readonly PolicyBindings[], prefix = ''): Promise<string[]> {
    const lacks = await Promise.all(
        policies.map(async (policy) =>
            (await lackingBindings(policyAccess(context, policy), policy.bindings)).length === 0
                ? []
                : [`${prefix}${policy.kind}:${policy.resource}`],
        ),
    );
    return lacks.flat();
}

/**
 * `DECISIONS-for-review.md` §75b (the user's decision, 2026-10-31): the App Engine default account loses `roles/editor`
 * on the project. Nothing of ours runs as it (every function names its own account, the raster job runs as `job-raster@`,
 * the builds as `hcm-installer@`), and since §75a the installer may act as it, which would reach Editor through it.
 * §75g (finding 33, the user's decision "Act-as + narrow its role"): the Compute Engine default account, which builds the
 * functions and which the installer may now act as, loses it too, once its builder role is in place. Only that member of
 * only that binding (an unconditional one); nothing when the account is absent.
 */
const EDITOR_ROLE = 'roles/editor';

/** Each existing default account's Editor binding while the project's policy holds it: App Engine's first, then compute's. */
async function editorsHeld(context: ProvisionContext, accounts: DefaultAccounts): Promise<readonly WantedBinding[]> {
    const members = [accounts.appEngine, accounts.compute].flatMap((account) =>
        account === undefined ? [] : [`serviceAccount:${account}`],
    );
    if (members.length === 0) {
        return [];
    }
    const policy = await context.clients.resourceManager.projectPolicy(context.project.projectId).read();
    return heldBindings(
        policy,
        members.map((member) => ({ role: EDITOR_ROLE, member })),
    );
}

/**
 * One removal per account, each reading the policy again before its write (the role table's and the builder role's own
 * writes come first, and someone may have changed the policy): a refused one stops the item with the role it needs.
 */
async function dropEditors(context: ProvisionContext, held: readonly WantedBinding[]): Promise<void> {
    await eachInTurn(held, (binding) =>
        removeBindings(context.clients.resourceManager.projectPolicy(context.project.projectId), [binding]),
    );
}

/** Whether `binding` is the Compute Engine default account's. */
function isCompute(binding: WantedBinding): boolean {
    return binding.member.endsWith('-compute@developer.gserviceaccount.com');
}

/**
 * The doctor's reason when §75's parts are all the item lacks (a project prepared before them): the build account's
 * (§75g) before the App Engine account's Editor role (§75b); none while anything else lacks.
 */
function iamReason(granting: readonly string[], build: readonly string[], editors: readonly WantedBinding[]): AdminMessageKey | undefined {
    if (granting.length > 0) {
        return undefined;
    }
    if (build.length > 0 || editors.some(isCompute)) {
        return 'adminSetup.provision.computeBuildAccount';
    }
    return editors.length > 0 ? 'adminSetup.provision.appEngineEditor' : undefined;
}

function withReason(observation: Observation, detail: AdminMessageKey | undefined): Observation {
    return detail === undefined ? observation : { ...observation, detail };
}

/**
 * The fix, in turn: the custom roles, the role table, the build account's actAs then builder role (§75g), then the
 * Editor removals; a failed write stops it there, so the compute account never loses Editor before its builder role.
 */
const iam: ProvisionItemSpec = {
    id: 'iam',
    // Finding 31 of 2026-10-31: not `artifact-registry`, which only the optional imagery pipeline needs (it keeps its own binding).
    after: ['service-accounts', 'buckets', 'secrets', 'org-policies'],
    observe: async (context) => {
        const roles = await Promise.all(
            CUSTOM_ROLES.map(async (entry) => ({ entry, found: await context.clients.iam.getRole(context.project.projectId, entry.id) })),
        );
        const accounts = await defaultAccounts(context);
        const table = roleTable(context.project, conventionalAgents(context, accounts));
        const buildAccount = buildAccountBindings(context.project, accounts.compute);
        const granting = [...rolesLacking(roles), ...(await policiesLacking(context, table))];
        const build = await policiesLacking(context, buildAccount, 'build:');
        const editors = await editorsHeld(context, accounts);
        const lacks = [...granting, ...build, ...editors.map((binding) => `editor:${binding.member}`)];
        const observation = lacking(lacks, async () => {
            await fixRoles(context, roles);
            await bindAll(context, accounts);
            await bindEach(context, buildAccount);
            await dropEditors(context, editors);
        });
        return withReason(observation, iamReason(granting, build, editors));
    },
};

/** The repository's facts of a project that deploys from GitHub Actions (CR-M5-7: others have none). */
type ProjectGithub = NonNullable<ProvisionContext['project']['github']>;

const POOL_ID = 'github';
const PROVIDER_ID = 'site-master';
const ISSUER = 'https://token.actions.githubusercontent.com';

/** The provider's mapping and condition: only this repository's `master` branch, from the `deploy` environment (§23g). */
function providerSpec(github: ProjectGithub): JsonObject {
    const { ownerId, repoId, branch, environment } = github;
    return {
        displayName: 'GitHub master deploys',
        attributeMapping: {
            'google.subject': 'assertion.sub',
            'attribute.repository_id': 'assertion.repository_id',
            'attribute.repository_owner_id': 'assertion.repository_owner_id',
            'attribute.ref': 'assertion.ref',
        },
        attributeCondition: [
            `assertion.repository_owner_id=='${String(ownerId)}'`,
            `assertion.repository_id=='${String(repoId)}'`,
            `assertion.ref=='refs/heads/${branch}'`,
            `assertion.environment=='${environment}'`,
        ].join(' && '),
        oidc: { issuerUri: ISSUER },
    };
}

function poolName({ project }: ProvisionContext): string {
    return `projects/${project.projectNumber}/locations/global/workloadIdentityPools/${POOL_ID}`;
}

/** The repository's principal set: who may impersonate the deployer through the pool. */
function deployerBinding(context: ProvisionContext, github: ProjectGithub): WantedBinding {
    const member = `principalSet://iam.googleapis.com/${poolName(context)}/attribute.repository_id/${String(github.repoId)}`;
    return { role: 'roles/iam.workloadIdentityUser', member };
}

/** `create`, `undelete` or `update` for a pool or provider; nothing when it is active and right. */
function identityPart(resource: IdentityResource | undefined, prefix: string, matches: boolean): string[] {
    if (resource === undefined) {
        return [`${prefix}:create`];
    }
    if (resource.state === 'DELETED') {
        return [`${prefix}:undelete`, ...(matches ? [] : [`${prefix}:update`])];
    }
    return matches ? [] : [`${prefix}:update`];
}

/** The steps in the order they must run: the pool before its provider, both before the deployer's binding. */
const IDENTITY_STEP_ORDER = ['pool:create', 'pool:undelete', 'provider:create', 'provider:undelete', 'provider:update', 'binding'] as const;

const IDENTITY_STEPS: Readonly<
    Record<(typeof IDENTITY_STEP_ORDER)[number], (context: ProvisionContext, github: ProjectGithub) => Promise<unknown>>
> = {
    'pool:create': (context) =>
        context.clients.iam.createPool(context.project.projectNumber, POOL_ID, {
            displayName: 'GitHub Actions',
            description: 'Keyless deploys of the master branch',
        }),
    'pool:undelete': (context) => context.clients.iam.undelete(poolName(context)),
    'provider:create': (context, github) => context.clients.iam.createProvider(poolName(context), PROVIDER_ID, providerSpec(github)),
    'provider:undelete': (context) => context.clients.iam.undelete(`${poolName(context)}/providers/${PROVIDER_ID}`),
    'provider:update': (context, github) =>
        context.clients.iam.updateProvider(`${poolName(context)}/providers/${PROVIDER_ID}`, providerSpec(github), [
            'displayName',
            'attributeMapping',
            'attributeCondition',
            'oidc',
        ]),
    binding: (context, github) =>
        ensureBindings(context.clients.iam.serviceAccountPolicy(context.project.projectId, context.names.email('gh-deployer')), [
            deployerBinding(context, github),
        ]),
};

/** What the deploy job's repository variables are (§3.3 d): the provider's resource name and the deployer's address. */
function deployVariables(context: ProvisionContext): Readonly<Record<string, string>> {
    return { provider: `${poolName(context)}/providers/${PROVIDER_ID}`, serviceAccount: context.names.email('gh-deployer') };
}

const workloadIdentity: ProvisionItemSpec = {
    id: 'workload-identity',
    after: ['apis', 'service-accounts'],
    observe: async (context) => {
        const { github } = context.project;
        // CR-M5-7: a project deployed from the owner's browser or terminal has no GitHub Actions, so nothing to look for.
        return github === undefined ? ok() : observeIdentity(context, github);
    },
};

export const IAM_ITEMS: readonly ProvisionItemSpec[] = [iam, workloadIdentity];

async function observeIdentity(context: ProvisionContext, github: ProjectGithub): Promise<Observation> {
    const { iam: client } = context.clients;
    const pool = await client.getPool(context.project.projectNumber, POOL_ID);
    const provider = pool === undefined ? undefined : await client.getProvider(pool.name, PROVIDER_ID);
    const deployer = client.serviceAccountPolicy(context.project.projectId, context.names.email('gh-deployer'));
    const binding = await lackingBindings(deployer, [deployerBinding(context, github)]);
    const lacks = [
        ...identityPart(pool, 'pool', true),
        ...identityPart(provider, 'provider', matchesSpec(provider?.body, providerSpec(github))),
        ...(binding.length === 0 ? [] : ['binding']),
    ];
    const steps = IDENTITY_STEP_ORDER.filter((step) => lacks.includes(step));
    return lacking(lacks, () => eachInTurn(steps, (step) => IDENTITY_STEPS[step](context, github)), deployVariables(context));
}
