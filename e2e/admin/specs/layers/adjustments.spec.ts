import { LAYER_DELETE_GRACE_DAYS, translateAdminShell } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { E2E_USER_TILESET_COLOUR, E2E_XYZ_LAYER, type Rgb } from '../../../fixtures/world.js';
import { colourDistance, expectColourAt, mapFraction, probeArea, type ScreenPoint } from '../../../support/map.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { contentText } from '../../support/ops.js';
import { adminMapReady, rasterPaint } from '../../support/map.js';
import { seedLayer, text } from '../settings/world.js';

/**
 * A layer's look on the admin map (docs/research/M2c-interfaces.md §5.2, §8.2–§8.4; behaviours A35, A33, A15) in a city of
 * the admin's own: the layer `corona-1968` is a tileset of the city's Mapbox account, which the mock tile server paints
 * one solid blue, so a pixel probe at the admin map's centre reads what the admin previews. The image adjustments change
 * that probe live and nothing is written until Save; the viewer, served the manifest the save published, shows the same
 * probe; Reset and Discard bring the stored look back; the black level never passes the white one, even dragged. A
 * deleted layer waits seven days for its tileset's deletion and History brings it back meanwhile; a linked XYZ layer is
 * previewed on the map.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const LAYER = 'corona-1968';

/** Mapbox's `raster-saturation` at -1 turns a pixel into the average of its channels. */
function desaturated([red, green, blue]: Rgb): Rgb {
    const average = Math.round((red + green + blue) / 3);
    return [average, average, average];
}

function slider(page: Page, lang: 'ro' | 'en', name: 'brightnessMin' | 'brightnessMax' | 'contrast' | 'saturation'): Locator {
    return page.getByRole('slider', { name: text(lang, `adminContent.layers.adjust.${name}`), exact: true });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true });
}

async function openLayer(
    page: Page,
    content: ContentWorld,
    lang: 'ro' | 'en',
    extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
    await seedPublicCity(content, AT);
    // A published layer needs its attribution: the manifest build skips one without it.
    await seedLayer(content, LAYER, AT, { attribution: 'USGS EarthExplorer (e2e)', ...extra });
    await page.goto(content.address(lang, `layers/${LAYER}`));
    await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
    await adminMapReady(page);
}

/** The admin map's centre on the page, its box scrolled into view first (a slider below may have scrolled it away). */
async function centre(page: Page): Promise<ScreenPoint> {
    await page.locator('hcm-admin-map').scrollIntoViewIfNeeded();
    return mapFraction(page, 0.5, 0.5);
}

/** The colour at the admin map's centre (only the basemap and the layer draw there). */
async function mapCentre(page: Page): Promise<Rgb> {
    return probeArea(page, await centre(page));
}

