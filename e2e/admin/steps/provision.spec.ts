import type { Locator, Page, Route } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { apiText, setupText, shellText, templatePattern } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { openStep, seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../support/steps.js';
import type { UpstreamCall, UpstreamControl } from '../support/upstream.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import { ADMIN_PROJECT } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's provisioning step (docs/research/M2b-interfaces.md §3.3 c, §3.4; behaviours A04, A30) on a
 * claimed map with billing done, its owner signed in (normal mode): "Prepare the project" (one click, one cloud-platform
 * consent) runs the provisioner against the owner's Google world of the fake upstreams, which starts as a new project on
 * Blaze with the app's budget; the doctor shows each item as it settles, and the result is recorded in `setup/status`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ adminWorld, upstream }) => {
    const owner = adminWorld.accounts.owner.uid;
    await seedClaimedCity(adminWorld.emulators, owner);
    await adminWorld.emulators.setDocument('setup/status', {
        billing: { state: 'ok', checkedAt: STEPS_AT },
        updatedBy: owner,
        updatedAt: STEPS_AT,
    });
    await upstream.scenario('cloud-billing.enabled', 'browser');
    await upstream.scenario('billing-budgets.appBudget', 'browser');
});

/** The Compute Engine default account: the functions' build account (finding 33 of 2026-10-31). */
const COMPUTE_EMAIL = `${ADMIN_PROJECT.projectNumber}-compute@developer.gserviceaccount.com`;
const COMPUTE = `serviceAccount:${COMPUTE_EMAIL}`;

/** Every item done but the scheduler, which the first deploy creates. */
const PROVISIONED = {
    apis: 'ok',
    'service-accounts': 'ok',
    iam: 'ok',
    buckets: 'ok',
    // M6 (docs/research/M6-interfaces.md §1.6): the imagery pipeline's repository, the 16th item.
    'artifact-registry': 'ok',
    'bucket-cors': 'ok',
    'bucket-lifecycle': 'ok',
    secrets: 'ok',
    'task-queues': 'ok',
    scheduler: 'pending',
    'workload-identity': 'ok',
    'app-check': 'ok',
    'budget-alerts': 'ok',
    'org-policies': 'ok',
    'crash-alerts': 'ok',
    'api-key': 'ok',
    // DECISIONS-for-review.md §210: the admin's own Hosting site and its Firebase Auth domains, the 17th item.
    'admin-site': 'ok',
};

/** A Google default account's own IAM policy in the browser's world of the IAM fake (none: no policy). */
function accountPolicy(snapshot: Readonly<Record<string, unknown>>, email: string): unknown {
    const iam = snapshot['iam'] as { readonly projects: Record<string, { readonly accountPolicies: Record<string, unknown> }> };
    return iam.projects[ADMIN_PROJECT.projectId]?.accountPolicies[email];
}

/** The App Engine default account's own IAM policy (none: no policy). */
function appEnginePolicy(snapshot: Readonly<Record<string, unknown>>): unknown {
    return accountPolicy(snapshot, `${ADMIN_PROJECT.projectId}@appspot.gserviceaccount.com`);
}

/** A Google call that changes something (the rest read: GET, and the POSTs that read an IAM policy or test permissions). */
function isWrite(call: UpstreamCall): boolean {
    return call.method !== 'GET' && !/(getIamPolicy|testIamPermissions|tokeninfo)$/.test(call.operation);
}

async function writes(upstream: UpstreamControl): Promise<UpstreamCall[]> {
    return (await upstream.calls('browser')).filter(isWrite);
}

interface ProvisionCard {
    readonly card: Locator;
    readonly run: Locator;
    readonly retry: Locator;
}

async function provisionCard(page: Page, lang: 'ro' | 'en'): Promise<ProvisionCard> {
    const card = await openStep(page, lang, 'provision', 'provision');
    return {
        card,
        run: card.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }),
        retry: card.getByRole('button', { name: setupText(lang, 'adminSetup.provision.retry') }),
    };
}

