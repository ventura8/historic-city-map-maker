// The local stack's own check (docs/SETUP.md → *Local stack for manual testing*), run against a running stack inside its
// container (`bash scripts/dev/dev-stack.sh check`, which runs `npm run stack:check` there):
//
//     node --import ./scripts/site/register-ts.mjs e2e/stack/check.ts
//
// Drives a headless Chromium as the Claude browser pane is (no service worker, no Playwright route in the way but the
// guard below) through the admin and the viewer: the owner signs in with Google's consent stand-in and lands on the
// dashboard; the photos, the harvested scenes and a layer's editor (with the admin map and its tiles) show the seeded
// city; the second city opens from the city menu's address and has its page on the site; a file the page saves itself
// goes through the stack's forward; the viewer shows the manifest the emulators published. A request that reached the
// network for a host off this machine fails the check: it is recorded and aborted at the browser's network layer, so even
// a leak never leaves. Exit status 1 when a step fails.
import process from 'node:process';

import { createLogger, translateAdminContent, translateAdminShell } from '@hcm/shared';
import { chromium, type Page } from '@playwright/test';

import { ADMIN_ORIGIN, ADMIN_URL, PERSONAS } from '../admin/world.js';
import { E2E_CITY_ID, MOCK_API_ORIGIN, SITE_ORIGIN } from '../fixtures/world.js';
import { STACK_SECOND_CITY, STACK_SECOND_CITY_NAME } from './seed-cities.js';

const log = createLogger('dev-stack-check');

const TIMEOUT_MS = 60_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost']);

function pause(ms: number): Promise<void> {
    return new Promise((done) => {
        setTimeout(done, ms);
    });
}

interface Step {
    readonly name: string;
    readonly run: (page: Page) => Promise<void>;
}

async function signIn(page: Page): Promise<void> {
    await page.goto(ADMIN_URL);
    const signInButton = page.getByRole('button', { name: translateAdminShell('ro', 'adminShell.auth.signIn') });
    await signInButton.waitFor({ timeout: TIMEOUT_MS });
    await signInButton.click();
    // The stack opens Google's consent stand-in in a frame over the page (e2e/stack/browser.ts), as in the Claude pane.
    const consent = page.frameLocator('iframe[title="Sign in with Google (e2e stand-in)"]');
    await consent.getByRole('radio', { name: PERSONAS.owner.email }).check();
    await consent.getByRole('button', { name: 'Allow' }).click();
    await page.getByRole('heading', { level: 1, name: translateAdminShell('ro', 'adminShell.nav.home') }).waitFor({ timeout: TIMEOUT_MS });
}

async function photos(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/photos`);
    await page.locator('hcm-admin-photo-list li.photo-row').nth(12).waitFor({ timeout: TIMEOUT_MS });
}

async function imagery(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/imagery`);
    const scenes = page.getByRole('list', { name: translateAdminContent('ro', 'adminContent.imagery.scenesLabel') });
    await scenes.getByRole('link').nth(5).waitFor({ timeout: TIMEOUT_MS });
}

/**
 * M4: the frame to buy has its order card (Free only off: the filter hides a scene not ordered yet), and the one marked
 * as ordered says it is watched (an ordered scene opens whatever the filters).
 */
async function orders(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/imagery`);
    const scenes = page.getByRole('list', { name: translateAdminContent('ro', 'adminContent.imagery.scenesLabel') });
    await scenes.getByRole('link').first().waitFor({ timeout: TIMEOUT_MS });
    await page.getByRole('button', { name: translateAdminContent('ro', 'adminContent.imagery.filter.freeOnly') }).click();
    await scenes.locator('a[href$="/imagery/scene/DS1105-1071DF076"]').click();
    const card = page.locator('hcm-imagery-page .order-card');
    await card.getByText(translateAdminContent('ro', 'adminContent.orders.state.needsOrder')).waitFor({ timeout: TIMEOUT_MS });
    await page.goto(`${ADMIN_URL}#/imagery/scene/D3C1209-100055F012`);
    await card.getByText(translateAdminContent('ro', 'adminContent.orders.state.ordered')).waitFor({ timeout: TIMEOUT_MS });
}

/** M4: the server's own events (a failed import, a draft over the threshold, a version waiting for points) in the inbox. */
async function inbox(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/inbox`);
    await page.locator('hcm-inbox-page a.row').nth(2).waitFor({ timeout: TIMEOUT_MS });
}

async function layersMap(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/layers/corona-1968`);
    await page.getByRole('heading', { level: 2, name: 'Corona 1968' }).waitFor({ timeout: TIMEOUT_MS });
    await page.locator('hcm-admin-map canvas.mapboxgl-canvas').first().waitFor({ timeout: TIMEOUT_MS });
    const deadline = Date.now() + TIMEOUT_MS;
    // The layer's tiles came through the stack to the mock Mapbox (the e2e account's tilesets are one solid colour).
    while (Date.now() < deadline) {
        const calls = (await (await fetch(`${MOCK_API_ORIGIN}/__calls?host=api.mapbox.com`)).json()) as { path: string }[];
        if (calls.some((call) => call.path.startsWith('/v4/e2e-user.corona-1968'))) {
            return;
        }
        await pause(1000);
    }
    throw new Error('the admin map asked the mock Mapbox for no tile of the layer');
}

