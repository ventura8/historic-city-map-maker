import { destinationPoint } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { SITE_ORIGIN } from '../../fixtures/world.js';
import { expectMapCounts } from '../../support/compare.js';
import { mapFacts, mapIdle, myLocationDrawn, pixelsOfColour, screenPointOf, type LngLat } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import {
    callController,
    chooseMenuItem,
    currentHash,
    hashParam,
    menuButton,
    openLayers,
    openViewer,
    t,
    viewer,
} from '../../support/viewer.js';

/**
 * "Show my location" (behaviour V10): a switch in the menu. On, the browser's position moves the camera there when it
 * lies inside the city and is drawn as a blue dot with its accuracy circle, its accuracy said in a polite status, and the
 * dot follows each new position; off (the menu again, or the page hidden) the dot goes. A refused permission or a
 * position outside the city says so in a toast and leaves the camera where it was. The position comes from the browser
 * context (Playwright's geolocation, which has no heading: the cone is unit-tested), never from a network service, and is
 * kept nowhere: not in the page's storage, not in a request, not in the address or a link shared from it.
 */

interface Position {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy: number;
}

const INSIDE: Position = { latitude: 44.4301, longitude: 26.1003, accuracy: 25 };
const MOVED: Position = { latitude: 44.4312, longitude: 26.1021, accuracy: 18 };
/** The view the page opens with before the visitor asks for their position. */
const CITY_VIEW = '14.5/44.42704/26.0853';
/** Cluj-Napoca: far outside Bucharest's bounds. */
const OUTSIDE: Position = { latitude: 46.7712, longitude: 23.6236, accuracy: 25 };
/** The dot's colour (`packages/ui/src/map/my-location.ts`). */
const BLUE = [26, 115, 232] as const;

function lngLatOf(position: Position): LngLat {
    return [position.longitude, position.latitude];
}

/** A position to four decimals (about 10 m), as the map gives it back. */
function rounded(lngLat: LngLat | null | undefined): readonly number[] | null {
    return lngLat === null || lngLat === undefined ? null : lngLat.map((value) => Number(value.toFixed(4)));
}

async function allowLocation(page: Page, position: Position): Promise<void> {
    await page.context().grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
    await page.context().setGeolocation(position);
}

/** Opens the menu: the Show my location switch in it. */
async function locateSwitch(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    await menuButton(page, lang).click();
    return page.getByRole('menuitemcheckbox', { name: t(lang, 'action.locate'), exact: true });
}

/** Where the viewer's map draws the dot now (null: none). */
async function dotOnTheMap(page: Page): Promise<readonly number[] | null> {
    return rounded((await myLocationDrawn(page))[0]?.dot);
}

async function expectDotAt(page: Page, position: Position): Promise<void> {
    await expect.poll(() => dotOnTheMap(page), { message: 'the dot is drawn there' }).toEqual(rounded(lngLatOf(position)));
}

test(
    'A position inside the city moves the camera there and shows it as a blue dot, its accuracy said politely',
    { tag: '@S-V10-HAPPY' },
    async ({ page, lang }) => {
        await allowLocation(page, INSIDE);
        await openViewer(page, { lang });

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));

        await expect
            .poll(async () => (await mapFacts(page)).center[1], { message: 'the camera reaches the latitude' })
            .toBeCloseTo(INSIDE.latitude, 4);
        await expect.poll(async () => (await mapFacts(page)).moving).toBe(false);
        const facts = await mapFacts(page);
        expect(facts.center[0]).toBeCloseTo(INSIDE.longitude, 4);
        expect(facts.zoom).toBeGreaterThanOrEqual(16);
        await expectDotAt(page, INSIDE);
        expect((await myLocationDrawn(page))[0]?.area).toBe(true);
        await mapIdle(page);
        const dot = await screenPointOf(page, lngLatOf(INSIDE));
        expect(await pixelsOfColour(page, dot, BLUE, 4), 'the visitor sees a blue dot').toBeGreaterThan(20);
        await expect(
            viewer(page)
                .getByRole('status')
                .filter({ hasText: t(lang, 'geolocate.shown', { meters: '25' }) }),
        ).toBeVisible();
        await expect(await locateSwitch(page, lang)).toHaveAttribute('aria-checked', 'true');
    },
);

