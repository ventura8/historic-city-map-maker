import { deployedName, MANIFEST_QUEUE } from '@hcm/shared';

import { isGoogleFailure } from '../google/failure.js';
import { deploymentStatus } from '../google/functions.js';
import { eachInTurn, lacking, ok, refused, waiting, type OrgFindings, type ProvisionContext, type ProvisionItemSpec } from './item.js';
import { serviceAccountIdsOf, SERVICE_ACCOUNTS } from './project-config.js';
import { REQUIRED_APIS, SECRET_IDS } from './resources.js';

/**
 * The provisioner's plain items (`docs/research/M2b-interfaces.md` §3.4): the APIs, the organisation policies (read
 * only), the service accounts, the secret shells, the manifest queue, and the Scheduler job the first deploy creates.
 */

const ORG_CONSTRAINTS = [
    'iam.allowedPolicyMemberDomains',
    'storage.publicAccessPrevention',
    'iam.automaticIamGrantsForDefaultServiceAccounts',
] as const;

const NO_ORGANIZATION: OrgFindings = {
    organization: false,
    domainRestricted: false,
    publicAccessPrevention: false,
    noDefaultGrants: false,
};

/** Reads the project's parent and, inside an organisation, the three effective policies that steer later items. */
export async function readOrgFindings(context: Pick<ProvisionContext, 'clients' | 'project'>): Promise<OrgFindings> {
    const { resourceManager } = context.clients;
    const project = await resourceManager.getProject(context.project.projectId);
    if (project.parent === undefined) {
        return NO_ORGANIZATION;
    }
    const [domainRestricted, publicAccessPrevention, noDefaultGrants] = await Promise.all(
        ORG_CONSTRAINTS.map((constraint) => resourceManager.constraintEnforced(context.project.projectId, constraint)),
    );
    return {
        organization: true,
        domainRestricted: domainRestricted === true,
        publicAccessPrevention: publicAccessPrevention === true,
        noDefaultGrants: noDefaultGrants === true,
    };
}

/** The enforced constraints by name, for the doctor's line. */
function enforcedConstraints(findings: OrgFindings): string[] {
    const flags = [findings.domainRestricted, findings.publicAccessPrevention, findings.noDefaultGrants];
    return ORG_CONSTRAINTS.filter((_constraint, index) => flags[index]);
}

const apis: ProvisionItemSpec = {
    id: 'apis',
    after: [],
    observe: async ({ clients, project }) => {
        const enabled = new Set(await clients.serviceUsage.listEnabled(project.projectNumber));
        const missing = REQUIRED_APIS.filter((api) => !enabled.has(api));
        return lacking(missing, () => clients.serviceUsage.enable(project.projectNumber, missing));
    },
};

const orgPolicies: ProvisionItemSpec = {
    id: 'org-policies',
    after: ['apis'],
    observe: async (context) => {
        const enforced = enforcedConstraints(await context.findings());
        return ok(enforced.length === 0 ? undefined : { enforced: enforced.join(', ') });
    },
};

const serviceAccounts: ProvisionItemSpec = {
    id: 'service-accounts',
    after: ['apis'],
    observe: async ({ clients, project }) => {
        const existing = new Set(await clients.iam.listServiceAccounts(project.projectId));
        const missing = serviceAccountIdsOf(project).filter((account) => !existing.has(account));
        return lacking(missing, () =>
            eachInTurn(missing, (account) => clients.iam.createServiceAccount(project.projectId, account, SERVICE_ACCOUNTS[account])),
        );
    },
};

const secrets: ProvisionItemSpec = {
    id: 'secrets',
    after: ['apis'],
    observe: async ({ clients, project }) => {
        const present = await Promise.all(SECRET_IDS.map((secret) => clients.secretManager.exists(project.projectId, secret)));
        const missing = SECRET_IDS.filter((_secret, index) => !present[index]);
        return lacking(missing, () => eachInTurn(missing, (secret) => clients.secretManager.create(project.projectId, secret)));
    },
};

const taskQueues: ProvisionItemSpec = {
    id: 'task-queues',
    after: ['apis'],
    observe: async ({ clients, project }) => {
        const exists = await clients.queues.queueExists(project.projectId, project.region, MANIFEST_QUEUE);
        return lacking(exists ? [] : [MANIFEST_QUEUE], () => clients.queues.createQueue(project.projectId, project.region, MANIFEST_QUEUE));
    },
};

/** True once every registry function is `ACTIVE`; a project whose Cloud Functions API is off has deployed nothing. */
async function serverDeployed({ clients, project }: ProvisionContext): Promise<boolean> {
    try {
        return deploymentStatus(await clients.functions.list(project.projectId, project.region)).state === 'ok';
    } catch (error) {
        if (isGoogleFailure(error, 'forbidden') && error.api !== undefined) {
            return false;
        }
        throw error;
    }
}

/** The job firebase-tools creates for `ops.tick`: `firebase-schedule-ops-tick-<region>`, targeting the function. */
function isOpsTickJob(job: { readonly name: string; readonly uri?: string }, region: string): boolean {
    const id = deployedName('ops.tick');
    return job.name.endsWith(`/jobs/firebase-schedule-${id}-${region}`) || (job.uri ?? '').includes(id);
}

const scheduler: ProvisionItemSpec = {
    id: 'scheduler',
    after: ['apis'],
    observe: async (context) => {
        const { clients, project } = context;
        const jobs = await clients.queues.listSchedulerJobs(project.projectId, project.region);
        if (jobs.some((job) => isOpsTickJob(job, project.region))) {
            return ok();
        }
        return (await serverDeployed(context)) ? refused('apiError.notFound') : waiting('adminSetup.provision.afterDeploy');
    },
};

export const CORE_ITEMS: readonly ProvisionItemSpec[] = [apis, orgPolicies, serviceAccounts, secrets, taskQueues, scheduler];
