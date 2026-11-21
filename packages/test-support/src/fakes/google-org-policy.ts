import { fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { authenticated, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { E2E_ORGANIZATION, type ResourceManagerState } from './google-identity.js';
import type { CloudStorageState } from './google-storage.js';
import { route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Org Policy v2's effective policies for the `org-policies` doctor item (`docs/research/M2b-interfaces.md` §3.4.2): the
 * same organisation the other fakes play. `iam.allowedPolicyMemberDomains` is restricted when Resource Manager's
 * domain-restricted sharing is on, `storage.publicAccessPrevention` when Cloud Storage's public access prevention is,
 * and `iam.automaticIamGrantsForDefaultServiceAccounts` with the scenario `noDefaultGrants`. Nothing is enforced on a
 * project outside an organisation (the default).
 */

export interface OrgPolicyState {
    /** `iam.automaticIamGrantsForDefaultServiceAccounts` is enforced: the compute default account gets no Editor role. */
    noDefaultGrants: boolean;
}

const ORG_POLICY: GoogleApi = { service: 'orgpolicy.googleapis.com', title: 'Organization Policy API', permission: 'orgpolicy.policy.get' };

/** The fake Org Policy API. */
export function createOrgPolicyFake(
    state: OrgPolicyState,
    resourceManager: ResourceManagerState,
    storage: CloudStorageState,
    projects: GoogleProjects,
): ServiceFake {
    const enforced: Readonly<Record<string, () => FixtureName | undefined>> = {
        'iam.allowedPolicyMemberDomains': () =>
            resourceManager.allowedMemberDomains === undefined ? undefined : 'org-policy/effective-policy.list-restricted',
        'storage.publicAccessPrevention': () =>
            storage.publicAccessPrevented ? 'org-policy/effective-policy.boolean-enforced' : undefined,
        'iam.automaticIamGrantsForDefaultServiceAccounts': () =>
            state.noDefaultGrants ? 'org-policy/effective-policy.boolean-enforced' : undefined,
    };
    const effective: Route['answer'] = (_request, params) => {
        const constraint = String(params['constraint']);
        const values = { projectNumber: projects.resolve(String(params['project'])).number, constraint };
        return fixtureResponse(enforced[constraint]?.() ?? 'org-policy/effective-policy.not-enforced', { values });
    };
    return {
        name: 'org-policy',
        routes: [
            route(
                'GET',
                'https://orgpolicy.googleapis.com/v2/projects/{project}/policies/{constraint}:getEffectivePolicy',
                'org-policy.getEffectivePolicy',
                authenticated(ORG_POLICY, effective),
            ),
        ],
        failure: (mode) => googleFailure(ORG_POLICY, mode),
        scenarios: {
            noDefaultGrants: () => {
                state.noDefaultGrants = true;
                resourceManager.parent = E2E_ORGANIZATION;
            },
            publicAccessPrevented: () => {
                storage.publicAccessPrevented = true;
                resourceManager.parent = E2E_ORGANIZATION;
            },
        },
        snapshot: () => ({ noDefaultGrants: state.noDefaultGrants }),
    };
}
