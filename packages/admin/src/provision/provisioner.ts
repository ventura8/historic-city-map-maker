import { PROVISION_ITEMS, type Logger, type ProvisionItem, type ServiceState } from '@hcm/shared';

import type { GoogleClients } from '../google/clients.js';
import { failureMessage, googleFailureOf, type AdminMessageKey, type GoogleFailure } from '../google/failure.js';
import type { ApiWaits } from '../google/transport.js';
import type { Observation, OrgFindings, ProvisionContext, ProvisionItemSpec, WebAppIdentity } from './item.js';
import { ADMIN_SITE_ITEMS } from './items-admin-site.js';
import { CORE_ITEMS, readOrgFindings } from './items-core.js';
import { EXTRA_ITEMS } from './items-extra.js';
import { IAM_ITEMS } from './items-iam.js';
import { STORAGE_ITEMS } from './items-storage.js';
import { projectNames, type ProjectConfig } from './project-config.js';

/**
 * The Provision cloud step's engine (`docs/research/M2b-interfaces.md` §3.3 c, §3.4): a declarative list of items, each
 * observed, fixed when something lacks, and observed again. `planProvision` says which items a run touches (a retry
 * reruns only those that are not `ok`), `applyProvision` runs them in execution order, and `doctorProvision` only
 * observes (the dry run behind Re-check). A failing item marks itself and every item that depends on it (`pending`) and
 * the run goes on; a Google 401 stops the run where it is (the token is gone, §1.5), and a later run resumes, writing
 * nothing for what is already in place.
 */

/** The order the items run in (the screen order is `PROVISION_ITEMS`). */
export const PROVISION_ORDER: readonly ProvisionItem[] = [
    'apis',
    'org-policies',
    'service-accounts',
    'buckets',
    'artifact-registry',
    'bucket-cors',
    'bucket-lifecycle',
    'secrets',
    'iam',
    'budget-alerts',
    'workload-identity',
    'app-check',
    'crash-alerts',
    'api-key',
    'admin-site',
    'task-queues',
    'scheduler',
];

/** Every item by id (`provisioner.test.ts` pins that each of `PROVISION_ITEMS` has exactly one). */
const SPECS = Object.fromEntries(
    [...CORE_ITEMS, ...STORAGE_ITEMS, ...IAM_ITEMS, ...EXTRA_ITEMS, ...ADMIN_SITE_ITEMS].map((spec) => [spec.id, spec]),
) as Readonly<Record<ProvisionItem, ProvisionItemSpec>>;

/** One doctor line: what the card shows and `setup.recordCloud` records (no token, no address, no secret). */
export interface ProvisionItemResult {
    readonly id: ProvisionItem;
    readonly state: ServiceState;
    readonly detail?: AdminMessageKey;
    readonly params?: Readonly<Record<string, string>>;
}

export interface ProvisionReport {
    /** Every item the run reached, in screen order. */
    readonly items: readonly ProvisionItemResult[];
    /** A Google 401 stopped the run: the step asks for a new token and runs again (Continue, §1.5). */
    readonly stopped: boolean;
}

export interface ProvisionPlan {
    /** The items to run, in execution order. */
    readonly items: readonly ProvisionItem[];
}

export interface ProvisionDeps {
    readonly project: ProjectConfig;
    /** The web configuration's project and app (`/__/firebase/init.json`). */
    readonly web: WebAppIdentity & { readonly projectId: string };
    /** The owner's verified address (the crash e-mail channel only); null: `crash-alerts` waits. */
    readonly ownerEmail: string | null;
    readonly clients: GoogleClients;
    readonly log: Logger;
    /**
     * M6 (§1.5, finding 4): where the clients' transport reports an API Google is still switching on; the run says it on
     * the item it is running ("Waiting for Google to switch on {api}…") until the item settles.
     */
    readonly waits?: ApiWaits;
}

export type OnProvisionItem = (item: ProvisionItemResult) => void;

/**
 * The items a run touches, in execution order: those of `only` (every item when null) that a previous report did not
 * find `ok` (all of them without a report).
 */
export function planProvision(
    observed: readonly ProvisionItemResult[] | null,
    only: readonly ProvisionItem[] | null = null,
): ProvisionPlan {
    const okItems = new Set((observed ?? []).filter((item) => item.state === 'ok').map((item) => item.id));
    return { items: PROVISION_ORDER.filter((id) => (only ?? PROVISION_ORDER).includes(id) && !okItems.has(id)) };
}

/** The organisation findings, read on first use and kept for the run (a failed read is tried again by the next item). */
function context(deps: ProvisionDeps): ProvisionContext {
    let findings: Promise<OrgFindings> | undefined;
    return {
        project: deps.project,
        names: projectNames(deps.project),
        web: deps.web,
        ownerEmail: deps.ownerEmail,
        clients: deps.clients,
        findings: () => {
            findings ??= readOrgFindings({ clients: deps.clients, project: deps.project }).catch((error: unknown) => {
                findings = undefined;
                throw error;
            });
            return findings;
        },
    };
}

function result(id: ProvisionItem, observation: Observation): ProvisionItemResult {
    return {
        id,
        state: observation.state,
        ...(observation.detail === undefined ? {} : { detail: observation.detail }),
        ...(observation.params === undefined ? {} : { params: observation.params }),
    };
}