test(
    'The dot follows a new position without moving the camera, and Show my location again removes it',
    { tag: '@S-V10-HAPPY-DOT-FOLLOWS' },
    async ({ page, lang }) => {
        await allowLocation(page, INSIDE);
        await openViewer(page, { lang });
        await chooseMenuItem(page, lang, t(lang, 'action.locate'));
        await expectDotAt(page, INSIDE);
        await expect.poll(async () => (await mapFacts(page)).moving).toBe(false);
        const camera = (await mapFacts(page)).center;

        await page.context().setGeolocation(MOVED);

        await expectDotAt(page, MOVED);
        expect((await mapFacts(page)).center[0]).toBeCloseTo(camera[0], 6);
        const item = await locateSwitch(page, lang);
        await expect(item).toHaveAttribute('aria-checked', 'true');
        await item.click();
        await expect.poll(() => dotOnTheMap(page)).toBeNull();
        await expect(await locateSwitch(page, lang)).toHaveAttribute('aria-checked', 'false');
    },
);

test(
    'A hidden page stops watching: the dot goes, and the position is kept nowhere',
    { tag: '@S-V10-BAD-PAGE-HIDDEN' },
    async ({ page, lang }) => {
        const requests: string[] = [];
        page.on('request', (request) => requests.push(`${request.url()} ${request.postData() ?? ''}`));
        await allowLocation(page, INSIDE);
        await openViewer(page, { lang });
        await chooseMenuItem(page, lang, t(lang, 'action.locate'));
        await expectDotAt(page, INSIDE);
        await page.context().setGeolocation(MOVED);
        await expectDotAt(page, MOVED);

        await page.evaluate(() => {
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
            document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
        });

        await expect.poll(() => dotOnTheMap(page)).toBeNull();
        await page.evaluate(() => {
            Reflect.deleteProperty(document, 'visibilityState');
        });
        await page.context().setGeolocation(INSIDE);
        await expect(await locateSwitch(page, lang)).toHaveAttribute('aria-checked', 'false');
        expect(await dotOnTheMap(page)).toBeNull();
        const stored = await page.evaluate(() =>
            [localStorage, sessionStorage]
                .flatMap((storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? ''))
                .join(' '),
        );
        expect(stored).not.toContain(String(MOVED.latitude));
        expect(requests.filter((line) => line.includes(String(MOVED.latitude)) || line.includes(String(MOVED.longitude)))).toEqual([]);
    },
);

test(
    'The address and a shared link keep the view they had: the position is not in them',
    { tag: '@S-V10-BAD-POSITION-NOT-IN-LINK' },
    async ({ page, context, lang }) => {
        await context.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
        await context.setGeolocation(INSIDE);
        await page.addInitScript(() => {
            Reflect.deleteProperty(Navigator.prototype, 'share');
        });
        await openViewer(page, { lang, hash: CITY_VIEW });

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));
        await expectDotAt(page, INSIDE);
        await expect.poll(async () => (await mapFacts(page)).center[1]).toBeCloseTo(INSIDE.latitude, 4);
        await expect.poll(async () => (await mapFacts(page)).moving).toBe(false);
        // A change the hash carries (the street names off) makes the viewer write it with the view it holds now.
        await callController(page, 'setMapLabels', { streets: false });
        await expect.poll(() => hashParam(page, 'labels'), { message: 'the hash is written again' }).not.toBeNull();

        expect((await currentHash(page)).split('&')[0], 'the address keeps the view it had').toBe(CITY_VIEW);
        await chooseMenuItem(page, lang, t(lang, 'action.share'));
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'share.copied') })).toBeVisible();
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(new URL(copied).hash.split('&')[0]).toBe(`#${CITY_VIEW}`);
        for (const coordinate of [INSIDE.latitude, INSIDE.longitude]) {
            expect(`${page.url()} ${copied}`, 'the position is in no link').not.toContain(String(coordinate));
        }
    },
);

