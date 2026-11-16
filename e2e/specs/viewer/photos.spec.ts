import type { Locator, Page } from '@playwright/test';
import type { Locale } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { mapFacts, mapIdle, renderedFeatureIds, renderedPoints, screenPointOf, type LngLat } from '../../support/map.js';
import { isColour, probePixel, sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, engineEvents, isDocked, openViewer, serveManifest, t, viewer, windowClassOf } from '../../support/viewer.js';

/**
 * Photos on the map (behaviour V07) and the lightbox (V08): clustered camera markers that expand when the visitor zooms
 * in, a detail sheet whose shape follows the window class, view cones from zoom 17, and the full image with zoom,
 * arrows and Esc. Image failures show a placeholder or an error state, never a broken image.
 */

interface FixturePhoto {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string };
    readonly location: { readonly lat: number; readonly lng: number };
}

const PHOTOS = siteManifestData()['photos'] as FixturePhoto[];

function photo(id: string): FixturePhoto {
    const found = PHOTOS.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(`no photo ${id} in the fixture`);
    }
    return found;
}

function titleOf(id: string, lang: Locale): string {
    const { title } = photo(id);
    return lang === 'en' ? (title.en ?? title.ro) : title.ro;
}

function lngLatOf(id: string): LngLat {
    const { location } = photo(id);
    return [location.lng, location.lat];
}

/** A photo with a view cone and no neighbour within 300 m; one without a bearing, in a dense street. */
const LONE = 'strandul-opereta-1976';
const LONE_VIEW = '18/44.42955/26.09560';
const NO_BEARING = 'intrarea-in-fabrica-luceafarul-nufarul';
const NO_BEARING_VIEW = '18.5/44.43082/26.08578';

/**
 * The detail sheet of a photo: a modal bottom sheet (compact) or side sheet (medium below 760 px) is a dialog; wider it
 * is a docked pane, a labelled region.
 */
function detailSheet(page: Page, name: string): Locator {
    return page.getByRole(isDocked(page) ? 'region' : 'dialog', { name, exact: true });
}

/** The visible variant of the sheet: `bottom`, `side` (both modal) or `docked`. */
async function sheetVariant(page: Page): Promise<string> {
    const modal = viewer(page).locator('hcm-photo-sheet hcm-sheet[open]');
    return (await modal.count()) > 0 ? ((await modal.getAttribute('variant')) ?? '') : 'docked';
}

function expectedVariant(page: Page): string {
    if (isDocked(page)) {
        return 'docked';
    }
    return windowClassOf(page.viewportSize()?.width ?? 0) === 'compact' ? 'bottom' : 'side';
}

interface ListLine {
    readonly text: string;
    readonly size: string;
    readonly lineHeight: string;
    /** The text is cut: wider or taller than its box. */
    readonly clipped: boolean;
    /** It wraps onto more than one line. */
    readonly wrapped: boolean;
}

/** Runs in the page: every date line and title of the open photo list, with its type size and whether it is cut. */
function listTypography(): { readonly dates: ListLine[]; readonly titleSizes: string[] } {
    const list = document.querySelector('hcm-map-viewer')?.shadowRoot?.querySelector('.photos-sheet hcm-photo-list')?.shadowRoot;
    const line = (element: Element): ListLine => {
        const style = getComputedStyle(element);
        const html = element as HTMLElement;
        return {
            text: html.textContent.trim(),
            size: style.fontSize,
            lineHeight: style.lineHeight,
            clipped: html.scrollWidth > html.clientWidth + 1 || html.scrollHeight > html.clientHeight + 1,
            wrapped: element.getClientRects().length > 1 || html.getBoundingClientRect().height > Number.parseFloat(style.lineHeight) * 1.5,
        };
    };
    return {
        dates: Array.from(list?.querySelectorAll('.date') ?? []).map(line),
        titleSizes: Array.from(list?.querySelectorAll('.title') ?? []).map((title) => getComputedStyle(title).fontSize),
    };
}

