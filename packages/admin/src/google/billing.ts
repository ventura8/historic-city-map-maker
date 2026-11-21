import { asRecord, at, matchesSpec, records, stringAt, type JsonObject } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Billing v1 and the Budget API v1 for step (b) and the `budget-alerts` item (`docs/research/M2b-interfaces.md`
 * §3.3 b, §3.4): the open billing accounts, the project's billing link (Blaze), and the monthly budget found by its
 * display name `historic-city-map <projectId>`, created or patched to the spec (idempotent).
 */

const BILLING = 'https://cloudbilling.googleapis.com/v1';
const BUDGETS = 'https://billingbudgets.googleapis.com/v1';

interface BillingAccount {
    /** `billingAccounts/0E2E00-0E2E00-0E2E01` */
    readonly name: string;
    readonly open: boolean;
    /** Shown in the choice only; never recorded (§3.2). */
    readonly displayName: string;
    readonly currencyCode: string;
}

interface BillingInfo {
    readonly billingEnabled: boolean;
    /** The linked account's name; absent when none is linked. */
    readonly billingAccountName?: string;
}

export interface Budget {
    /** `billingAccounts/<account>/budgets/<id>` */
    readonly name: string;
    readonly displayName: string;
    /** The whole budget as Google answered it. */
    readonly body: JsonObject;
}

/** What the budget spec needs: the amount is chosen by the card (`BUDGET_AMOUNTS`, setup-ui) in the account's currency. */
export interface BudgetTarget {
    readonly projectId: string;
    readonly projectNumber: string;
    readonly currencyCode: string;
    readonly units: number;
}

export interface BillingClient {
    listAccounts(): Promise<BillingAccount[]>;
    getBillingInfo(projectId: string): Promise<BillingInfo>;
    /** Links the account (the project is on Blaze). A 403 names `roles/billing.user`. */
    linkBilling(projectId: string, accountName: string): Promise<BillingInfo>;
    listBudgets(accountName: string): Promise<Budget[]>;
    /** The budget named for the project, or undefined. */
    findBudget(accountName: string, projectId: string): Promise<Budget | undefined>;
    /** Creates the budget, or patches it to the spec when it differs; resolves to its name and whether anything was written. */
    ensureBudget(accountName: string, target: BudgetTarget): Promise<{ readonly name: string; readonly written: boolean }>;
    /** Points the budget's notifications at a Pub/Sub topic (`projects/<id>/topics/budget`, item `budget-alerts`). */
    setBudgetTopic(budget: Budget, topic: string): Promise<boolean>;
}

const BUDGET_ROLE = 'roles/billing.costsManager';

/** The budget's display name: how step (b) and the `budget-alerts` item find it again. */
export function budgetDisplayName(projectId: string): string {
    return `historic-city-map ${projectId}`;
}

/** The budget spec of §3.3 b: this project, monthly, 50/90/100 % of current spend and 100 % forecast, e-mails to billing admins. */
export function budgetSpec(target: BudgetTarget): JsonObject {
    return {
        displayName: budgetDisplayName(target.projectId),
        budgetFilter: { projects: [`projects/${target.projectNumber}`], calendarPeriod: 'MONTH' },
        amount: { specifiedAmount: { currencyCode: target.currencyCode, units: String(target.units) } },
        thresholdRules: [
            { thresholdPercent: 0.5, spendBasis: 'CURRENT_SPEND' },
            { thresholdPercent: 0.9, spendBasis: 'CURRENT_SPEND' },
            { thresholdPercent: 1, spendBasis: 'CURRENT_SPEND' },
            { thresholdPercent: 1, spendBasis: 'FORECASTED_SPEND' },
        ],
        notificationsRule: { disableDefaultIamRecipients: false },
    };
}

const SPEC_FIELDS = ['budgetFilter', 'amount', 'thresholdRules'] as const;

/** The spec fields the budget differs in (the notification rule is the `budget-alerts` item's). */
function differingFields(budget: JsonObject, spec: JsonObject): string[] {
    return SPEC_FIELDS.filter((field) => !matchesSpec(budget[field], spec[field]));
}

