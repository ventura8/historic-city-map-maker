import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { START_PROJECT_TOKEN, START_RELEASE_FILE, START_TREE_FOLDER, startReleaseSchema, type StartRelease } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { adminVisit } from '../../../tour/states.js';
import { engineEvents, waitForEngineEvent } from '../../../support/viewer.js';
import { setupText, shellText } from '../../support/i18n.js';
import { billingDoneRecord, installState, nextLook, submittedBuilds } from '../../support/install.js';
import { SetupPage } from '../../support/setup-page.js';
import { rememberBootstrap, withConsent } from '../../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { giveViewerToken, servePublicBucket } from '../cities/journey-world.js';
import { cityText } from '../cities/world.js';
import { PERSONAS } from '../../world.js';
import { E2E_START_DIR } from '../../world.js';
import {
    allowConsent,
    cancelConsent,
    CITY,
    claimProjectRead,
    FakeHostingUploads,
    filesWithToken,
    fillPlan,
    PROJECT,
    publishedSite,
    REPOSITORY,
    serveReleased,
    START_URL,
    startPage,
    startText,
} from './world.js';

// The fake's project is the emulators' own (`demo-hcm`), so what is released can run against them.
test.describe.configure({ lock: ADMIN_LOCK });

function releaseFolder(): string {
    const root = join(REPOSITORY, E2E_START_DIR);
    const config = JSON.parse(readFileSync(join(root, 'start-config.json'), 'utf8')) as { readonly release: string };
    return join(root, 'release', config.release);
}

function releaseManifest(): StartRelease {
    return startReleaseSchema.parse(JSON.parse(readFileSync(join(releaseFolder(), START_RELEASE_FILE), 'utf8')));
}

/** Every file released is the tree's, whose digest the manifest names, with this project where it holds the token. */
function expectManifestReleased(manifest: StartRelease, released: Readonly<Record<string, Uint8Array>>): void {
    for (const file of manifest.files) {
        const source = readFileSync(join(releaseFolder(), START_TREE_FOLDER, file.path));
        expect(createHash('sha256').update(source).digest('hex'), file.path).toBe(file.sha256);
        const expected = file.template === true ? Buffer.from(source.toString('utf8').replaceAll(START_PROJECT_TOKEN, PROJECT)) : source;
        expect(Buffer.compare(Buffer.from(released[file.path] ?? []), expected), file.path).toBe(0);
    }
}

/** The tree holds nobody's project and none of Bucharest's data: what a tarball holds is `start.test.ts`'s and the publish's. */
function expectGenericTree(manifest: StartRelease): void {
    for (const file of manifest.files.filter((item) => !item.path.endsWith('.tgz') && !item.path.endsWith('.woff2'))) {
        const text = readFileSync(join(releaseFolder(), START_TREE_FOLDER, file.path), 'utf8');
        expect(text.includes(PROJECT) || text.includes('bucurestiul-disparut'), file.path).toBe(false);
    }
    const paths = manifest.files.map((file) => file.path);
    expect(paths.filter((path) => path.startsWith('data/') || path === 'config.js' || path.includes('/legacy/'))).toEqual([]);
}

async function openStart(page: Page, testId: string, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(`${START_URL}?test=${encodeURIComponent(testId)}&lang=${lang}`);
    await expect(startPage(page).getByRole('heading', { level: 1 })).toBeVisible();
}

