import { adminSiteId, siteDomains } from '@hcm/shared';

import type { RecaptchaKey } from '../google/app-check.js';
import type { Budget } from '../google/billing.js';
import type { GoogleClients } from '../google/clients.js';
import { ensureBindings, missingBindings, type WantedBinding } from '../google/iam-policy.js';
import { sameSet, type JsonObject } from '../google/json.js';
import type { AlertPolicy, NotificationChannel } from '../google/monitoring.js';
import { lacking, refused, waiting, type ProvisionContext, type ProvisionItemSpec } from './item.js';

/**
 * The items around the project's edges (`docs/research/M2b-interfaces.md` §3.4 items 9 and 11–13): the budget's Pub/Sub
 * topic, App Check with reCAPTCHA Enterprise, the crash e-mail alert, and the browser key's referrer restriction.
 */

const BUDGET_TOPIC = 'budget';
/** The account the Budget API publishes budget notifications as (**UNVERIFIED** whether it grants itself the role). */
const BUDGET_PUBLISHER: WantedBinding = {
    role: 'roles/pubsub.publisher',
    member: 'serviceAccount:billing-budget-alert@system.gserviceaccount.com',
};

function budgetTopic({ project }: ProvisionContext): string {
    return `projects/${project.projectId}/topics/${BUDGET_TOPIC}`;
}

/** The project's budget of step (b), found by name in its linked account; undefined before billing is linked. */
async function projectBudget({ clients, project }: ProvisionContext): Promise<Budget | undefined> {
    const info = await clients.billing.getBillingInfo(project.projectId);
    return info.billingAccountName === undefined ? undefined : clients.billing.findBudget(info.billingAccountName, project.projectId);
}

async function topicLacks({ clients, project }: ProvisionContext): Promise<string[]> {
    if (!(await clients.pubsub.topicExists(project.projectId, BUDGET_TOPIC))) {
        return ['topic', 'publisher'];
    }
    const policy = await clients.pubsub.topicPolicy(project.projectId, BUDGET_TOPIC).read();
    return missingBindings(policy, [BUDGET_PUBLISHER]).length === 0 ? [] : ['publisher'];
}

function budgetNotifies(budget: Budget, topic: string): boolean {
    const rule = budget.body['notificationsRule'] as JsonObject | undefined;
    return rule?.['pubsubTopic'] === topic && rule['schemaVersion'] === '1.0';
}

/** Creates what the topic lacks (`topic`, `publisher`), then points the budget at it. */
async function fixBudgetAlerts(context: ProvisionContext, lacks: readonly string[], budget: Budget | undefined): Promise<void> {
    const { clients, project } = context;
    if (lacks.includes('topic')) {
        await clients.pubsub.createTopic(project.projectId, BUDGET_TOPIC);
    }
    if (lacks.includes('publisher')) {
        await ensureBindings(clients.pubsub.topicPolicy(project.projectId, BUDGET_TOPIC), [BUDGET_PUBLISHER]);
    }
    if (budget !== undefined && lacks.includes('budget')) {
        await clients.billing.setBudgetTopic(budget, budgetTopic(context));
    }
}

const budgetAlerts: ProvisionItemSpec = {
    id: 'budget-alerts',
    after: ['apis'],
    observe: async (context) => {
        const topic = await topicLacks(context);
        const budget = await projectBudget(context);
        if (budget === undefined && topic.length === 0) {
            return waiting(undefined, { item: 'billing' });
        }
        const lacks = [...topic, ...(budget === undefined || budgetNotifies(budget, budgetTopic(context)) ? [] : ['budget'])];
        return lacking(lacks, () => fixBudgetAlerts(context, lacks, budget));
    },
};

/** The admin's reCAPTCHA Enterprise key, found by this display name. */
const RECAPTCHA_KEY_NAME = 'historic-city-map admin';
const TOKEN_TTL = '3600s';

/** The key's domains: the public map's site and, since §210, the admin's own (`<project>-admin`). */
function keyDomains({ project }: ProvisionContext): string[] {
    return [`${project.projectId}.web.app`, `${project.projectId}.firebaseapp.com`, ...siteDomains(adminSiteId(project.projectId))];
}

async function adminKey(context: ProvisionContext): Promise<RecaptchaKey | undefined> {
    return (await context.clients.appCheck.listKeys(context.project.projectId)).find((key) => key.displayName === RECAPTCHA_KEY_NAME);
}

async function appCheckLacks(context: ProvisionContext, key: RecaptchaKey): Promise<string[]> {
    const config = await context.clients.appCheck.getConfig(context.project.projectNumber, context.web.appId);
    return [
        ...(sameSet(key.allowedDomains, keyDomains(context)) ? [] : ['key-domains']),
        ...(config.siteKey === key.siteKey && config.tokenTtl === TOKEN_TTL ? [] : ['config']),
    ];
}

