import type { Locale } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { currentHash, openViewer, serveManifest, t } from '../../support/viewer.js';

/**
 * The full-size view's Zoom in and Zoom out (behaviour V60) and a photo's versions (V61; the owner on 2026-11-09). The
 * full-size view is side-loaded with its integrity the first time it opens (`engine.extras.js`); its buttons zoom the
 * photo around the centre and say they are disabled at the limits. A photo with an improved and a colorized version shows
 * the improved one, a switch Original / Improved / Colorized in the detail sheet and the full-size view, and the choice in
 * the address (`pv=`); a word the viewer does not know shows the original, and a photo with only its original has no switch.
 */

interface FixturePhoto extends Json {
    readonly id: string;
    readonly image: Json;
}

const LONE = 'strandul-opereta-1976';
const LONE_VIEW = '18/44.42955/26.09560';

/** The fixture with LONE carrying an improved (another photo's image) and a credited colorized version. */
function versionedManifest(): Json {
    const manifest = siteManifestData();
    const photos = manifest['photos'] as FixturePhoto[];
    const [improved, colorized] = photos.filter((photo) => photo.id !== LONE).map((photo) => photo.image);
    const versions = { improved, colorized: { ...colorized, credit: 'Ana Pop' } };
    return { ...manifest, photos: photos.map((photo) => (photo.id === LONE ? { ...photo, versions } : photo)) };
}

function imageWeb(manifest: Json, id: string, version: 'improved' | 'colorized' | null): string {
    const photo = (manifest['photos'] as FixturePhoto[]).find((candidate) => candidate.id === id);
    const image = version === null ? photo?.image : ((photo?.['versions'] as Json | undefined)?.[version] as Json | undefined);
    const web = image?.['web'];
    return typeof web === 'string' ? web : '';
}

function fullView(page: Page, lang: Locale): Locator {
    return page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
}

async function openFullView(page: Page, lang: Locale): Promise<Locator> {
    await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
    const view = fullView(page, lang);
    await expect(view).toBeVisible();
    return view;
}

function versions(scope: Locator | Page, lang: Locale): Locator {
    return scope.getByRole('radiogroup', { name: t(lang, 'photo.versions') });
}

async function imageWidth(view: Locator): Promise<number> {
    return (await view.locator('img').boundingBox())?.width ?? 0;
}

test(
    'The full-size view loads beside the engine and its buttons zoom the photo in and out',
    { tag: '@S-V60-HAPPY' },
    async ({ page, lang }) => {
        const parts: string[] = [];
        page.on('request', (request) => {
            if (request.url().endsWith('/engine.extras.js')) {
                parts.push(request.url());
            }
        });
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        expect(parts, 'nothing of the full-size view loads before it opens').toEqual([]);

        const view = await openFullView(page, lang);
        expect(parts).toHaveLength(1);
        const before = await imageWidth(view);
        await view.getByRole('button', { name: t(lang, 'lightbox.zoomIn'), exact: true }).click();
        await expect.poll(() => imageWidth(view), { message: 'Zoom in enlarges the photo' }).toBeGreaterThan(before * 1.2);
        await view.getByRole('button', { name: t(lang, 'lightbox.zoomOut'), exact: true }).click();

        await expect.poll(() => imageWidth(view), { message: 'Zoom out brings it back' }).toBeLessThan(before * 1.05);
    },
);

test('Zoom out says it is disabled at the photo size and Zoom in at the largest', { tag: '@S-V60-BAD-LIMITS' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
    const view = await openFullView(page, lang);
    const zoomIn = view.getByRole('button', { name: t(lang, 'lightbox.zoomIn'), exact: true });
    const zoomOut = view.getByRole('button', { name: t(lang, 'lightbox.zoomOut'), exact: true });

    await expect(zoomOut).toHaveAttribute('aria-disabled', 'true');
    await zoomIn.focus();
    for (let press = 0; press < 8; press += 1) {
        await page.keyboard.press('Enter');
    }

    await expect(zoomIn).toHaveAttribute('aria-disabled', 'true');
    await expect(zoomIn).toBeFocused();
    await expect(zoomOut).not.toHaveAttribute('aria-disabled', 'true');
});

test(
    'A photo with versions shows the improved one, switches to colorized and keeps it in the address',
    { tag: '@S-V61-HAPPY' },
    async ({ page, lang }) => {
        const manifest = versionedManifest();
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

        const sheetSwitch = versions(page, lang);
        await expect(sheetSwitch.getByRole('radio', { name: t(lang, 'photoVersion.improved') })).toHaveAttribute('aria-checked', 'true');
        await sheetSwitch.getByRole('radio', { name: t(lang, 'photoVersion.colorized') }).click();
        await expect.poll(() => currentHash(page)).toContain(`photo=${LONE}&pv=colorized`);
        await expect(page.getByText(t(lang, 'photoVersion.colorizedBy', { credit: 'Ana Pop' })).first()).toBeVisible();

        await page.reload();
        const view = await openFullView(page, lang);
        await expect(versions(view, lang).getByRole('radio', { name: t(lang, 'photoVersion.colorized') })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        const colorized = imageWeb(manifest, LONE, 'colorized').split('/').slice(-2).join('/');
        await expect.poll(async () => (await view.locator('img').getAttribute('src'))?.endsWith(colorized)).toBe(true);
    },
);

test(
    'A word the viewer does not know shows the original; a photo with only its original has no switch',
    { tag: '@S-V61-BAD-UNKNOWN-VERSION' },
    async ({ page, lang }) => {
        const manifest = versionedManifest();
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}&pv=sepia` });

        await expect(versions(page, lang).getByRole('radio', { name: t(lang, 'photoVersion.original') })).toHaveAttribute(
            'aria-checked',
            'true',
        );
        const other = (manifest['photos'] as FixturePhoto[]).find((photo) => photo.id !== LONE)?.id ?? '';
        await page.goto('about:blank');
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${other}` });

        await expect(versions(page, lang)).toHaveCount(0);
        const view = await openFullView(page, lang);
        await expect(versions(view, lang)).toHaveCount(0);
    },
);
