import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';

/**
 * Viewer smoke (projects `smoke-c360` and `smoke-l1440`): the built Bucharest site boots the engine from config.js
 * behind the mock APIs. The map canvas appears inside `<hcm-map-viewer>`, exactly one Mapbox map is created and one
 * map load is billed, the engine reports `hcm-ready`, and nothing outside the loopback and mocked hosts is contacted
 * (the firewall fixture fails the test otherwise, so no Firestore call can slip through).
 */

test(
    'Only allowlisted hosts, no Firestore calls, one map load',
    { tag: '@S-V16-HAPPY' },
    async ({ page, lang, mockApis, instrumentation }) => {
        await page.goto(sitePath('bucharest', { lang }));

        await expect(page.locator('hcm-map-viewer')).toBeAttached();
        await expect(page.locator('hcm-map-viewer canvas.mapboxgl-canvas')).toBeVisible();
        await expect.poll(async () => (await instrumentation.read(page)).events.map((event) => event.type)).toContain('hcm-ready');
        const counted = await instrumentation.read(page);
        expect(counted.mapsCreated).toBe(1);
        expect(counted.events.map((event) => event.type)).not.toContain('hcm-error');
        await expect.poll(() => mockApis.mapLoadEvents()).toBe(1);
    },
);
