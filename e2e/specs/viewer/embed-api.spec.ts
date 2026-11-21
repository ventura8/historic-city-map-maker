import type { Page } from '@playwright/test';

import { E2E_CITY_ID, E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { readInstrumentation } from '../../support/instrumentation.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { currentHash, engineEvents, menuButton, t, viewer } from '../../support/viewer.js';

/**
 * The embed API (behaviour V21, docs/ENGINE_API.md → JavaScript API and config.js): a third-party page loads the IIFE
 * build next to the Bucharest site and drives `HistoricCityMap.mount` and its controller; the public events and the
 * URL hash follow every call. A `config.js` that names a missing container mounts nothing and says why in the log.
 */

/** A page of its own beside the site: Mapbox GL JS and the engine's IIFE build, an element to mount into, no config.js. */
const EMBED_PAGE = '/bucharest/embed-e2e.html';
const EMBED_HTML = `<!DOCTYPE html>
<html lang="ro">
<head>
<meta charset="utf-8"><title>Embed e2e</title><link rel="icon" href="data:,">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"></script>
<script src="engine/engine.iife.js"></script>
<style>html, body, #embed { margin: 0; width: 100%; height: 100%; }</style>
</head>
<body><div id="embed"></div></body>
</html>`;

const LONE = 'strandul-opereta-1976';

interface EmbedWindow {
    HistoricCityMap: {
        mount(element: Element, config: unknown): Record<string, (...args: unknown[]) => unknown> & { ready: Promise<unknown> };
    };
    hcmE2eController?: Record<string, (...args: unknown[]) => unknown>;
}

async function openEmbed(page: Page): Promise<unknown> {
    await page.route(`**${EMBED_PAGE}`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: EMBED_HTML }));
    await page.goto(EMBED_PAGE);
    return page.evaluate(async () => {
        const scope = window as unknown as EmbedWindow;
        const controller = scope.HistoricCityMap.mount(document.getElementById('embed') as Element, {
            cityId: 'bucharest',
            manifestUrl: './data/manifest.json',
        });
        scope.hcmE2eController = controller;
        return controller.ready;
    });
}

async function call(page: Page, method: string, ...args: unknown[]): Promise<void> {
    await page.evaluate(
        ({ name, values }) => {
            (window as unknown as EmbedWindow).hcmE2eController?.[name]?.(...values);
        },
        { name: method, values: args },
    );
}

test('mount() boots a viewer whose controller drives the map, the events and the hash', { tag: '@S-V21-HAPPY' }, async ({ page }) => {
    expect(await openEmbed(page)).toEqual({ ok: true, cityId: E2E_CITY_ID });
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();

    await call(page, 'setYear', 1966);
    await expect(page.getByRole('slider', { name: t('ro', 'timeline.label'), exact: true })).toHaveAttribute(
        'aria-valuetext',
        t('ro', 'timeline.year', { year: '1966' }),
    );
    await expect
        .poll(() => engineEvents(page, 'hcm-layer-change'))
        .toContainEqual({ layerId: E2E_TILESET_LAYER.id, visible: true, opacity: 1, year: 1966 });

    await call(page, 'toggleLayer', E2E_XYZ_LAYER.id, true);
    await expect
        .poll(() => engineEvents(page, 'hcm-layer-change'))
        .toContainEqual(expect.objectContaining({ layerId: E2E_XYZ_LAYER.id, visible: true }));
    await call(page, 'openPhoto', LONE);
    await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
    expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: LONE }]);

    await call(page, 'setLang', 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect.poll(() => currentHash(page)).toContain('lang=en');
    const hash = await currentHash(page);
    expect(hash).toContain(`photo=${LONE}`);
    expect(hash).toMatch(new RegExp(`layers=(${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}|${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id})`));
    expect((await readInstrumentation(page)).mapsCreated).toBe(1);
});

test(
    'A config.js naming a missing container mounts nothing and logs why',
    { tag: '@S-V21-BAD-MISSING-CONTAINER' },
    async ({ page, lang, consoleErrors, mockApis }) => {
        const logged: string[] = [];
        page.on('console', (message) => logged.push(message.text()));
        await page.route('**/bucharest/config.js', (route) =>
            route.fulfill({
                contentType: 'text/javascript; charset=utf-8',
                body: "globalThis.HistoricCityMapConfig = { cityId: 'bucharest', manifestUrl: './data/manifest.json', container: '#nope' };",
            }),
        );
        await page.goto(sitePath('bucharest', { lang }));

        const expected = t(lang, 'error.config.container', { selector: '#nope' });
        await expect.poll(() => logged.some((text) => text.includes(expected))).toBe(true);
        await expect(page.locator('hcm-map-viewer')).toHaveCount(0);
        await expect(page.locator('#historic-city-map')).toBeEmpty();
        expect((await readInstrumentation(page)).mapsCreated).toBe(0);
        expect(await mockApis.mapLoadEvents()).toBe(0);
        expect(consoleErrors.take()).toEqual([expect.stringContaining(expected)]);
        await expect(menuButton(page, lang)).toHaveCount(0);
    },
);

test('After destroy() the map is gone and later calls change nothing', { tag: '@S-V21-BAD-AFTER-DESTROY' }, async ({ page }) => {
    expect(await openEmbed(page)).toEqual({ ok: true, cityId: E2E_CITY_ID });
    // The viewer writes the city view into the hash shortly after it is ready.
    await expect.poll(() => currentHash(page)).not.toBe('');
    const hashBefore = await currentHash(page);

    await call(page, 'destroy');

    await expect(page.locator('hcm-map-viewer')).toHaveCount(0);
    const counted = await readInstrumentation(page);
    expect(counted.mapsCreated).toBe(1);
    expect(counted.mapsRemoved).toBe(1);
    await call(page, 'setYear', 1966);
    await call(page, 'openPhoto', LONE);
    await call(page, 'destroy');
    expect(await engineEvents(page, 'hcm-photo-open')).toEqual([]);
    expect(await engineEvents(page, 'hcm-layer-change')).toEqual([]);
    expect(await currentHash(page)).toBe(hashBefore);
    await expect(page.locator('canvas')).toHaveCount(0);
});
