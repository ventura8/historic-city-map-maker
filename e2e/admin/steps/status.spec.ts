import { SELF_TEST_CHECKS, VERTEX_MODEL_IDS } from '@hcm/shared';
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../support/state-check.js';
import { adminVisit } from '../../tour/states.js';
import type { InputBudget } from '../../support/budget.js';
import type { GoogleConsent } from '../support/consent.js';
import type { ServerDeployment } from '../support/deployment.js';
import { apiText, setupText, shellText, templatePattern } from '../support/i18n.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { bootstrapRecord, rememberBootstrap, seedClaimedCity, seedSetupStatus, STEPS_AT, withConsent } from '../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import { ADMIN_RUNTIME, ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin, PERSONAS } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's page as a whole on a claimed map (docs/research/M2-interfaces.md §6, M2b-interfaces.md §3.2;
 * behaviour A03): `setup.status` gives every card its chip and its reason, the page opens at the first step not done,
 * and Check again runs `setup.selfTest`, whose findings the chips follow; the map is set up once billing, provisioning,
 * Mapbox and USGS are done.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await upstream.scenario('google.provisioned', 'server');
    await standInProviderPages(page.context(), ['https://ers.cr.usgs.gov']);
});

/** The chip of every step, by id. */
async function chips(page: Page): Promise<Record<string, string | null>> {
    const steps = page.locator('hcm-setup-step[mode="summary"], hcm-setup-step[mode="inline"]');
    const pairs = await steps.evaluateAll((elements) =>
        elements.map((element): [string, string | null] => [element.getAttribute('data-step') ?? '', element.getAttribute('data-state')]),
    );
    return Object.fromEntries(pairs);
}

