import { expect, test as setup } from '@playwright/test';

import { buildFixtureManifest } from '../fixtures/manifest.js';
import { E2E_TELEMETRY_HOST, E2E_TILE_HOST, E2E_TILESET_LAYER, E2E_XYZ_LAYER, MOCK_API_ORIGIN, SITE_ORIGIN } from '../fixtures/world.js';

/**
 * The `setup` project every other project depends on (e2e/projects.ts): the fixture manifest validates, both servers
 * answer, and the built Bucharest site serves that fixture with a CSP for the e2e hosts. A broken fixture or a missing
 * `npm run build:site:e2e` fails here, once, instead of in every scenario. No page is opened, so this file uses
 * Playwright's own `test` (the browser fixtures of support/test.ts are not needed).
 */

setup('the e2e fixture manifest validates and the sites and mock APIs are served', async ({ request }) => {
    const fixture = buildFixtureManifest();

    expect(fixture.layers.map((layer) => layer.id)).toEqual([E2E_TILESET_LAYER.id, E2E_XYZ_LAYER.id]);
    expect((await request.get(`${MOCK_API_ORIGIN}/__health`)).ok()).toBe(true);
    for (const site of ['bucharest', 'starter-kit']) {
        const page = await request.get(`${SITE_ORIGIN}/${site}/`);
        expect(page.status(), `${site} is built (npm run build:site:e2e)`).toBe(200);
    }
    const served = (await (await request.get(`${SITE_ORIGIN}/bucharest/data/manifest.json`)).json()) as typeof fixture;
    expect(served.city.id).toBe(fixture.city.id);
    expect(served.layers.map((layer) => layer.id)).toEqual(fixture.layers.map((layer) => layer.id));
    expect((served.pois ?? []).map((poi) => poi.id)).toEqual((fixture.pois ?? []).map((poi) => poi.id));
    const page = await (await request.get(`${SITE_ORIGIN}/bucharest/`)).text();
    expect(page).toContain(`https://${E2E_TILE_HOST}`);
    expect(page).toContain(`https://${E2E_TELEMETRY_HOST}`);
});
