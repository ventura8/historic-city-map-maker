import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { applyMask, bodyField, jsonResponse, requestObject, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Billing v1 and Billing Budgets v1, as the admin's browser calls them with the admin's own token (PLAN Addendum 1,
 * scenario A04): the billing accounts the caller sees, a project's billing info, linking an account (Blaze), and the
 * $5 budget. A fresh project has one open account it is not linked to.
 */

interface BillingAccount {
    /** `0E2E00-0E2E00-0E2E01` */
    readonly id: string;
    readonly displayName: string;
    open: boolean;
    /** USD unless stated. */
    readonly currencyCode?: string;
}

export interface BillingState {
    readonly accounts: BillingAccount[];
    /** Project id → the linked account's resource name (`billingAccounts/…`). */
    readonly links: Map<string, string>;
    /** `PUT billingInfo` answers 403: the caller is not a Billing Account User of the account. */
    linkForbidden: boolean;
    /** Account id → its budgets (the fixture's shape, with the request's fields). */
    readonly budgets: Map<string, Readonly<Record<string, unknown>>[]>;
    /** `PUT billingInfo` answers 400 with a `QuotaFailure`: the account has as many projects as it may (S-A04-BAD-BILLING-QUOTA). */
    quotaExceeded: boolean;
    /** Budget writes answer 403: the caller lacks `roles/billing.costsManager` (S-A04-BAD-BUDGET-PERMISSION). */
    budgetsForbidden: boolean;
}

const DEFAULT_ACCOUNT = String(FIXTURE_VALUES['billingAccountId']);

export function defaultBillingState(): BillingState {
    return {
        accounts: [{ id: DEFAULT_ACCOUNT, displayName: 'My Billing Account', open: true }],
        links: new Map(),
        linkForbidden: false,
        budgets: new Map(),
        quotaExceeded: false,
        budgetsForbidden: false,
    };
}

/** The second open account of `severalAccounts` (S-A04-BAD-SEVERAL-ACCOUNTS), billed in euros. */
const SECOND_ACCOUNT = '0E2E00-0E2E00-0E2E02';

const BILLING: GoogleApi = {
    service: 'cloudbilling.googleapis.com',
    title: 'Cloud Billing API',
    permission: 'billing.resourceAssociations.create',
};
const BUDGETS: GoogleApi = {
    service: 'billingbudgets.googleapis.com',
    title: 'Cloud Billing Budget API',
    permission: 'billing.budgets.create',
};

/** Whether `projectId` is on Blaze: linked to an open account. */
export function billingEnabled(state: BillingState, projectId: string): boolean {
    const linked = state.links.get(projectId);
    return state.accounts.some((account) => `billingAccounts/${account.id}` === linked && account.open);
}

function accountBody(account: BillingAccount): Record<string, unknown> {
    return {
        name: `billingAccounts/${account.id}`,
        open: account.open,
        displayName: account.displayName,
        masterBillingAccount: '',
        currencyCode: account.currencyCode ?? 'USD',
    };
}

/** The fake Cloud Billing API. */
export function createCloudBillingFake(state: BillingState, projects: GoogleProjects): ServiceFake {
    const billingInfo = (projectSegment: string): Response => {
        const project = projects.resolve(projectSegment);
        const values = { projectId: project.id, projectNumber: project.number };
        if (!billingEnabled(state, project.id)) {
            return fixtureResponse('cloud-billing/billing-info.disabled', { values });
        }
        return fixtureResponse('cloud-billing/billing-info.enabled', {
            values,
            merge: { billingAccountName: state.links.get(project.id) },
        });
    };
    /** The refusal a link gets before the account is even looked at (a missing role, the account's project quota). */
    const linkRefusal = (): Response | undefined => {
        if (state.linkForbidden) {
            return fixtureResponse('cloud-billing/billing-info.forbidden');
        }
        return state.quotaExceeded ? fixtureResponse('cloud-billing/billing-info.quota-exceeded') : undefined;
    };
    const link: Route['answer'] = (request, params) => {
        const refused = linkRefusal();
        if (refused !== undefined) {
            return refused;
        }
        const name = bodyField(request, 'billingAccountName');
        const project = projects.resolve(String(params['project']));
        if (name === '' || name === undefined) {
            state.links.delete(project.id);
            return billingInfo(project.id);
        }
        const account = state.accounts.find((candidate) => `billingAccounts/${candidate.id}` === name);
        if (account === undefined) {
            return googleError('google/error.permission-denied', BILLING);
        }
        state.links.set(project.id, `billingAccounts/${account.id}`);
        return billingInfo(project.id);
    };
    const base = 'https://cloudbilling.googleapis.com/v1';
    return {
        name: 'cloud-billing',
        routes: [
            route(
                'GET',
                `${base}/billingAccounts`,
                'cloud-billing.listAccounts',
                authenticated(BILLING, () =>
                    jsonResponse(state.accounts.length === 0 ? {} : { billingAccounts: state.accounts.map(accountBody) }),
                ),
            ),
            route(
                'GET',
                `${base}/billingAccounts/{account}`,
                'cloud-billing.getAccount',
                authenticated(BILLING, (_request, params) => {
                    const account = state.accounts.find((candidate) => candidate.id === params['account']);
                    return account === undefined ? googleError('google/error.not-found', BILLING) : jsonResponse(accountBody(account));
                }),
            ),
            route(
                'GET',
                `${base}/projects/{project}/billingInfo`,
                'cloud-billing.getBillingInfo',
                authenticated(BILLING, (_request, params) => billingInfo(String(params['project']))),
            ),
            route('PUT', `${base}/projects/{project}/billingInfo`, 'cloud-billing.updateBillingInfo', authenticated(BILLING, link)),
        ],
        failure: (mode) => googleFailure(BILLING, mode),
        scenarios: {
            noAccount: () => {
                state.accounts.splice(0);
            },
            accountOpen: () => {
                state.accounts.splice(0, state.accounts.length, { id: DEFAULT_ACCOUNT, displayName: 'My Billing Account', open: true });
            },
            enabled: () => {
                if (!state.accounts.some((account) => account.id === DEFAULT_ACCOUNT)) {
                    state.accounts.push({ id: DEFAULT_ACCOUNT, displayName: 'My Billing Account', open: true });
                }
                state.links.set(String(FIXTURE_VALUES['projectId']), `billingAccounts/${DEFAULT_ACCOUNT}`);
            },
            disabled: () => {
                state.links.clear();
            },
            linkForbidden: () => {
                state.linkForbidden = true;
            },
            severalAccounts: () => {
                if (!state.accounts.some((account) => account.id === SECOND_ACCOUNT)) {
                    state.accounts.push({ id: SECOND_ACCOUNT, displayName: 'Second Billing Account', open: true, currencyCode: 'EUR' });
                }
            },
            quotaExceeded: () => {
                state.quotaExceeded = true;
            },
        },
        snapshot: () => ({
            accounts: state.accounts,
            links: Object.fromEntries(state.links),
            linkForbidden: state.linkForbidden,
            quotaExceeded: state.quotaExceeded,
        }),
    };
}

/** The fake Billing Budgets API. */
export function createBillingBudgetsFake(state: BillingState): ServiceFake {
    const nextId = sequence('0e2e0000-0000-4000-8000-', 12);
    const budgetsOf = (account: string): Readonly<Record<string, unknown>>[] => {
        const existing = state.budgets.get(account);
        if (existing !== undefined) {
            return existing;
        }
        const created: Readonly<Record<string, unknown>>[] = [];
        state.budgets.set(account, created);
        return created;
    };
    const create: Route['answer'] = (request, params) => {
        const account = String(params['account']);
        if (state.budgetsForbidden || !state.accounts.some((candidate) => candidate.id === account)) {
            return googleError('google/error.permission-denied', BUDGETS);
        }
        const fields = requestObject(request);
        const budget = {
            ...(fixtureBody('billing-budgets/create.ok', { billingAccountId: account, budgetId: nextId() }) as Record<string, unknown>),
        };
        for (const key of ['displayName', 'budgetFilter', 'amount', 'thresholdRules', 'notificationsRule']) {
            if (fields[key] !== undefined) {
                budget[key] = fields[key];
            }
        }
        budgetsOf(account).push(budget);
        return jsonResponse(budget);
    };
    const patch: Route['answer'] = (request, params) => {
        const name = `billingAccounts/${String(params['account'])}/budgets/${String(params['budget'])}`;
        const index = budgetsOf(String(params['account'])).findIndex((candidate) => candidate['name'] === name);
        const budget = budgetsOf(String(params['account']))[index];
        if (state.budgetsForbidden || budget === undefined) {
            return googleError(state.budgetsForbidden ? 'google/error.permission-denied' : 'google/error.not-found', BUDGETS);
        }
        const updated = applyMask(budget, requestObject(request), request.url.searchParams.get('updateMask'));
        budgetsOf(String(params['account']))[index] = updated;
        return jsonResponse(updated);
    };
    const addAppBudget = (fields: Readonly<Record<string, unknown>>): void => {
        const budget = fixtureBody('billing-budgets/create.ok', { billingAccountId: DEFAULT_ACCOUNT, budgetId: nextId() }) as Record<
            string,
            unknown
        >;
        const projectId = String(FIXTURE_VALUES['projectId']);
        budgetsOf(DEFAULT_ACCOUNT).push({
            ...budget,
            displayName: `historic-city-map ${projectId}`,
            notificationsRule: { disableDefaultIamRecipients: false },
            ...fields,
        });
    };
    const base = 'https://billingbudgets.googleapis.com/v1/billingAccounts/{account}/budgets';
    return {
        name: 'billing-budgets',
        routes: [
            route('POST', base, 'billing-budgets.create', authenticated(BUDGETS, create)),
            route(
                'GET',
                base,
                'billing-budgets.list',
                authenticated(BUDGETS, (_request, params) => {
                    const budgets = budgetsOf(String(params['account']));
                    return jsonResponse(budgets.length === 0 ? {} : { budgets });
                }),
            ),
            route('PATCH', `${base}/{budget}`, 'billing-budgets.patch', authenticated(BUDGETS, patch)),
            route(
                'GET',
                `${base}/{budget}`,
                'billing-budgets.get',
                authenticated(BUDGETS, (_request, params) => {
                    const name = `billingAccounts/${String(params['account'])}/budgets/${String(params['budget'])}`;
                    const budget = budgetsOf(String(params['account'])).find((candidate) => candidate['name'] === name);
                    return budget === undefined ? googleError('google/error.not-found', BUDGETS) : jsonResponse(budget);
                }),
            ),
        ],
        failure: (mode) => googleFailure(BUDGETS, mode),
        scenarios: {
            budgetForbidden: () => {
                state.budgetsForbidden = true;
            },
            // The app's budget as step (b) creates it (its display name: packages/admin/src/google/billing.ts
            // budgetDisplayName), on the default account, before the `budget-alerts` item pointed it at its topic.
            appBudget: () => {
                addAppBudget({});
            },
            // The same budget as an earlier setup left it, out of spec: $3, alerts at 100 % only (S-A04-BAD-BUDGET-EXISTS).
            staleBudget: () => {
                addAppBudget({
                    amount: { specifiedAmount: { currencyCode: 'USD', units: '3' } },
                    thresholdRules: [{ thresholdPercent: 1, spendBasis: 'CURRENT_SPEND' }],
                });
            },
        },
        snapshot: () => ({ budgets: Object.fromEntries(state.budgets) }),
    };
}