test(
    'A new owner starts a map from nothing, in a browser',
    { tag: ['@S-A76-HAPPY', '@S-A76-HAPPY-ANNOUNCED'] },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        const uploads = new FakeHostingUploads();
        await uploads.install(context, mockApiRequest, testId);

        await openStart(page, testId, lang);
        const start = startPage(page);
        for (const key of ['start.get.title', 'start.cost.title', 'start.accounts.title', 'start.consent.title'] as const) {
            await expect(start.getByRole('heading', { name: startText(lang, key) })).toBeVisible();
        }
        await expect(start.getByText(startText(lang, 'start.consent.warning'))).toBeVisible();
        await expectStateSound(page, adminVisit('start.intro', lang));

        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        // The token is on the fragment for a moment only.
        await expect.poll(() => new URL(page.url()).hash).toBe('');
        await expect(start.getByRole('heading', { name: startText(lang, 'start.plan.title') })).toBeVisible();
        await fillPlan(page, lang);
        await expectStateSound(page, adminVisit('start.plan', lang));

        // Held at the create: the long run is said to a screen reader, from the heading it moved to.
        let releaseCreate: () => void = () => undefined;
        const created = new Promise<void>((resolve) => {
            releaseCreate = resolve;
        });
        await page.route('https://cloudresourcemanager.googleapis.com/v3/projects', async (route) => {
            await created;
            await route.fallback();
        });
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('heading', { level: 1, name: startText(lang, 'start.work.title') })).toBeFocused();
        await expect(start.getByRole('status').filter({ hasText: startText(lang, 'start.step.project') })).toHaveText(
            startText(lang, 'start.work.now', { step: startText(lang, 'start.step.project') }),
        );
        releaseCreate();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        await expect(start.getByRole('heading', { level: 1 })).toBeFocused();
        await claimProjectRead(consoleErrors);
        // The admin's address is there before anything could read that sign-in is on (M14 §4).
        await expect(start.locator('[data-open-admin]')).toHaveAttribute('href', `https://${PROJECT}.web.app/admin/`);
        const console = start.getByRole('link', { name: startText(lang, 'start.provider.link') });
        await expect(console).toHaveAttribute('href', `https://console.firebase.google.com/project/${PROJECT}/authentication/providers`);
        await expectStateSound(page, adminVisit('start.provider', lang));

        // The console's click is the owner's: until it is done, Check again says so.
        await start.getByRole('button', { name: startText(lang, 'start.provider.check') }).click();
        await expect(start.getByText(startText(lang, 'start.provider.waiting'))).toBeVisible();
        await upstream.scenario('firebase-hosting.googleSignInOn', 'browser');
        await start.getByRole('button', { name: startText(lang, 'start.provider.check') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.done.title') })).toBeVisible();
        await expect(start.locator('[data-open-admin]')).toHaveAttribute('href', `https://${PROJECT}.web.app/admin/`);
        await expectStateSound(page, adminVisit('start.done', lang));

        // What was released is the manifest's, byte for byte, with the project put in; nothing names the build's project.
        const folder = testId.replace(/[^\w-]/g, '-').slice(0, 100);
        const released = await uploads.releaseToFolder(upstream, folder);
        const manifest = releaseManifest();
        expect(new Set(Object.keys(released.files))).toEqual(new Set([...manifest.files.map((file) => file.path), 'admin/project.json']));
        expectManifestReleased(manifest, released.bytes);
        expectGenericTree(manifest);
        expect(JSON.stringify(released.config)).toContain(`"${PROJECT}`.replace('"', ''));
        expect(JSON.stringify(released.config)).not.toContain('__HCM_PROJECT_ID__');
        const project = JSON.parse(released.files['admin/project.json'] ?? '{}') as Record<string, unknown>;
        expect(project).toMatchObject({
            projectId: PROJECT,
            cities: [CITY.id],
            firstCity: { id: CITY.id, name: { ro: CITY.nameRo, en: CITY.nameEn } },
        });
        expect(project).not.toHaveProperty('github');
        expect(released.files['admin/runtime.json']).toContain('"startUp": true');
        expect(released.files['index.html']).not.toContain('mapbox');
        expect(Object.keys(released.files).filter((path) => path.startsWith('admin/legacy/'))).toEqual([]);

        // The released admin itself, from those bytes: it boots and opens the Setup Assistant in start-up mode.
        await serveReleased(context, folder);
        await page.goto(`/admin/?test=${encodeURIComponent(testId)}&lang=${lang}`);
        await expect(page.locator('hcm-admin-shell')).toBeVisible();
        await expect(page.locator('hcm-sign-in, hcm-setup-page').first()).toBeVisible();
    },
);