test(
    'Prepare the project creates every item once, in order, with the numeric ids of the project file; a second run writes nothing',
    { tag: ['@S-A04-HAPPY-PROVISION'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        test.setTimeout(150_000);
        const { card, run } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        const scopes = await withConsent(page, consent, run, inputs, setupBudget.consents('provision'));

        expect(scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        const setup = new SetupPage(page, lang);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const first = await writes(upstream);
        const keys = first.map((call) => `${call.operation} ${call.url} ${call.body}`);
        expect(new Set(keys).size).toBe(keys.length);
        // The doctor's order: the APIs first, the service accounts before their roles, the buckets before their settings.
        const position = (operation: string): number => first.findIndex((call) => call.operation === operation);
        expect(position('service-usage.batchEnable')).toBeLessThan(position('iam.serviceAccounts.create'));
        expect(position('iam.serviceAccounts.create')).toBeLessThan(position('resource-manager.setIamPolicy'));
        expect(position('cloud-storage.buckets.insert')).toBeLessThan(position('cloud-storage.buckets.patch'));
        const provider = first.find((call) => call.operation === 'iam.workloadIdentityPools.providers.create');
        expect(provider?.body).toContain(`assertion.repository_owner_id=='${String(ADMIN_PROJECT.github.ownerId)}'`);
        expect(provider?.body).toContain(`assertion.repository_id=='${String(ADMIN_PROJECT.github.repoId)}'`);
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['provision'])
            .toMatchObject({
                state: 'ok',
                items: expect.arrayContaining([expect.objectContaining({ id: 'scheduler', state: 'pending' })]),
            });

        // Check again: the doctor reads every item and writes nothing (the token is still live: no consent).
        await inputs.click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }));
        await expect.poll(async () => (await upstream.calls('browser')).length).toBeGreaterThan(first.length);
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })).toBeEnabled();
        expect(await setup.provisionItems()).toEqual(PROVISIONED);
        expect(await writes(upstream)).toHaveLength(first.length);
    },
);

