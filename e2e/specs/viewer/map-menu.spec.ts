import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { SITE_ORIGIN } from '../../fixtures/world.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t, viewer } from '../../support/viewer.js';
import { UNPLACED_CONTRIBUTE_URL } from '../../tour/unplaced-states.js';

/**
 * The map's menu (behaviour V62; the owner on 2026-11-09): a right click, a long press on a touch screen or the ContextMenu
 * key opens a menu at that point of the map with "Open in Google Street View" (a plain link to Google Maps' panorama of the
 * place, in a new tab), "Copy coordinates" and "Share a link to this view" (the page's address, whose hash carries the view;
 * the owner, 2026-11-12); a right-drag rotates the map and opens nothing; Esc closes it and the focus goes back to the map;
 * near an edge it stays inside the map; a clipboard that refuses is said by a toast. A photo's sheet links to Street View at the photo's place, looking along its bearing.
 */

const CENTRE = { lat: 44.42704, lng: 26.0853 };
const HASH = `16/${String(CENTRE.lat)}/${String(CENTRE.lng)}`;

function map(page: Page): Locator {
    return viewer(page).locator('.map');
}

function menu(page: Page, lang: Locale): Locator {
    return page.getByRole('menu', { name: t(lang, 'mapMenu.label') });
}

async function mapBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await map(page).boundingBox();
    expect(box, 'the map is on screen').not.toBeNull();
    return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The viewpoint a Street View link names, as numbers. */
function viewpointOf(href: string | null): { lat: number; lng: number } {
    const [lat = 'NaN', lng = 'NaN'] = new URL(href ?? 'https://x/').searchParams.get('viewpoint')?.split(',') ?? [];
    return { lat: Number(lat), lng: Number(lng) };
}

test(
    'A right click opens the menu at the place, whose Street View link names it',
    { tag: '@S-V62-HAPPY-RIGHT-CLICK' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: HASH });
        const box = await mapBox(page);

        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });

        const link = menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.streetView') });
        await expect(link).toBeFocused();
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        const place = viewpointOf(await link.getAttribute('href'));
        expect(place.lat).toBeCloseTo(CENTRE.lat, 3);
        expect(place.lng).toBeCloseTo(CENTRE.lng, 3);
        await expect(menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.copy') })).toBeVisible();
        await expect(menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.share') })).toBeVisible();
    },
);

/** No Web Share API (Linux Chromium has none either): sharing goes through the clipboard. */
function withoutWebShare(): void {
    Reflect.deleteProperty(Navigator.prototype, 'share');
}

/** The clipboard refuses every write, as a browser does without permission. */
function refusingClipboard(): void {
    Reflect.deleteProperty(Navigator.prototype, 'share');
    Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get: () => ({ writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) }),
    });
}

function toast(page: Page, text: string): Locator {
    return page.getByRole('status').filter({ hasText: text });
}

async function openByRightClick(page: Page, lang: Locale): Promise<Locator> {
    const box = await mapBox(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(menu(page, lang)).toBeVisible();
    return menu(page, lang);
}

test(
    'Shift+F10 on the focused map opens the menu at its centre; Copy coordinates copies the place and the focus returns',
    { tag: '@S-V62-HAPPY-KEYBOARD-COPY' },
    async ({ page, context, lang }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
        await openViewer(page, { lang, hash: HASH });
        const canvas = map(page).locator('canvas.mapboxgl-canvas');
        await canvas.focus();

        await page.keyboard.press('Shift+F10');
        await expect(menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.streetView') })).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(menu(page, lang).getByRole('menuitem', { name: t(lang, 'mapMenu.copy') })).toBeFocused();
        await page.keyboard.press('Enter');

        await expect(toast(page, t(lang, 'mapMenu.copied'))).toBeVisible();
        await expect(menu(page, lang)).toHaveCount(0);
        await expect(canvas).toBeFocused();
        const [lat = 'NaN', lng = 'NaN'] = (await page.evaluate(() => navigator.clipboard.readText())).split(', ');
        expect(Number(lat)).toBeCloseTo(CENTRE.lat, 3);
        expect(Number(lng)).toBeCloseTo(CENTRE.lng, 3);
    },
);

test('Share a link to this view copies the address of the view', { tag: '@S-V62-HAPPY-SHARE' }, async ({ page, context, lang }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE_ORIGIN });
    await page.addInitScript(withoutWebShare);
    await openViewer(page, { lang, hash: HASH });
    const opened = await openByRightClick(page, lang);

    await opened.getByRole('menuitem', { name: t(lang, 'mapMenu.share') }).click();

    await expect(toast(page, t(lang, 'share.copied'))).toBeVisible();
    await expect(menu(page, lang)).toHaveCount(0);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(page.url());
    expect(new URL(copied).hash).toContain('16/44.427');
});

test(
    'A clipboard that refuses: neither the coordinates nor the link is copied, and a toast says so',
    { tag: '@S-V62-BAD-CLIPBOARD-REFUSED' },
    async ({ page, lang }) => {
        await page.addInitScript(refusingClipboard);
        await openViewer(page, { lang, hash: HASH });
        const before = page.url();

        await (await openByRightClick(page, lang)).getByRole('menuitem', { name: t(lang, 'mapMenu.copy') }).click();
        await expect(toast(page, t(lang, 'mapMenu.copyFailed'))).toBeVisible();
        await (await openByRightClick(page, lang)).getByRole('menuitem', { name: t(lang, 'mapMenu.share') }).click();

        await expect(toast(page, t(lang, 'share.failed'))).toBeVisible();
        await expect(menu(page, lang)).toHaveCount(0);
        expect(page.url()).toBe(before);
    },
);

