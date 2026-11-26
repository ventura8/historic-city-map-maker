import { translateAdminShell } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { BASEMAP_BACKGROUND, E2E_USER_TILESET_COLOUR } from '../../../fixtures/world.js';
import { blend, expectColourAt, mapFraction } from '../../../support/map.js';
import { chooseMenuItem, openLayers, opacitySlider, t, viewer } from '../../../support/viewer.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { awaitManifest, entries, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { templatePattern } from '../../support/i18n.js';
import { seedCategory, seedLayer, seedPlace, text } from './world.js';

/**
 * The city settings that reach the public viewer (docs/research/M2c-interfaces.md §8.5; behaviours A19, A36, A39) in a city
 * of the admin's own: About refuses a non-https link and keeps markup as text up to the viewer; a previewed theme goes
 * when it is discarded or left; a visitor's own opacity in the link wins over a new default; a new category with its icon,
 * colour and default opacity reaches the viewer's Layers panel, categories reorder there, and a category named like the
 * photos or a layer gets an id of its own. Each save is read back from the manifest the Functions emulator built.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

function fieldOf(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1]): Locator {
    return page.getByLabel(text(lang, key), { exact: true });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true });
}

/** The city as Setup leaves it, its Mapbox account `e2e-user` (whose tilesets the mock paints blue). */
async function publicCity(content: ContentWorld): Promise<void> {
    await seedPublicCity(content, AT);
}

test(
    'A non-https link in About is refused at its line, and markup typed into About stays text up to the viewer',
    { tag: ['@S-A19-BAD-MARKDOWN-LINK'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await publicCity(content);
        await page.goto(content.address(lang, 'settings/texts', { map: false }));
        const about = fieldOf(page, lang, 'adminContent.settings.aboutRo');
        await about.fill('Harta orașului de altădată.\n[Primăria](http://example.org) <b>azi</b>');
        await expect(page.getByText(text(lang, 'adminContent.settings.linkLines', { lines: '2' }))).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        const preview = page.getByRole('figure', {
            name: text(lang, 'adminContent.settings.preview', { field: text(lang, 'adminContent.settings.aboutRo') }),
        });
        await expect(preview).toContainText('<b>azi</b>');
        await expect(preview.locator('b')).toHaveCount(0);

        // The link made https, the markup kept: Save; the viewer's About shows the characters, never markup.
        const written = 'Harta orașului de altădată. <b>azi</b> <img src=x>';
        await about.fill(written);
        await saveButton(page, lang).click();
        await expect.poll(async () => ((await content.document())?.['about'] as { ro?: string } | undefined)?.ro).toBe(written);
        const manifest = await awaitManifest(content, 'carries the new About', (built) =>
            JSON.stringify(built['city']).includes('<b>azi</b>'),
        );
        await openPublicViewer(page, manifest, { lang: 'ro', hash: '13/44.43000/26.10000' });
        await chooseMenuItem(page, 'ro', t('ro', 'about.title'));
        const dialog = viewer(page).locator('hcm-about-dialog');
        await expect(dialog.getByText(written)).toBeVisible();
        await expect(dialog.locator('b, img[src="x"]')).toHaveCount(0);
    },
);

test(
    "A previewed theme goes back to the city's colours when it is discarded or the page is left, and nothing is written",
    { tag: ['@S-A19-BAD-THEME-DISCARDED'] },
    async ({ page, lang, content }) => {
        // The navigation rail, which "the page is left" uses: a large window (on a phone the section is full screen,
        // without the bar).
        await page.setViewportSize({ width: 1440, height: 900 });
        await publicCity(content);
        await page.goto(content.address(lang, 'settings/theme', { map: false }));
        await expect(page.getByRole('heading', { level: 2, name: text(lang, 'adminContent.settings.section.theme') })).toBeVisible();
        // The shell's colours: what the whole admin wears.
        const shell = page.locator('hcm-admin-shell');
        const primary = (): Promise<string> =>
            shell.evaluate((element) => getComputedStyle(element).getPropertyValue('--md-sys-color-primary').trim());
        const before = await primary();
        const preset = page.getByRole('button', { name: text(lang, 'adminContent.settings.preset', { hex: '#006a6a' }) });

        // Discard.
        await preset.click();
        await expect.poll(primary).not.toBe(before);
        await page.getByRole('button', { name: text(lang, 'adminContent.common.discard'), exact: true }).click();
        await expect.poll(primary).toBe(before);

        // Another page: the unsaved guard asks; Discard there leaves, and the city's colours come back.
        await preset.click();
        await expect.poll(primary).not.toBe(before);
        await page
            .getByRole('navigation')
            .getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.photos') })
            .click();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: text(lang, 'adminContent.common.discard'), exact: true })
            .click();
        await expect(page).toHaveURL(/#\/photos$/);
        await expect.poll(primary).toBe(before);
        expect((await content.document())?.['theme']).toEqual(expect.objectContaining({}));
        expect(JSON.stringify((await content.document())?.['theme'])).not.toContain('006a6a');
    },
);