async function openPhotoList(page: Page, lang: Locale): Promise<void> {
    await chooseMenuItem(page, lang, t(lang, 'photos.list'));
    await expect(viewer(page).locator('.photos-sheet hcm-photo-list').getByRole('status')).toBeVisible();
}

async function clickPhoto(page: Page, id: string): Promise<void> {
    const point = await screenPointOf(page, lngLatOf(id));
    await page.mouse.click(point.x, point.y);
}

test(
    'Clusters expand on zoom, a marker opens the detail sheet, cones show from zoom 17',
    { tag: '@S-V07-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const [cluster] = await renderedPoints(page, 'hcm-photos-cluster');
        expect(cluster, 'the city view shows clusters').toBeDefined();
        const before = (await mapFacts(page)).zoom;
        const at = await screenPointOf(page, cluster?.lngLat ?? [0, 0]);
        await page.mouse.click(at.x, at.y);
        await expect.poll(async () => (await mapFacts(page)).zoom, { message: 'a cluster click zooms in' }).toBeGreaterThan(before + 0.25);
        await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the cluster flight ends' }).toBe(false);

        await page.evaluate((hash) => {
            location.hash = hash;
        }, LONE_VIEW);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toContain(LONE);
        await mapIdle(page);
        await clickPhoto(page, LONE);
        const sheet = detailSheet(page, titleOf(LONE, lang));
        await expect(sheet).toBeVisible();
        expect(await sheetVariant(page)).toBe(expectedVariant(page));
        await expect(page.getByRole('img', { name: titleOf(LONE, lang) })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: LONE }]);

        await page.evaluate(() => {
            location.hash = '16/44.42955/26.09560';
        });
        await expect.poll(async () => (await mapFacts(page)).zoom).toBeLessThan(16.5);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toEqual([]);
    },
);

test(
    'A thumbnail that fails shows a placeholder named after the photo',
    { tag: '@S-V07-BAD-IMAGE404' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(`**/data/media/${LONE}/thumb.webp`, (route) => route.fulfill({ status: 404, body: 'gone' }));
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

        const sheet = detailSheet(page, titleOf(LONE, lang));
        await expect(sheet).toBeVisible();
        const placeholder = page.getByRole('img', { name: titleOf(LONE, lang), exact: true });
        await expect(placeholder).toBeVisible();
        await expect(viewer(page).locator('hcm-photo-sheet .placeholder')).toContainText(t(lang, 'error.photoImage'));
        await expect(page.getByRole('button', { name: t(lang, 'photo.openLightbox') })).toHaveCount(0);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);

test(
    'A photo without a bearing has an unrotated marker, no cone, and still opens',
    { tag: '@S-V07-BAD-NO-BEARING' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: NO_BEARING_VIEW });

        await expect.poll(async () => (await renderedPoints(page, 'hcm-photos-marker')).map((point) => point.id)).toContain(NO_BEARING);
        const marker = (await renderedPoints(page, 'hcm-photos-marker')).find((point) => point.id === NO_BEARING);
        expect(marker?.properties).not.toHaveProperty('bearing');
        expect(await renderedFeatureIds(page, 'hcm-photos-cone')).not.toContain(NO_BEARING);

        await clickPhoto(page, NO_BEARING);
        const sheet = detailSheet(page, titleOf(NO_BEARING, lang));
        await expect(sheet).toBeVisible();
        await expect(viewer(page).locator('hcm-photo-sheet .supporting')).toHaveText(t(lang, 'photo.unknownYear'));
    },
);

function withRightsHolder(id: string, holder: string): Json {
    const manifest = siteManifestData();
    const target = (manifest['photos'] as Json[]).find((candidate) => candidate['id'] === id);
    if (target !== undefined) {
        target['rightsHolder'] = holder;
    }
    return manifest;
}

/** The fixture with the lone photo's own dating taken away and `fields` set. */
function withPhotoFields(fields: Readonly<Record<string, unknown>>): Json {
    const manifest = siteManifestData();
    const target = (manifest['photos'] as Json[]).find((candidate) => candidate['id'] === LONE) ?? {};
    for (const key of ['yearEnd', 'dateText']) {
        Reflect.deleteProperty(target, key);
    }
    Object.assign(target, fields);
    return manifest;
}

