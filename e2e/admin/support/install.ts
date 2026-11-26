import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test';

import type { InputFlow } from '../../support/budget.js';
import type { SetupBudget } from './budget.js';
import type { GoogleConsent } from './consent.js';
import { setupText, shellText } from './i18n.js';
import { SetupPage } from './setup-page.js';
import { bootstrapRecord, rememberBootstrap, STEPS_AT, withConsent } from './steps.js';
import { adminPath } from './test.js';
import { PROJECT_CITY, projectCity } from './content.js';
import type { EmulatorWorld } from './emulators.js';
import { seedPublicCity } from './flows.js';
import type { UpstreamControl } from './upstream.js';
import { INSTALL_RELEASE, INSTALL_RELEASE_TIME, INSTALL_SLUG, installManifestText } from '../../fixtures/install-bundle.js';
import { bucketFolder } from '../../support/hosting.js';
import { ADMIN_ORIGIN, ADMIN_RUNTIME, E2E_PROJECT_ID, PERSONAS } from '../world.js';

/**
 * The in-app installer's e2e world (docs/research/M6-interfaces.md §1.3, §1.10): the admin's own release and its install
 * bundle's manifest, served on the admin's origin as Hosting serves the built bundle (the e2e admin's `runtime.json`
 * names no release of its own, so a spec gives it one), and the builds the fake Cloud Build received. No build step
 * runs: a scenario plays each build (`cloud-build.start`, `cloud-build.finish`, `cloud-build.<target><Outcome>`).
 */

export { INSTALL_RELEASE, INSTALL_RELEASE_TIME, INSTALL_SLUG };

export interface ServedBundle {
    /** SHA-256 of the served manifest: what the build's `fetch` step must be told. */
    readonly manifestSha256: string;
}

/** Serves the admin's release (in start-up mode when `startUp`) and its bundle's manifest on the admin's origin. */
export async function serveInstallBundle(
    page: Page,
    options: { readonly startUp?: boolean; readonly docker?: boolean } = {},
): Promise<ServedBundle> {
    const text = installManifestText(E2E_PROJECT_ID, options.docker ?? true);
    const runtime = {
        ...{ ...ADMIN_RUNTIME, release: INSTALL_RELEASE, releaseTime: INSTALL_RELEASE_TIME },
        ...(options.startUp === true ? { startUp: true } : {}),
    };
    await page.route('**/runtime.json', (route) => route.fulfill({ json: runtime }));
    await page.route(`**/install/${INSTALL_SLUG}/manifest.json`, (route) => route.fulfill({ body: text, contentType: 'application/json' }));
    return { manifestSha256: createHash('sha256').update(text).digest('hex') };
}

/**
 * Finding 29 of docs/research/manual-test-2026-10-25.md (2026-10-31): Hosting serves another admin release from now on,
 * as after a redeploy while the tab is open (its old chunks still run; its `runtime.json` names the new release).
 */
export async function redeployAdmin(page: Page, release: string, options: { readonly startUp?: boolean } = {}): Promise<void> {
    const runtime = { ...ADMIN_RUNTIME, release, ...(options.startUp === true ? { startUp: true } : {}) };
    await page.route('**/runtime.json', (route) => route.fulfill({ json: runtime }));
}

/**
 * The tab hidden, or shown again: `document.visibilityState` and its event as the browser fires it on a tab switch, at the
 * document and bubbling (`docs/LESSONS.md` 299).
 */
export async function setTabVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
    await page.evaluate((value) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }, state);
}

/**
 * The owner keeps working on the visible tab through the five-minute look at `runtime.json`: a key every 30 s of the
 * page's clock, and one at the end. A tab untouched for a minute reloads into a newer admin by itself (the installed app
 * updates itself, 2026-11-14, `packages/admin/src/app/activity.ts`); one in use gets the Reload banner, with a minute of
 * headroom before the next quiet retry.
 */
export async function workThroughTheLook(page: Page): Promise<void> {
    for (let step = 0; step < 11; step += 1) {
        await page.keyboard.press('Shift');
        await page.clock.fastForward(30_000);
    }
    await page.keyboard.press('Shift');
}

/** The shell's banner that a newer admin is ready, with Reload (finding 29). */
export function newAdminBanner(page: Page): Locator {
    return page.locator('hcm-admin-shell').locator('.banner.release');
}

/** A build as the fake Cloud Build holds it: Google's answer, its target and the definition the admin sent. */
export interface SubmittedBuild {
    readonly id: string;
    readonly status: string;
    readonly target: string;
    readonly tags: readonly string[];
    readonly substitutions: Readonly<Record<string, string>>;
    readonly request: {
        readonly serviceAccount: string;
        readonly options: Readonly<Record<string, unknown>>;
        readonly steps: readonly {
            readonly id: string;
            readonly name: string;
            readonly args?: readonly string[];
            readonly dir?: string;
            readonly env?: readonly string[];
        }[];
    };
}