test(
    "A visitor's own opacity in the link still wins over a layer's new default",
    { tag: ['@S-A36-BAD-LINK-STILL-WINS'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await publicCity(content);
        await seedLayer(content, 'corona-1968', AT, { attribution: 'USGS EarthExplorer (e2e)' });
        await page.goto(content.address(lang, 'settings/overlays', { map: false }));
        const layer = page.getByRole('slider', { name: text(lang, 'adminContent.settings.overlayOpacity', { name: 'Corona 1968' }) });
        await layer.focus();
        await layer.press('Home');
        for (let step = 0; step < 4; step += 1) {
            await layer.press('PageUp');
        }
        await expect(layer).toHaveAttribute('aria-valuenow', '40');
        await saveButton(page, lang).click();
        await expect.poll(async () => (await content.document('layers/corona-1968'))?.['opacity']).toBe(0.4);

        // The default is 40 %; the visitor's link asks 90 %: the layer shows at 90 %.
        const manifest = await awaitManifest(
            content,
            'carries the new default',
            (built) => Math.abs(Number(entry(built, 'layers', 'corona-1968')?.['opacity']) - 0.4) < 1e-9,
        );
        await openPublicViewer(page, manifest, { lang, hash: '15/44.43000/26.10000&layers=corona-1968&op=corona-1968:90' });
        await expectColourAt(
            page,
            await mapFraction(page, 0.5, 0.5),
            blend(E2E_USER_TILESET_COLOUR, BASEMAP_BACKGROUND, 0.9),
            'the layer at 90 %',
            {
                tolerance: 10,
            },
        );
        await openLayers(page, lang);
        await expect(opacitySlider(page, lang, 'Corona 1968')).toHaveAttribute('aria-valuenow', '90');
    },
);

/** Adds a category from the list: Add, the Romanian label (the icon follows it), Save (the colour and opacity keep their defaults). */
async function addCategory(page: Page, lang: 'ro' | 'en', label: string): Promise<void> {
    await page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory') }).click();
    await fieldOf(page, lang, 'adminContent.settings.categoryLabelRo').fill(label);
    await saveButton(page, lang).click();
    // The page says it is saved before the spec goes on (the server has the write a moment before the page hears).
    await expect(page.getByText(text(lang, 'adminContent.settings.saved')).first()).toBeVisible();
}

test(
    'A new category with its icon, colour and default opacity is offered to places and reaches the viewer at 80 %',
    { tag: ['@S-A39-HAPPY', '@S-A30-HAPPY-CONTENT'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(180_000);
        await publicCity(content);
        await page.goto(content.address(lang, 'settings/categories', { map: false }));

        // Add category, the label in both languages (its icon follows it: no click in the picker), a colour, 80 %; Save.
        const flow = inputBudget.flow('category', contentFlowBudget('category'));
        await flow.click(page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory') }));
        await flow.fill(fieldOf(page, lang, 'adminContent.settings.categoryLabelRo'), 'Fântâni');
        await expect(page.getByRole('radio', { name: text(lang, 'adminContent.settings.icon.water'), exact: true })).toBeChecked();
        await fieldOf(page, lang, 'adminContent.settings.categoryLabelEn').fill('Fountains');
        await fieldOf(page, lang, 'adminContent.settings.color').fill('#1565c0');
        const opacity = page.getByRole('slider', { name: text(lang, 'adminContent.settings.defaultOpacity') });
        await opacity.focus();
        await opacity.press('PageDown');
        await opacity.press('PageDown');
        await expect(opacity).toHaveAttribute('aria-valuenow', '80');
        await flow.click(saveButton(page, lang));
        await expect.poll(async () => Object.keys(await content.collection('poiCategories'))).toEqual(['fantani']);
        expect(await content.document('poiCategories/fantani')).toMatchObject({
            label: { ro: 'Fântâni', en: 'Fountains' },
            icon: 'water',
            color: '#1565c0',
            defaultOpacity: 0.8,
        });

        // The place editor offers it; a place in it is published.
        await page.goto(content.address(lang, 'pois', { map: false }));
        await page.getByRole('button', { name: text(lang, 'adminContent.pois.add') }).click();
        await page.getByRole('button', { name: text(lang, 'adminContent.pois.shape.point'), exact: true }).click();
        await page.locator('hcm-poi-editor #category').selectOption('fantani');
        await page.getByRole('button', { name: text(lang, 'adminContent.map.tool.addCentre') }).click();
        await page.getByRole('textbox', { name: text(lang, 'adminContent.pois.field.titleRo') }).fill('Fântâna Zodiac');
        await page.locator('hcm-poi-editor #yearStart').fill('1890');
        await saveButton(page, lang).click();
        await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(1);

        // The manifest lists it; the viewer's Layers panel shows its swatch and its slider at 80 %.
        const manifest = await awaitManifest(content, 'lists the category and its place', (built) => entries(built, 'pois').length === 1);
        expect(entries(manifest, 'poiCategories' as 'pois')).toEqual([expect.objectContaining({ id: 'fantani', defaultOpacity: 0.8 })]);
        await openPublicViewer(page, manifest, { lang, hash: '15/44.43000/26.10000' });
        await openLayers(page, lang);
        await expect(opacitySlider(page, lang, lang === 'ro' ? 'Fântâni' : 'Fountains')).toHaveAttribute('aria-valuenow', '80');
    },
);

test(
    'A label with no word the icons know keeps the pin, and an icon picked by hand stays when the label changes',
    { tag: ['@S-A39-BAD-ICON-NOT-GUESSED'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await publicCity(content);
        await page.goto(content.address(lang, 'settings/categories', { map: false }));
        const icon = (name: 'location_on' | 'museum' | 'water') =>
            page.getByRole('radio', { name: text(lang, `adminContent.settings.icon.${name}`), exact: true });

        await page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory') }).click();
        const label = fieldOf(page, lang, 'adminContent.settings.categoryLabelRo');
        await label.fill('Corona 1968');
        await expect(icon('location_on')).toBeChecked();
        await icon('museum').click();
        await label.fill('Fântâni');
        await expect(icon('museum')).toBeChecked();
        await expect(icon('water')).not.toBeChecked();
        await saveButton(page, lang).click();
        await expect
            .poll(async () => Object.values(await content.collection('poiCategories')).map((doc) => doc['icon']))
            .toEqual(['museum']);
    },
);

test(
    "Moving categories up and down writes their order, and the viewer's places follow it",
    { tag: ['@S-A39-HAPPY-REORDER'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await publicCity(content);
        const names = [
            ['biserici', 'Biserici', 'Churches'],
            ['piete', 'Piețe', 'Markets'],
            ['teatre', 'Teatre', 'Theatres'],
        ] as const;
        for (const [index, [id, ro, en]] of names.entries()) {
            await seedCategory(content, id, AT, { label: { ro, en }, order: index });
            await seedPlace(content, `loc-${id}`, AT, { category: id, lat: 44.43 + index * 0.001, lng: 26.1, title: ro });
        }
        await page.goto(content.address(lang, 'settings/categories', { map: false }));

        // Theatres up twice: first. A move made while the last one is still being written does nothing (the buttons stay
        // enabled, reorder.ts), so the second waits until the list shows the first, as a person sees it moved.
        const theatres = ({ ro: 'Teatre', en: 'Theatres' } as const)[lang];
        const up = page.getByRole('button', { name: text(lang, 'adminContent.settings.categoryUp', { name: theatres }) });
        const ups = page.getByRole('button', { name: templatePattern(text(lang, 'adminContent.settings.categoryUp', { name: '\u0000' })) });
        const stored = async (): Promise<string[]> =>
            Object.entries(await content.collection('poiCategories'))
                .sort(([, a], [, b]) => Number(a['order']) - Number(b['order']))
                .map(([id]) => id);
        await up.click();
        await expect.poll(stored).toEqual(['biserici', 'teatre', 'piete']);
        await expect(ups.nth(1)).toHaveAccessibleName(text(lang, 'adminContent.settings.categoryUp', { name: theatres }));
        await up.click();
        await expect.poll(stored).toEqual(['teatre', 'biserici', 'piete']);

        const manifest = await awaitManifest(content, 'lists the categories in the new order', (built) => {
            const categories = (built['poiCategories'] as { id: string }[] | undefined) ?? [];
            return categories.map((category) => category.id).join() === 'teatre,biserici,piete';
        });
        await openPublicViewer(page, manifest, { lang, hash: '15/44.43000/26.10000' });
        await openLayers(page, lang);
        const order = names.map(([, ro, en]) => (lang === 'ro' ? ro : en));
        const sliders = await Promise.all(order.map(async (name) => (await opacitySlider(page, lang, name).boundingBox())?.y ?? 0));
        expect(sliders[2]).toBeLessThan(sliders[0] ?? 0);
        expect(sliders[0]).toBeLessThan(sliders[1] ?? 0);
    },
);

test(
    'A category named like the photos or like a layer gets an id of its own, and the manifest reports no duplicate',
    { tag: ['@S-A39-BAD-ID-CLASH'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await publicCity(content);
        await seedLayer(content, 'corona-1968', AT, { attribution: 'USGS EarthExplorer (e2e)' });
        await page.goto(content.address(lang, 'settings/categories', { map: false }));

        await addCategory(page, lang, 'Photos');
        await expect.poll(async () => Object.keys(await content.collection('poiCategories')).length).toBe(1);
        await page.goto(content.address(lang, 'settings/categories', { map: false }));
        await addCategory(page, lang, 'Corona 1968');
        await expect.poll(async () => Object.keys(await content.collection('poiCategories')).length).toBe(2);

        const ids = Object.keys(await content.collection('poiCategories')).sort((a, b) => a.localeCompare(b));
        expect(ids).not.toContain('photos');
        expect(ids).not.toContain('corona-1968');
        expect(ids.every((id) => /^(photos|corona-1968)-\w+$/.test(id))).toBe(true);
        for (const [index, id] of ids.entries()) {
            await seedPlace(content, `loc-${String(index)}`, AT, { category: id, lat: 44.43, lng: 26.1 + index * 0.001, title: id });
        }
        const manifest = await awaitManifest(content, 'lists both categories', (built) => entries(built, 'pois').length === 2);
        expect(JSON.stringify(await content.emulators.document(`manifests/${content.city}`))).not.toContain('duplicateId');
        await openPublicViewer(page, manifest, { lang, hash: '15/44.43000/26.10000' });
        await openLayers(page, lang);
        // In English the photos' own slider has the same name as the category's (DECISIONS-for-review.md §37i).
        await expect(opacitySlider(page, lang, 'Photos').first()).toBeVisible();
        await expect(opacitySlider(page, lang, 'Corona 1968').first()).toBeVisible();
    },
);

// M18 item 6 (docs/research/M18-improvements.md): the public map's Places are the place categories; the Layers page says so.
test(
    'The Layers page points to the place categories, which are the Places of the public map',
    { tag: ['@S-A39-HAPPY-FROM-LAYERS'] },
    async ({ page, lang, content }) => {
        await page.goto(content.address(lang, 'layers', { map: false }));
        const pointer = page.getByRole('link', { name: text(lang, 'adminContent.layers.placesLink'), exact: true });
        await expect(pointer).toHaveAttribute('href', '#/settings/categories');
        await expect(page.getByText(text(lang, 'adminContent.layers.placesNote'))).toBeVisible();

        await pointer.click();
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory') })).toBeVisible();
    },
);