const ARCHIVE = { url: 'https://arhiva.example/foto/1976', label: 'Arhiva Operetei (e2e)' };

test('A photo reads at the precision of its date', { tag: '@S-V07-HAPPY-PRECISE-DATE' }, async ({ page, lang }) => {
    await serveManifest(page, withPhotoFields({ year: 1976, month: 7, day: 12 }));
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
    const date = viewer(page).locator('hcm-photo-sheet .supporting');
    await expect(date).toHaveText(lang === 'ro' ? '12 iulie 1976' : '12 July 1976');

    await serveManifest(page, withPhotoFields({ year: 1976, month: 7 }));
    await page.reload();
    await expect(date).toHaveText(lang === 'ro' ? 'Iulie 1976' : 'July 1976');
});

test(
    "An impossible date in a manifest is the manifest's error, never a shown date",
    { tag: '@S-V07-BAD-IMPOSSIBLE-DATE' },
    async ({ page, lang }) => {
        await serveManifest(page, withPhotoFields({ year: 1977, month: 2, day: 29 }));
        await page.goto(sitePath('bucharest', { lang }));

        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.invalid', { count: '1' }));
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
    },
);

test('The source is a plain link that opens in a new tab', { tag: '@S-V07-HAPPY-SOURCE-LINK' }, async ({ page, lang }) => {
    await serveManifest(page, withPhotoFields({ source: ARCHIVE }));
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

    const link = viewer(page).locator('hcm-photo-sheet .source').getByRole('link', { name: ARCHIVE.label });
    await expect(link).toHaveAttribute('href', ARCHIVE.url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
    await expect(viewer(page).locator('hcm-photo-sheet .source')).toContainText(t(lang, 'photo.source'));
});

test('A source that is not https makes the manifest invalid', { tag: '@S-V07-BAD-SOURCE-NOT-HTTPS' }, async ({ page, lang }) => {
    await serveManifest(page, withPhotoFields({ source: { url: 'http://arhiva.example/foto/1976' } }));
    await page.goto(sitePath('bucharest', { lang }));

    await expect(page.getByRole('alert')).toContainText(t(lang, 'error.manifest.invalid', { count: '1' }));
    await expect(viewer(page).locator('a[href^="http://arhiva"]')).toHaveCount(0);
});

test('A photo with no source, from an old manifest, shows no source line', { tag: '@S-V07-BAD-NO-SOURCE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

    await expect(viewer(page).locator('hcm-photo-sheet .details')).toContainText(t(lang, 'license.permission-legacy'));
    await expect(viewer(page).locator('hcm-photo-sheet .source')).toHaveCount(0);
});

test('The photo sheet credits the rights holder after the licence', { tag: '@S-V07-HAPPY-RIGHTS-HOLDER' }, async ({ page, lang }) => {
    await serveManifest(page, withRightsHolder(LONE, 'Arhiva Operetei (e2e)'));
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

    const details = viewer(page).locator('hcm-photo-sheet .details > p');
    // `allTextContents` does not wait, and the sheet renders after `hcm-ready`: poll for the line after the licence.
    await expect
        .poll(async () => {
            const texts = await details.allTextContents();
            const licence = texts.indexOf(t(lang, 'license.permission-legacy'));
            return licence < 0 ? 'no licence line' : texts[licence + 1];
        })
        .toBe(t(lang, 'photo.rightsHolder', { holder: 'Arhiva Operetei (e2e)' }));
});

test(
    'A photo without a rights holder shows its licence and no credit line',
    { tag: '@S-V07-BAD-NO-RIGHTS-HOLDER' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

        const details = viewer(page).locator('hcm-photo-sheet .details');
        await expect(details).toContainText(t(lang, 'license.permission-legacy'));
        await expect(details).not.toContainText('©');
    },
);

/** Pinches outwards on `target` with two touch points (Chrome DevTools Protocol touch input). */
async function pinchOut(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
            { x: x - 20, y, id: 1 },
            { x: x + 20, y, id: 2 },
        ],
    });
    for (const spread of [40, 60, 80, 100]) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                { x: x - spread, y, id: 1 },
                { x: x + spread, y, id: 2 },
            ],
        });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