/** The builds the browser's world of the fake Cloud Build received, oldest first. */
export async function submittedBuilds(upstream: UpstreamControl): Promise<SubmittedBuild[]> {
    const snapshot = (await upstream.snapshot('browser'))['cloud-build'] as { readonly builds: SubmittedBuild[] };
    return snapshot.builds;
}

/** Steps (a) and (b) done in the tab: Prepare the project is next (it makes the installer's account). */
export function billingDoneRecord(): Readonly<Record<string, unknown>> {
    const record = Object.fromEntries(Object.entries(bootstrapRecord(E2E_PROJECT_ID, false)).filter(([key]) => key !== 'provision'));
    const ok = { state: 'ok', checkedAt: STEPS_AT.toISOString() };
    return { ...record, steps: { signIn: ok, billing: ok } };
}

export interface Started {
    readonly setup: SetupPage;
    readonly bundle: ServedBundle;
    readonly deploy: Locator;
}

export interface StartOptions {
    readonly page: Page;
    readonly lang: 'ro' | 'en';
    readonly consent: GoogleConsent;
    readonly setupBudget: SetupBudget;
    readonly upstream: UpstreamControl;
    readonly signInBudget: InputFlow;
    readonly signInConsent: InputFlow;
    /** The state Prepare the project ends in (default `ok`; finding 31: an item may fail while the server's are done). */
    readonly provisioned?: string;
}

/** Start-up mode after billing: sign in, Prepare the project (one click, one consent), the server's card open. */
export async function preparedProject(options: StartOptions): Promise<Started> {
    const { page, lang, consent, setupBudget, upstream } = options;
    await upstream.scenario('cloud-billing.enabled', 'browser');
    // Step (b) made the app's budget, so Prepare the project's budget alerts are not waiting for it.
    await upstream.scenario('billing-budgets.appBudget', 'browser');
    const bundle = await serveInstallBundle(page, { startUp: true });
    await rememberBootstrap(page, E2E_PROJECT_ID, billingDoneRecord());
    await page.clock.install();
    await page.clock.resume();
    await page.goto(adminPath(lang));
    const signIn = await consent.opened(page, () =>
        options.signInBudget.click(page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })),
    );
    await signIn.chooseAccount(PERSONAS.owner.email);
    await signIn.allow(options.signInConsent);
    const setup = new SetupPage(page, lang);
    const provision = await setup.show('provision');
    await withConsent(
        page,
        consent,
        provision.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') }),
        setupBudget.inputs('provision'),
        setupBudget.consents('provision'),
    );
    await setup.expectState('provision', options.provisioned ?? 'ok', 120_000);
    return { setup, bundle, deploy: await setup.show('deploy') };
}

/**
 * Answers the callable `name` with the emulated server's own answer changed by `older`: the shape of a server older than
 * the admin (finding 27 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31)). A refusal passes as it is.
 */
export async function answerAsOlderServer(page: Page, name: string, older: (result: Record<string, unknown>) => unknown): Promise<void> {
    await page.route(`**/us-central1/${name}`, async (route: Route) => {
        const response = await route.fetch();
        if (!response.ok()) {
            await route.fulfill({ response });
            return;
        }
        const body = (await response.json()) as { readonly result: Record<string, unknown> };
        await route.fulfill({ response, json: { result: older(body.result) } });
    });
}

/** A card's install state line (`p.install-state`: its icon's name and the state's words). */
export function installState(card: Locator): Locator {
    return card.locator('p.install-state');
}

/**
 * Moves the page's clock on by the card's running interval until `shown` is visible: a look already under way when the
 * clock jumped schedules the next one an interval after it ends, which one jump may not reach on a loaded machine.
 */
