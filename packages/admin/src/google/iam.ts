import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { asRecord, at, records, stringAt, strings, type JsonObject } from './json.js';
import { createOnce, type GoogleCall, type GoogleTransport } from './transport.js';

/**
 * IAM v1 for the `service-accounts`, `iam` and `workload-identity` items (`docs/research/M2b-interfaces.md` §3.4):
 * service accounts and their own IAM policies, the project's custom roles (M4: the translation drafts' Vertex AI calls
 * only, instead of all of `roles/aiplatform.user`), and the Workload Identity Federation pool and provider the CI deploy
 * signs in through. A second create answers 409, which is success; a deleted pool, provider or custom role is undeleted,
 * never recreated (its id stays reserved).
 */

const IAM = 'https://iam.googleapis.com/v1';
const ROLE = 'roles/iam.serviceAccountAdmin';
const WIF_ROLE = 'roles/iam.workloadIdentityPoolAdmin';
const ROLE_ADMIN = 'roles/iam.roleAdmin';

/** A pool or a provider as Google answers it; `state` is `ACTIVE` or `DELETED`. */
export interface IdentityResource {
    readonly name: string;
    readonly state: string;
    readonly body: JsonObject;
}

/** A project's custom role as Google answers it (`deleted`: within the days it can still be undeleted). */
export interface CustomRole {
    readonly name: string;
    readonly includedPermissions: readonly string[];
    readonly deleted: boolean;
    readonly etag: string | undefined;
}

/** What a custom role is made with. */
export interface CustomRoleSpec {
    readonly title: string;
    readonly description: string;
    readonly includedPermissions: readonly string[];
}

export interface IamClient {
    /** The account ids (`fn-admin`) of the project's service accounts. */
    listServiceAccounts(projectId: string): Promise<string[]>;
    /**
     * Whether the account `email` exists in the project (a 404 is false). Finding 28 of 2026-10-31: the App Engine default
     * account, outside the project's own accounts' domain, is looked up by its address.
     */
    serviceAccountExists(projectId: string, email: string): Promise<boolean>;
    /** Creates the account; an existing one is success. */
    createServiceAccount(projectId: string, accountId: string, displayName: string): Promise<void>;
    serviceAccountPolicy(projectId: string, email: string): PolicyAccess;
    getPool(projectNumber: string, poolId: string): Promise<IdentityResource | undefined>;
    createPool(projectNumber: string, poolId: string, body: JsonObject): Promise<void>;
    getProvider(poolName: string, providerId: string): Promise<IdentityResource | undefined>;
    createProvider(poolName: string, providerId: string, body: JsonObject): Promise<void>;
    updateProvider(name: string, body: JsonObject, updateMask: readonly string[]): Promise<void>;
    /** Undeletes a pool or a provider by its resource name. */
    undelete(name: string): Promise<void>;
    /** The project's custom role `roleId`, or undefined when there is none. */
    getRole(projectId: string, roleId: string): Promise<CustomRole | undefined>;
    /** Creates the custom role; an existing one is success. */
    createRole(projectId: string, roleId: string, spec: CustomRoleSpec): Promise<void>;
    /** Sets the role's permissions (and undeletes it first when `deleted`). */
    repairRole(role: CustomRole, spec: CustomRoleSpec): Promise<void>;
}

/** `projects/<project>/roles/<role>`: how a binding names a project's custom role. */
export function customRoleName(projectId: string, roleId: string): string {
    return `projects/${projectId}/roles/${roleId}`;
}

/** `fn-admin@demo-hcm.iam.gserviceaccount.com` */
export function serviceAccountEmail(accountId: string, projectId: string): string {
    return `${accountId}@${projectId}.iam.gserviceaccount.com`;
}

function roleOf(body: unknown): CustomRole | undefined {
    const name = stringAt(body, 'name');
    return name === undefined
        ? undefined
        : {
              name,
              includedPermissions: strings(at(body, 'includedPermissions')),
              deleted: at(body, 'deleted') === true,
              etag: stringAt(body, 'etag'),
          };
}

/**
 * Undeletes a deleted role, then sets its permissions; the etag of each answer keeps the writes in order (an absent one
 * is left out of the JSON body, and Google then applies the write as it comes).
 */
async function repairRole(transport: GoogleTransport, role: CustomRole, spec: CustomRoleSpec): Promise<void> {
    let etag = role.etag;
    if (role.deleted) {
        const undeleted = await transport.call({
            operation: 'iam.roles.undelete',
            method: 'POST',
            url: `${IAM}/${role.name}:undelete`,
            body: { etag },
            role: ROLE_ADMIN,
        });
        etag = stringAt(undeleted, 'etag');
    }
    await transport.call({
        operation: 'iam.roles.patch',
        method: 'PATCH',
        url: `${IAM}/${role.name}`,
        query: { updateMask: 'includedPermissions' },
        body: { includedPermissions: spec.includedPermissions, etag },
        role: ROLE_ADMIN,
    });
}