const LIGHTBOX_INDEX = PHOTOS.findIndex((candidate) => candidate.id === LONE);

test(
    'The lightbox zooms with a pinch, steps with the arrows and gives focus back on Esc',
    { tag: '@S-V08-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();

        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox).toBeVisible();
        await expect(lightbox).toBeFocused();
        const position = (index: number): string =>
            t(lang, 'lightbox.position', { index: String(index + 1), total: String(PHOTOS.length) });
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX))).toBeVisible();
        const image = lightbox.getByRole('img', { name: titleOf(LONE, lang) });
        await expect(image).toBeVisible();
        const before = (await image.boundingBox())?.width ?? 0;
        await pinchOut(page, image);
        await expect
            .poll(async () => (await image.boundingBox())?.width ?? 0, { message: 'the pinch zooms the image in' })
            .toBeGreaterThan(before * 1.2);

        await page.keyboard.press('ArrowRight');
        const next = PHOTOS[LIGHTBOX_INDEX + 1]?.id ?? '';
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX + 1))).toBeVisible();
        await expect(lightbox.getByRole('img', { name: titleOf(next, lang) })).toBeVisible();
        await page.keyboard.press('ArrowLeft');
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX))).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
    },
);

/** The fixture's photos dated within ten years of `year` (the photo list's "near the year"), in manifest order. */
function photosNear(year: number): string[] {
    const dated = siteManifestData()['photos'] as { id: string; year?: number; yearEnd?: number }[];
    return dated
        .filter((entry) => entry.year !== undefined && entry.year <= year + 10 && (entry.yearEnd ?? entry.year) >= year - 10)
        .map((entry) => entry.id);
}

test(
    'A double tap zooms the photo in at the tapped point, and a second one zooms back out',
    { tag: '@S-V08-HAPPY-DOUBLE-TAP' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        const image = page.getByRole('dialog', { name: t(lang, 'lightbox.label') }).getByRole('img', { name: titleOf(LONE, lang) });
        await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)).toBe(true);
        const before = (await image.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
        const at = { x: before.width * 0.75, y: before.height * 0.5 };

        await image.dblclick({ position: at });
        await expect.poll(async () => (await image.boundingBox())?.width ?? 0, { message: 'zoomed in' }).toBeGreaterThan(before.width * 2);
        const zoomed = (await image.boundingBox()) ?? before;
        const share = (before.x + at.x - zoomed.x) / zoomed.width;
        expect(share, 'the tapped point of the photo stays under the finger').toBeCloseTo(0.75, 1);

        await image.dblclick({ position: { x: before.x + at.x - zoomed.x, y: before.y + at.y - zoomed.y } });
        await expect
            .poll(async () => (await image.boundingBox())?.width ?? 0, { message: 'back to the whole photo' })
            .toBeCloseTo(before.width, 0);
    },
);

test(
    'Two clicks far apart on the photo are no double tap: the photo keeps its size',
    { tag: '@S-V08-BAD-DOUBLE-TAP-APART' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        const image = page.getByRole('dialog', { name: t(lang, 'lightbox.label') }).getByRole('img', { name: titleOf(LONE, lang) });
        await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0)).toBe(true);
        const before = (await image.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };

        await image.click({ position: { x: before.width * 0.2, y: before.height * 0.5 } });
        await image.click({ position: { x: before.width * 0.8, y: before.height * 0.5 } });

        await expect(image).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
        expect((await image.boundingBox())?.width ?? 0).toBeCloseTo(before.width, 0);
    },
);

