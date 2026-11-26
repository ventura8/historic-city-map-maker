import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from '@playwright/test';

import { SITE_ORIGIN } from '../../fixtures/world.js';
import {
    cdnEngineFolder,
    KIT_PATH,
    KIT_TEMPLATE,
    kitManifestWithToken,
    LATE_NOTE_DELAY,
    revealLateNotes,
    servedEngine,
    serveKit,
} from '../../support/kit.js';
import { expect, test } from '../../support/test.js';
import { callController, engineEvents, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The starter kit's template (behaviour V27; docs/research/M5-interfaces.md §3): its three files as committed, the
 * engine from the pinned jsDelivr folder with Subresource Integrity, Mapbox GL JS from api.mapbox.com. The bilingual note
 * inside `<hcm-map-viewer>` shows until the engine defines the element; when the engine is refused it stays, asking the
 * visitor to reload (the README's check is an HTML comment for the site's builder, never visitor text).
 */

const NOTES = { ro: 'Harta se încarcă.', en: 'The map is loading.' } as const;
const CITY = `${KIT_PATH}city.json`;
const KIT_HOSTS = ['api.mapbox.com', 'events.mapbox.com', 'cdn.jsdelivr.net'];

/** The pinned folder's path on the CDN host (`/gh/<repo>@v1.0.0/cdn/engine/`). */
function pinnedFolder(): string {
    const engine = servedEngine(readFileSync(resolve(KIT_TEMPLATE, 'index.html'), 'utf8'));
    return engine.kind === 'cdn' ? new URL(engine.release.base).pathname : '';
}

/** Answers the kit's city.json at `path` (any query) with `body`, or 404 while `available()` says no. */
async function serveCity(page: Page, body: string, available: () => boolean = () => true): Promise<void> {
    await page.route(
        (url) => url.origin === SITE_ORIGIN && url.pathname === CITY,
        (route) =>
            available()
                ? route.fulfill({ contentType: 'application/json', body })
                : route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }),
    );
}

test(
    'The template’s three files boot the example city from jsDelivr',
    { tag: '@S-V27-HAPPY' },
    async ({ page, lang, mockApis }, testInfo) => {
        await serveKit(page, testInfo);
        await serveCity(page, kitManifestWithToken());
        await page.goto(`${KIT_PATH}?lang=${lang}`);
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await engineEvents(page, 'hcm-ready')).toEqual([expect.objectContaining({ cityId: 'orasul-meu', layers: 0, photos: 0 })]);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
        await expect(page.getByText(NOTES[lang])).toBeHidden();
        await expect(
            page.getByRole('region', { name: t(lang, 'viewer.mapLabel', { city: lang === 'ro' ? 'Orașul meu' : 'My city' }) }),
        ).toBeVisible();
        await callController(page, 'openPoi', 'un-loc');
        await expect(
            viewer(page)
                .getByText(lang === 'ro' ? 'Un loc' : 'A place', { exact: true })
                .first(),
        ).toBeVisible();
        const calls = await mockApis.calls();
        const folder = pinnedFolder();
        expect(calls.filter((call) => call.host === 'cdn.jsdelivr.net').map((call) => call.path)).toEqual(
            expect.arrayContaining([`${folder}engine.css`, `${folder}engine.iife.js`]),
        );
        expect(
            calls.filter((call) => call.host === 'cdn.jsdelivr.net').every((call) => call.path.startsWith(folder) && call.status === 200),
        ).toBe(true);
        expect(calls.filter((call) => !KIT_HOSTS.includes(call.host))).toEqual([]);
        await expect(page.locator('script[src$="/mapbox-gl.js"]')).toHaveAttribute('integrity', /^sha384-/);
    },
);

test('A changed engine file is refused, never run', { tag: '@S-V27-BAD-INTEGRITY' }, async ({ page, lang, consoleErrors }, testInfo) => {
    const changed = readFileSync(resolve(cdnEngineFolder(), 'engine.iife.js'));
    const middle = changed.length >> 1;
    changed.writeUInt8(changed.readUInt8(middle) ^ 1, middle);
    await page.route('https://cdn.jsdelivr.net/**/engine.iife.js', (route) =>
        route.fulfill({ contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: changed }),
    );
    await serveKit(page, testInfo);
    await serveCity(page, kitManifestWithToken());
    await page.goto(`${KIT_PATH}?lang=${lang}`);

    await expect(page.getByText(NOTES.ro)).toBeVisible();
    await expect(page.getByText(NOTES.en)).toBeVisible();
    // docs/LESSONS.md 248: the troubleshooting waits while the engine may still be on its way; then it shows.
    await expect
        .poll(() =>
            page
                .locator('.hcm-note-late')
                .first()
                .evaluate((element) => getComputedStyle(element).animationDelay),
        )
        .toBe(LATE_NOTE_DELAY);
    await revealLateNotes(page);
    await expect(page.getByText('Reîncarcă pagina.').first()).toBeVisible();
    await expect(page.getByText('Reload the page.').first()).toBeVisible();
    await expect(page.getByText('README.md')).toHaveCount(0);
    await expect.poll(() => consoleErrors.takeMatching(/integrity/)).toEqual([expect.stringContaining('engine.iife.js')]);
    expect(await page.evaluate(() => customElements.get('hcm-map-viewer') === undefined)).toBe(true);
    await expect(page.locator('canvas.mapboxgl-canvas')).toHaveCount(0);
});

test(
    'Without city.json the page says the map was not found',
    { tag: '@S-V27-BAD-MISSING-CITY' },
    async ({ page, lang, consoleErrors }, testInfo) => {
        let published = false;
        await serveKit(page, testInfo);
        await serveCity(page, kitManifestWithToken(), () => published);
        await page.goto(`${KIT_PATH}?lang=${lang}`);

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.notFound'));
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
        published = true;
        await page.getByRole('button', { name: t(lang, 'action.retry') }).click();
        await waitForEngineEvent(page, 'hcm-ready');
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
    },
);

test(
    'The example’s placeholder token tells the owner to add their own',
    { tag: '@S-V27-BAD-PLACEHOLDER-TOKEN' },
    async ({ page, lang, consoleErrors, mockApis }, testInfo) => {
        await serveKit(page, testInfo);
        await page.goto(`${KIT_PATH}?lang=${lang}`);

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.mapLoad'));
        await expect(page.getByRole('button', { name: t(lang, 'action.retry') })).toBeVisible();
        expect(consoleErrors.takeMatching(/401/)).not.toEqual([]);
        expect((await mockApis.calls('api.mapbox.com')).some((call) => call.status === 401)).toBe(true);
    },
);
