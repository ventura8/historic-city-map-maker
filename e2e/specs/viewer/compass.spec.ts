import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { bothAtRest, cameras, compareBar, countedMoves, countMoves } from '../../support/compare.js';
import { mapIdle } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { currentHash, openViewer, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The compass (behaviour V64, the owner on 2026-11-13: "i want us to have a compass for the viewer. (and clicking on it
 * resets to north up)"): an icon button by the zoom group whose needle turns with the map, and whose press,
 * Enter or Space turns the map back to north up and level, animated (a jump under reduced motion); the address drops its
 * bearing. North up it stays, quiet; a press there changes nothing. In swipe compare both maps turn back. Where it sits
 * at every window size is the tour's (viewer.tour.ts, journey `compass`).
 */

const CENTRE = '44.42704/26.0853';
/** Two maps under SwiftShader take longer to settle (as the tour's compare states). */
const TWO_MAPS_IDLE_MS = 60_000;

function compass(page: Page, lang: Locale): Locator {
    return page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true });
}

function compassHost(page: Page): Locator {
    return viewer(page).locator('hcm-compass');
}

/** The view part of the address (`zoom/lat/lng[/bearing]`). */
async function hashView(page: Page): Promise<string> {
    return (await currentHash(page)).split('&')[0] ?? '';
}

/** Runs in the page: the viewer's map's tilt. */
function pitchInPage(): number {
    const maps = (window as unknown as { __hcmE2e?: { maps: { getPitch(): number }[] } }).__hcmE2e?.maps ?? [];
    return maps[0]?.getPitch() ?? Number.NaN;
}

/** A right-drag over the map's middle (Mapbox's own rotate and tilt gesture): `dx` turns it, `dy` tilts it. */
async function rightDrag(page: Page, dx: number, dy: number): Promise<void> {
    const box = await viewer(page).locator('.map').boundingBox();
    expect(box, 'the map is on screen').not.toBeNull();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up({ button: 'right' });
}

test(
    'A click on the compass turns a turned map back to north up and the address drops its bearing',
    { tag: '@S-V64-HAPPY-COMPASS-RESET' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `16/${CENTRE}/45` });
        await expect(compassHost(page)).not.toHaveAttribute('north');
        await expect(compass(page, lang)).toHaveAccessibleDescription(t(lang, 'viewer.compassTurned', { degrees: '45' }));

        await compass(page, lang).click();

        await expect.poll(() => hashView(page)).toBe(`16/${CENTRE}`);
        await mapIdle(page);
        expect((await cameras(page))[0]?.bearing).toBe(0);
        await expect(compassHost(page)).toHaveAttribute('north');
        await expect(compass(page, lang)).toHaveAccessibleDescription(t(lang, 'viewer.compassNorth'));
    },
);

test(
    "The needle follows the map's own rotate gesture, and Space levels a turned and tilted map",
    { tag: '@S-V64-HAPPY-NEEDLE-FOLLOWS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `16/${CENTRE}` });
        await expect(compassHost(page)).toHaveAttribute('north');

        await rightDrag(page, 160, -80);
        await mapIdle(page);

        const turned = (await cameras(page))[0]?.bearing ?? 0;
        expect(Math.abs(turned), 'the right-drag turned the map').toBeGreaterThan(1);
        expect(await page.evaluate(pitchInPage), 'and tilted it').toBeGreaterThan(1);
        await expect(compassHost(page)).not.toHaveAttribute('north');

        await compass(page, lang).focus();
        await page.keyboard.press('Space');
        await expect.poll(async () => (await cameras(page))[0]?.bearing).toBe(0);
        await mapIdle(page);
        expect(await page.evaluate(pitchInPage)).toBe(0);
        await expect(compassHost(page)).toHaveAttribute('north');
        await expect(compass(page, lang)).toBeFocused();
    },
);

test('In swipe compare the compass turns both maps north', { tag: '@S-V64-HAPPY-COMPARE' }, async ({ page, lang }) => {
    await page.goto(sitePath('bucharest', { lang, hash: `15/${CENTRE}/90&layers=e2e-1966&cmp=` }));
    await waitForEngineEvent(page, 'hcm-ready');
    await expect(compareBar(page, lang)).toBeVisible();
    await mapIdle(page, TWO_MAPS_IDLE_MS);

    await compass(page, lang).click();

    // Two maps where the window swipes (600 px and wider), one toggled map on a phone: each ends north up, at rest.
    const bearings = async (): Promise<readonly number[]> => (await cameras(page)).map((camera) => camera.bearing);
    await expect.poll(async () => (await bearings()).every((bearing) => bearing === 0), { timeout: TWO_MAPS_IDLE_MS }).toBe(true);
    await expect.poll(async () => (await bearings()).length < 2 || bothAtRest(page), { timeout: TWO_MAPS_IDLE_MS }).toBe(true);
    await expect.poll(() => hashView(page)).toBe(`15/${CENTRE}`);
});

test(
    'North up already, the compass stays, quiet, and a press or Enter changes nothing',
    { tag: '@S-V64-BAD-ALREADY-NORTH' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `16/${CENTRE}` });
        await expect(compass(page, lang)).toBeVisible();
        await expect(compassHost(page)).toHaveAttribute('north');
        const before = await currentHash(page);
        const camera = await cameras(page);
        await countMoves(page);

        await compass(page, lang).click();
        await page.keyboard.press('Enter');
        await mapIdle(page);

        expect(await countedMoves(page)).toBe(0);
        expect(await currentHash(page)).toBe(before);
        expect(await cameras(page)).toEqual(camera);
        await expect(compass(page, lang)).toBeFocused();
    },
);

test('Under reduced motion the compass jumps north instead of turning', { tag: '@S-V64-BAD-REDUCED-MOTION' }, async ({ page, lang }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openViewer(page, { lang, hash: `16/${CENTRE}/200` });
    await countMoves(page);

    await compass(page, lang).click();

    await expect.poll(() => hashView(page)).toBe(`16/${CENTRE}`);
    // A jump is one camera change: one `move`, never the dozens of frames of a turn.
    expect(await countedMoves(page)).toBeLessThanOrEqual(2);
    expect((await cameras(page))[0]?.bearing).toBe(0);
    await expect(compassHost(page)).toHaveAttribute('north');
});
