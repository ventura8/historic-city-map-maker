import { translate } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contrastRatio, type Rgba } from '../support/colour.js';
import { recordLiveRegions } from '../support/live-regions.js';
import { mapFraction } from '../support/map.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { adminMapReady } from '../admin/support/map.js';
import { seedCategory, seedCity, seedLayer, seedPhotoAt, seedPlace, text } from '../admin/specs/settings/world.js';

/**
 * The city settings (docs/research/M2c-interfaces.md §8.5; behaviours A19, A33, A36, A39): an admin narrows its city's
 * area (bounds of no width are refused at the field, bounds that would leave photos and a place off the map are refused
 * with each named and linked), refuses a non-https link in About, previews a seed colour and discards it, and edits the
 * POI categories: an icon outside the bundled set kept until another is chosen, a colour the white icon cannot be read
 * on replaced by the proposed tone, a category in use deleted only once its places have somewhere to go, and Add off at
 * the limit. Every screen and dialog on the way runs the generic layout and accessibility checkers (the settings section
 * of e2e/tour/states.ts).
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });
const AT = new Date('2026-10-17T09:00:00.000Z');

/** The bounds `seedCity` writes for this spec: wide, so that narrowing them leaves content out. */
const WIDE = { west: 25, south: 44, east: 27, north: 45 };

/** A field of the open section, by its label. */
function fieldOf(page: Page, lang: 'ro' | 'en', key: Parameters<typeof text>[1]): Locator {
    return page.getByLabel(text(lang, key), { exact: true });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true });
}

/** The seeded categories' names as the page shows them. */
const NAMES = { ro: { harbours: 'Porturi', buildings: 'Clădiri' }, en: { harbours: 'Harbours', buildings: 'Buildings' } } as const;

/** `#rrggbb` as RGBA. */
function rgbaOf(hex: string): Rgba {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 1];
}

test(
    "Narrower bounds are refused when they have no area or would leave the city's photos and places off the map",
    { tag: ['@S-A19-BAD-ZERO-AREA-BOUNDS', '@S-A19-BAD-BOUNDS-EXCLUDE-CONTENT', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT, { bounds: WIDE });
        await seedPhotoAt(content, 'snagov', AT, { lat: 44.7, lng: 25.2, title: 'Mănăstirea Snagov' });
        await seedPhotoAt(content, 'oltenita', AT, { lat: 44.09, lng: 26.95, title: 'Portul Oltenița' });
        await seedPhotoAt(content, 'centru', AT, { lat: 44.43, lng: 26.1, title: 'Calea Victoriei' });
        await seedCategory(content, 'cladiri', AT);
        await seedPlace(content, 'giurgiu', AT, { category: 'cladiri', lat: 44.43, lng: 26.9, title: 'Podul Prieteniei' });
        await seedPlace(content, 'ateneu', AT, { category: 'cladiri', lat: 44.44, lng: 26.1, title: 'Ateneul Român' });
        await page.goto(content.address(lang, 'settings'));

        // The sections, none open yet (beside "Choose a section" from 840 px; alone on a phone).
        const areaLink = page.getByRole('link', { name: new RegExp(text(lang, 'adminContent.settings.section.area')) });
        await expect(areaLink).toBeVisible();
        await expectStateSound(page, adminVisit('settings.sections', lang));

        await areaLink.click();
        await expect(page.getByRole('heading', { level: 2, name: text(lang, 'adminContent.settings.section.area') })).toBeVisible();
        await adminMapReady(page);
        await expectStateSound(page, adminVisit('settings.area', lang));

        // Draw the area: one corner clicked, the page says to click the opposite one; Stop drawing leaves the bounds.
        await page.getByRole('button', { name: text(lang, 'adminContent.settings.drawArea'), exact: true }).click();
        // The map sits above the section: on a short window the fields scrolled it away, so it comes back into view first.
        await page.locator('hcm-admin-map').scrollIntoViewIfNeeded();
        const corner = await mapFraction(page, 0.3, 0.3);
        await page.mouse.click(corner.x, corner.y);
        await expect(page.getByText(text(lang, 'adminContent.settings.drawSecond'))).toBeVisible();
        await expectStateSound(page, adminVisit('settings.area-drawing', lang));
        await page.getByRole('button', { name: text(lang, 'adminContent.settings.drawCancel'), exact: true }).click();
        await expect(fieldOf(page, lang, 'adminContent.settings.west')).toHaveValue(String(WIDE.west));

        // East on the west edge: no width; the problem is said at the bounds and Save stays off.
        await fieldOf(page, lang, 'adminContent.settings.east').fill('25');
        await expect(page.getByText(translate(lang, 'validation.bounds')).first()).toBeVisible();
        await expect(fieldOf(page, lang, 'adminContent.settings.east')).toHaveAttribute('aria-invalid', 'true');
        await expect(saveButton(page, lang)).toBeDisabled();
        await expectStateSound(page, adminVisit('settings.area-invalid', lang));

        // Bucharest alone: two photos and a place would be more than half a degree outside; the save is refused and names
        // each, a link to its editor; the photo and the place inside are not named.
        for (const [key, value] of [
            ['adminContent.settings.west', '25.9'],
            ['adminContent.settings.east', '26.3'],
            ['adminContent.settings.south', '44.3'],
            ['adminContent.settings.north', '44.6'],
        ] as const) {
            await fieldOf(page, lang, key).fill(value);
        }
        await saveButton(page, lang).click();
        const outside = page.getByRole('alert').filter({ hasText: text(lang, 'adminContent.settings.outside') });
        await expect(outside.getByRole('link')).toHaveCount(3);
        for (const [key, title, href] of [
            ['adminContent.settings.outsidePhoto', 'Mănăstirea Snagov', '#/photos/snagov'],
            ['adminContent.settings.outsidePhoto', 'Portul Oltenița', '#/photos/oltenita'],
            ['adminContent.settings.outsidePoi', 'Podul Prieteniei', '#/pois/giurgiu'],
        ] as const) {
            await expect(outside.getByRole('link', { name: text(lang, key, { title }) })).toHaveAttribute('href', href);
        }
        await expectStateSound(page, adminVisit('settings.area-refused', lang));
        expect((await content.document())?.['bounds']).toEqual(WIDE);
    },
);

