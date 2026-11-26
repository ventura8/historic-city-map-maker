import type { Logger, ProvisionItem } from '@hcm/shared';

import type { MeasurementReports } from '../google/analytics-reports.js';
import { createGoogleClients, type GoogleClients } from '../google/clients.js';
import { GoogleApiError } from '../google/failure.js';
import { deploymentStatus } from '../google/functions.js';
import { createApiWaits, withApiPropagation, type ApiWaits } from '../google/transport.js';
import { findCrashPolicy } from './items-extra.js';
import type { WebAppIdentity } from './item.js';
import type { ProjectConfig } from './project-config.js';
import { applyProvision, doctorProvision, planProvision, type OnProvisionItem, type ProvisionItemResult } from './provisioner.js';

/**
 * The Setup Assistant's Google Cloud port (setup-ui's `SetupCloud`, `packages/admin/src/setup/ports.ts`) over the typed
 * clients and the provisioner: each call builds its clients around the access token it is given (memory only, never
 * kept here), so a renewed token is used as soon as the step passes it. Every failure is a `GoogleApiError` whose
 * `kind`, `role`, `api` and `constraint` the step reads (`docs/research/M2b-interfaces.md` §3.3 b–d, g; §3.4).
 */

/** The part of a Google access the clients need. */
interface TokenAccess {
    readonly token: string;
}

export interface SetupCloudDeps {
    readonly fetch: typeof fetch;
    readonly sleep: (ms: number) => Promise<void>;
    readonly log: Logger;
    /** `infra/project.json`, bundled. */
    readonly project: ProjectConfig;
    /** The web configuration's project and app. */
    readonly web: WebAppIdentity & { readonly projectId: string };
    /** The signed-in owner's verified address (the crash e-mail channel only). */
    readonly ownerEmail: () => string | null;
}

interface CloudBillingAccount {
    readonly name: string;
    readonly displayName: string;
    readonly currency: string;
}

export interface SetupCloudAdapter {
    disabledApis(access: TokenAccess, apis: readonly string[]): Promise<readonly string[]>;
    enableApis(access: TokenAccess, apis: readonly string[]): Promise<void>;
    observeBilling(
        access: TokenAccess,
    ): Promise<{ readonly linkedAccount: string | null; readonly accounts: readonly CloudBillingAccount[] }>;
    linkBilling(access: TokenAccess, accountName: string): Promise<void>;
    ensureBudget(
        access: TokenAccess,
        budget: { readonly accountName: string; readonly amount: number; readonly currency: string },
    ): Promise<{ readonly budgetId: string }>;
    provision(access: TokenAccess, only: readonly ProvisionItem[] | null, onItem: OnProvisionItem): Promise<readonly ProvisionItemResult[]>;
    doctor(access: TokenAccess, only: readonly ProvisionItem[] | null, onItem: OnProvisionItem): Promise<readonly ProvisionItemResult[]>;
    deployment(access: TokenAccess): Promise<{ readonly ready: number; readonly total: number; readonly failed: readonly string[] }>;
    disablePageChanges(access: TokenAccess): Promise<{ readonly pageChangesEnabled: boolean }>;
    setCrashAlerts(access: TokenAccess, enabled: boolean): Promise<{ readonly enabled: boolean }>;
    /** §76f: the field measurements' custom definitions on the GA4 property of `measurementId` (null: no such property). */
    createMeasurementReports(access: TokenAccess, measurementId: string): Promise<MeasurementReports | null>;
}

function notFound(operation: string): GoogleApiError {
    return new GoogleApiError(operation, { kind: 'notFound', status: 404 });
}

async function observeBilling(clients: GoogleClients, projectId: string): ReturnType<SetupCloudAdapter['observeBilling']> {
    const [info, accounts] = await Promise.all([clients.billing.getBillingInfo(projectId), clients.billing.listAccounts()]);
    return {
        linkedAccount: info.billingEnabled && info.billingAccountName !== undefined ? info.billingAccountName : null,
        accounts: accounts
            .filter((account) => account.open)
            .map((account) => ({ name: account.name, displayName: account.displayName, currency: account.currencyCode })),
    };
}

async function disablePageChanges(clients: GoogleClients, deps: SetupCloudDeps): Promise<{ readonly pageChangesEnabled: boolean }> {
    const stream = await clients.analytics.findStream(deps.project.projectId, deps.web.appId);
    if (stream === undefined) {
        throw notFound('firebase-management.getAnalyticsDetails');
    }
    return { pageChangesEnabled: await clients.analytics.disablePageChanges(stream) };
}

async function setCrashAlerts(clients: GoogleClients, projectId: string, enabled: boolean): Promise<{ readonly enabled: boolean }> {
    const policy = await findCrashPolicy(clients, projectId);
    if (policy === undefined) {
        throw notFound('monitoring.alertPolicies.list');
    }
    return { enabled: (await clients.monitoring.patchAlertPolicy(policy.name, { enabled }, ['enabled'])).enabled };
}

export function createSetupCloud(deps: SetupCloudDeps): SetupCloudAdapter {
    const { project } = deps;
    // M6 (§1.5, finding 4): every client waits out an API Google is still switching on in the project.
    const clientsFor = (access: TokenAccess, waits: ApiWaits = createApiWaits()): GoogleClients =>
        createGoogleClients(
            withApiPropagation(
                { fetch: deps.fetch, token: () => access.token, sleep: deps.sleep, log: deps.log },
                project.projectNumber,
                waits,
            ),
        );
    const provisionDeps = (access: TokenAccess): Parameters<typeof applyProvision>[1] => {
        const waits = createApiWaits();
        return { project, web: deps.web, ownerEmail: deps.ownerEmail(), clients: clientsFor(access, waits), log: deps.log, waits };
    };
    return {
        disabledApis: async (access, apis) => {
            const enabled = new Set(await clientsFor(access).serviceUsage.listEnabled(project.projectNumber));
            return apis.filter((api) => !enabled.has(api));
        },
        enableApis: (access, apis) => clientsFor(access).serviceUsage.enable(project.projectNumber, apis),
        observeBilling: (access) => observeBilling(clientsFor(access), project.projectId),
        linkBilling: async (access, accountName) => {
            await clientsFor(access).billing.linkBilling(project.projectId, accountName);
        },
        ensureBudget: async (access, budget) => {
            const ensured = await clientsFor(access).billing.ensureBudget(budget.accountName, {
                projectId: project.projectId,
                projectNumber: project.projectNumber,
                currencyCode: budget.currency,
                units: budget.amount,
            });
            return { budgetId: ensured.name };
        },
        provision: async (access, only, onItem) => (await applyProvision(planProvision(null, only), provisionDeps(access), onItem)).items,
        doctor: async (access, only, onItem) => (await doctorProvision(provisionDeps(access), only, onItem)).items,
        deployment: async (access) => {
            const status = deploymentStatus(await clientsFor(access).functions.list(project.projectId, project.region));
            return { ready: status.ready, total: status.total, failed: status.failed };
        },
        disablePageChanges: (access) => disablePageChanges(clientsFor(access), deps),
        setCrashAlerts: (access, enabled) => setCrashAlerts(clientsFor(access), project.projectId, enabled),
        // §76f: a lazy chunk (`analytics-reports`), fetched on the button's click only.
        createMeasurementReports: async (access, measurementId) =>
            (await import('../google/analytics-reports.js')).createMeasurementReports(
                { fetch: deps.fetch, token: () => access.token, sleep: deps.sleep, log: deps.log },
                measurementId,
            ),
    };
}