test(
    'From the start page to a live map of Fostul Bacău, on the bytes that were released',
    { tag: ['@S-A76-HAPPY-LIVE', '@S-A76-HAPPY-ROOT', '@S-A76-BAD-NEW-CITY-AGAIN'] },
    async (
        { page, context, lang, upstream, consent, setupBudget, serverDeployment, adminWorld, mockApiRequest, consoleErrors },
        testInfo,
    ) => {
        test.setTimeout(420_000);
        const testId = testIdOf(testInfo);
        const { emulators } = adminWorld;
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.googleSignInOn', 'browser');
        const uploads = new FakeHostingUploads();
        await uploads.install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.done.title') })).toBeVisible({ timeout: 90_000 });
        await claimProjectRead(consoleErrors);
        const folder = `live-${testId.replace(/[^\w-]/g, '-').slice(0, 90)}`;
        await uploads.releaseToFolder(upstream, folder);

        // The Setup Assistant, on the released admin: Prepare the project leaves GitHub out (CR-M5-7).
        await serveReleased(context, folder);
        await upstream.scenario('cloud-billing.enabled', 'browser');
        await upstream.scenario('billing-budgets.appBudget', 'browser');
        await serverDeployment.hide();
        await rememberBootstrap(page, PROJECT, billingDoneRecord());
        await page.clock.install();
        await page.clock.resume();
        await page.goto(`/admin/?lang=${lang}&test=${encodeURIComponent(testId)}`);
        const signIn = await consent.opened(page, () =>
            setupBudget.inputs('signIn').click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
        );
        await signIn.chooseAccount(PERSONAS.owner.email);
        await signIn.allow(setupBudget.consents('signIn'));
        const setup = new SetupPage(page, lang);
        const provision = await setup.show('provision');
        await withConsent(
            page,
            consent,
            provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }),
            setupBudget.inputs('provision'),
            setupBudget.consents('provision'),
        );
        await setup.expectState('provision', 'ok', 120_000);
        const iam = JSON.stringify((await upstream.snapshot('browser'))['iam']);
        expect(iam).toContain('hcm-installer');
        expect(iam).not.toContain('gh-deployer');
        expect(iam).not.toContain('site-master');

        // Install the server from the bundle the page released; the fake plays the build, then the server answers.
        const deploy = await setup.show('deploy');
        await expect(deploy.getByText(setupText(lang, 'adminSetup.install.github'))).toBeHidden();
        await setupBudget.inputs('deploy').click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') }));
        await expect.poll(async () => (await submittedBuilds(upstream)).length).toBeGreaterThanOrEqual(2);
        await upstream.scenario('cloud-build.finish', 'browser');
        await upstream.scenario('secret-manager.provisioned', 'server');
        await nextLook(page, installState(setup.open('deploy')).filter({ hasText: setupText(lang, 'adminSetup.install.state.installed') }));
        await serverDeployment.show();
        await page.clock.fastForward(30_000);
        await setup.expectState('claim', 'ok', 60_000);
        serverDeployment.claimErrors();

        // New city opens with what the start page was told, one click from created.
        await page.goto(`/admin/?lang=${lang}&test=${encodeURIComponent(testId)}#/cities/new`);
        const form = page.locator('hcm-new-city-page');
        await expect(form.getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true })).toHaveValue(CITY.nameRo);
        await expect(form.getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true })).toHaveValue(CITY.id);
        await form.locator('form > .actions hcm-button').click();
        await expect(form.locator(`[data-city-created="${CITY.id}"]`)).toBeVisible({ timeout: 60_000 });
        // The viewer's token is minted right after the create, best effort: this project has no Mapbox yet, so it is refused.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400 .*setup-rotatePublicToken/).length).toBe(1);
        await giveViewerToken(emulators, CITY.id);

        // The city exists: project.json still names it, and New city no longer offers it. A new page load, as the owner's next visit.
        await page.reload();
        await expect(form.getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true })).toHaveValue('');
        await expect(form.getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true })).toHaveValue('');

        // Published, its manifest in the public bucket: the live map, at the address of the released rewrites.
        await page.goto(`/admin/?lang=${lang}&test=${encodeURIComponent(testId)}#/c/${CITY.id}/settings/publish`);
        await page.getByRole('switch', { name: cityText(lang, 'adminContent.settings.publish.label') }).click();
        await page.getByRole('button', { name: cityText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect
            .poll(async () => (await emulators.document(`manifests/${CITY.id}`))?.['url'], { timeout: 120_000 })
            .toEqual(expect.any(String));
        await servePublicBucket(page, emulators);
        await page.goto(`/${CITY.id}/?lang=${lang}`);
        await waitForEngineEvent(page, 'hcm-ready');
        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: CITY.id })]);

        // Publish the map's site build on the real generic bundle: only the admin's script keeps the token, as the text it looks
        // for; the city page's policy and everything else name the project.
        const site = await publishedSite(folder);
        expect(filesWithToken(site).filter((path) => !/\/admin\/[^/]+\.m?js$/.test(path))).toEqual([]);
        await serveReleased(context, site);
        // The root now goes to the first city, a page load away, and the map boots there from the published files.
        await page.goto(`/?lang=${lang}`);
        await page.waitForURL(new RegExp(`/${CITY.id}/`));
        await waitForEngineEvent(page, 'hcm-ready');
        const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
        expect(policy).toContain(`https://us-central1-${PROJECT}.cloudfunctions.net`);
    },
);