function accountOf(item: JsonObject): BillingAccount {
    return {
        name: String(item['name']),
        open: item['open'] === true,
        displayName: typeof item['displayName'] === 'string' ? item['displayName'] : '',
        currencyCode: typeof item['currencyCode'] === 'string' ? item['currencyCode'] : 'USD',
    };
}

function billingInfoOf(body: unknown): BillingInfo {
    const account = stringAt(body, 'billingAccountName') ?? '';
    return { billingEnabled: at(body, 'billingEnabled') === true, ...(account === '' ? {} : { billingAccountName: account }) };
}

function budgetOf(item: JsonObject): Budget {
    return { name: String(item['name']), displayName: typeof item['displayName'] === 'string' ? item['displayName'] : '', body: item };
}

async function listBudgets(transport: GoogleTransport, accountName: string): Promise<Budget[]> {
    const items = await transport.pages(
        { operation: 'billing-budgets.list', url: `${BUDGETS}/${accountName}/budgets`, role: BUDGET_ROLE },
        'budgets',
    );
    return records(items).map(budgetOf);
}

async function findBudget(transport: GoogleTransport, accountName: string, projectId: string): Promise<Budget | undefined> {
    return (await listBudgets(transport, accountName)).find((budget) => budget.displayName === budgetDisplayName(projectId));
}

function patchBudget(transport: GoogleTransport, name: string, body: JsonObject, updateMask: readonly string[]): Promise<unknown> {
    return transport.call({
        operation: 'billing-budgets.patch',
        method: 'PATCH',
        url: `${BUDGETS}/${name}`,
        query: { updateMask: updateMask.join(',') },
        body,
        role: BUDGET_ROLE,
    });
}

async function ensureBudget(
    transport: GoogleTransport,
    accountName: string,
    target: BudgetTarget,
): Promise<{ readonly name: string; readonly written: boolean }> {
    const spec = budgetSpec(target);
    const existing = await findBudget(transport, accountName, target.projectId);
    if (existing === undefined) {
        const created = await transport.call({
            operation: 'billing-budgets.create',
            method: 'POST',
            url: `${BUDGETS}/${accountName}/budgets`,
            body: spec,
            role: BUDGET_ROLE,
        });
        return { name: stringAt(created, 'name') ?? '', written: true };
    }
    const fields = differingFields(existing.body, spec);
    if (fields.length > 0) {
        await patchBudget(transport, existing.name, spec, fields);
    }
    return { name: existing.name, written: fields.length > 0 };
}

async function setBudgetTopic(transport: GoogleTransport, budget: Budget, topic: string): Promise<boolean> {
    const wanted = { pubsubTopic: topic, schemaVersion: '1.0' };
    const current = at(budget.body, 'notificationsRule');
    if (matchesSpec(current, wanted)) {
        return false;
    }
    const rule = { ...asRecord(current), ...wanted };
    await patchBudget(transport, budget.name, { notificationsRule: rule }, [
        'notificationsRule.pubsubTopic',
        'notificationsRule.schemaVersion',
    ]);
    return true;
}

export function createBillingClient(transport: GoogleTransport): BillingClient {
    return {
        listAccounts: async () =>
            records(
                await transport.pages({ operation: 'cloud-billing.listAccounts', url: `${BILLING}/billingAccounts` }, 'billingAccounts'),
            ).map(accountOf),
        getBillingInfo: async (projectId) =>
            billingInfoOf(
                await transport.call({ operation: 'cloud-billing.getBillingInfo', url: `${BILLING}/projects/${projectId}/billingInfo` }),
            ),
        linkBilling: async (projectId, accountName) =>
            billingInfoOf(
                await transport.call({
                    operation: 'cloud-billing.updateBillingInfo',
                    method: 'PUT',
                    url: `${BILLING}/projects/${projectId}/billingInfo`,
                    body: { billingAccountName: accountName },
                    role: 'roles/billing.user',
                }),
            ),
        listBudgets: (accountName) => listBudgets(transport, accountName),
        findBudget: (accountName, projectId) => findBudget(transport, accountName, projectId),
        ensureBudget: (accountName, target) => ensureBudget(transport, accountName, target),
        setBudgetTopic: (budget, topic) => setBudgetTopic(transport, budget, topic),
    };
}
