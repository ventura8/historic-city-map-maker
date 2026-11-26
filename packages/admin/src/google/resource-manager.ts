import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { at, isRecord, records, stringAt, strings } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Resource Manager v3 (the owner check of step (a), the project's parent for the `org-policies` item, the project IAM
 * policy of the `iam` item) and Org Policy v2's effective policies (`docs/research/M2b-interfaces.md` §3.3 a, §3.4).
 */

const RESOURCE_MANAGER = 'https://cloudresourcemanager.googleapis.com/v3';
const ORG_POLICY = 'https://orgpolicy.googleapis.com/v2';

interface ProjectInfo {
    readonly projectId: string;
    /** `projects/<number>` */
    readonly name: string;
    /** `organizations/<id>` or `folders/<id>`; absent for a project outside any organisation. */
    readonly parent?: string;
}

export interface ResourceManagerClient {
    getProject(projectId: string): Promise<ProjectInfo>;
    /** The subset of `permissions` the token's account holds on the project. */
    testPermissions(projectId: string, permissions: readonly string[]): Promise<string[]>;
    /** The project's IAM policy, read with `requestedPolicyVersion: 3`. */
    projectPolicy(projectId: string): PolicyAccess;
    /** Whether an organisation policy constraint (`iam.allowedPolicyMemberDomains`) is enforced on the project. */
    constraintEnforced(projectId: string, constraint: string): Promise<boolean>;
}

/** A list constraint restricts when a rule names values or denies all; a boolean one when a rule enforces it. */
function enforced(policy: unknown): boolean {
    return records(at(policy, 'spec', 'rules')).some(
        (rule) => rule['enforce'] === true || rule['denyAll'] === true || isRecord(rule['values']),
    );
}

export function createResourceManagerClient(transport: GoogleTransport): ResourceManagerClient {
    const project = (projectId: string): string => `${RESOURCE_MANAGER}/projects/${projectId}`;
    return {
        getProject: async (projectId) => {
            const body = await transport.call({ operation: 'resource-manager.getProject', url: project(projectId) });
            const parent = stringAt(body, 'parent');
            return {
                projectId: stringAt(body, 'projectId') ?? projectId,
                name: stringAt(body, 'name') ?? '',
                ...(parent === undefined || parent === '' ? {} : { parent }),
            };
        },
        testPermissions: async (projectId, permissions) => {
            const body = await transport.call({
                operation: 'resource-manager.testIamPermissions',
                method: 'POST',
                url: `${project(projectId)}:testIamPermissions`,
                body: { permissions },
            });
            return strings(at(body, 'permissions'));
        },
        projectPolicy: (projectId) => ({
            read: async () =>
                parsePolicy(
                    await transport.call({
                        operation: 'resource-manager.getIamPolicy',
                        method: 'POST',
                        url: `${project(projectId)}:getIamPolicy`,
                        body: { options: { requestedPolicyVersion: 3 } },
                    }),
                ),
            write: (policy) =>
                transport.call({
                    operation: 'resource-manager.setIamPolicy',
                    method: 'POST',
                    url: `${project(projectId)}:setIamPolicy`,
                    body: { policy },
                    role: 'roles/resourcemanager.projectIamAdmin',
                }),
        }),
        constraintEnforced: async (projectId, constraint) =>
            enforced(
                await transport.call({
                    operation: 'org-policy.getEffectivePolicy',
                    url: `${ORG_POLICY}/projects/${projectId}/policies/${constraint}:getEffectivePolicy`,
                    role: 'roles/orgpolicy.policyViewer',
                }),
            ),
    };
}