/**
 * M5: the owner administers two cities: the second one's address opens it (the admin reloads into it by itself, so the
 * check waits for its name on the city button), and the site serves its page.
 */
async function secondCity(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/c/${STACK_SECOND_CITY}/home`);
    await page
        .locator('hcm-city-menu:not([inline]) [data-city-menu]', { hasText: STACK_SECOND_CITY_NAME })
        .waitFor({ timeout: TIMEOUT_MS });
    const config = await (await fetch(`${SITE_ORIGIN}/${STACK_SECOND_CITY}/config.js`)).text();
    const site = await fetch(`${SITE_ORIGIN}/${STACK_SECOND_CITY}/`);
    if (!config.includes(`"cityId":"${STACK_SECOND_CITY}"`) || !site.ok) {
        throw new Error(`the second city's page on the site: ${String(site.status)} ${config.slice(0, 200)}`);
    }
}

/**
 * A file the page saves itself (an `<a download>` it clicks: the export's Download, whose signed address is on Google's
 * storage host) goes through the stack's forward like every other request of the page, never to the network.
 */
async function savedFile(page: Page): Promise<void> {
    await page.goto(`${ADMIN_URL}#/home`);
    const href = await page.evaluate(() => {
        const link = document.createElement('a');
        link.href = 'https://storage.googleapis.com/demo-hcm.firebasestorage.app/exports/none.zip';
        link.download = 'none.zip';
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        return link.href;
    });
    if (!href.startsWith(`${ADMIN_ORIGIN}/__stack/h/storage.googleapis.com/`)) {
        throw new Error(`a download link the page clicked kept its address: ${href}`);
    }
}

async function viewer(page: Page): Promise<void> {
    const manifest = await fetch(`${SITE_ORIGIN}/${E2E_CITY_ID}/data/manifest.json`);
    if (manifest.headers.get('x-hcm-stack-manifest') !== 'emulators') {
        throw new Error('the viewer is served the fixture manifest: the emulators published none yet');
    }
    await page.goto(`${SITE_ORIGIN}/${E2E_CITY_ID}/`);
    await page.locator('canvas.mapboxgl-canvas').first().waitFor({ timeout: TIMEOUT_MS });
}

/**
 * M12: a layer on its own tiles is one archive the viewer reads by range. The site's storage route answered every read with the whole
 * file (200), which the viewer's reader refuses, so the layer failed on the stack (the rehearsal of 2026-11-07, docs/LESSONS.md).
 */
async function ownTiles(): Promise<void> {
    const manifestUrl = `${SITE_ORIGIN}/${E2E_CITY_ID}/data/manifest.json`;
    const manifest = (await (await fetch(manifestUrl)).json()) as { layers: { id: string; source: { type: string; url?: string } }[] };
    const layer = manifest.layers.find((candidate) => candidate.source.type === 'pmtiles');
    if (layer?.source.url === undefined) {
        throw new Error('the published manifest has no layer on its own tiles');
    }
    const read = await fetch(new URL(layer.source.url, manifestUrl), { headers: { range: 'bytes=0-6' } });
    const magic = await read.text();
    if (read.status !== 206 || magic !== 'PMTiles') {
        throw new Error(`the archive of ${layer.id} was not read by range: ${String(read.status)}, ${String(magic.length)} bytes`);
    }
}

const STEPS: readonly Step[] = [
    { name: 'the owner signs in with the consent stand-in and lands on the dashboard', run: signIn },
    { name: 'Photos lists the seeded photos', run: photos },
    { name: 'Historical imagery lists the harvested scenes', run: imagery },
    { name: 'a frame to buy has its order card, and an ordered one is watched', run: orders },
    { name: 'the inbox lists what the server did', run: inbox },
    { name: "a layer's editor draws its tiles on the admin map through the mock Mapbox", run: layersMap },
    { name: 'the second city opens from its address, and its page is on the site', run: secondCity },
    { name: 'a file the page saves itself stays on the machine', run: savedFile },
    { name: "the viewer shows the emulators' published manifest", run: viewer },
    { name: "a layer's own tiles are read by range from the site", run: ownTiles },
];

async function check(): Promise<boolean> {
    const browser = await chromium.launch();
    const context = await browser.newContext({ locale: 'ro-RO', timezoneId: 'Europe/Bucharest', serviceWorkers: 'block' });
    const leaks: string[] = [];
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (LOOPBACK.has(url.hostname) || !url.protocol.startsWith('http')) {
            await route.fallback();
            return;
        }
        leaks.push(`${url.host}${url.pathname}`);
        await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    let passed = true;
    for (const step of STEPS) {
        try {
            await step.run(page);
            log.info(`[PASS] ${step.name}`);
        } catch (error: unknown) {
            passed = false;
            log.error(`[FAIL] ${step.name}`, { error: String(error).slice(0, 500) });
        }
    }
    await browser.close();
    if (leaks.length > 0) {
        log.error('[FAIL] requests reached the network for hosts off this machine (aborted)', { leaks: leaks.slice(0, 20) });
        return false;
    }
    log.info('[PASS] no request reached the network for a host off this machine');
    return passed;
}

if (await check()) {
    log.info('[SUCCESS] the local stack works');
} else {
    log.error('[FAILURE] the local stack check failed');
    process.exitCode = 1;
}