/** How a failed call leaves the item: an API still off is `missing`, a refusal `invalid`, an outage `unavailable`. */
function stateOfFailure(failure: GoogleFailure): ServiceState {
    if (failure.kind === 'forbidden' && failure.api !== undefined) {
        return 'missing';
    }
    return failure.kind === 'rateLimited' || failure.kind === 'unavailable' ? 'unavailable' : 'invalid';
}

function failedResult(id: ProvisionItem, error: unknown, log: Logger): ProvisionItemResult {
    const failure = googleFailureOf(error);
    if (failure === undefined) {
        log.error('provision item failed', { item: id, error: error instanceof Error ? error.name : 'unknown' });
        return { id, state: 'invalid', detail: 'apiError.internal' };
    }
    const message = failureMessage(failure);
    return { id, state: stateOfFailure(failure), detail: message.key, ...(message.params === undefined ? {} : { params: message.params }) };
}

function inScreenOrder(items: readonly ProvisionItemResult[]): ProvisionItemResult[] {
    return [...items].sort((left, right) => PROVISION_ITEMS.indexOf(left.id) - PROVISION_ITEMS.indexOf(right.id));
}

/** Every item `invalid` when the bundled `infra/project.json` names another project than the web configuration. */
function wrongProject(deps: ProvisionDeps, items: readonly ProvisionItem[]): ProvisionReport | undefined {
    if (deps.web.projectId === deps.project.projectId) {
        return undefined;
    }
    deps.log.error('provision refused: the build belongs to another project', { projectId: deps.project.projectId });
    const detail: AdminMessageKey = 'apiError.invalidRequest';
    return {
        items: inScreenOrder(items.map((id) => ({ id, state: 'invalid', detail, params: { projectId: deps.project.projectId } }))),
        stopped: false,
    };
}

interface RunState {
    readonly results: ProvisionItemResult[];
    /** Items that are not `ok` in this run: their dependants wait. */
    readonly notOk: Set<ProvisionItem>;
    stopped: boolean;
}

/** Observes the item; when it lacks something it can create, creates it and observes again. */
async function settle(spec: ProvisionItemSpec, run: ProvisionContext, fix: boolean): Promise<Observation> {
    const first = await spec.observe(run);
    if (!fix || first.fix === undefined) {
        return first;
    }
    await first.fix();
    return spec.observe(run);
}

async function runItem(
    spec: ProvisionItemSpec,
    run: ProvisionContext,
    state: RunState,
    deps: ProvisionDeps & { fix: boolean },
): Promise<ProvisionItemResult> {
    const blocker = deps.fix ? spec.after.find((id) => state.notOk.has(id)) : undefined;
    if (blocker !== undefined) {
        return { id: spec.id, state: 'pending', params: { item: blocker } };
    }
    try {
        return result(spec.id, await settle(spec, run, deps.fix));
    } catch (error) {
        state.stopped = googleFailureOf(error)?.kind === 'unauthorized';
        return failedResult(spec.id, error, deps.log);
    }
}

/** The line of an item whose call waits for an API Google is still switching on (it settles as usual afterwards). */
function waitingResult(id: ProvisionItem, api: string): ProvisionItemResult {
    return { id, state: 'pending', detail: 'adminSetup.provision.apiWaiting', params: { api } };
}

async function runItems(deps: ProvisionDeps, items: readonly ProvisionItem[], onItem: OnProvisionItem, fix: boolean): Promise<RunState> {
    const runContext = context(deps);
    const state: RunState = { results: [], notOk: new Set(), stopped: false };
    for (const id of PROVISION_ORDER.filter((item) => items.includes(item))) {
        if (state.stopped) {
            break;
        }
        deps.waits?.listen((api) => {
            onItem(waitingResult(id, api));
        });
        const itemResult = await runItem(SPECS[id], runContext, state, { ...deps, fix });
        state.results.push(itemResult);
        if (itemResult.state !== 'ok') {
            state.notOk.add(id);
        }
        onItem(itemResult);
    }
    return state;
}

async function run(deps: ProvisionDeps, items: readonly ProvisionItem[], onItem: OnProvisionItem, fix: boolean): Promise<ProvisionReport> {
    const refusedRun = wrongProject(deps, items);
    if (refusedRun !== undefined) {
        refusedRun.items.forEach(onItem);
        return refusedRun;
    }
    try {
        const state = await runItems(deps, items, onItem, fix);
        return { items: inScreenOrder(state.results), stopped: state.stopped };
    } finally {
        deps.waits?.listen(undefined);
    }
}

/** Runs the plan: each item observed, fixed when it lacks something, observed again; `onItem` hears each as it settles. */
export function applyProvision(
    plan: ProvisionPlan,
    deps: ProvisionDeps,
    onItem: OnProvisionItem = () => undefined,
): Promise<ProvisionReport> {
    return run(deps, plan.items, onItem, true);
}

/** The read-only doctor over `only` (every item when null): observations only, nothing written. */
export function doctorProvision(
    deps: ProvisionDeps,
    only: readonly ProvisionItem[] | null = null,
    onItem: OnProvisionItem = () => undefined,
): Promise<ProvisionReport> {
    return run(deps, only ?? PROVISION_ORDER, onItem, false);
}