test(
    "An organisation policy that forbids public access marks the public bucket's access with the policy; everything else is provisioned",
    { tag: ['@S-A04-BAD-ORG-POLICY'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await upstream.scenario('org-policy.publicAccessPrevented', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision'), setupBudget.consents('provision'));

        await expect(retry).toBeEnabled({ timeout: 60_000 });
        const items = await new SetupPage(page, lang).provisionItems();
        // The public read is the one part the policy refuses: the item says which policy; what needs the buckets waits.
        expect(items).toMatchObject({ buckets: 'invalid', apis: 'ok', 'service-accounts': 'ok', secrets: 'ok', 'org-policies': 'ok' });
        await expect(card.locator('[data-item="buckets"]')).toContainText(
            setupText(lang, 'adminSetup.provision.orgPolicy', { constraint: 'storage.publicAccessPrevention' }),
        );
        consoleErrors.takeMatching(/status of 412/);
    },
);

test(
    'A failed item costs one more input: Retry runs only what is not done, with no second consent',
    { tag: ['@S-A30-BAD-RETRY-COSTS-ONE'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await page.clock.resume();
        await upstream.fail('secret-manager', 'unavailable', 'browser');
        const { run, retry } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        const consents = setupBudget.consents('provision');
        await withConsent(page, consent, run, inputs, consents);
        // The client retries a 503 three times (after 1, 2 and 4 s of the page's clock) before it reports the item.
        await expect(async () => {
            await page.clock.fastForward(5_000);
            await expect(retry).toBeEnabled({ timeout: 1_000 });
        }).toPass({ timeout: 60_000 });
        const setup = new SetupPage(page, lang);
        expect(await setup.provisionItems()).toMatchObject({ secrets: 'unavailable', apis: 'ok', 'service-accounts': 'ok', buckets: 'ok' });
        const before = (await upstream.calls('browser')).length;
        expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);

        await upstream.fail('secret-manager', null, 'browser');
        await inputs.click(retry);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const again = (await upstream.calls('browser'))
            .slice(before)
            .filter(isWrite)
            .map((call) => call.operation);
        expect(again).not.toContain('service-usage.batchEnable');
        expect(again).not.toContain('iam.serviceAccounts.create');
        expect(again).not.toContain('cloud-storage.buckets.insert');
        expect(inputs.used).toBe(2);
        expect(consents.used).toBe(1);
    },
);

test(
    'A Google token that expires during the run stops it with the rest pending; Continue, one click and one consent, finishes it',
    { tag: ['@S-A04-BAD-TOKEN-EXPIRED-MID-RUN'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        // The owner's first token expires when the run reaches Secret Manager: Google answers 401 to it from then on.
        let expired: string | null = null;
        await page.route('https://*.googleapis.com/**', async (route: Route) => {
            const token = (await route.request().headerValue('authorization')) ?? '';
            if (expired === null && route.request().url().startsWith('https://secretmanager.googleapis.com/')) {
                expired = token;
            }
            if (expired !== null && token === expired) {
                await route.fulfill({
                    status: 401,
                    json: { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } },
                });
                return;
            }
            await route.fallback();
        });
        const { card, run } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision', 1), setupBudget.consents('provision', 1));

        const proceed = card.getByRole('button', { name: shellText(lang, 'adminShell.session.continue') });
        await expect(proceed).toBeVisible({ timeout: 60_000 });
        const setup = new SetupPage(page, lang);
        const stopped = await setup.provisionItems();
        expect(stopped).toMatchObject({ apis: 'ok', 'service-accounts': 'ok', buckets: 'ok' });
        expect(stopped['secrets']).not.toBe('ok');
        const before = (await upstream.calls('browser')).length;
        consoleErrors.takeMatching(/status of 401/);

        const renewed = await withConsent(page, consent, proceed, setupBudget.inputs('provision', 1), setupBudget.consents('provision', 1));
        expect(renewed).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        const again = (await upstream.calls('browser'))
            .slice(before)
            .filter(isWrite)
            .map((call) => call.operation);
        expect(again).not.toContain('iam.serviceAccounts.create');
        expect(again).not.toContain('cloud-storage.buckets.insert');
    },
);

/**
 * M6 (findings 4, 12 and 17 of docs/research/manual-test-2026-10-25.md; docs/research/M6-interfaces.md §1.2, §1.5, §1.6):
 * an API Google is still switching on is waited for on the page's clock, and Prepare the project makes the installer's
 * account and roles, the pipeline's repository, `roles/run.invoker` for the function accounts and the Eventarc and
 * Pub/Sub service identities.
 */

/** The bindings of one IAM policy of the browser's fakes, as `{role: members}`. */
function bindingsIn(policy: unknown): Record<string, string[]> {
    const bindings =
        (policy as { readonly bindings?: readonly { readonly role: string; readonly members: readonly string[] }[] }).bindings ?? [];
    return Object.fromEntries(bindings.map((binding) => [binding.role, [...binding.members]]));
}

/** Advances the page's clock until `until` holds (the waits of 10, 20, 40, 60 and 60 s are the page's timers). */
async function fastForwardUntil(page: Page, until: () => Promise<void>): Promise<void> {
    await expect(async () => {
        await page.clock.fastForward(10_000);
        await until();
    }).toPass({ timeout: 120_000 });
}

test(
    'An API Google is still switching on is waited for on the clock, its row says so, and the run finishes with no click',
    { tag: ['@S-A04-HAPPY-API-PROPAGATION'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(240_000);
        await page.clock.install();
        await page.clock.resume();
        await upstream.scenario('service-usage.propagation', 'browser');
        const { card, run } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        await withConsent(page, consent, run, inputs, setupBudget.consents('provision'));

        const accounts = card.locator('[data-item="service-accounts"]');
        await expect(accounts).toContainText(setupText(lang, 'adminSetup.provision.apiWaiting', { api: 'iam.googleapis.com' }), {
            timeout: 60_000,
        });
        await expect(accounts).toHaveAttribute('data-state', 'pending');
        const setup = new SetupPage(page, lang);
        await fastForwardUntil(page, async () => {
            expect(await setup.provisionItems()).toEqual(PROVISIONED);
        });
        await expect(accounts).not.toContainText(setupText(lang, 'adminSetup.provision.apiWaiting', { api: 'iam.googleapis.com' }));
        expect(inputs.used).toBe(1);
        consoleErrors.takeMatching(/status of 403/);
    },
);

test(
    'An API still off after about three minutes is named on its row with its dependants waiting; Retry what failed finishes',
    { tag: ['@S-A04-BAD-API-STILL-DISABLED'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(240_000);
        await page.clock.install();
        await page.clock.resume();
        await upstream.scenario('service-usage.propagationSlow', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        await withConsent(page, consent, run, inputs, setupBudget.consents('provision'));

        await fastForwardUntil(page, async () => {
            await expect(retry).toBeEnabled({ timeout: 1_000 });
        });
        const setup = new SetupPage(page, lang);
        expect(await setup.provisionItems()).toMatchObject({ apis: 'ok', 'service-accounts': 'missing', iam: 'pending' });
        await expect(card.locator('[data-item="service-accounts"]')).toContainText(
            apiText(lang, 'apiError.cloud.apiPropagation', { api: 'iam.googleapis.com' }),
        );
        consoleErrors.takeMatching(/status of 403/);

        await inputs.click(retry);
        await fastForwardUntil(page, async () => {
            expect(await setup.provisionItems()).toEqual(PROVISIONED);
        });
        expect(inputs.used).toBe(2);
    },
);

test(
    'A project without the App Engine default account is prepared in full, with nothing to grant on it',
    { tag: ['@S-A04-BAD-NO-APPENGINE-ACCOUNT'] },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        // Finding 28 of 2026-10-31: the account comes with an App Engine app, which a project may lack (a GET answers 404).
        test.setTimeout(150_000);
        await upstream.scenario('iam.noAppEngineAccount', 'browser');
        const { run } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision'), setupBudget.consents('provision'));
        const setup = new SetupPage(page, lang);

        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        expect(appEnginePolicy(await upstream.snapshot('browser'))).toBeUndefined();
        const appEngineCalls = (await upstream.calls('browser')).filter((call) => call.url.includes('@appspot.gserviceaccount.com:'));
        expect(appEngineCalls).toEqual([]);
    },
);

test(
    "Prepare the project makes the installer's account with the contract's roles, the repository, the invokers and the service agents",
    {
        tag: [
            '@S-A04-HAPPY-INSTALLER-ACCOUNT',
            '@S-A04-HAPPY-APPENGINE-ACTAS',
            '@S-A04-HAPPY-APPENGINE-NO-EDITOR',
            '@S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT',
        ],
    },
    async ({ page, lang, consent, setupBudget, upstream }) => {
        test.setTimeout(150_000);
        const { run } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision', 1), setupBudget.consents('provision'));
        const setup = new SetupPage(page, lang);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);

        const snapshot = await upstream.snapshot('browser');
        const project = bindingsIn(
            (snapshot['resource-manager'] as { policies: Record<string, unknown> }).policies[ADMIN_PROJECT.projectId],
        );
        const account = (id: string): string => `serviceAccount:${id}@${ADMIN_PROJECT.projectId}.iam.gserviceaccount.com`;
        const installer = account('hcm-installer');
        expect(
            Object.entries(project)
                .filter(([, members]) => members.includes(installer))
                .map(([role]) => role),
        ).toEqual([
            'roles/firebase.viewer',
            'roles/firebasehosting.admin',
            'roles/firebaserules.admin',
            'roles/datastore.indexAdmin',
            'roles/cloudfunctions.developer',
            'roles/cloudscheduler.admin',
            'roles/cloudtasks.queueAdmin',
            'roles/serviceusage.serviceUsageConsumer',
            'roles/logging.logWriter',
            `projects/${ADMIN_PROJECT.projectId}/roles/hcmInstaller`,
        ]);
        // The compute default account invokes and receives a first deploy's events (firebase-tools' ensureServiceAgentRoles).
        expect(project['roles/run.invoker']).toEqual([account('fn-admin'), account('fn-events'), COMPUTE]);
        expect(JSON.stringify(snapshot['artifact-registry'])).toContain(`"roles/artifactregistry.writer","members":["${installer}"]`);
        expect(JSON.stringify(snapshot['iam'])).toContain('hcm-installer');
        // Finding 28 of 2026-10-31: Service Account User on the App Engine default account, in its own policy only.
        expect(appEnginePolicy(snapshot)).toEqual([
            expect.objectContaining({ role: 'roles/iam.serviceAccountUser', members: [installer] }),
        ]);
        expect(project['roles/iam.serviceAccountUser'] ?? []).not.toContain(installer);
        // DECISIONS §75b and §75g: neither default account holds Editor any more; every other member and binding is kept.
        expect(project['roles/editor']).toBeUndefined();
        expect(project['roles/owner']).toHaveLength(1);
        expect(JSON.stringify(project)).not.toContain('@appspot.gserviceaccount.com');
        // Finding 33 (§75g): the installer may act as the functions' build account, on its own policy only, and the account
        // builds with the Cloud Build builder role; the order of the writes: the actAs, the builder role, the removal.
        expect(accountPolicy(snapshot, COMPUTE_EMAIL)).toEqual([
            expect.objectContaining({ role: 'roles/iam.serviceAccountUser', members: [installer] }),
        ]);
        expect(project['roles/cloudbuild.builds.builder']).toEqual([COMPUTE]);
        // The service identities are generated before any policy is written (finding 12).
        const calls = await upstream.calls('browser');
        const index = (match: (call: UpstreamCall) => boolean): number => calls.findIndex(match);
        const firstWrite = index((call) => call.operation === 'resource-manager.setIamPolicy');
        for (const service of ['eventarc.googleapis.com', 'pubsub.googleapis.com']) {
            const generated = index((call) => call.operation === 'service-usage.generateServiceIdentity' && call.url.includes(service));
            expect(generated).toBeGreaterThan(-1);
            expect(generated).toBeLessThan(firstWrite);
        }

        // A second run writes nothing.
        const before = (await writes(upstream)).length;
        const card = setup.open('provision');
        await card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }).click();
        await expect.poll(async () => (await upstream.calls('browser')).length).toBeGreaterThan(calls.length);
        await expect(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })).toBeEnabled();
        expect(await writes(upstream)).toHaveLength(before);
    },
);