test(
    'A non-https link in About is refused at the line, and a previewed seed colour is discarded',
    { tag: ['@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        await page.goto(content.address(lang, 'settings/texts'));

        // About with an http link on its second line and markup: the line is named, Save is off, the markup shows as text.
        const about = fieldOf(page, lang, 'adminContent.settings.aboutRo');
        await about.fill('Harta orașului de altădată.\n[Primăria](http://example.org) <b>azi</b>');
        await expect(page.getByText(text(lang, 'adminContent.settings.linkLines', { lines: '2' }))).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        const preview = page.getByRole('figure', {
            name: text(lang, 'adminContent.settings.preview', { field: text(lang, 'adminContent.settings.aboutRo') }),
        });
        await expect(preview).toContainText('<b>azi</b>');
        await expect(preview.locator('b')).toHaveCount(0);
        await expectStateSound(page, adminVisit('settings.texts-link-refused', lang));
        expect((await content.document())?.['about']).toBeUndefined();

        // The link made https: Save writes About.
        await about.fill('Harta orașului de altădată.\n[Primăria](https://example.org)');
        await saveButton(page, lang).click();
        // The page says it is saved before the spec leaves (the server has the write a moment before the page hears).
        await expect(page.getByText(text(lang, 'adminContent.settings.saved')).first()).toBeVisible();
        await expect
            .poll(async () => (await content.document())?.['about'])
            .toEqual({ ro: 'Harta orașului de altădată.\n[Primăria](https://example.org)' });

        // A preset seed recolours the page at once; Discard returns the city's colours and writes nothing.
        await page.goto(content.address(lang, 'settings/theme'));
        await expect(page.getByRole('heading', { level: 2, name: text(lang, 'adminContent.settings.section.theme') })).toBeVisible();
        const settings = page.locator('hcm-settings-page');
        const primary = (): Promise<string> =>
            settings.evaluate((element) => getComputedStyle(element).getPropertyValue('--md-sys-color-primary').trim());
        const before = await primary();
        await expectStateSound(page, adminVisit('settings.theme', lang));
        await page.getByRole('button', { name: text(lang, 'adminContent.settings.preset', { hex: '#006a6a' }) }).click();
        await expect(page.getByText(text(lang, 'adminContent.settings.themePreview'))).toBeVisible();
        await expect.poll(primary).not.toBe(before);
        await expectStateSound(page, adminVisit('settings.theme-preview', lang));
        await page.getByRole('button', { name: text(lang, 'adminContent.common.discard'), exact: true }).click();
        await expect.poll(primary).toBe(before);
        expect((await content.document())?.['theme']).toBeUndefined();
    },
);

test(
    'Categories: an unbundled icon is kept until another is chosen, an unreadable colour is replaced, one in use moves its places',
    {
        tag: [
            '@S-A39-BAD-UNBUNDLED-ICON',
            '@S-A39-BAD-LOW-CONTRAST-COLOUR',
            '@S-A33-BAD-CATEGORY-IN-USE',
            '@S-A31-HAPPY-EDITORS',
            '@S-A21-BAD-LEAK-CHECK',
        ],
    },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        await seedCategory(content, 'cladiri', AT);
        await seedCategory(content, 'porturi', AT, {
            label: { ro: 'Porturi', en: 'Harbours' },
            icon: 'sailing',
            color: '#00658f',
            order: 1,
        });
        for (const [id, title] of [
            ['ateneu', 'Ateneul Român'],
            ['palat', 'Palatul Telefoanelor'],
            ['cec', 'Palatul CEC'],
        ] as const) {
            await seedPlace(content, id, AT, { category: 'cladiri', lat: 44.44, lng: 26.1, title });
        }
        await page.goto(content.address(lang, 'settings/categories'));
        const { harbours, buildings } = NAMES[lang];
        await expect(page.getByRole('link', { name: new RegExp(harbours) })).toBeVisible();
        await expectStateSound(page, adminVisit('settings.categories', lang));

        // An icon the map does not bundle: the picker says it is drawn as the pin, and a save of another field keeps it.
        await page.getByRole('link', { name: new RegExp(harbours) }).click();
        const unbundled = page.getByText(text(lang, 'adminContent.settings.iconUnbundled', { icon: 'sailing' }));
        await expect(unbundled).toBeVisible();
        await expectStateSound(page, adminVisit('settings.category-editor', lang));
        await fieldOf(page, lang, 'adminContent.settings.categoryLabelEn').fill('Ports');
        await saveButton(page, lang).click();
        await expect.poll(async () => (await content.document(`poiCategories/porturi`))?.['label']).toEqual({ ro: 'Porturi', en: 'Ports' });
        expect((await content.document(`poiCategories/porturi`))?.['icon']).toBe('sailing');

        // Another icon chosen: the note goes.
        await page.getByRole('radio', { name: text(lang, 'adminContent.settings.icon.water'), exact: true }).click();
        await expect(unbundled).toHaveCount(0);

        // A yellow the white icon does not read on: a warning, Save off, the nearest readable tone proposed; using it saves
        // a colour the icon reads on (3:1).
        await fieldOf(page, lang, 'adminContent.settings.color').fill('#ffeb3b');
        const warning = page.getByRole('alert').filter({ hasText: text(lang, 'adminContent.settings.colorLowContrast') });
        await expect(warning).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        await expectStateSound(page, adminVisit('settings.category-low-contrast', lang));
        const proposal = warning.locator('hcm-button');
        const proposed = /#[0-9a-f]{6}/i.exec((await proposal.textContent()) ?? '')?.[0] ?? '';
        expect(proposed).toMatch(/^#[0-9a-f]{6}$/i);
        await proposal.click();
        await expect(warning).toHaveCount(0);
        await saveButton(page, lang).click();
        await expect(page.getByText(text(lang, 'adminContent.settings.saved')).first()).toBeVisible();
        await expect.poll(async () => (await content.document(`poiCategories/porturi`))?.['color']).toBe(proposed);
        expect((await content.document(`poiCategories/porturi`))?.['icon']).toBe('water');
        expect(contrastRatio(rgbaOf(proposed), [255, 255, 255, 1])).toBeGreaterThanOrEqual(3);
        // The editor itself says Saved before the address changes: the document reached the emulator first, and a new
        // address while the save was still settling asked "Discard your changes?" (a loaded machine, lesson 148).
        await expect(
            page.getByRole('status').filter({ hasText: new RegExp(`^${text(lang, 'adminContent.settings.state.saved')}$`) }),
        ).toBeVisible();

        // A category three places use: Delete asks where they go and stays off without a choice; with one, the places
        // move and the category goes.
        await page.goto(content.address(lang, 'settings/categories/cladiri'));
        const deleteName = text(lang, 'adminContent.settings.deleteCategory');
        await page.getByRole('button', { name: deleteName, exact: true }).click();
        await expect(
            page.getByRole('dialog', { name: text(lang, 'adminContent.settings.deleteCategoryConfirm', { name: buildings }) }),
        ).toBeVisible();
        // The dialog's body and actions are slotted content of its element (light DOM), not inside the native dialog.
        const dialog = page.locator('hcm-dialog', { has: page.locator('#delete-target') });
        await expect(dialog.getByText(text(lang, 'adminContent.settings.deleteCategoryInUse', { count: '3' }))).toBeVisible();
        const confirm = dialog.locator('hcm-button.confirm').getByRole('button');
        await expect(confirm).toBeDisabled();
        expect(await content.document(`poiCategories/cladiri`)).toBeDefined();
        await expectStateSound(page, adminVisit('settings.category-delete-move', lang));
        await dialog.getByLabel(text(lang, 'adminContent.settings.moveTo')).selectOption('porturi');
        await confirm.click();
        await expect.poll(async () => await content.document(`poiCategories/cladiri`)).toBeUndefined();
        const places = await content.collection(`pois`);
        expect(Object.values(places).map((place) => place['category'])).toEqual(['porturi', 'porturi', 'porturi']);
    },
);

test(
    'At fifty categories Add a category is off with the limit named',
    { tag: ['@S-A39-BAD-LIMIT', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await seedCity(content, AT);
        await seedLayer(content, 'corona-1968', AT);
        for (let index = 0; index < 50; index += 1) {
            const n = String(index + 1).padStart(2, '0');
            await seedCategory(content, `categoria-${n}`, AT, { label: { ro: `Categoria ${n}` }, order: index });
        }
        await page.goto(content.address(lang, 'settings/categories'));
        await expect(page.getByText(text(lang, 'adminContent.settings.categoryLimit', { max: '50' }))).toBeVisible();
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory') })).toHaveCount(0);
        await expectStateSound(page, adminVisit('settings.categories-limit', lang));

        // The default opacities of the photos, the layer and every category, in one list.
        await page.goto(content.address(lang, 'settings/overlays'));
        await expect(
            page.getByRole('slider', { name: text(lang, 'adminContent.settings.overlayOpacity', { name: 'Categoria 50' }) }),
        ).toBeVisible();
        await expectStateSound(page, adminVisit('settings.overlays', lang));
    },
);

/** The starters' names as the page shows them, in starter order. */
const STARTERS = { ro: ['Clădire', 'Stradă', 'Piață', 'Biserică', 'Monument'], en: ['Building', 'Street', 'Square', 'Church', 'Monument'] };

test(
    'Add the starter categories adds in one click only the starters the city lacks, clear of every id',
    { tag: ['@S-A39-HAPPY-ADD-MISSING-STARTERS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        // A layer already holds the id `cladire`: the starter Building takes another.
        await seedLayer(content, 'cladire', AT);
        await seedCategory(content, 'biserici', AT, { label: { ro: 'Biserică' }, icon: 'church', color: '#a23b2a' });
        await seedCategory(content, 'porturi', AT, { label: { ro: 'Porturi', en: 'Harbours' }, icon: 'location_on', order: 1 });
        await page.goto(content.address(lang, 'settings/categories'));
        const starters = page.getByRole('button', { name: text(lang, 'adminContent.settings.addStarters'), exact: true });
        await expect(starters).toBeEnabled();

        await starters.click();
        await expect(page.getByText(text(lang, 'adminContent.settings.startersAdded', { count: '4' })).first()).toBeVisible();
        const [building, street, square, , monument] = STARTERS[lang];
        for (const name of [building, street, square, monument]) {
            await expect(page.getByRole('link', { name: new RegExp(`^${String(name)}`) })).toBeVisible();
        }
        // Every starter is there now: the action is off, the reason beside it.
        await expect(starters).toBeDisabled();
        await expect(page.getByText(text(lang, 'adminContent.settings.startersPresent'))).toBeVisible();
        await expectStateSound(page, adminVisit('settings.categories-starters-added', lang));

        const categories = await content.collection('poiCategories');
        const orders = Object.fromEntries(Object.entries(categories).map(([id, category]) => [id, category['order']]));
        expect(orders).toEqual({ biserici: 0, porturi: 1, 'cladire-2': 2, strada: 3, piata: 4, monument: 5 });
        expect(categories['cladire-2']).toMatchObject({ label: { ro: 'Clădire', en: 'Building' }, icon: 'domain' });
        expect(await content.document('layers/cladire')).toBeDefined();
    },
);

test(
    'With every starter named, case and diacritics aside, Add the starter categories is off with the reason and writes nothing',
    { tag: ['@S-A39-BAD-STARTERS-PRESENT', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await seedCity(content, AT);
        const labels = [
            { ro: 'BISERICA' },
            { ro: 'Străzi', en: 'Street' },
            { ro: 'clădire' },
            { ro: 'Piata' },
            { ro: 'Monumente', en: 'MONUMENT' },
        ];
        for (const [index, label] of labels.entries()) {
            await seedCategory(content, `c${String(index)}`, AT, { label, order: index });
        }
        await page.goto(content.address(lang, 'settings/categories'));
        await expect(page.getByRole('link', { name: /^BISERICA/ })).toBeVisible();

        await expect(page.getByRole('button', { name: text(lang, 'adminContent.settings.addStarters'), exact: true })).toBeDisabled();
        await expect(page.getByText(text(lang, 'adminContent.settings.startersPresent'))).toBeVisible();
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.settings.addCategory'), exact: true })).toBeEnabled();
        await expectStateSound(page, adminVisit('settings.categories-starters-present', lang));
        expect(Object.keys(await content.collection('poiCategories')).toSorted((a, b) => a.localeCompare(b))).toEqual([
            'c0',
            'c1',
            'c2',
            'c3',
            'c4',
        ]);
    },
);
