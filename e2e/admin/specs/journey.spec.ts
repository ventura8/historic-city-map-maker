import { SITE_PUBLISH_TRANSFER_MB, SITE_PUBLISH_TRANSFER_TRIMMED_MB } from '@hcm/shared';
import { COUNTRY_SEEDS } from '@hcm/shared/country-seeds';
import { MAPBOX_TOKENS, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Locator, Page, Request } from '@playwright/test';

import { contentFlowBudget } from '../../../packages/admin/src/content/budgets.js';
import { GOOGLE_SCOPES } from '../../../packages/admin/src/google/scopes.js';
import { E2E_CITY_ID } from '../../fixtures/world.js';
import { hostingUrl } from '../../support/hosting.js';
import type { InputFlow } from '../../support/budget.js';
import type { TestFixtures } from '../../support/test.js';
import { engineEvents, waitForEngineEvent } from '../../support/viewer.js';
import type { SetupBudget } from '../support/budget.js';
import { capture, captureElement } from '../support/capture.js';
import type { GoogleConsent } from '../support/consent.js';
import type { ServerDeployment } from '../support/deployment.js';
import type { EmulatorWorld } from '../support/emulators.js';
import { apiText, setupText, shellText, sourcesText } from '../support/i18n.js';
import {
    followSiteRelease,
    INSTALL_RELEASE,
    installState,
    nextLook,
    preparedProject,
    recordsSettled,
    seedPublishedMap,
    serveInstallBundle,
    servePublishedMap,
    submittedBuilds,
    trackRecords,
} from '../support/install.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import { STEPS_AT, withConsent } from '../support/steps.js';
import { recordLiveRegions } from '../../support/live-regions.js';
import { expectStateSound } from '../../support/state-check.js';
import { adminVisit, type AdminStateId } from '../../tour/states.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../support/test.js';
import type { UpstreamControl } from '../support/upstream.js';
import { ADMIN_WEB_CONFIG, emulatorOrigin, E2E_PROJECT_ID } from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The owner's whole journey through the Setup Assistant (docs/research/M2b-interfaces.md §3; since M6 with no terminal
 * step, docs/research/M6-interfaces.md §4), against the emulators and the fake upstreams, from a Google Cloud project
 * with no billing account and no server to the public map at the root of the project's Hosting site:
 *
 * 1. start-up mode, as a new map's Hosting-only deploy serves it (`runtime.json` says `startUp`, with the admin's
 *    release, whose install bundle Hosting serves beside it): the admin calls nothing of the server, so the browser
 *    logs no error; the owner signs in with a read-only Google consent and Google proves the ownership;
 * 2. billing: no billing account yet (the deep link), the owner creates one on Google's page, the card links it by itself
 *    and creates the budget;
 * 3. provisioning: Secret Manager is down at first, so the secrets and what needs them wait; Retry what failed;
 * 4. Install the server: one click submits the server's and the imagery pipeline's Cloud Build builds (the fake plays
 *    them); once every function is there and the server answers, the claim runs without a click;
 * 5. Mapbox: a demo account is refused, the owner adds a card on Mapbox's page and pastes the token again;
 * 6. USGS: Do it later (the owner has no USGS account yet), so Setup goes on;
 * 7. analytics: detected once Google Analytics is linked to the project; the GA4 stream setting; the crash reports;
 * 8. the legacy import: one click, 57 photos (the 45 and the 2023 additions) through the photo pipeline, published and in the manifest;
 * 9. the imagery pipeline the server's click installed, then Publish the map: one click, the viewer at the Hosting
 *    root shows the 57 photos the server published, the admin stays at `/admin/`, and Setup is done with USGS later;
 * 10. USGS after all: the paste box opens before the token page, with the countdown; the M2M role waits for USGS's
 *     approval, which the server's six-hourly check (`ops.tick`) finds, and Home's reminder goes.
 *
 * Every in-app input and every Google consent is counted against `SETUP_STEP_SPECS` (§3.5, M6 §4.2), each bad path with
 * its declared allowance; what the human does on the providers' pages is not counted, and no Setup text names a command.
 */

test.use({ persona: null, mapOwner: null });

/** The pages the deep links of this journey open (the human's work there is out of the app). */
const PROVIDER_ORIGINS = ['https://ers.cr.usgs.gov', 'https://console.firebase.google.com'];

/** The emulators' origins whose requests start-up mode must not make (a start-up deploy does not even probe the server). */
const BACKEND = [emulatorOrigin('firestore'), emulatorOrigin('storage'), emulatorOrigin('functions')];

/** Records the path of every request of the page to Firestore, Storage or a callable until `stop()`. */
function backendRequests(page: Page): { readonly paths: string[]; stop(): void } {
    const paths: string[] = [];
    const listener = (request: Request): void => {
        if (BACKEND.some((origin) => request.url().startsWith(origin))) {
            paths.push(new URL(request.url()).pathname);
        }
    };
    page.on('request', listener);
    return {
        paths,
        stop: () => {
            page.off('request', listener);
        },
    };
}