function identityOf(body: unknown): IdentityResource | undefined {
    const name = stringAt(body, 'name');
    return name === undefined ? undefined : { name, state: stringAt(body, 'state') ?? 'ACTIVE', body: asRecord(body) };
}

/** Starts a long-running IAM call and waits for it. */
async function longRunning(transport: GoogleTransport, call: GoogleCall): Promise<void> {
    const request = { ...call, role: WIF_ROLE };
    const started = await transport.call(request);
    await transport.operation(IAM, started, request);
}

async function createServiceAccount(transport: GoogleTransport, projectId: string, accountId: string, displayName: string): Promise<void> {
    await createOnce(transport, {
        operation: 'iam.serviceAccounts.create',
        method: 'POST',
        url: `${IAM}/projects/${projectId}/serviceAccounts`,
        body: { accountId, serviceAccount: { displayName } },
        role: ROLE,
    });
}

function serviceAccountPolicy(transport: GoogleTransport, projectId: string, email: string): PolicyAccess {
    const resource = `${IAM}/projects/${projectId}/serviceAccounts/${email}`;
    return {
        read: async () =>
            parsePolicy(
                await transport.call({ operation: 'iam.serviceAccounts.getIamPolicy', method: 'POST', url: `${resource}:getIamPolicy` }),
            ),
        write: (policy) =>
            transport.call({
                operation: 'iam.serviceAccounts.setIamPolicy',
                method: 'POST',
                url: `${resource}:setIamPolicy`,
                body: { policy },
                role: ROLE,
            }),
    };
}

export function createIamClient(transport: GoogleTransport): IamClient {
    const pools = (projectNumber: string): string => `${IAM}/projects/${projectNumber}/locations/global/workloadIdentityPools`;
    return {
        listServiceAccounts: async (projectId) => {
            const accounts = await transport.pages(
                { operation: 'iam.serviceAccounts.list', url: `${IAM}/projects/${projectId}/serviceAccounts`, query: { pageSize: 100 } },
                'accounts',
            );
            return records(accounts).map((account) => String(account['email']).split('@', 1).join(''));
        },
        serviceAccountExists: async (projectId, email) =>
            (await transport.find({
                operation: 'iam.serviceAccounts.get',
                url: `${IAM}/projects/${projectId}/serviceAccounts/${email}`,
            })) !== undefined,
        createServiceAccount: (projectId, accountId, displayName) => createServiceAccount(transport, projectId, accountId, displayName),
        serviceAccountPolicy: (projectId, email) => serviceAccountPolicy(transport, projectId, email),
        getPool: async (projectNumber, poolId) =>
            identityOf(await transport.find({ operation: 'iam.workloadIdentityPools.get', url: `${pools(projectNumber)}/${poolId}` })),
        createPool: (projectNumber, poolId, body) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.create',
                method: 'POST',
                url: pools(projectNumber),
                query: { workloadIdentityPoolId: poolId },
                body,
            }),
        getProvider: async (poolName, providerId) =>
            identityOf(
                await transport.find({
                    operation: 'iam.workloadIdentityPools.providers.get',
                    url: `${IAM}/${poolName}/providers/${providerId}`,
                }),
            ),
        createProvider: (poolName, providerId, body) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.providers.create',
                method: 'POST',
                url: `${IAM}/${poolName}/providers`,
                query: { workloadIdentityPoolProviderId: providerId },
                body,
            }),
        updateProvider: (name, body, updateMask) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.providers.patch',
                method: 'PATCH',
                url: `${IAM}/${name}`,
                query: { updateMask: updateMask.join(',') },
                body,
            }),
        undelete: (name) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentity.undelete',
                method: 'POST',
                url: `${IAM}/${name}:undelete`,
                body: {},
            }),
        ...roleCalls(transport),
    };
}

/** The custom role calls of the client. */
function roleCalls(transport: GoogleTransport): Pick<IamClient, 'getRole' | 'createRole' | 'repairRole'> {
    return {
        getRole: async (projectId, roleId) =>
            roleOf(await transport.find({ operation: 'iam.roles.get', url: `${IAM}/${customRoleName(projectId, roleId)}` })),
        createRole: async (projectId, roleId, spec) => {
            await createOnce(transport, {
                operation: 'iam.roles.create',
                method: 'POST',
                url: `${IAM}/projects/${projectId}/roles`,
                body: { roleId, role: { ...spec, includedPermissions: [...spec.includedPermissions], stage: 'GA' } },
                role: ROLE_ADMIN,
            });
        },
        repairRole: (role, spec) => repairRole(transport, role, spec),
    };
}
