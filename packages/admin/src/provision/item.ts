import type { ProvisionItem, ServiceState } from '@hcm/shared';

import type { GoogleClients } from '../google/clients.js';
import type { AdminMessageKey } from '../google/failure.js';
import type { ProjectConfig, ProjectNames } from './project-config.js';

/**
 * The shape every doctor item shares (`docs/research/M2b-interfaces.md` §3.4): `observe` reads what exists and says
 * what is lacking, with the `fix` that creates or patches exactly that from what it read (idempotent: a create
 * answering 409 is success, a policy is merged with its etag); after a fix a second observation verifies it. The doctor
 * observes only. Items never hold a token; they get typed clients.
 */

/** What the organisation's effective policies decide for later items (`org-policies`, §3.4.2). */
export interface OrgFindings {
    /** The project has a parent organisation or folder. */
    readonly organization: boolean;
    /** `iam.allowedPolicyMemberDomains`: `allUsers` is refused (no public bucket read, no public invoker). */
    readonly domainRestricted: boolean;
    /** `storage.publicAccessPrevention`: the public bucket cannot be public. */
    readonly publicAccessPrevention: boolean;
    /** `iam.automaticIamGrantsForDefaultServiceAccounts`: the compute default account has no Editor role. */
    readonly noDefaultGrants: boolean;
}

/** The web app's public identifiers from the web configuration (`/__/firebase/init.json`). */
export interface WebAppIdentity {
    readonly appId: string;
    readonly apiKey: string;
}

export interface ProvisionContext {
    readonly project: ProjectConfig;
    readonly names: ProjectNames;
    readonly web: WebAppIdentity;
    /** The signed-in owner's verified address, for the crash e-mail channel only; null: `crash-alerts` waits. */
    readonly ownerEmail: string | null;
    readonly clients: GoogleClients;
    /** The organisation findings, read once per run. */
    findings(): Promise<OrgFindings>;
}

export interface Observation {
    readonly state: ServiceState;
    /** What `fix` creates or patches (API names, account ids, bucket names, parts); empty when nothing. */
    readonly lacks: readonly string[];
    readonly detail?: AdminMessageKey;
    readonly params?: Readonly<Record<string, string>>;
    /** Present when the item is `missing` and the provisioner can create what lacks. */
    readonly fix?: () => Promise<void>;
}

export interface ProvisionItemSpec {
    readonly id: ProvisionItem;
    /** Items that must be `ok` first; a failed one leaves this item `pending` in the same run. */
    readonly after: readonly ProvisionItem[];
    observe(context: ProvisionContext): Promise<Observation>;
}

export function ok(params?: Readonly<Record<string, string>>): Observation {
    return params === undefined ? { state: 'ok', lacks: [] } : { state: 'ok', lacks: [], params };
}

/** `ok` when nothing lacks, else `missing` with the list and the fix for it. */
export function lacking(lacks: readonly string[], fix: () => Promise<unknown>, params?: Readonly<Record<string, string>>): Observation {
    return lacks.length === 0
        ? ok(params)
        : {
              state: 'missing',
              lacks,
              fix: async () => {
                  await fix();
              },
          };
}

export function waiting(detail?: AdminMessageKey, params?: Readonly<Record<string, string>>): Observation {
    return { state: 'pending', lacks: [], ...(detail === undefined ? {} : { detail }), ...(params === undefined ? {} : { params }) };
}

export function refused(detail: AdminMessageKey, params?: Readonly<Record<string, string>>): Observation {
    return { state: 'invalid', lacks: [], detail, ...(params === undefined ? {} : { params }) };
}

/** Runs `step` for each entry, one after the other (Google's write quotas prefer sequential calls). */
export async function eachInTurn<T>(entries: readonly T[], step: (entry: T) => Promise<unknown>): Promise<void> {
    for (const entry of entries) {
        await step(entry);
    }
}