test(
    'Every card shows its state and reason from setup.status; Check again runs the self-test, and the map is set up once the four required steps are done',
    { tag: ['@S-A03-HAPPY'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        const owner = adminWorld.accounts.owner.uid;
        await seedSetupStatus(adminWorld.emulators, owner, {
            usgs: { state: 'invalid', checkedAt: STEPS_AT, detail: 'apiError.usgs.credentials' },
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        expect(await chips(page)).toMatchObject({
            billing: 'ok',
            provision: 'ok',
            mapbox: 'missing',
            usgs: 'invalid',
            analytics: 'missing',
        });
        await expect((await setup.show('usgs')).getByText(apiText(lang, 'apiError.usgs.credentials'))).toBeVisible();
        const ready = page.getByText(setupText(lang, 'adminSetup.ready'));
        await expect(ready).toHaveCount(0);

        // Mapbox, then USGS with an account whose M2M access waits for approval.
        const mapbox = await setup.show('mapbox');
        await mapbox.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.bootstrap);
        await mapbox.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();
        await setup.expectState('mapbox', 'ok');
        const usgs = await setup.show('usgs');
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.username')).fill(USGS_CREDENTIALS.pending.username);
        await followDeepLink(page, () =>
            usgs.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) }).click(),
        );
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).fill(USGS_CREDENTIALS.pending.applicationToken);
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).press('Enter');
        await setup.expectState('usgs', 'pending');
        await expect(ready).toHaveCount(0);

        // USGS approves; Check again runs the self-test, and the USGS chip follows what it found.
        await upstream.scenario('usgs.m2mApproved', 'server');
        const selfTest = page.waitForRequest(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        const analyticsChecked = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-analyticsConfig`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;
        await setup.expectState('usgs', 'ok');
        await expect(ready).toBeVisible();
        expect(await chips(page)).toMatchObject({ billing: 'ok', provision: 'ok', mapbox: 'ok', usgs: 'ok' });

        // The page moves on to the next step not done (since M6 the imagery pipeline's, which the server's install
        // starts); the optional analytics card, opened, checks and says Google Analytics is not enabled yet: a
        // callable's 400, which the browser logs.
        await setup.show('analytics');
        expect((await analyticsChecked).status()).toBe(400);
        await expect.poll(() => consoleErrors.takeMatching(/setup-analyticsConfig/).length).toBeGreaterThan(0);
    },
);

test(
    'A partial setup opens at the first step that is not done',
    { tag: ['@S-A03-BAD-PARTIAL-STATE'] },
    async ({ page, lang, adminWorld }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
            mapbox: { state: 'ok', checkedAt: STEPS_AT, user: 'e2e-mapbox' },
        });
        const setup = new SetupPage(page, lang);
        await setup.visit('usgs');

        await expect(setup.open('usgs')).toBeVisible();
        await expect(setup.open('billing')).toHaveCount(0);
        expect(await chips(page)).toMatchObject({ billing: 'ok', provision: 'ok', mapbox: 'ok', usgs: 'missing' });
    },
);

/**
 * Holds the page's `setup.status` until the returned call lets it through (the server answering slowly after a reload,
 * finding 32 of docs/research/manual-test-2026-10-25.md), or answers it as `answer` says.
 */
async function holdStatus(page: Page, answer: 'pass' | 'unavailable' = 'pass'): Promise<() => void> {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
        release = resolve;
    });
    await page.route(`${emulatorOrigin('functions')}/**/setup-status`, async (route) => {
        await released;
        const response = await route.fetch();
        if (answer === 'pass') {
            await route.fulfill({ response });
            return;
        }
        const error = { status: 'UNAVAILABLE', message: 'The service is unavailable.', details: { code: 'apiError.unavailable' } };
        await route.fulfill({ response, status: 503, json: { error } });
    });
    return release;
}

/** The chips that read Checking… (finding 32). */
function checkingChips(page: Page) {
    return page.locator('hcm-setup-step').locator('.status[data-checking]');
}

test(
    'Right after a reload every step reads Checking… until the server answers, then its own state; the header never says 0 done',
    { tag: ['@S-A03-HAPPY-CHECKING-AFTER-RELOAD'] },
    async ({ page, lang, adminWorld }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid, {
            mapbox: { state: 'ok', checkedAt: STEPS_AT, user: 'e2e-mapbox' },
        });
        const release = await holdStatus(page);
        await page.goto(adminPath(lang, 'setup'));

        const status = page.locator('hcm-setup-page').locator('header .note[role="status"]');
        await expect(status).toHaveText(setupText(lang, 'adminSetup.checking'));
        await expect(checkingChips(page).first()).toContainText(setupText(lang, 'adminSetup.state.checking'));
        await expect(page.locator('hcm-setup-step').getByText(setupText(lang, 'adminSetup.state.missing'), { exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }).first()).toBeDisabled();

        release();
        await expect(status).toHaveText(templatePattern(setupText(lang, 'adminSetup.progress', { done: '\u0000', total: '\u0000' })));
        await expect(checkingChips(page)).toHaveCount(0);
        expect(await chips(page)).toMatchObject({ billing: 'ok', provision: 'ok', mapbox: 'ok', usgs: 'missing' });
    },
);

test(
    'A server record that cannot be read ends Checking…: the page says why and no chip keeps checking',
    { tag: ['@S-A03-BAD-CHECKING-STATUS-FAILS'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        const release = await holdStatus(page, 'unavailable');
        await page.goto(adminPath(lang, 'setup'));
        await expect(checkingChips(page).first()).toBeVisible();

        release();
        await expect(page.locator('hcm-setup-page').getByRole('alert').first()).toContainText(apiText(lang, 'apiError.unavailable'));
        await expect(checkingChips(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }).first()).toBeEnabled();
        consoleErrors.takeMatching(/status of 503/);
    },
);

test(
    'A failing self-test check names what to fix and links its step; every other check shows its own state',
    { tag: ['@S-A03-BAD-SELFTEST-FAILURE', '@S-A45-HAPPY-MODEL-NAMED'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        // The functions' account may not read the secrets: Secret Manager refuses it.
        await upstream.fail('secret-manager', 'forbidden', 'server');
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;

        const list = page.getByRole('region', { name: setupText(lang, 'adminSetup.selfTest.title') });
        // Every check of the server's list, the `ai` check (M4: Vertex AI's free `countTokens`) among them.
        await expect(list.locator('[data-check]')).toHaveCount(SELF_TEST_CHECKS.length);
        const secrets = list.locator('[data-check="secrets"]');
        await expect(secrets).toHaveAttribute('data-state', 'invalid');
        await expect(secrets).toContainText(apiText(lang, 'apiError.secrets.unavailable'));
        await expect(list.locator('[data-check="firestore"]')).toHaveAttribute('data-state', 'ok');
        await expect(list.locator('[data-check="private-bucket"]')).toHaveAttribute('data-state', 'ok');
        // §67g: the translation drafts' check names the model Vertex AI offers the project, the first of the list here.
        const ai = list.locator('[data-check="ai"]');
        await expect(ai).toHaveAttribute('data-state', 'ok');
        await expect(ai.locator('[data-model]')).toHaveText(setupText(lang, 'adminSetup.selfTest.model', { model: VERTEX_MODEL_IDS[0] }));
        await expectStateSound(page, adminVisit('setup-self-test', lang));

        // The fix: the step that grants the role.
        const fix = secrets.getByRole('link', {
            name: setupText(lang, 'adminSetup.selfTest.fix', { step: setupText(lang, 'adminSetup.step.provision') }),
        });
        await expect(fix).toHaveAttribute('href', '#/setup/provision');
        await fix.click();
        await expect(setup.open('provision')).toBeVisible();
        // A refused secret is a warning of the server's own, not an error the page logs; nothing else failed.
        consoleErrors.takeMatching(/status of 4\d\d/);
    },
);

test(
    'Check again proves that events reach the server: the probe comes back through ops.onProbe and the events check is ok',
    { tag: ['@S-A03-HAPPY-EVENTS-REACH'] },
    async ({ page, lang, adminWorld }) => {
        // M6 (finding 17 of docs/research/manual-test-2026-10-25.md): the check writes ops/probe and the Functions emulator
        // delivers the change to ops.onProbe, which sends the nonce back; on the real project Eventarc delivers it with
        // fn-events@, which needs roles/run.invoker (the emulators skip IAM; S-A03-BAD-EVENTS-REFUSED is the functions tier's).
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`, { timeout: 90_000 });
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        expect((await selfTest).status()).toBe(200);

        const list = page.getByRole('region', { name: setupText(lang, 'adminSetup.selfTest.title') });
        const events = list.locator('[data-check="events"]');
        await expect(events).toHaveAttribute('data-state', 'ok');
        await expect(events).toContainText(setupText(lang, 'adminSetup.selfTest.check.events'));
        const probe = await adminWorld.emulators.document('ops/probe');
        expect(probe?.['receivedNonce']).toBe(probe?.['nonce']);
        expect(probe?.['updatedBy']).toBe('system:ops');
    },
);