export async function nextLook(page: Page, shown: Locator): Promise<void> {
    await expect(async () => {
        await page.clock.fastForward(10_000);
        await expect(shown).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
}

/** The `setup.recordCloud` requests of each page still under way (`trackRecords`). */
const RECORDS = new WeakMap<Page, Set<Request>>();

/** Follows the page's `setup.recordCloud` requests, so a test can end once none is under way (`recordsSettled`). */
export function trackRecords(page: Page): void {
    const open = new Set<Request>();
    RECORDS.set(page, open);
    page.on('request', (request) => {
        if (request.url().endsWith('/setup-recordCloud')) {
            open.add(request);
        }
    });
    const settle = (request: Request): void => {
        open.delete(request);
    };
    page.on('requestfinished', settle);
    page.on('requestfailed', settle);
}

/**
 * Waits until no `setup.recordCloud` of the page has been under way for two looks in a row: a callable cut off when the
 * page closes leaves its Firestore transaction holding `setup/status` for up to a minute in the emulator, which the next
 * test's reset then meets as a 409 (`docs/LESSONS.md` 270).
 */
export async function recordsSettled(page: Page): Promise<void> {
    const open = RECORDS.get(page);
    if (open === undefined) {
        return;
    }
    let quiet = 0;
    await expect
        .poll(
            () => {
                quiet = open.size === 0 ? quiet + 1 : 0;
                return quiet;
            },
            { intervals: [250], timeout: 30_000 },
        )
        .toBeGreaterThanOrEqual(2);
}

/**
 * The first city published as Setup leaves it once Mapbox is connected (`seedPublicCity`), and its manifest built by the
 * real publisher (the emulated functions): Publish the map then has something to show. Waits for the build's record to
 * name the manifest's address (a synthetic record would race the builds the seed's own writes request, and an unstamped
 * one made the publish trigger's retries hold `manifests/{city}`; `docs/LESSONS.md` 270).
 */
export async function seedPublishedMap(emulators: EmulatorWorld, ownerUid: string): Promise<void> {
    // The public city replaces the city's document: a sources choice seeded before it (`seedClaimedCity`) is kept.
    const sources = (await emulators.document(`cities/${PROJECT_CITY}`))?.['sources'];
    await seedPublicCity(projectCity(emulators, ownerUid), STEPS_AT);
    if (sources !== undefined) {
        await emulators.updateFields(`cities/${PROJECT_CITY}`, { sources }, ['sources']);
    }
    const built = async (): Promise<unknown> => (await emulators.document(`manifests/${PROJECT_CITY}`))?.['url'];
    await expect.poll(built, { message: 'the first city has a published manifest', timeout: 120_000 }).toEqual(expect.any(String));
}

/** `/release.json` of the admin's origin as the fake Cloud Build's last site build left it (none: the start-up root). */
export async function followSiteRelease(page: Page, upstream: UpstreamControl): Promise<void> {
    await page.route(`${ADMIN_ORIGIN}/release.json`, async (route) => {
        const { hosting } = (await upstream.snapshot('browser'))['cloud-build'] as { readonly hosting: unknown };
        await route.fulfill({
            json: hosting ?? { release: INSTALL_RELEASE, releaseTime: INSTALL_RELEASE_TIME, variant: 'start-up' },
            headers: { 'cache-control': 'no-cache' },
        });
    });
}

/** The project's public bucket, where the photo pipeline and the manifest build write (`<project>-public`). */
const PROJECT_PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
const OBJECT_TYPES: Readonly<Record<string, string>> = { json: 'application/json', webp: 'image/webp' };

/** An object of the project's public bucket from the Storage emulator, as Google's host answers it (or a 404). */
async function answerFromEmulator(route: Route, emulators: EmulatorWorld, path: string): Promise<void> {
    const stored = await emulators.storageObject(PROJECT_PUBLIC_BUCKET, path);
    const headers = { 'access-control-allow-origin': '*' };
    if (stored === undefined) {
        await route.fulfill({ status: 404, contentType: 'text/plain', headers, body: 'No such object.' });
        return;
    }
    // The manifest is stored gzip with its encoding; Google's host decodes it for a browser.
    const body = stored[0] === 0x1f && stored[1] === 0x8b ? gunzipSync(stored) : stored;
    const type = OBJECT_TYPES[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
    await route.fulfill({ status: 200, contentType: type, headers, body });
}

/**
 * The public map's bucket as a visitor's browser reaches it, answered from the Storage emulator with what the server
 * really published: the e2e Hosting tree's pages read the city's folder of the e2e bucket (`bucketFolder`), which holds
 * here the project's `cities/<city>/` objects, and the manifest's photos name the project's public bucket itself.
 */
export async function servePublishedMap(page: Page, emulators: EmulatorWorld, city: string): Promise<void> {
    const folder = bucketFolder(city);
    await page.route(`${folder}**`, (route) =>
        answerFromEmulator(route, emulators, `cities/${city}/${decodeURIComponent(route.request().url().slice(folder.length))}`),
    );
    const projectBucket = `https://storage.googleapis.com/${PROJECT_PUBLIC_BUCKET}/`;
    await page.route(`${projectBucket}**`, (route) =>
        answerFromEmulator(
            route,
            emulators,
            decodeURIComponent(new URL(route.request().url()).pathname.slice(`/${PROJECT_PUBLIC_BUCKET}/`.length)),
        ),
    );
}