test(
    "A map prepared before M6 retries every item, so the installer's account and its roles are made too",
    { tag: ['@S-A04-BAD-PRE-M6-RECORD'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        // Finding 2 of the M6 review: the live map's record has 15 items ok and the 16th never reported; running that
        // one alone left hcm-installer@ uncreated while step c read done, and the install cards sent the owner back there.
        test.setTimeout(150_000);
        await upstream.scenario('google.provisioned', 'browser');
        const owner = adminWorld.accounts.owner.uid;
        const items = Object.entries(PROVISIONED)
            .filter(([id]) => id !== 'artifact-registry')
            .map(([id, state]) => ({ id, state }));
        await adminWorld.emulators.setDocument('setup/status', {
            billing: { state: 'ok', checkedAt: STEPS_AT },
            provision: { state: 'ok', checkedAt: STEPS_AT, items },
            updatedBy: owner,
            updatedAt: STEPS_AT,
        });
        const { retry } = await provisionCard(page, lang);

        await withConsent(page, consent, retry, setupBudget.inputs('provision'), setupBudget.consents('provision'));

        const setup = new SetupPage(page, lang);
        await expect.poll(() => setup.provisionItems(), { timeout: 60_000 }).toEqual(PROVISIONED);
        // The rows read done from the record while the run still works through them: wait for the run's own end.
        await expect(setup.card('provision').locator('[data-busy]')).toHaveCount(0, { timeout: 60_000 });
        await setup.expectState('provision', 'ok');
        const snapshot = await upstream.snapshot('browser');
        expect(JSON.stringify(snapshot['iam'])).toContain('hcm-installer');
        const project = bindingsIn(
            (snapshot['resource-manager'] as { policies: Record<string, unknown> }).policies[ADMIN_PROJECT.projectId],
        );
        expect(project['roles/cloudfunctions.developer']).toContain(
            `serviceAccount:hcm-installer@${ADMIN_PROJECT.projectId}.iam.gserviceaccount.com`,
        );
    },
);

test(
    "A refused Eventarc service identity names the refused role on the permissions' row; the items that do not need it are provisioned",
    { tag: ['@S-A04-BAD-IDENTITY-REFUSED'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await upstream.scenario('service-usage.identityRefused', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision', 1), setupBudget.consents('provision'));

        await expect(retry).toBeEnabled({ timeout: 60_000 });
        const items = await new SetupPage(page, lang).provisionItems();
        expect(items).toMatchObject({
            iam: 'invalid',
            apis: 'ok',
            'service-accounts': 'ok',
            buckets: 'ok',
            'artifact-registry': 'ok',
            secrets: 'ok',
            'app-check': 'ok',
            'api-key': 'ok',
        });
        await expect(card.locator('[data-item="iam"]')).toContainText(
            apiText(lang, 'apiError.cloud.permission', { role: 'roles/serviceusage.serviceUsageAdmin' }),
        );
        expect((await upstream.calls('browser')).filter((call) => call.operation === 'resource-manager.setIamPolicy')).toEqual([]);
        consoleErrors.takeMatching(/status of 403/);
    },
);

test(
    'A provisioning failure names the button on the card, Retry what failed, never Prepare the project, which the card does not show then',
    { tag: ['@S-A04-HAPPY-RETRY-NAMES-BUTTON'] },
    async ({ page, lang, adminWorld }) => {
        // M6 setup-ux (finding 5 of docs/research/manual-test-2026-10-25.md): a run recorded with one item refused because
        // Google's Pub/Sub service was off.
        const owner = adminWorld.accounts.owner.uid;
        const items = Object.keys(PROVISIONED).map((id) =>
            id === 'budget-alerts'
                ? {
                      id,
                      state: 'missing',
                      detail: 'apiError.cloud.apiDisabled',
                      params: { api: 'pubsub.googleapis.com' },
                      checkedAt: STEPS_AT,
                  }
                : { id, state: 'ok', checkedAt: STEPS_AT },
        );
        await adminWorld.emulators.setDocument('setup/status', {
            billing: { state: 'ok', checkedAt: STEPS_AT },
            provision: { state: 'missing', checkedAt: STEPS_AT, items },
            updatedBy: owner,
            updatedAt: STEPS_AT,
        });
        const { card, run, retry } = await provisionCard(page, lang);

        const failed = card.locator('[data-item="budget-alerts"]');
        await expect(failed).toContainText(setupText(lang, 'adminSetup.provision.apiDisabled', { api: 'pubsub.googleapis.com' }));
        await expect(failed).toContainText(setupText(lang, 'adminSetup.provision.retry'));
        await expect(failed).not.toContainText(setupText(lang, 'adminSetup.provision.run'));
        await expect(retry).toBeVisible();
        await expect(run).toHaveCount(0);
    },
);

test(
    "A refused removal of the App Engine account's Editor role fails the permissions' row with the role it needs and keeps the binding",
    { tag: ['@S-A04-BAD-APPENGINE-EDITOR-REFUSED'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        // DECISIONS §75b: an IAM deny policy of the owner's organisation keeps the binding; the role table is written anyway.
        test.setTimeout(150_000);
        await upstream.scenario('resource-manager.appEngineEditorLocked', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        const inputs = setupBudget.inputs('provision', 1);
        await withConsent(page, consent, run, inputs, setupBudget.consents('provision'));

        await expect(retry).toBeEnabled({ timeout: 60_000 });
        const setup = new SetupPage(page, lang);
        expect(await setup.provisionItems()).toMatchObject({ iam: 'invalid', apis: 'ok', 'service-accounts': 'ok', secrets: 'ok' });
        const row = card.locator('[data-item="iam"]');
        await expect(row).toContainText(apiText(lang, 'apiError.cloud.permission', { role: 'roles/resourcemanager.projectIamAdmin' }));
        const project = bindingsIn(
            ((await upstream.snapshot('browser'))['resource-manager'] as { policies: Record<string, unknown> }).policies[
                ADMIN_PROJECT.projectId
            ],
        );
        expect(project['roles/editor']).toContain(`serviceAccount:${ADMIN_PROJECT.projectId}@appspot.gserviceaccount.com`);
        expect(project['roles/run.invoker']).toHaveLength(3);
        expect(project['roles/owner']).toHaveLength(1);
        await expect(row).toHaveAttribute('data-state', 'invalid');
        expect(inputs.used).toBe(1);
        consoleErrors.takeMatching(/status of 403/);
    },
);

test(
    "A refused removal of the build account's Editor role fails the permissions' row with the role it needs; its builder role stays",
    { tag: ['@S-A04-BAD-COMPUTE-EDITOR-REFUSED'] },
    async ({ page, lang, consent, setupBudget, upstream, consoleErrors }) => {
        // DECISIONS §75g (finding 33): an IAM deny policy keeps the Compute Engine default account's Editor role; the actAs and
        // the builder role are written first, so the installs work while only the narrowing waits.
        test.setTimeout(150_000);
        await upstream.scenario('resource-manager.computeEditorLocked', 'browser');
        const { card, run, retry } = await provisionCard(page, lang);
        await withConsent(page, consent, run, setupBudget.inputs('provision', 1), setupBudget.consents('provision'));

        await expect(retry).toBeEnabled({ timeout: 60_000 });
        expect(await new SetupPage(page, lang).provisionItems()).toMatchObject({ iam: 'invalid', apis: 'ok', 'service-accounts': 'ok' });
        const row = card.locator('[data-item="iam"]');
        await expect(row).toContainText(apiText(lang, 'apiError.cloud.permission', { role: 'roles/resourcemanager.projectIamAdmin' }));
        const snapshot = await upstream.snapshot('browser');
        const project = bindingsIn(
            (snapshot['resource-manager'] as { policies: Record<string, unknown> }).policies[ADMIN_PROJECT.projectId],
        );
        expect(project['roles/editor']).toEqual([COMPUTE]);
        expect(project['roles/cloudbuild.builds.builder']).toEqual([COMPUTE]);
        expect(accountPolicy(snapshot, COMPUTE_EMAIL)).toEqual([
            expect.objectContaining({
                role: 'roles/iam.serviceAccountUser',
                members: [`serviceAccount:hcm-installer@${ADMIN_PROJECT.projectId}.iam.gserviceaccount.com`],
            }),
        ]);
        consoleErrors.takeMatching(/status of 403/);
    },
);

/**
 * Finding 34 of docs/research/manual-test-2026-10-25.md (2026-11-01): on a map whose step c is recorded done, Check again
 * in a tab without Google's permission changed the chip to To do; and a re-check never recorded an item the doctor found
 * missing, so the server's record could not follow an item that went back.
 */
test(
    'Check again without a Google token keeps step c as recorded and says when it was last checked',
    { tag: ['@S-A04-BAD-RECHECK-NO-TOKEN'] },
    async ({ page, lang, consent, setupBudget, upstream, adminWorld }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const card = await setup.show('provision');
        await setup.expectState('provision', 'ok');
        const before = (await upstream.calls('browser')).length;

        const popup = await consent.opened(page, () =>
            setupBudget.inputs('provision').click(card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })),
        );
        await popup.cancel(setupBudget.consents('provision'));

        await expect(
            card.getByText(templatePattern(setupText(lang, 'adminSetup.provision.lastChecked', { time: '\u0000' }))),
        ).toBeVisible();
        await setup.expectState('provision', 'ok');
        await expect(card.locator('.status')).toContainText(setupText(lang, 'adminSetup.state.ok'));
        // The doctor never ran: its first item reads the project's services.
        const after = (await upstream.calls('browser')).slice(before);
        expect(after.filter((call) => call.operation.startsWith('service-usage'))).toEqual([]);
        expect((await adminWorld.emulators.document('setup/status'))?.['provision']).toMatchObject({ state: 'ok' });
    },
);

test(
    "Check again with Google's permission records the items the doctor found missing, so step c follows the project",
    { tag: ['@S-A04-HAPPY-RECHECK-RECORDS-MISSING'] },
    async ({ page, lang, consent, setupBudget, adminWorld, consoleErrors }) => {
        test.setTimeout(150_000);
        // The record says every item is done; the project behind it has none of the services switched on any more.
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const card = await setup.show('provision');
        await setup.expectState('provision', 'ok');

        const recheck = card.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') });
        await withConsent(page, consent, recheck, setupBudget.inputs('provision'), setupBudget.consents('provision'));

        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['provision'], { timeout: 60_000 })
            .toMatchObject({
                state: 'missing',
                items: expect.arrayContaining([expect.objectContaining({ id: 'apis', state: 'missing' })]),
            });
        await setup.expectState('provision', 'missing', 60_000);
        await expect.poll(async () => (await setup.provisionItems())['apis']).toBe('missing');
        // With the token live the install cards look too, and Cloud Functions, switched off, refuses them.
        consoleErrors.takeMatching(/status of 403/);
    },
);