// M6 setup-ux (docs/research/M6-interfaces.md §3.1; findings 5, 7, 20 and 24 of docs/research/manual-test-2026-10-25.md).

test(
    "A server check's disabled service names the Setup step that switches it on, with its link, in both languages",
    { tag: ['@S-A04-BAD-CHECK-NAMES-STEP'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await upstream.fail('firebase-management', 'apiDisabled', 'server');
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;

        const check = page
            .getByRole('region', { name: setupText(lang, 'adminSetup.selfTest.title') })
            .locator('[data-check="firebase-management"]');
        const [, tail = ''] = apiText(lang, 'apiError.cloud.apiDisabled', { api: '\u0000' }).split('\u0000');
        await expect(check).toContainText(tail);
        await expect(
            check.getByRole('link', {
                name: setupText(lang, 'adminSetup.selfTest.fix', { step: setupText(lang, 'adminSetup.step.provision') }),
            }),
        ).toHaveAttribute('href', '#/setup/provision');
        // The message names the step, never a button: in both languages, the step's own title.
        for (const language of ['ro', 'en'] as const) {
            const text = apiText(language, 'apiError.cloud.apiDisabled', { api: 'secretmanager.googleapis.com' });
            expect(text).toContain(setupText(language, 'adminSetup.step.provision'));
            expect(text).not.toContain(setupText(language, 'adminSetup.provision.run'));
        }
        consoleErrors.takeMatching(/status of 4\d\d/);
    },
);

test(
    'A failing optional check is said quietly, apart from the others, and Setup stays done',
    { tag: ['@S-A03-HAPPY-OPTIONAL-CHECK-QUIET'] },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        test.setTimeout(150_000);
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
        // Vertex AI does not serve the pinned model to this project (finding 20's leading hypothesis).
        await upstream.scenario('vertex-ai.modelUnavailable', 'server');
        const setup = new SetupPage(page, lang);
        await setup.visit('mapbox');
        // Mapbox and an approved USGS account, saved as the owner does, so the server's own checks find them ok.
        const mapbox = await setup.show('mapbox');
        await mapbox.getByLabel(setupText(lang, 'adminSetup.mapbox.token')).fill(MAPBOX_TOKENS.bootstrap);
        await mapbox.getByRole('button', { name: setupText(lang, 'adminSetup.mapbox.save') }).click();
        await setup.expectState('mapbox', 'ok');
        const usgs = await setup.show('usgs');
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.username')).fill(USGS_CREDENTIALS.approved.username);
        await followDeepLink(page, () =>
            usgs.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) }).click(),
        );
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).fill(USGS_CREDENTIALS.approved.applicationToken);
        await usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token')).press('Enter');
        await setup.expectState('usgs', 'ok');
        const ready = page.locator('hcm-setup-page').locator('.ready');
        await expect(ready).toHaveText(setupText(lang, 'adminSetup.ready'));

        const selfTest = page.waitForResponse(`${emulatorOrigin('functions')}/**/setup-selfTest`);
        await page
            .getByRole('button', { name: setupText(lang, 'adminSetup.recheck') })
            .first()
            .click();
        await selfTest;

        const list = page.getByRole('region', { name: setupText(lang, 'adminSetup.selfTest.title') });
        const ai = list.locator('[data-check="ai"]');
        await expect(ai).toHaveAttribute('data-optional', '');
        await expect(ai).not.toHaveAttribute('data-state', 'ok');
        await expect(ai).toContainText(setupText(lang, 'adminSetup.selfTest.off.ai'));
        await expect(ai.locator('.reason')).not.toBeEmpty();
        await expect(ai.locator('hcm-icon')).toHaveAttribute('name', 'info');
        await expect(list.getByRole('heading', { name: setupText(lang, 'adminSetup.selfTest.optionalTitle') })).toBeVisible();
        // The required checks' list does not hold it; Setup is still done.
        await expect(list.locator('ul.checks:not(.optional) [data-check="ai"]')).toHaveCount(0);
        await expect(ready).toHaveText(setupText(lang, 'adminSetup.ready'));
        consoleErrors.takeMatching(/status of 4\d\d/);
    },
);