test('A long press on a touch screen opens the menu', { tag: '@S-V62-HAPPY-LONG-PRESS' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);
    const at = { clientX: box.x + 60, clientY: box.y + 80 };

    await map(page).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });

    await expect(menu(page, lang)).toBeVisible();
    await map(page).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });
    await expect(menu(page, lang)).toBeVisible();
});

/** Whether the browser's text selection may start at `target` (false: the page cancelled `selectstart`). */
async function selectionStarts(target: Locator): Promise<boolean> {
    return target.evaluate((element) =>
        element.dispatchEvent(new Event('selectstart', { bubbles: true, cancelable: true, composed: true })),
    );
}

test(
    'A long press on the map selects no text and offers no touch callout; the menu alone answers',
    { tag: '@S-V62-HAPPY-NO-SELECTION' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: HASH });
        const box = await mapBox(page);
        const at = { clientX: box.x + 60, clientY: box.y + 80 };

        await map(page).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });
        const whileHeld = await selectionStarts(map(page).locator('canvas.mapboxgl-canvas'));
        await expect(menu(page, lang)).toBeVisible();
        await map(page).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...at });

        expect(whileHeld, 'selectstart under the finger is cancelled').toBe(false);
        expect(await selectionStarts(map(page).locator('.mapboxgl-ctrl-attrib')), 'nor after the long press, on the credits').toBe(false);
        await expect(map(page)).toHaveCSS('user-select', 'none');
        expect(await page.evaluate(() => getSelection()?.toString() ?? ''), 'nothing is selected').toBe('');
    },
);

test(
    'A short tap on the map lets the browser select again once the finger lifts, and opens no menu',
    { tag: '@S-V62-BAD-SHORT-TAP' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: HASH });
        const box = await mapBox(page);
        const at = { clientX: box.x + 60, clientY: box.y + 80 };

        await map(page).dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 8, isPrimary: true, ...at });
        await map(page).dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 8, isPrimary: true, ...at });

        expect(await selectionStarts(map(page)), 'no finger down: the page no longer cancels selectstart').toBe(true);
        await expect(menu(page, lang)).toHaveCount(0);
    },
);

test(
    "A photo's sheet links to Street View at its place, looking along its bearing",
    { tag: '@S-V62-HAPPY-PHOTO' },
    async ({ page, lang }) => {
        const photos = siteManifestData()['photos'] as { id: string; bearing?: number; location: { lat: number; lng: number } }[];
        const photo = photos.find((candidate) => candidate.bearing !== undefined);
        expect(photo, 'the fixture has a photo with a bearing').toBeDefined();
        await openViewer(page, { lang, hash: `18/${String(photo?.location.lat)}/${String(photo?.location.lng)}&photo=${photo?.id ?? ''}` });

        const link = page.getByRole('link', { name: t(lang, 'mapMenu.streetView') });

        await expect(link).toHaveAttribute('href', new RegExp(`&heading=${String(Math.round(photo?.bearing ?? 0) % 360)}$`));
        expect(viewpointOf(await link.getAttribute('href')).lat).toBeCloseTo(photo?.location.lat ?? 0, 5);
    },
);

test(
    "A photo's sheet keeps its lone links, Street View and Suggest a correction, 48 px tall",
    { tag: '@S-V62-BAD-LONE-LINKS-SMALL' },
    async ({ page, lang }) => {
        // The Pixel Tablet, 2026-11-12: both links were 19 px tall, a line of text, too small for a finger.
        const manifest = siteManifestData();
        const photos = manifest['photos'] as { id: string; bearing?: number; location: { lat: number; lng: number } }[];
        const photo = photos.find((candidate) => candidate.bearing !== undefined);
        await serveManifest(page, { ...manifest, contributeUrl: UNPLACED_CONTRIBUTE_URL });
        await openViewer(page, { lang, hash: `18/${String(photo?.location.lat)}/${String(photo?.location.lng)}&photo=${photo?.id ?? ''}` });

        for (const name of [t(lang, 'mapMenu.streetView'), t(lang, 'photo.suggest')]) {
            const link = viewer(page).locator('hcm-photo-sheet').getByRole('link', { name, exact: true });
            await expect(link).toBeVisible();
            expect((await link.boundingBox())?.height ?? 0, `${name}: a finger's target`).toBeGreaterThanOrEqual(48);
        }
    },
);

test('A right-drag rotates the map and opens no menu', { tag: '@S-V62-BAD-DRAG' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up({ button: 'right' });

    await expect(menu(page, lang)).toHaveCount(0);
});

test('Esc closes the menu; near the edge it stays inside the map', { tag: '@S-V62-BAD-ESC-EDGE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: HASH });
    const box = await mapBox(page);

    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 3, { button: 'right' });
    const opened = await menu(page, lang).boundingBox();
    expect(opened, 'the menu is open').not.toBeNull();
    expect((opened?.x ?? 0) + (opened?.width ?? 0)).toBeLessThanOrEqual(box.x + box.width);
    expect((opened?.y ?? 0) + (opened?.height ?? 0)).toBeLessThanOrEqual(box.y + box.height);
    await page.keyboard.press('Escape');

    await expect(menu(page, lang)).toHaveCount(0);
});