/** The navigation's destinations and its More button (the bar of a compact window keeps the rest behind it). */
function destinations(page: Page): Locator {
    const navigation = page.getByRole('navigation');
    return navigation.getByRole('link').or(navigation.getByRole('button'));
}

/** The leading text of a catalogue text with a placeholder, as a pattern (`Link billing and create the …`). */
function startOf(text: string): RegExp {
    return new RegExp(`^${(text.split('{')[0] ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/** The USGS countdown's text with any number of seconds, as a pattern. */
function countdownPattern(lang: 'ro' | 'en'): RegExp {
    const [head = '', tail = ''] = setupText(lang, 'adminSetup.usgs.countdown', { seconds: '\u0000' }).split('\u0000');
    const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escape(head)}(\\d+)${escape(tail)}$`);
}

/** The seconds the USGS countdown shows now. */
async function countdownSeconds(timer: Locator, lang: 'ro' | 'en'): Promise<number> {
    const [, seconds] = countdownPattern(lang).exec(await timer.innerText()) ?? [];
    return Number(seconds);
}

/**
 * A state of the journey: the generic layout and accessibility checkers on it (the admin's inventory,
 * e2e/tour/states.ts → `ADMIN_STATES`), then its review screenshots (`capture`, only with `HCM_SCREENSHOTS`).
 */
async function checkpoint(
    page: Page,
    lang: 'ro' | 'en',
    shot: string,
    state: AdminStateId,
    announcements: readonly string[] = [],
): Promise<void> {
    await expectStateSound(page, adminVisit(state, lang, { announcements }));
    await capture(page, shot);
}

/** What every step of the journey drives: the page, the Setup page object and the admin tier's fixtures. */
interface Journey {
    readonly page: Page;
    readonly lang: 'ro' | 'en';
    readonly setup: SetupPage;
    readonly consent: GoogleConsent;
    readonly setupBudget: SetupBudget;
    readonly skipUsgs: InputFlow;
    readonly upstream: UpstreamControl;
    readonly serverDeployment: ServerDeployment;
    readonly consoleErrors: TestFixtures['consoleErrors'];
    readonly emulators: EmulatorWorld;
    readonly notes: { readonly projectId: string; readonly domain: string };
}

/** 1. Start-up mode: one read-only consent proves the ownership. */
async function signInInStartUpMode({ page, lang, setup, consent, setupBudget, notes }: Journey): Promise<void> {
    await setup.expectConsentNote(page.locator('hcm-sign-in'), 'cloudReadOnly', notes);
    await checkpoint(page, lang, '01-sign-in', 'sign-in');
    const signInButton = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
    const signIn = await consent.opened(page, () => setupBudget.inputs('signIn').click(signInButton));
    expect(await signIn.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudReadOnly]);
    await signIn.allow(setupBudget.consents('signIn'));
    await expect(page.getByText(shellText(lang, 'adminShell.bootstrap.banner'))).toBeVisible();
    await setup.expectState('signIn', 'ok');
    // Start-up mode offers the Setup destination only.
    await expect(destinations(page)).toHaveCount(1);
}