test.describe('start-up mode, before the server', () => {
    test.use({ persona: null, mapOwner: null });

    /** Signs the owner in to start-up mode (the server hidden) with `record` in the tab; one read-only consent. */
    async function startUp(
        page: Page,
        lang: 'ro' | 'en',
        fixtures: StartUp,
        record: Readonly<Record<string, unknown>>,
    ): Promise<SetupPage> {
        const { consent, inputBudget, serverDeployment } = fixtures;
        await serverDeployment.hide();
        await page.route('**/runtime.json', (route) => route.fulfill({ json: { ...ADMIN_RUNTIME, startUp: true } }));
        await rememberBootstrap(page, E2E_PROJECT_ID, record);
        await page.goto(adminPath(lang));
        const signIn = await consent.opened(page, () =>
            inputBudget.flow('signIn', 1).click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
        );
        await signIn.chooseAccount(PERSONAS.owner.email);
        await signIn.allow(inputBudget.flow('signInConsent', 1));
        return new SetupPage(page, lang);
    }

    /** The count of functions installed, wherever the card says it (a line, a reason). */
    function countLines(card: ReturnType<SetupPage['open']>, lang: 'ro' | 'en') {
        return card.getByText(templatePattern(setupText(lang, 'adminSetup.deploy.progress', { ready: '\u0000', total: '\u0000' })));
    }

    test(
        'A consent note appears only where its button asks Google now: beside Prepare the project, not on the server card while the token lives',
        { tag: ['@S-A03-HAPPY-CONSENT-NOTE-WHERE-ASKED'] },
        async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment }) => {
            await upstream.scenario('google.provisioned', 'browser');
            await upstream.scenario('service-usage.allEnabled', 'browser');
            await upstream.scenario('cloud-functions.partial', 'browser');
            const setup = await startUp(page, lang, { consent, inputBudget, serverDeployment }, bootstrapRecord(E2E_PROJECT_ID, false));
            const notes = { projectId: E2E_PROJECT_ID, domain: ADMIN_WEB_CONFIG.authDomain };

            // Only the sign-in's read-only token lives: Prepare the project (its Check again) will ask Google, so it says so.
            const provision = await setup.show('provision');
            await setup.expectConsentNote(provision, 'cloudPlatform', notes);
            await withConsent(
                page,
                consent,
                provision.getByRole('button', { name: setupText(lang, 'adminSetup.recheck') }),
                setupBudget.inputs('provision'),
                setupBudget.consents('provision'),
            );

            // Google's cloud-platform token now lives: the server's card asks nothing of Google, so it has no note.
            const deploy = await setup.show('deploy');
            await expect(deploy.getByRole('complementary')).toHaveCount(0);
            expect(await countLines(deploy, lang).count()).toBeLessThanOrEqual(1);
            await expect((await setup.show('provision')).getByRole('complementary')).toHaveCount(0);
        },
    );

    test(
        'A partial install with the token gone shows its count once and the consent note beside the button that will ask',
        { tag: ['@S-A03-BAD-ONE-COUNT'] },
        async ({ page, lang, consent, inputBudget, upstream, serverDeployment }) => {
            await upstream.scenario('google.provisioned', 'browser');
            await upstream.scenario('service-usage.allEnabled', 'browser');
            await upstream.scenario('cloud-functions.partial', 'browser');
            const setup = await startUp(page, lang, { consent, inputBudget, serverDeployment }, bootstrapRecord(E2E_PROJECT_ID, false));
            await setup.expectState('provision', 'ok');
            const deploy = await setup.show('deploy');

            // Only the read-only token of the sign-in lives: the card's button will ask, so its note is there, once.
            await expect(deploy.getByRole('complementary')).toHaveCount(1);
            await setup.expectConsentNote(deploy, 'cloudPlatform', { projectId: E2E_PROJECT_ID, domain: ADMIN_WEB_CONFIG.authDomain });
            expect(await countLines(deploy, lang).count()).toBeLessThanOrEqual(1);
            // No line of the card says the same thing twice.
            const lines = await deploy.locator('p').allTextContents();
            const said = lines.map((line) => line.trim()).filter((line) => line !== '');
            expect(said).toHaveLength(new Set(said).size);
        },
    );
});

interface StartUp {
    readonly consent: GoogleConsent;
    readonly inputBudget: InputBudget;
    readonly serverDeployment: ServerDeployment;
}
