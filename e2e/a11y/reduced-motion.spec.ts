import type { Page, Route } from '@playwright/test';

import { SITE_ORIGIN } from '../fixtures/world.js';
import { assertLayoutSound } from '../support/layout.js';
import { mapFacts, myLocationDrawn } from '../support/map.js';
import { sitePath } from '../support/site.js';
import { expect, test } from '../support/test.js';
import { BUCHAREST_MANIFEST, chooseMenuItem, openViewer, t, viewer } from '../support/viewer.js';

/**
 * Reduced motion (behaviour V14, bad path; project `a11y-reduced-motion`, `prefers-reduced-motion: reduce`): the camera
 * jumps instead of flying to the visitor's blue dot (which never pulses), and the loading skeleton does not shimmer; the generic layout checker of the tour holds after
 * the jump (without transitions every control is where it settles at once).
 */

const INSIDE = { latitude: 44.4301, longitude: 26.1003 } as const;

/** Runs in the page: counts the camera's `move` events from now on (the read-only map of the instrumentation). */
function countMoves(): void {
    const scope = window as unknown as { __hcmE2e: { maps: { on(type: string, listener: () => void): void }[] }; hcmE2eMoves: number };
    scope.hcmE2eMoves = 0;
    scope.__hcmE2e.maps.at(-1)?.on('move', () => {
        scope.hcmE2eMoves += 1;
    });
}

async function moves(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { hcmE2eMoves: number }).hcmE2eMoves);
}

test(
    'With reduced motion the camera jumps to the visitor instead of flying',
    { tag: '@S-V14-BAD-REDUCED-MOTION' },
    async ({ page, context, lang }) => {
        await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
        await context.setGeolocation(INSIDE);
        await openViewer(page, { lang });
        expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
        await page.evaluate(countMoves);

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));

        await expect.poll(async () => (await mapFacts(page)).center[1]).toBeCloseTo(INSIDE.latitude, 4);
        expect((await mapFacts(page)).zoom).toBeGreaterThanOrEqual(16);
        expect(await moves(page), 'one jump, not an animated flight').toBeLessThanOrEqual(2);
        await expect.poll(async () => (await myLocationDrawn(page))[0]?.dot ?? null, { message: 'the blue dot is drawn' }).not.toBeNull();
        await assertLayoutSound(page, 'reduced motion: after the jump');
    },
);

test('With reduced motion the loading skeleton stands still', { tag: '@S-V14-BAD-REDUCED-MOTION' }, async ({ page, lang }) => {
    const held: Route[] = [];
    await page.route(BUCHAREST_MANIFEST, (route) => {
        held.push(route);
    });
    await page.goto(sitePath('bucharest', { lang }));

    await expect(page.getByRole('status').filter({ hasText: t(lang, 'viewer.loading') })).toBeVisible();
    const shimmer = viewer(page).locator('.skeleton .shimmer');
    await expect(shimmer).toBeAttached();
    expect(await shimmer.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    await expect.poll(() => held.length).toBe(1);
    await held[0]?.fallback();
    await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toBeVisible();
});