test(
    'Image adjustments preview live on the admin map, are saved without their neutral values, and the viewer shows the same',
    { tag: ['@S-A35-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openLayer(page, content, lang);
        await expectColourAt(page, await centre(page), E2E_USER_TILESET_COLOUR, 'the layer as stored');

        // Saturation to its minimum, contrast up: the probe changes at once; nothing is written.
        const saturation = slider(page, lang, 'saturation');
        await saturation.focus();
        await saturation.press('Home');
        const contrast = slider(page, lang, 'contrast');
        await contrast.focus();
        await contrast.press('PageUp');
        await expect(contrast).toHaveAttribute('aria-valuetext', text(lang, 'adminContent.layers.adjustValue', { value: '+20' }));
        await expect
            .poll(async () => colourDistance(await mapCentre(page), desaturated(E2E_USER_TILESET_COLOUR)), { message: 'previewed grey' })
            .toBeGreaterThan(0);
        await expect.poll(async () => colourDistance(await mapCentre(page), E2E_USER_TILESET_COLOUR)).toBeGreaterThan(40);
        const previewed = await mapCentre(page);
        expect((await content.document(`layers/${LAYER}`))?.['adjustments']).toBeUndefined();

        // Save: only the moved adjustments are stored; the manifest carries them; the viewer shows the same colour.
        await saveButton(page, lang).click();
        await expect
            .poll(async () => (await content.document(`layers/${LAYER}`))?.['adjustments'])
            .toEqual({ saturation: -1, contrast: 0.2 });
        const manifest = await awaitManifest(content, 'carries the adjustments', (built) => {
            const layer = entry(built, 'layers', LAYER);
            return (layer?.['adjustments'] as { saturation?: number } | undefined)?.saturation === -1;
        });
        await openPublicViewer(page, manifest, { lang, hash: `13/44.43000/26.10000&layers=${LAYER}` });
        await expectColourAt(page, await mapFraction(page, 0.5, 0.5), previewed, 'the viewer shows what the admin previewed', {
            tolerance: 8,
        });
    },
);

test(
    'Reset returns every adjustment to neutral live, and Save removes them from the layer',
    { tag: ['@S-A35-HAPPY-RESET'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openLayer(page, content, lang, { adjustments: { saturation: -1, contrast: 0.4, brightnessMin: 0.1, brightnessMax: 0.9 } });
        await expect.poll(async () => colourDistance(await mapCentre(page), E2E_USER_TILESET_COLOUR)).toBeGreaterThan(40);

        await page.getByRole('button', { name: text(lang, 'adminContent.layers.reset') }).click();

        for (const name of ['saturation', 'contrast', 'brightnessMin'] as const) {
            await expect(slider(page, lang, name)).toHaveAttribute('aria-valuenow', '0');
        }
        await expect(slider(page, lang, 'brightnessMax')).toHaveAttribute('aria-valuenow', '100');
        await expectColourAt(page, await centre(page), E2E_USER_TILESET_COLOUR, 'the raw tile again, live');
        expect((await content.document(`layers/${LAYER}`))?.['adjustments']).toEqual({
            saturation: -1,
            contrast: 0.4,
            brightnessMin: 0.1,
            brightnessMax: 0.9,
        });
        await saveButton(page, lang).click();
        await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['adjustments']).toBeUndefined();
    },
);

test(
    'The black level dragged past the white one stops at it, the image is never inverted, and the levels are saved uncrossed',
    { tag: ['@S-A35-BAD-CROSSED-BRIGHTNESS'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openLayer(page, content, lang);
        const white = slider(page, lang, 'brightnessMax');
        await white.focus();
        for (let step = 0; step < 5; step += 1) {
            await white.press('PageDown');
        }
        await expect(white).toHaveAttribute('aria-valuenow', '50');

        // A drag of the black level's track from its start to its end: it stops at the white level, live.
        const track = page
            .locator('hcm-slider')
            .filter({ has: slider(page, lang, 'brightnessMin') })
            .locator('.track');
        await track.scrollIntoViewIfNeeded();
        const box = await track.boundingBox();
        expect(box).not.toBeNull();
        const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
        await page.mouse.move(x + 2, y + height / 2);
        await page.mouse.down();
        await page.mouse.move(x + width - 2, y + height / 2, { steps: 8 });
        await page.mouse.up();
        await expect(slider(page, lang, 'brightnessMin')).toHaveAttribute('aria-valuenow', '50');
        await expect
            .poll(async () => {
                const min = Number(await rasterPaint(page, LAYER, 'raster-brightness-min'));
                const max = Number(await rasterPaint(page, LAYER, 'raster-brightness-max'));
                return min <= max;
            })
            .toBe(true);

        await saveButton(page, lang).click();
        await expect
            .poll(async () => (await content.document(`layers/${LAYER}`))?.['adjustments'])
            .toEqual({ brightnessMin: 0.5, brightnessMax: 0.5 });
    },
);

test(
    'Adjustments left without saving go: Discard, or another page, shows the stored look and writes nothing',
    { tag: ['@S-A35-BAD-DISCARD'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        // The navigation rail, which "another page" uses: a large window (on a phone the editor is full screen, without
        // the bar).
        await page.setViewportSize({ width: 1440, height: 900 });
        await openLayer(page, content, lang);
        const saturation = slider(page, lang, 'saturation');

        // Discard.
        await saturation.focus();
        await saturation.press('Home');
        await expect.poll(async () => colourDistance(await mapCentre(page), E2E_USER_TILESET_COLOUR)).toBeGreaterThan(40);
        await page.getByRole('button', { name: text(lang, 'adminContent.common.discard'), exact: true }).click();
        await expectColourAt(page, await centre(page), E2E_USER_TILESET_COLOUR, 'the stored look after Discard');
        await expect(saturation).toHaveAttribute('aria-valuenow', '0');

        // Another page: the unsaved guard asks; Discard there leaves; back on the layer, its stored look.
        await saturation.focus();
        await saturation.press('Home');
        await page
            .getByRole('navigation')
            .getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.history'), exact: true })
            .click();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: contentText(lang, 'adminContent.common.discard'), exact: true })
            .click();
        await page.goto(content.address(lang, `layers/${LAYER}`));
        await adminMapReady(page);
        await expectColourAt(page, await centre(page), E2E_USER_TILESET_COLOUR, 'the stored look on coming back');
        expect((await content.document(`layers/${LAYER}`))?.['adjustments']).toBeUndefined();
    },
);

test(
    "Deleting a layer queues its tileset's deletion for seven days later, and restoring it from History cancels that",
    { tag: ['@S-A33-HAPPY-LAYER'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await openLayer(page, content, lang);

        // Delete, confirmed: the layer goes at once; a layer-delete job waits for its date, shown on Jobs.
        await page.getByRole('button', { name: text(lang, 'adminContent.layers.delete'), exact: true }).click();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: text(lang, 'adminContent.layers.delete'), exact: true })
            .click();
        await expect.poll(() => content.document(`layers/${LAYER}`)).toBeUndefined();
        await expect
            .poll(async () => Object.values(await content.collection('jobs')).map((job) => [job['type'], job['status']]))
            .toEqual([['layer-delete', 'queued']]);
        const [jobId = '', job] = Object.entries(await content.collection('jobs'))[0] ?? [];
        const waits = new Date(String(job?.['dispatchAt'])).getTime() - new Date(String(job?.['createdAt'])).getTime();
        expect(Math.round(waits / 86_400_000)).toBe(LAYER_DELETE_GRACE_DAYS);
        await page.goto(content.address(lang, `jobs/${jobId}`, { map: false }));
        await expect(page.getByText(new RegExp(contentText(lang, 'adminContent.jobs.waiting', { date: '.+' })))).toBeVisible();

        // History, Deleted: Restore brings the layer back and cancels its deletion.
        await page.goto(content.address(lang, 'history', { map: false }));
        await page.getByLabel(contentText(lang, 'adminContent.history.actionLabel'), { exact: true }).selectOption('delete');
        await page
            .getByRole('listitem')
            .filter({ hasText: 'Corona 1968' })
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') })
            .click();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') })
            .click();
        await expect.poll(() => content.document(`layers/${LAYER}`)).toBeDefined();
        await expect.poll(async () => (await content.document(`jobs/${jobId}`))?.['status']).toBe('cancelled');
    },
);