/** 2. Billing. The billing APIs are off on a new project, so this consent is cloud-platform (provisioning then needs none). */
async function linkBilling({ page, lang, setup, consent, setupBudget, upstream, notes }: Journey): Promise<void> {
    const billing = setup.open('billing');
    await setup.expectConsentNote(billing, 'cloudPlatform', notes);
    const link = billing.getByRole('button', { name: startOf(setupText(lang, 'adminSetup.billing.link')) });
    const billingConsent = await consent.opened(page, () => setupBudget.inputs('billing').click(link));
    expect(await billingConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
    await billingConsent.allow(setupBudget.consents('billing'));
    await expect(billing.getByText(setupText(lang, 'adminSetup.billing.noAccount'))).toBeVisible();
    await expect(billing.getByText(setupText(lang, 'adminSetup.billing.cost'))).toBeVisible();
    await expect(billing.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.gcp.billingAccounts')) })).toHaveAttribute(
        'href',
        'https://console.cloud.google.com/billing',
    );
    await checkpoint(page, lang, '02-billing-no-account', 'billing-no-account');
    await upstream.scenario('cloud-billing.accountOpen', 'browser');
    await page.clock.fastForward(10_000);
    await setup.expectState('billing', 'ok');
}

/** 3. Provisioning: Secret Manager answers 503, so the secrets and the roles that need them wait; the rest is created. */
async function provisionWithARetry({ page, lang, setup, setupBudget, upstream, consoleErrors }: Journey): Promise<void> {
    await upstream.fail('secret-manager', 'unavailable', 'browser');
    const provision = setup.open('provision');
    const provisionInputs = setupBudget.inputs('provision', 1);
    await provisionInputs.click(provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }));
    const retry = provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.retry') });
    // The client retries a 503 three times (after 1, 2 and 4 s of the page's clock) before it reports the item.
    await expect(async () => {
        await page.clock.fastForward(5_000);
        await expect(retry).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    expect(await setup.provisionItems()).toMatchObject({
        secrets: 'unavailable',
        iam: 'pending',
        apis: 'ok',
        buckets: 'ok',
        'api-key': 'ok',
    });
    expect(consoleErrors.takeMatching(/status of 503/).length).toBeGreaterThan(0);
    await checkpoint(page, lang, '03-provision-partial', 'provision-partial');
    await upstream.fail('secret-manager', null, 'browser');
    await provisionInputs.click(retry);
    await setup.expectState('provision', 'ok');
}

/** No Setup text names a command: what is left of the install is a button (finding 13, S-A30-HAPPY-NO-TERMINAL). */
const COMMAND = /\b(?:firebase (?:deploy|login|use)|gcloud [a-z]|gsutil |npm (?:run|install|ci)|npx |gh (?:secret|variable|workflow))/;

async function expectNoCommand(page: Page): Promise<void> {
    expect(await page.locator('hcm-setup-page').innerText()).not.toMatch(COMMAND);
}

/** The builds of `target` the fake Cloud Build received. */
async function buildsOf(upstream: UpstreamControl, target: string): Promise<number> {
    return (await submittedBuilds(upstream)).filter((build) => build.target === target).length;
}

/** The `fetch` step's environment of the newest site build: which tarballs it downloads and unpacks (§73k). */
async function siteFetchEnv(upstream: UpstreamControl): Promise<readonly string[]> {
    const site = (await submittedBuilds(upstream)).filter((build) => build.target === 'site').at(-1);
    return site?.request.steps[0]?.env ?? [];
}

/** 4. Install the server: one click, no consent within the hour of Prepare the project; the claim without a click. */
async function installTheServer(journey: Journey, owner: string): Promise<void> {
    const { page, lang, setup, setupBudget, upstream, serverDeployment, emulators } = journey;
    const deploy = await setup.show('deploy');
    await expect(deploy.getByText(setupText(lang, 'adminSetup.deploy.watching'))).toBeVisible();
    await expectNoCommand(page);
    await checkpoint(page, lang, '04-deploy-waiting', 'deploy-waiting');
    await setupBudget.inputs('deploy').click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') }));
    // The same click starts the imagery pipeline's build (step d3, no input of its own).
    await expect.poll(async () => [await buildsOf(upstream, 'server'), await buildsOf(upstream, 'pipeline')]).toEqual([1, 1]);
    await upstream.scenario('cloud-build.finish', 'browser');
    // The functions reach the server's world of the fake upstreams until CR-M2b-3 forwards the test's: it holds the
    // secrets the browser's provisioning created in the test's world.
    await upstream.scenario('secret-manager.provisioned', 'server');
    await nextLook(page, installState(setup.open('deploy')).filter({ hasText: setupText(lang, 'adminSetup.install.state.installed') }));
    await serverDeployment.show();
    await page.clock.fastForward(30_000);
    await expect(page.getByText(shellText(lang, 'adminShell.bootstrap.banner'))).toBeHidden({ timeout: 60_000 });
    await setup.expectState('claim', 'ok');
    await expect(setup.open('mapbox')).toBeVisible();
    // Normal mode adds the server's pages (on a compact window behind More).
    await expect.poll(() => destinations(page).count()).toBeGreaterThan(1);
    await checkpoint(page, lang, '05-claimed-mapbox', 'mapbox-open');
    expect(await emulators.document(`admins/${owner}`)).toEqual(expect.objectContaining({ role: 'owner' }));
    expect(await emulators.document('cities/bucharest')).toEqual(expect.objectContaining({ published: true, updatedBy: owner }));
    expect(await emulators.document('setup/status')).toEqual(
        expect.objectContaining({
            billing: expect.objectContaining({ state: 'ok', budgetAmount: 5, currency: 'USD' }),
            provision: expect.objectContaining({ state: 'ok' }),
        }),
    );
}

/** 5. Mapbox: a demo account cannot mint tokens; the owner adds a card on Mapbox's page and pastes the token again. */
async function connectMapbox({ page, lang, setup, setupBudget, upstream, consoleErrors, emulators }: Journey): Promise<void> {
    const mapbox = setup.open('mapbox');
    const tokenBox = mapbox.getByLabel(setupText(lang, 'adminSetup.mapbox.token'));
    // A pasted secret token is saved at once (one input); the retry after the upgrade is one more paste.
    const mapboxInputs = setupBudget.inputs('mapbox', 1);
    await mapboxInputs.paste(tokenBox, MAPBOX_TOKENS.trial);
    await expect(mapbox.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.mapbox.mintRefused') })).toBeVisible();
    await expect(mapbox.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.link.mapbox.console')) })).toBeVisible();
    await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
    expect(await emulators.document('cities/bucharest')).not.toHaveProperty('mapbox');
    await checkpoint(page, lang, '06-mapbox-trial', 'mapbox-trial', [apiText(lang, 'apiError.mapbox.mintRefused')]);
    await upstream.scenario('mapbox.upgraded', 'server');
    await mapboxInputs.paste(tokenBox, MAPBOX_TOKENS.trial);
    await setup.expectState('mapbox', 'ok');
    const city = await emulators.document('cities/bucharest');
    expect(city).toEqual(
        expect.objectContaining({
            mapbox: expect.objectContaining({ publicToken: expect.stringMatching(/^pk\./) }),
        }),
    );
    // The secret token went to Secret Manager only.
    expect(JSON.stringify([city, await emulators.document('setup/status')])).not.toContain(MAPBOX_TOKENS.trial);
}

/** M28 §10: Romania's list as `ops.tick` writes it once the city is placed (the tick does not run in the e2e world). */
async function seedCountryList(emulators: EmulatorWorld): Promise<void> {
    const at = STEPS_AT;
    const seed = COUNTRY_SEEDS['RO'];
    await emulators.setDocument('countrySources/RO', {
        country: 'RO',
        language: 'ro',
        cities: [E2E_CITY_ID],
        places: (seed?.places ?? []).map((place) => ({ ...place, reachable: true })),
        origin: 'curated',
        factsCheckedOn: seed?.factsCheckedOn,
        refreshedAt: at,
        updatedBy: 'system:ops',
        updatedAt: at,
    });
}

/**
 * 5b. M28: the app's platform (read from the steps before it, no input) and the map's sources: after Mapbox the Sources card
 * opens with the suggested switches and the month's estimate; Save my choice (one input) writes the city's `sources` and
 * USGS stays in the list (its frames and Landsat are on by default).
 */
async function chooseSources({ page, lang, setup, setupBudget, emulators }: Journey): Promise<void> {
    const platform = await setup.show('platform');
    await expect(platform.locator('[data-platform]')).toHaveCount(5);
    await checkpoint(page, lang, '06b-platform', 'setup-platform');
    const sources = await setup.show('sources');
    await expect(sources.getByRole('switch', { name: sourcesText(lang, 'adminSources.usgs.title') })).toHaveAttribute(
        'aria-checked',
        'true',
    );
    await expect(sources.getByText(startOf(sourcesText(lang, 'adminSources.summary.total')))).toBeVisible();
    // M28 §10–§11: the free translation options and the country's archives, libraries and sellers (the list ops.tick wrote).
    await expect(sources.locator('[data-translation]')).toHaveCount(6);
    await expect(sources.locator('[data-finder="ready"] [data-place]')).toHaveCount(COUNTRY_SEEDS['RO']?.places.length ?? 0);
    await checkpoint(page, lang, '06c-sources', 'setup-sources');
    // Review screenshots only (HCM_SCREENSHOTS): the translation options and the finder, a visit guide open.
    await sources.locator('[data-translation="deeplFree"] summary').click();
    await sources.locator('[data-place="anrCentral"] [data-guide="offline"] summary').click();
    await captureElement(page, sources.locator('section[aria-labelledby="sources-translations"]'), '06d-translations');
    await captureElement(page, sources.locator('[data-finder]'), '06e-finder');
    await setupBudget.inputs('sources').click(sources.getByRole('button', { name: sourcesText(lang, 'adminSources.save') }));
    await setup.expectState('sources', 'ok');
    await expect
        .poll(async () => (await emulators.document('cities/bucharest'))?.['sources'])
        .toMatchObject({ usgs: true, cloudAi: false });
    await expect(setup.card('usgs')).toBeVisible();
}

/** 6. USGS can wait: Do it later (one input of its own budget); the chip says Later and Setup goes on. */
async function postponeUsgs({ lang, setup, skipUsgs, page }: Journey): Promise<void> {
    const usgs = await setup.show('usgs');
    await skipUsgs.click(usgs.getByRole('button', { name: setupText(lang, 'adminSetup.usgs.later') }));
    await expect(setup.card('usgs').locator('.status[data-later]')).toContainText(setupText(lang, 'adminSetup.state.later'));
    await expectNoCommand(page);
}

/** 10. USGS after all: the username, the token page (the paste box first, then the 60 s countdown), the paste saves at once. */
async function connectUsgs({ page, lang, setup, setupBudget, upstream, emulators }: Journey): Promise<void> {
    const usgs = await setup.show('usgs');
    const usgsInputs = setupBudget.inputs('usgs');
    await usgsInputs.fill(usgs.getByLabel(setupText(lang, 'adminSetup.usgs.username')), USGS_CREDENTIALS.pending.username);
    const tokenPage = usgs.getByRole('link', { name: startOf(setupText(lang, 'adminSetup.usgs.openTokenPage')) });
    await followDeepLink(page, () => usgsInputs.click(tokenPage));
    const usgsBox = usgs.getByLabel(setupText(lang, 'adminSetup.usgs.token'));
    await expect(usgsBox).toBeFocused();
    const timer = usgs.getByRole('timer');
    await expect(timer).toHaveText(countdownPattern(lang));
    // The page's clock keeps running after the jump (the Firebase SDK needs it), so a busy machine may show a second
    // or two less than 60 and 55: the jump must take five seconds off, and the 60 s window must still be open.
    const before = await countdownSeconds(timer, lang);
    expect(before).toBeGreaterThan(45);
    await page.clock.fastForward(5_000);
    await expect.poll(() => countdownSeconds(timer, lang)).toBeLessThanOrEqual(before - 5);
    expect(await countdownSeconds(timer, lang)).toBeGreaterThan(30);
    await checkpoint(page, lang, '07-usgs-countdown', 'usgs-countdown');
    await usgsInputs.paste(usgsBox, USGS_CREDENTIALS.pending.applicationToken);
    await setup.expectState('usgs', 'pending');
    const pending = await setup.show('usgs');
    await expect(pending.getByText(apiText(lang, 'apiError.usgs.accessPending'))).toBeVisible();
    await expect(pending.getByText(startOf(setupText(lang, 'adminSetup.usgs.nextCheck')))).toBeVisible();
    await checkpoint(page, lang, '08-usgs-pending', 'usgs-pending');
    // USGS approves. Six hours later the server's tick checks again: its clock cannot move, so the check's time does.
    await upstream.scenario('usgs.m2mApproved', 'server');
    await emulators.updateFields('setup/status', { usgs: { nextCheckAt: new Date('2026-01-01T00:00:00Z') } }, ['usgs.nextCheckAt']);
    await emulators.runOpsTick();
    await expect.poll(async () => (await emulators.document('setup/status'))?.['usgs'], { timeout: 30_000 }).toMatchObject({ state: 'ok' });
    // Every step is done: the empty address opens the dashboard (DECISIONS-for-review.md §34i), with no USGS reminder.
    await page.goto(adminPath(lang));
    await expect(page.locator('hcm-home-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('li[data-reminder^="usgs"]')).toHaveCount(0);
    await page.goto(adminPath(lang, 'setup'));
    await setup.expectState('usgs', 'ok', 60_000);
}

/** 7. Analytics: after the deep link the card watches every 15 s; then the GA4 stream setting (its own consent). */
async function enableAnalytics({
    page,
    lang,
    setup,
    consent,
    setupBudget,
    upstream,
    consoleErrors,
    emulators,
    notes,
}: Journey): Promise<void> {
    let analytics = await setup.show('analytics');
    // Google Analytics is not enabled yet: setup.analyticsConfig says so (a callable's 400).
    await expect(analytics.getByText(apiText(lang, 'apiError.analytics.notEnabled'))).toBeVisible();
    await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
    await followDeepLink(page, () => analytics.getByRole('link', { name: /Firebase/ }).click());
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.watching'))).toBeVisible();
    // The owner enables Google Analytics on Google's page; the next check finds it.
    await upstream.scenario('firebase-management.analyticsLinked', 'both');
    await page.clock.fastForward(15_000);
    await setup.expectState('analytics', 'ok');
    analytics = await setup.show('analytics');
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.measurementId', { id: 'G-E2E0000000' }))).toBeVisible();
    await expect(analytics.locator('[data-group]')).toHaveCount(2);
    await setup.expectConsentNote(analytics, 'analyticsEdit', notes);
    const stream = analytics.getByRole('button', { name: setupText(lang, 'adminSetup.analytics.streamSetting') });
    const analyticsConsent = await consent.opened(page, () => setupBudget.inputs('analytics').click(stream));
    expect(await analyticsConsent.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsEdit]);
    await analyticsConsent.allow(setupBudget.consents('analytics'));
    await expect(analytics.getByText(setupText(lang, 'adminSetup.analytics.streamOff'))).toBeVisible();
    await checkpoint(page, lang, '09-analytics', 'analytics');
    expect(await emulators.document('cities/bucharest')).toEqual(
        expect.objectContaining({ analytics: expect.objectContaining({ measurementId: 'G-E2E0000000' }) }),
    );
}

/** 8. The legacy import: one click, the 57 photos of the old site processed by photos.onUpload, published, then in the manifest. */
async function importLegacyPhotos({ page, lang, setup, setupBudget, emulators }: Journey): Promise<void> {
    const legacy = await setup.show('legacyImport');
    const importButton = legacy.getByRole('button', { name: setupText(lang, 'adminSetup.import.action', { count: '57' }) });
    await setupBudget.inputs('legacyImport').click(importButton);
    await expect(setup.card('legacyImport')).not.toHaveAttribute('data-state', /missing|pending/, { timeout: 180_000 });
    // A photo the import could not finish is listed on the card with its reason: none may be.
    await expect(page.locator('hcm-setup-step[data-step="legacyImport"] [data-photo]')).toHaveText([]);
    await setup.expectState('legacyImport', 'ok');
    await expect((await setup.show('legacyImport')).getByText(setupText(lang, 'adminSetup.import.done', { count: '57' }))).toBeVisible();
    await checkpoint(page, lang, '10-import-done', 'import-done');
    const photos = Object.values(await emulators.collection('cities/bucharest/photos'));
    expect(
        photos.filter((photo) => photo['published'] === true && photo['processing'] === 'done' && photo['rightsReview'] === true),
    ).toHaveLength(57);
    await expect
        .poll(async () => (await emulators.document('manifests/bucharest'))?.['counts'], { timeout: 120_000 })
        .toMatchObject({ photos: 57 });
}

/** 9a. The imagery pipeline: installed by the server's click, with no input of its own. */
async function expectPipelineInstalled({ setup, lang }: Journey): Promise<void> {
    await setup.expectState('pipeline', 'ok', 60_000);
    const pipeline = await setup.show('pipeline');
    await expect(installState(pipeline)).toContainText(setupText(lang, 'adminSetup.install.state.installed'));
}

/**
 * 9b. Publish the map: one click. The steps since Prepare the project asked Google for another scope (the analytics
 * stream); the tab keeps one token per scope (§73j), so Google Cloud's is still live and the click asks Google nothing.
 */
async function publishTheMap({ page, lang, setup, consent, setupBudget, upstream, emulators }: Journey): Promise<void> {
    const site = await setup.show('site');
    await expectNoCommand(page);
    const publish = site.getByRole('button', { name: setupText(lang, 'adminSetup.install.site.action') });
    // The first city's manifest was published while the tab held no Google Cloud token: the card saw it all the same.
    await expect(publish).toBeEnabled({ timeout: 90_000 });
    // §73k: the cost line counts the publish without the originals once the import is complete.
    const transfer = setupText(lang, 'adminSetup.install.site.transfer', { megabytes: String(SITE_PUBLISH_TRANSFER_TRIMMED_MB) });
    await expect(site).toContainText(transfer);
    const asked = (await consent.requests()).length;
    await setupBudget.inputs('site').click(publish);
    await expect.poll(() => buildsOf(upstream, 'site')).toBe(1);
    expect(await consent.requests()).toHaveLength(asked);
    // §73k: every old photo is imported (step h), so the build neither downloads nor publishes their originals.
    expect(await siteFetchEnv(upstream)).toContain('HCM_FILES=site,server,pipeline');
    expect((await siteFetchEnv(upstream)).some((line) => line.startsWith('HCM_UNPACK'))).toBe(false);
    await upstream.scenario('cloud-build.finish', 'browser');
    await page.clock.fastForward(10_000);
    await setup.expectState('site', 'ok');
    const published = await setup.show('site');
    await expect(published.getByRole('link', { name: new RegExp(setupText(lang, 'adminSetup.install.site.open')) })).toHaveAttribute(
        'href',
        `https://${E2E_PROJECT_ID}.web.app/`,
    );
    await checkpoint(page, lang, '11-site-published', 'setup.site-published');
    await expect
        .poll(async () => (await emulators.document('setup/status'))?.['install'])
        .toMatchObject({ server: { state: 'installed' }, site: { state: 'installed', release: INSTALL_RELEASE } });
    // The admin stays under /admin/ on the same origin as the public map (§2.3).
    expect(new URL(page.url()).pathname).toMatch(/^\/admin\//);
}

/** 9c. The public map at the Hosting root boots the city with the 57 photos the server published, on one map. */
async function viewTheMapAtTheRoot({ page, lang, emulators }: Journey): Promise<void> {
    const viewer = await page.context().newPage();
    await servePublishedMap(viewer, emulators, E2E_CITY_ID);
    await viewer.goto(hostingUrl('/', { lang }));
    await waitForEngineEvent(viewer, 'hcm-ready');
    expect(await engineEvents(viewer, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: E2E_CITY_ID, photos: 57 })]);
    await viewer.close();
}

/** 9d. Setup is done with USGS for later: the empty address opens Home, whose reminder offers Set up USGS. */
async function expectDoneWithUsgsLater({ page, lang }: Journey): Promise<void> {
    await page.goto(adminPath(lang));
    await expect(page.locator('hcm-home-page')).toBeVisible({ timeout: 60_000 });
    const reminder = page.locator('li[data-reminder="usgsLater"]');
    await expect(reminder).toContainText(setupText(lang, 'adminSetup.reminder.usgsLater'));
    await reminder.getByRole('link', { name: setupText(lang, 'adminSetup.reminder.setUpUsgs') }).click();
}

test(
    'The owner sets up a new map from sign-in to the public map with no terminal, within the input budget',
    {
        tag: [
            '@S-A30-HAPPY',
            '@S-A30-HAPPY-NO-TERMINAL',
            '@S-A25-HAPPY',
            '@S-A27-HAPPY-UNVERIFIED-NOTICE',
            '@S-A04-BAD-NOT-ENABLED',
            '@S-A04-BAD-PARTIAL-FAILURE',
            '@S-A26-HAPPY',
            '@S-A05-BAD-TRIAL',
            '@S-A06-HAPPY',
            '@S-A07-HAPPY-COUNTDOWN',
            '@S-A07-BAD-ROLE-PENDING',
            '@S-A22-HAPPY',
            '@S-A22-HAPPY-STREAM-SETTING',
            '@S-A57-HAPPY-PUBLISH-WITHOUT-ORIGINALS',
            '@S-A28-HAPPY',
            '@S-A31-HAPPY',
            '@S-A31-BAD-ALERTS',
            '@S-A180-HAPPY-SAVE-DEFAULTS',
            '@S-A181-HAPPY-PLATFORM',
            '@S-A183-HAPPY-FINDER',
            '@S-A184-HAPPY-TRANSLATIONS',
        ],
    },
    async ({ page, lang, consent, inputBudget, setupBudget, upstream, serverDeployment, consoleErrors, adminWorld }) => {
        // Ten steps, four polls, three builds, 57 photos through photos.onUpload on the emulators, and both generic
        // checkers at a dozen states (about 6 minutes beside the viewer tiers on a loaded laptop, 2026-10-17).
        test.setTimeout(900_000);
        const setup = new SetupPage(page, lang);
        const emulators = adminWorld.emulators;
        const notes = { projectId: E2E_PROJECT_ID, domain: ADMIN_WEB_CONFIG.authDomain };
        const skipUsgs = inputBudget.flow('skipUsgs', contentFlowBudget('skipUsgs'));
        const journey: Journey = {
            ...{ page, lang, setup, consent, setupBudget, skipUsgs, upstream, serverDeployment, consoleErrors, emulators },
            notes,
        };
        await upstream.scenario('cloud-billing.noAccount', 'browser');
        await upstream.scenario('error-reporting.twoGroups', 'server');
        await standInProviderPages(page.context(), PROVIDER_ORIGINS);
        await serverDeployment.hide();
        await page.context().addInitScript(recordLiveRegions);
        trackRecords(page);
        // The polls run on the page's clock: time flows, and the spec jumps ahead to the next poll.
        await page.clock.install();
        await page.clock.resume();
        // A new map's start-up deploy: `runtime.json` says start-up and names the admin's release, whose bundle it serves.
        await serveInstallBundle(page, { startUp: true });
        await followSiteRelease(page, upstream);
        const startUp = backendRequests(page);
        await seedCountryList(emulators);
        await page.goto(adminPath(lang));

        await signInInStartUpMode(journey);
        await linkBilling(journey);
        await provisionWithARetry(journey);
        startUp.stop();
        // A start-up deploy calls nothing of the server, not even the probe, so the browser logs no CORS error (the
        // hidden server would have refused it: the live admin of 2026-10-17 logged one).
        expect(startUp.paths).toEqual([]);
        expect(serverDeployment.claimErrors()).toEqual([]);

        await installTheServer(journey, adminWorld.accounts.owner.uid);
        await connectMapbox(journey);
        await chooseSources(journey);
        await postponeUsgs(journey);
        await enableAnalytics(journey);
        await importLegacyPhotos(journey);
        await expectPipelineInstalled(journey);
        await publishTheMap(journey);
        // The required steps with USGS postponed: within 9 inputs (Do it later counted for USGS's three) and 4 consents;
        // Publish the map asks none since the tab keeps a token per scope (§73j).
        const required = setupBudget.used();
        expect(required.inputs - setupBudget.allowance() + skipUsgs.used).toBeLessThanOrEqual(required.limit.inputs - 2);
        expect(required.consents).toBeLessThanOrEqual(required.limit.consents);
        await viewTheMapAtTheRoot(journey);
        await expectDoneWithUsgsLater(journey);
        await connectUsgs(journey);

        // The whole assistant: within its budget once the bad paths' declared allowances are taken off (§3.5, M6 §4.2).
        const used = setupBudget.used();
        expect(used.inputs - setupBudget.allowance()).toBeLessThanOrEqual(used.limit.inputs);
        expect(used.consents).toBeLessThanOrEqual(used.limit.consents);
        await recordsSettled(page);
    },
);

test(
    'A Hosting-only deploy that does not say start-up still finds no server and starts the setup',
    { tag: ['@S-A25-BAD-NO-START-UP-DEPLOY'] },
    async ({ page, lang, serverDeployment }) => {
        await serverDeployment.hide();
        const probes = backendRequests(page);
        await page.goto(adminPath(lang));

        // Without `startUp` in runtime.json the admin probes admin-session before sign-in; the hidden server does not
        // answer, so start-up mode's sign-in shows, as for a start-up deploy, at the cost of the probe's console error.
        await expect(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toBeVisible();
        await new SetupPage(page, lang).expectConsentNote(page.locator('hcm-sign-in'), 'cloudReadOnly', {
            projectId: E2E_PROJECT_ID,
            domain: ADMIN_WEB_CONFIG.authDomain,
        });
        probes.stop();
        expect(new Set(probes.paths)).toEqual(new Set([`/${E2E_PROJECT_ID}/us-central1/admin-session`]));
        expect(serverDeployment.claimErrors().length).toBeGreaterThan(0);
    },
);

test(
    'Publishing the map hours after Prepare the project costs one consent from the same click; nothing is asked again',
    { tag: ['@S-A30-BAD-TOKEN-EXPIRED', '@S-A57-BAD-ORIGINALS-UNTIL-IMPORTED'] },
    async ({ page, lang, consent, setupBudget, upstream, serverDeployment, consoleErrors, adminWorld }) => {
        test.setTimeout(300_000);
        await serverDeployment.hide();
        trackRecords(page);
        const { setup, deploy } = await preparedProject({
            ...{ page, lang, consent, setupBudget, upstream, signInBudget: setupBudget.inputs('signIn') },
            signInConsent: setupBudget.consents('signIn'),
        });
        await followSiteRelease(page, upstream);
        // Within the hour of Prepare the project: Install the server is one click and no consent.
        await setupBudget.inputs('deploy').click(deploy.getByRole('button', { name: setupText(lang, 'adminSetup.install.server.action') }));
        await expect.poll(() => buildsOf(upstream, 'server')).toBe(1);
        await upstream.scenario('cloud-build.finish', 'browser');
        await upstream.scenario('secret-manager.provisioned', 'server');
        await nextLook(page, installState(deploy).filter({ hasText: setupText(lang, 'adminSetup.install.state.installed') }));
        await serverDeployment.show();
        await page.clock.fastForward(30_000);
        await setup.expectState('claim', 'ok', 60_000);
        // The steps between (Mapbox, the photos) leave the first city published; they took longer than the token's hour.
        await adminWorld.emulators.updateFields('setup/status', { mapbox: { state: 'ok', checkedAt: STEPS_AT, user: 'e2e-mapbox' } }, [
            'mapbox',
        ]);
        await seedPublishedMap(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await page.clock.fastForward('02:00:00');

        const site = await setup.show('site');
        await expect(site).toContainText(
            setupText(lang, 'adminSetup.install.site.transfer', { megabytes: String(SITE_PUBLISH_TRANSFER_MB) }),
        );
        const publish = setupBudget.inputs('site');
        const consents = setupBudget.consents('site', 1);
        const scopes = await withConsent(
            page,
            consent,
            site.getByRole('button', { name: setupText(lang, 'adminSetup.install.site.action') }),
            publish,
            consents,
        );

        expect(scopes).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await expect.poll(() => buildsOf(upstream, 'site')).toBe(1);
        // §73k: no old photo is imported here, so the build still downloads and publishes their originals.
        expect(await siteFetchEnv(upstream)).toEqual(
            expect.arrayContaining(['HCM_FILES=site,server,pipeline,legacy', 'HCM_UNPACK=legacy']),
        );
        await upstream.scenario('cloud-build.finish', 'browser');
        await page.clock.fastForward(10_000);
        await setup.expectState('site', 'ok');
        expect([publish.used, consents.used]).toEqual([1, 1]);
        // Nothing detected is asked again: the steps done stay done, and the server is not installed a second time.
        for (const step of ['signIn', 'billing', 'provision', 'deploy', 'claim'] as const) {
            await setup.expectState(step, 'ok');
        }
        expect(await buildsOf(upstream, 'server')).toBe(1);
        const used = setupBudget.used();
        expect(used.inputs - setupBudget.allowance()).toBeLessThanOrEqual(used.limit.inputs);
        // The hours the clock jumped make Firestore's channel check its connection (an image the admin's CSP refuses).
        consoleErrors.takeMatching(/cleardot\.gif/);
        serverDeployment.claimErrors();
        await recordsSettled(page);
    },
);