test(
    'After several positions the map shows one blue dot only, its accuracy circle a translucent fill with no dot at its edge',
    { tag: '@S-V10-BAD-ONE-DOT-ONLY' },
    async ({ page, lang }) => {
        await allowLocation(page, INSIDE);
        await openViewer(page, { lang });
        await chooseMenuItem(page, lang, t(lang, 'action.locate'));
        await expectDotAt(page, INSIDE);
        await expect.poll(async () => (await mapFacts(page)).moving).toBe(false);

        for (const position of [MOVED, INSIDE]) {
            await page.context().setGeolocation(position);
            await expectDotAt(page, position);
        }
        await mapIdle(page);

        const [drawn] = await myLocationDrawn(page);
        expect(drawn?.dots, 'the dot layer draws the one position, no dot at a vertex of the circle').toEqual(['Point']);
        expect(drawn?.area).toBe(true);
        expect(drawn?.areaType, 'the accuracy circle is a fill').toBe('fill');
        // The circle's northern edge: a dot drawn at that vertex (the owner's "a lot of blue dots") would paint it solid blue.
        const edge = await screenPointOf(page, destinationPoint(lngLatOf(INSIDE), 0, INSIDE.accuracy));
        expect(await pixelsOfColour(page, edge, BLUE, 4), 'no blue dot on the accuracy circle').toBe(0);
        expect(await pixelsOfColour(page, await screenPointOf(page, lngLatOf(INSIDE)), BLUE, 4)).toBeGreaterThan(20);
    },
);

test('A refused permission says so and the camera stays', { tag: '@S-V10-BAD-DENIED' }, async ({ page, context, lang }) => {
    await context.clearPermissions();
    await openViewer(page, { lang });
    const before = await mapFacts(page);

    await chooseMenuItem(page, lang, t(lang, 'action.locate'));

    await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.geolocate.denied') })).toBeVisible();
    const after = await mapFacts(page);
    expect(after.center[0]).toBeCloseTo(before.center[0], 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(await dotOnTheMap(page)).toBeNull();
    await expect(await locateSwitch(page, lang)).toHaveAttribute('aria-checked', 'false');
});

test('A position outside the city says so and the camera stays', { tag: '@S-V10-BAD-OUT-OF-BOUNDS' }, async ({ page, lang }) => {
    await allowLocation(page, OUTSIDE);
    await openViewer(page, { lang });
    const before = await mapFacts(page);

    await chooseMenuItem(page, lang, t(lang, 'action.locate'));

    await expect(page.getByRole('status').filter({ hasText: t(lang, 'error.geolocate.outside') })).toBeVisible();
    const after = await mapFacts(page);
    expect(after.center[1]).toBeCloseTo(before.center[1], 6);
    expect(after.zoom).toBeCloseTo(before.zoom, 6);
    expect(await dotOnTheMap(page)).toBeNull();
});

test(
    'While comparing, both sides show the dot, with no new map load',
    { tag: '@S-V10-HAPPY-COMPARE-BOTH-SIDES' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await allowLocation(page, INSIDE);
        await openViewer(page, { lang });
        await openLayers(page, lang);
        await viewer(page)
            .getByRole('button', { name: t(lang, 'compare.open'), exact: true })
            .click();
        await expectMapCounts(page, 2, 0);

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));

        const expected = rounded(lngLatOf(INSIDE));
        await expect.poll(async () => (await myLocationDrawn(page)).map(({ dot }) => rounded(dot))).toEqual([expected, expected]);
        await expectMapCounts(page, 2, 0);
    },
);