test('A linked XYZ layer is previewed on the admin map and saved', { tag: ['@S-A15-HAPPY'] }, async ({ page, lang, content }) => {
    test.setTimeout(150_000);
    await seedPublicCity(content, AT);
    await page.goto(content.address(lang, 'layers'));
    await page.getByRole('button', { name: text(lang, 'adminContent.layers.link'), exact: true }).click();
    const dialog = page.locator('hcm-dialog', { has: page.locator('#link-address') });
    await dialog.getByLabel(text(lang, 'adminContent.layers.address'), { exact: true }).fill(E2E_XYZ_LAYER.tiles);
    await dialog.getByLabel(text(lang, 'adminContent.layers.labelRo'), { exact: true }).fill('Fotografie aeriană 1980');
    await dialog.getByLabel(text(lang, 'adminContent.layers.year'), { exact: true }).fill('1980');
    await dialog.getByRole('button', { name: text(lang, 'adminContent.layers.linkAction'), exact: true }).click();

    // layers.link created it, unpublished; its editor previews its tiles on the map.
    await expect.poll(async () => Object.values(await content.collection('layers')).map((layer) => layer['published'])).toEqual([false]);
    const [id = ''] = Object.keys(await content.collection('layers'));
    await page.goto(content.address(lang, `layers/${id}`));
    await expect(page.getByRole('heading', { level: 2, name: 'Fotografie aeriană 1980' })).toBeVisible();
    await adminMapReady(page);
    await expectColourAt(page, await centre(page), E2E_XYZ_LAYER.colour, 'the linked tiles on the admin map');

    // Published on, Save.
    await page.getByRole('switch', { name: text(lang, 'adminContent.layers.publishedSwitch') }).click();
    await saveButton(page, lang).click();
    await expect.poll(async () => (await content.document(`layers/${id}`))?.['published']).toBe(true);
});