test(
    'The lightbox counts and pages through the list it was opened from: the photos near the year',
    { tag: '@S-V08-HAPPY-OPENED-LIST' },
    async ({ page, lang }) => {
        const near = photosNear(1966);
        expect(near.length, 'the fixture has photos near 1966 and others').toBeLessThan(PHOTOS.length);
        await openViewer(page, { lang, hash: `${LONE_VIEW}&layers=e2e-1966&photo=${LONE}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        const position = (index: number): string => t(lang, 'lightbox.position', { index: String(index + 1), total: String(near.length) });

        await expect(lightbox.getByText(position(near.indexOf(LONE)))).toBeVisible();
        for (let step = near.indexOf(LONE); step < near.length - 1; step += 1) {
            await page.keyboard.press('ArrowRight');
        }
        await expect(lightbox.getByText(position(near.length - 1))).toBeVisible();
        await expect(lightbox.getByRole('button', { name: t(lang, 'action.next') })).toBeDisabled();
    },
);

test(
    'A photo far from the year (a link to it) pages through all the photos',
    { tag: '@S-V08-BAD-PHOTO-OUTSIDE-LIST' },
    async ({ page, lang }) => {
        const far = PHOTOS.find((entry) => !photosNear(1966).includes(entry.id))?.id ?? '';
        const [lng, lat] = lngLatOf(far);
        await openViewer(page, { lang, hash: `18/${lat.toFixed(5)}/${lng.toFixed(5)}&layers=e2e-1966&photo=${far}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();

        const total = t(lang, 'lightbox.position', {
            index: String(PHOTOS.findIndex((entry) => entry.id === far) + 1),
            total: String(PHOTOS.length),
        });
        await expect(page.getByRole('dialog', { name: t(lang, 'lightbox.label') }).getByText(total)).toBeVisible();
    },
);

test(
    'Stepping to the last photo with the Next button keeps the focus in the lightbox, and Tab stays inside it',
    { tag: '@S-V08-BAD-FOCUS-AT-LAST-PHOTO' },
    async ({ page, lang }) => {
        const lastIndex = PHOTOS.length - 1;
        const before = PHOTOS[lastIndex - 1]?.id ?? '';
        const [lng, lat] = lngLatOf(before);
        await openViewer(page, { lang, hash: `18/${lat.toFixed(5)}/${lng.toFixed(5)}&photo=${before}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();
        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox).toBeFocused();

        // A focused button that becomes disabled drops the focus: Esc and the arrow keys used to stop working here.
        const next = lightbox.getByRole('button', { name: t(lang, 'action.next') });
        await next.focus();
        await page.keyboard.press('Enter');
        await expect(
            lightbox.getByText(t(lang, 'lightbox.position', { index: String(lastIndex + 1), total: String(PHOTOS.length) })),
        ).toBeVisible();
        await expect(next).toBeDisabled();
        await expect(lightbox).toBeFocused();

        // The last control before the disabled Next is Zoom in (V60), between the arrows.
        await page.keyboard.press('Shift+Tab');
        await expect(lightbox.getByRole('button', { name: t(lang, 'lightbox.zoomIn'), exact: true })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(lightbox.getByRole('button', { name: t(lang, 'action.close') })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
    },
);

test(
    'On a landscape phone the lightbox fits the whole photo on a scrim that hides the viewer',
    { tag: '@S-V08-BAD-SHORT-WINDOW' },
    async ({ page, lang }) => {
        // UX review: on 915 x 412 the photo overflowed its stage and was cropped, and the photo sheet showed through.
        await page.setViewportSize({ width: 915, height: 412 });
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        const image = page.getByRole('dialog', { name: t(lang, 'lightbox.label') }).getByRole('img', { name: titleOf(LONE, lang) });
        await expect
            .poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0), {
                message: 'the full image has loaded',
            })
            .toBe(true);

        const stage = (await viewer(page).locator('hcm-lightbox .stage').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
        const box = (await image.boundingBox()) ?? { x: 0, y: -1, width: 0, height: 0 };
        expect(box.height, 'the photo is drawn').toBeGreaterThan(0);
        expect(box.y, 'the top of the photo is inside the stage').toBeGreaterThanOrEqual(stage.y - 0.5);
        expect(box.y + box.height, 'the bottom of the photo is inside the stage').toBeLessThanOrEqual(stage.y + stage.height + 0.5);
        const middle = stage.y + stage.height / 2;
        for (const x of [stage.x + 4, stage.x + stage.width - 4]) {
            expect(isColour(await probePixel(page, x, middle), [0, 0, 0]), `the scrim at x = ${String(x)} is opaque`).toBe(true);
        }
    },
);

test(
    'A broken full image shows an error state and the lightbox still closes',
    { tag: '@S-V08-BAD-BROKEN-IMAGE' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(`**/data/media/${LONE}/web.webp`, (route) => route.fulfill({ status: 404, body: 'gone' }));
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();

        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox.getByRole('alert')).toContainText(t(lang, 'error.photoImage'));
        await lightbox.getByRole('button', { name: t(lang, 'action.close') }).click();
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);

test(
    'The photo list shows each date as 14 px supporting text under a 16 px title',
    { tag: '@S-V07-HAPPY-LIST-DATES' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        await openPhotoList(page, lang);

        const { dates, titleSizes } = await page.evaluate(listTypography);
        expect(dates).toHaveLength(PHOTOS.length);
        expect([...new Set(dates.map((date) => `${date.size}/${date.lineHeight}`))], 'M3 body-medium').toEqual(['14px/20px']);
        expect([...new Set(titleSizes)], 'M3 body-large').toEqual(['16px']);
        expect(dates.map((date) => date.text)).toContain(t(lang, 'photo.year', { year: '1976' }));
        expect(dates.filter((date) => date.clipped)).toEqual([]);
    },
);

test(
    'A long or a missing date wraps in the same supporting text and is never cut',
    { tag: '@S-V07-BAD-LIST-NO-DATE' },
    async ({ page, lang }) => {
        const manifest = siteManifestData();
        const photos = manifest['photos'] as Json[];
        const dated = photos.find((candidate) => candidate['id'] === LONE) ?? {};
        dated['dateText'] = {
            ro: 'Între primăvara lui 1974 și toamna lui 1976, după fotografiile de familie ale autorului',
            en: 'Between the spring of 1974 and the autumn of 1976, from the author family photographs',
        };
        await serveManifest(page, manifest);
        await page.setViewportSize({ width: 320, height: 640 });
        await openViewer(page, { lang });
        await openPhotoList(page, lang);

        const { dates } = await page.evaluate(listTypography);
        const long = dates.find((date) => date.text.startsWith(lang === 'ro' ? 'Între primăvara' : 'Between the spring'));
        const unknown = dates.filter((date) => date.text === t(lang, 'photo.unknownYear'));
        expect(long).toMatchObject({ size: '14px', clipped: false, wrapped: true });
        expect(unknown.length, 'the photos without a date say so').toBeGreaterThan(0);
        expect(unknown.every((date) => date.size === '14px' && !date.clipped)).toBe(true);
    },
);

test(
    'An aerial photo is labelled in the list and the list filters street and aerial photos',
    { tag: '@S-V76-HAPPY-AERIAL-FILTER' },
    async ({ page, lang }) => {
        await serveManifest(page, withPhotoFields({ kind: 'aerial', year: 1944 }));
        await openViewer(page, { lang });
        await openPhotoList(page, lang);
        const list = viewer(page).locator('.photos-sheet hcm-photo-list');

        await list.getByRole('radio', { name: t(lang, 'photos.filter.aerial'), exact: true }).check();
        await expect(list.getByRole('button')).toHaveCount(1);
        await expect(list.locator('.date')).toHaveText(`${t(lang, 'photos.kind.aerial')} · 1944`);
        await list.getByRole('radio', { name: t(lang, 'photos.filter.ground'), exact: true }).check();
        await expect(list.getByRole('button')).toHaveCount(PHOTOS.length - 1);
    },
);

test('A map with no aerial photo shows no street or aerial choice', { tag: '@S-V76-BAD-NO-AERIAL' }, async ({ page, lang }) => {
    await openViewer(page, { lang });
    await openPhotoList(page, lang);

    const list = viewer(page).locator('.photos-sheet hcm-photo-list');
    await expect(list.getByRole('button')).toHaveCount(PHOTOS.length);
    await expect(list.getByRole('radio')).toHaveCount(0);
});