test(
    'Before its OAuth client exists the page explains and offers the terminal, with no button',
    { tag: '@S-A76-BAD-CLOSED' },
    async ({ page, lang }, testInfo) => {
        await page.route('**/start/start-config.json', (route) => route.fulfill({ json: { release: 'none' } }));
        await openStart(page, testIdOf(testInfo), lang);
        const start = startPage(page);
        await expect(start.getByRole('heading', { name: startText(lang, 'start.closed.title') })).toBeVisible();
        await expect(start.getByRole('button', { name: startText(lang, 'start.signIn') })).toBeHidden();
        await expectStateSound(page, adminVisit('start.closed', lang));
    },
);

test('Refusing Google’s consent changes nothing', { tag: '@S-A76-BAD-DENIED' }, async ({ page, lang }, testInfo) => {
    const testId = testIdOf(testInfo);
    await openStart(page, testId, lang);
    const start = startPage(page);
    await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
    await cancelConsent(page);
    await expect(start.getByRole('alert')).toHaveText(startText(lang, 'start.signedOut.denied'));
    await expect(start.getByRole('button', { name: startText(lang, 'start.signIn') })).toBeVisible();
});

test(
    'Firebase’s terms stop the run with their link, and Try again continues',
    { tag: '@S-A76-BAD-TERMS' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.termsNotAccepted', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();

        await expect(start.getByRole('alert')).toContainText(startText(lang, 'start.failure.terms'));
        await expect(start.getByRole('link', { name: startText(lang, 'start.failure.termsLink') })).toHaveAttribute(
            'href',
            'https://console.firebase.google.com/',
        );
        await expect(start.locator('[data-step="firebase"]')).toHaveAttribute('data-state', 'failed');
        await expect.poll(() => consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
        await expectStateSound(page, adminVisit('start.work-failed', lang));
        const creates = await upstream.calls('browser', 'start.projects.create');
        expect(creates).toHaveLength(1);

        await upstream.scenario('firebase-hosting.termsAccepted', 'browser');
        await start.getByRole('button', { name: startText(lang, 'start.tryAgain') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        // Nothing is made twice.
        expect(await upstream.calls('browser', 'start.projects.create')).toHaveLength(1);
    },
);

test(
    'A taken project id is refused, with a free one offered',
    { tag: '@S-A76-BAD-ID-TAKEN' },
    async ({ page, lang, upstream, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.idTaken', 'browser');
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('alert')).toContainText(startText(lang, 'start.failure.taken', { projectId: PROJECT }));
        await expect(start.getByLabel(startText(lang, 'start.plan.projectId'))).toHaveValue(`${PROJECT}-2`);
        await expect.poll(() => consoleErrors.takeMatching(/status of 409/).length).toBeGreaterThan(0);
        await claimProjectRead(consoleErrors);
    },
);

test(
    'The project limit says so, with the way to ask for more',
    { tag: '@S-A76-BAD-QUOTA' },
    async ({ page, lang, upstream, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.quotaReached', 'browser');
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('alert')).toContainText(startText(lang, 'start.failure.quota'), { timeout: 60_000 });
        await expect(start.getByRole('link', { name: startText(lang, 'start.failure.quotaLink') })).toBeVisible();
        await expect.poll(() => consoleErrors.takeMatching(/status of 429/).length).toBeGreaterThan(0);
        await claimProjectRead(consoleErrors);
    },
);

test('The form says what it cannot take, and Create waits', { tag: '@S-A76-BAD-FORM' }, async ({ page, lang, upstream }, testInfo) => {
    const testId = testIdOf(testInfo);
    await upstream.scenario('firebase-hosting.fresh', 'browser');
    await openStart(page, testId, lang);
    const start = startPage(page);
    await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
    await allowConsent(page);
    await fillPlan(page, lang, 'Nu E Bun');
    await start.getByLabel(startText(lang, 'start.plan.east'), { exact: true }).fill('40');
    await expect(start.locator('[data-area-problem]')).toHaveText(startText(lang, 'start.plan.areaTooBig'));
    await expect(start.getByLabel(startText(lang, 'start.plan.east'), { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(start.locator('[data-area-status]')).toHaveRole('status');
    await expect(start.getByText(startText(lang, 'start.plan.projectIdInvalid'))).toBeVisible();
    await expect(start.getByRole('button', { name: startText(lang, 'start.plan.go') })).toBeDisabled();
    await expectStateSound(page, adminVisit('start.plan-invalid', lang));
});

test(
    'A reload in the middle resumes from the plan, after one more consent',
    { tag: '@S-A76-HAPPY-RESUME' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.termsNotAccepted', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('alert')).toContainText(startText(lang, 'start.failure.terms'));

        await expect.poll(() => consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
        await page.reload();
        await expect(start.getByRole('alert')).toContainText(startText(lang, 'start.failure.expired'));
        await upstream.scenario('firebase-hosting.termsAccepted', 'browser');
        await start.getByRole('button', { name: startText(lang, 'start.continue') }).click();
        await allowConsent(page);
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        expect(await upstream.calls('browser', 'start.projects.create')).toHaveLength(1);
    },
);

test(
    'A project the owner has already is used, not made',
    { tag: '@S-A76-HAPPY-EXISTING' },
    async ({ page, context, lang, upstream, mockApiRequest }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.ownedProject', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByLabel(startText(lang, 'start.plan.existingProject')).check();
        await start.getByLabel(startText(lang, 'start.plan.pick')).selectOption(PROJECT);
        await start.getByRole('button', { name: startText(lang, 'start.plan.goExisting') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        expect(await upstream.calls('browser', 'start.projects.create')).toHaveLength(0);
        expect(await upstream.calls('browser', 'start.firebase.add')).toHaveLength(0);
    },
);

test(
    'A browser that cannot reach Hosting’s upload host is told, with the terminal road',
    { tag: '@S-A76-BAD-UPLOAD' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        let refuse = true;
        await new FakeHostingUploads().install(context, mockApiRequest, testId, () => refuse);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('alert')).toContainText('npx create-historic-city', { timeout: 60_000 });
        await expect(start.locator('[data-step="files"]')).toHaveAttribute('data-state', 'failed');
        await expect.poll(() => consoleErrors.takeMatching(/upload-firebasehosting/).length).toBeGreaterThan(0);
        await claimProjectRead(consoleErrors);
        // Nothing is released: the site stays as it was.
        const snapshot = (await upstream.snapshot('browser'))['firebase-hosting'] as { readonly live: object };
        expect(snapshot.live).toEqual({});
        refuse = false;
        await start.getByRole('button', { name: startText(lang, 'start.tryAgain') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
    },
);

test(
    'A city name with punctuation and a decimal comma still make a plan',
    { tag: '@S-A76-HAPPY-PLAN-WORDS' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByLabel(startText(lang, 'start.plan.cityName'), { exact: true }).fill('Sf. Gheorghe, vechi');
        await start.getByLabel(startText(lang, 'start.plan.west'), { exact: true }).fill(CITY.west.replace('.', ','));
        await expect(start.locator('[data-area-problem]')).toBeHidden();
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        await claimProjectRead(consoleErrors);
        const { projects } = (await upstream.snapshot('browser'))['firebase-hosting'] as {
            readonly projects: Readonly<Record<string, string>>;
        };
        expect(projects[PROJECT]).toBe('Sf Gheorghe vechi');
    },
);

test(
    'A project Google refuses goes back to the form, which says so',
    { tag: '@S-A76-BAD-PROJECT-REFUSED' },
    async ({ page, lang, upstream, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await upstream.scenario('firebase-hosting.projectRefused', 'browser');
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('alert')).toHaveText(startText(lang, 'start.failure.refused'));
        await expect(start.getByLabel(startText(lang, 'start.plan.cityName'), { exact: true })).toBeVisible();
        await expect(start.getByRole('button', { name: startText(lang, 'start.tryAgain') })).toBeHidden();
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
        await claimProjectRead(consoleErrors);
    },
);

test(
    'After the release nothing releases again: not a reload, a new consent or another tab',
    { tag: '@S-A76-BAD-RELEASE-AGAIN' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        const provider = start.getByRole('heading', { name: startText(lang, 'start.provider.title') });
        await expect(provider).toBeVisible({ timeout: 60_000 });
        await claimProjectRead(consoleErrors);
        const releases = async (): Promise<number> => (await upstream.calls('browser', 'start.hosting.releases.create')).length;
        expect(await releases()).toBe(1);

        // A reload: the provider step, with no token; Check again asks for one and reads the provider, nothing else.
        await page.reload();
        await expect(provider).toBeVisible();
        await expect(start.locator('[data-open-admin]')).toHaveAttribute('href', `https://${PROJECT}.web.app/admin/`);
        await start.getByRole('button', { name: startText(lang, 'start.provider.check') }).click();
        await allowConsent(page);
        await expect(provider).toBeVisible();
        expect(await releases()).toBe(1);

        // The plan gone, the same new project asked for again: what is live stays.
        await page.evaluate(() => {
            sessionStorage.clear();
        });
        await page.reload();
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(provider).toBeVisible({ timeout: 60_000 });
        expect(await releases()).toBe(1);
        expect(await upstream.calls('browser', 'start.projects.create')).toHaveLength(1);
    },
);

test(
    'A provider that cannot be read is said so, and the admin’s address is still there',
    { tag: '@S-A76-BAD-PROVIDER-UNREADABLE' },
    async ({ page, context, lang, upstream, mockApiRequest, consoleErrors }, testInfo) => {
        const testId = testIdOf(testInfo);
        await upstream.scenario('firebase-hosting.fresh', 'browser');
        await new FakeHostingUploads().install(context, mockApiRequest, testId);
        await openStart(page, testId, lang);
        const start = startPage(page);
        await start.getByRole('button', { name: startText(lang, 'start.signIn') }).click();
        await allowConsent(page);
        await fillPlan(page, lang);
        await start.getByRole('button', { name: startText(lang, 'start.plan.go') }).click();
        await expect(start.getByRole('heading', { name: startText(lang, 'start.provider.title') })).toBeVisible({ timeout: 60_000 });
        await claimProjectRead(consoleErrors);
        await upstream.fail('firebase-management', 'forbidden', 'browser');
        await start.getByRole('button', { name: startText(lang, 'start.provider.check') }).click();
        await expect(start.getByRole('status').filter({ hasText: startText(lang, 'start.provider.unreadable') })).toBeVisible();
        await expect(start.getByText(startText(lang, 'start.provider.waiting'))).toBeHidden();
        await expect(start.getByRole('link', { name: startText(lang, 'start.provider.open') })).toHaveAttribute(
            'href',
            `https://${PROJECT}.web.app/admin/`,
        );
        await expect.poll(() => consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
        await expectStateSound(page, adminVisit('start.provider-unreadable', lang));
    },
);