async function fixAppCheck(context: ProvisionContext, key: RecaptchaKey | undefined, lacks: readonly string[]): Promise<void> {
    const { appCheck: client } = context.clients;
    const ready = key ?? (await client.createKey(context.project.projectId, RECAPTCHA_KEY_NAME, keyDomains(context)));
    if (lacks.includes('key-domains')) {
        await client.setKeyDomains(ready, keyDomains(context));
    }
    if (lacks.includes('config')) {
        await client.setConfig(context.project.projectNumber, context.web.appId, { siteKey: ready.siteKey, tokenTtl: TOKEN_TTL });
    }
}

const appCheck: ProvisionItemSpec = {
    id: 'app-check',
    after: ['apis'],
    observe: async (context) => {
        const key = await adminKey(context);
        const lacks = key === undefined ? ['key', 'config'] : await appCheckLacks(context, key);
        return lacking(lacks, () => fixAppCheck(context, key, lacks), key === undefined ? undefined : { siteKey: key.siteKey });
    },
};

const CRASH_CHANNEL_NAME = 'historic-city-map crashes';
const CRASH_POLICY_NAME = 'historic-city-map new crash reports';
const CRASH_FILTER = 'jsonPayload."@type"="type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"';

function crashPolicy(channel: string): JsonObject {
    return {
        displayName: CRASH_POLICY_NAME,
        combiner: 'OR',
        enabled: true,
        conditions: [{ displayName: 'A new crash report', conditionMatchedLog: { filter: CRASH_FILTER } }],
        alertStrategy: { notificationRateLimit: { period: '3600s' }, autoClose: '1800s' },
        notificationChannels: [channel],
    };
}

/** The crash alert policy (step (g)'s switch), or undefined before `crash-alerts` created it. */
export async function findCrashPolicy(clients: GoogleClients, projectId: string): Promise<AlertPolicy | undefined> {
    return (await clients.monitoring.listAlertPolicies(projectId)).find((policy) => policy.displayName === CRASH_POLICY_NAME);
}

async function ownerChannel({ clients, project }: ProvisionContext, email: string): Promise<NotificationChannel | undefined> {
    const channels = await clients.monitoring.listEmailChannels(project.projectId);
    return channels.find((channel) => channel.displayName === CRASH_CHANNEL_NAME && channel.email === email);
}

function policyLacks(policy: AlertPolicy | undefined, channel: NotificationChannel | undefined): string[] {
    if (policy === undefined) {
        return ['policy'];
    }
    return channel === undefined || policy.channels.includes(channel.name) ? [] : ['policy-channel'];
}

async function fixCrashAlerts(
    context: ProvisionContext,
    email: string,
    found: { readonly channel: NotificationChannel | undefined; readonly policy: AlertPolicy | undefined },
): Promise<void> {
    const { monitoring } = context.clients;
    const projectId = context.project.projectId;
    const channel = found.channel ?? (await monitoring.createEmailChannel(projectId, CRASH_CHANNEL_NAME, email));
    // A fix with an existing policy always lacks its channel: the owner's channel was just created, or the policy lost it.
    if (found.policy === undefined) {
        await monitoring.createAlertPolicy(projectId, crashPolicy(channel.name));
    } else {
        await monitoring.patchAlertPolicy(found.policy.name, { notificationChannels: [...found.policy.channels, channel.name] }, [
            'notificationChannels',
        ]);
    }
}

const crashAlerts: ProvisionItemSpec = {
    id: 'crash-alerts',
    after: ['apis'],
    observe: async (context) => {
        const email = context.ownerEmail;
        if (email === null) {
            return waiting();
        }
        const channel = await ownerChannel(context, email);
        const policy = await findCrashPolicy(context.clients, context.project.projectId);
        const lacks = [...(channel === undefined ? ['channel'] : []), ...policyLacks(policy, channel)];
        return lacking(lacks, () => fixCrashAlerts(context, email, { channel, policy }), { enabled: String(policy?.enabled ?? true) });
    },
};

/** The referrers the browser key accepts: the admin's Hosting origins and every viewer origin (GA4 uses the same key). */
function allowedReferrers(context: ProvisionContext): string[] {
    return [...context.names.adminOrigins, ...context.project.viewerOrigins].map((origin) => `${origin}/*`);
}

const apiKey: ProvisionItemSpec = {
    id: 'api-key',
    after: ['apis'],
    observe: async (context) => {
        const key = await context.clients.apiKeys.findKey(context.project.projectId, context.web.apiKey);
        if (key === undefined) {
            return refused('apiError.notFound');
        }
        const wanted = allowedReferrers(context);
        return lacking(sameSet(key.allowedReferrers, wanted) ? [] : ['referrers'], () => context.clients.apiKeys.setReferrers(key, wanted));
    },
};

export const EXTRA_ITEMS: readonly ProvisionItemSpec[] = [budgetAlerts, appCheck, crashAlerts, apiKey];
