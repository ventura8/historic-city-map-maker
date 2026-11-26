import { readFile } from 'node:fs/promises';

import { STARTER_POI_CATEGORIES, translate } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../support/live-regions.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { menuDialog } from '../admin/support/menu.js';
import { chooseImport, feature, poisText, seedCategories, seedPlace, seedPoisCity } from '../admin/specs/pois/places.js';

/**
 * The places page (docs/research/M2c-interfaces.md §7; behaviours A32, A34) in a city of the admin's own (the content
 * world): first a map whose Mapbox step is not done yet (no admin token), so the page's map box says why and links to
 * the step, and every place is edited without a map: Add at centre (the city's view centre), the positions typed in the
 * list, a position removed, the texts, Save; then, with the map, the GeoJSON export, its import changing nothing, a file
 * that is not GeoJSON, and a file whose invalid features are listed with their reasons while the valid one imports. Every
 * screen and dialog on the way runs the generic layout and accessibility checkers (the pois section of
 * e2e/tour/states.ts). Drawing on the map: e2e/tour/admin-drawing.tour.ts and
 * e2e/admin/specs/pois/drawing.spec.ts.
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** A row of the places list (its link opens the place). */
function placeLink(page: Page, title: string) {
    return page.getByRole('link', { name: new RegExp(title) });
}

/** A coordinate field of the list of positions: `v<index>-lat` or `v<index>-lng`. */
function coordinate(page: Page, id: string) {
    return page.locator(`hcm-vertex-list #${id}`);
}

/** Types a coordinate and leaves the field (the list reads it on change). */
async function typeCoordinate(page: Page, id: string, value: string): Promise<void> {
    const field = coordinate(page, id);
    await field.fill(value);
    await field.press('Tab');
}

test(
    'Without the Mapbox token a place is still drawn from its positions, saved, and deleted after a question',
    { tag: ['@S-A32-BAD-NO-MAP-TOKEN', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedPoisCity(content, AT);
        await seedCategories(content, AT);
        await page.goto(content.address(lang, 'pois', { map: false }));

        // No place yet: the empty list says how to add one.
        await expect(page.getByText(poisText(lang, 'adminContent.pois.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('pois.empty', lang));

        // Add place asks which shape.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
        const line = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.linestring'), exact: true });
        await expect(line).toBeVisible();
        await expectStateSound(page, adminVisit('pois.add-shape', lang));

        // A new line: the map box says why there is no map and leads to the Mapbox step; the tools and the list still work.
        await line.click();
        await expect(page.getByRole('heading', { name: poisText(lang, 'adminContent.pois.newPlace') })).toBeVisible();
        await expect(page.getByText(poisText(lang, 'adminContent.map.noToken'))).toBeVisible();
        await expect(page.getByRole('link', { name: poisText(lang, 'adminContent.map.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/mapbox',
        );
        await expect(page.getByText(poisText(lang, 'adminContent.map.verticesEmpty'))).toBeVisible();
        await expectStateSound(page, adminVisit('pois.new-place', lang));

        // Add at centre puts the city's view centre; the first position is typed; two more added, the last one removed.
        const addAtCentre = page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') });
        await addAtCentre.click();
        await expect(coordinate(page, 'v0-lat')).toHaveValue('44.43');
        await typeCoordinate(page, 'v0-lat', '44.44');
        await addAtCentre.click();
        await addAtCentre.click();
        await expect(coordinate(page, 'v2-lng')).toHaveValue('26.1');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.removeVertex', { number: '3' }) }).click();
        await expect(coordinate(page, 'v2-lng')).toHaveCount(0);
        await typeCoordinate(page, 'v1-lng', '26.11');

        // The texts: the description's preview shows its emphasis as text, never as markup from the field.
        await page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') }).fill('Strada Lipscani');
        await page.locator('hcm-poi-editor #yearStart').fill('1890');
        const description = page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.descriptionRo') });
        await description.fill('**Strada** negustorilor');
        await description.press('Tab');
        const preview = page.getByRole('region', {
            name: poisText(lang, 'adminContent.pois.field.preview', { language: poisText(lang, 'adminContent.pois.language.ro') }),
        });
        await expect(preview.locator('strong')).toHaveText('Strada');

        // Save writes the line, published, in the first category.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect.poll(async () => Object.values(await content.collection('pois')).length).toBe(1);
        const [saved] = Object.values(await content.collection('pois'));
        expect(saved).toMatchObject({
            category: 'monuments',
            geometry: {
                type: 'LineString',
                points: [
                    { lat: 44.44, lng: 26.1 },
                    { lat: 44.43, lng: 26.11 },
                ],
            },
            title: { ro: 'Strada Lipscani' },
            description: { ro: '**Strada** negustorilor' },
            published: true,
        });
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        // The snackbar's message, not its live region; the pointer rests on it, which holds it open (its timer waits while
        // it is pointed at) for the checkers to see it whole (lesson 89).
        const savedNotice = poisText(lang, 'adminContent.pois.saved');
        const notice = page.getByText(savedNotice).and(page.locator(':not([aria-live])'));
        await expect(notice).toBeVisible();
        await notice.hover();
        await expectStateSound(page, adminVisit('pois.editor', lang, { announcements: [savedNotice] }));

        // History and Redraw as… wait in the editor's overflow menu (a dialog; DECISIONS-for-review.md §42e).
        const more = poisText(lang, 'adminContent.pois.actions');
        await page.locator('hcm-poi-editor').getByRole('button', { name: more, exact: true }).click();
        await expect(menuDialog(page, more).getByRole('button', { name: poisText(lang, 'adminContent.pois.history') })).toBeVisible();
        await expectStateSound(page, adminVisit('pois.more-actions', lang, { escape: { opener: more } }));

        // Delete asks first; the place leaves the list.
        const remove = poisText(lang, 'adminContent.pois.delete');
        await page.getByRole('button', { name: remove }).click();
        await expect(
            page.getByRole('dialog', { name: poisText(lang, 'adminContent.pois.deleteTitle', { title: 'Strada Lipscani' }) }),
        ).toBeVisible();
        await expectStateSound(page, adminVisit('pois.delete-confirm', lang, { escape: { opener: remove } }));
        await page.getByRole('button', { name: remove }).click();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.deleteConfirm'), exact: true }).click();
        await expect.poll(async () => Object.values(await content.collection('pois')).length).toBe(0);
        await expect(page.getByText(poisText(lang, 'adminContent.pois.deleted')).and(page.locator(':not([aria-live])'))).toBeVisible();
    },
);

test(
    'Exported places import unchanged, a file that is not GeoJSON is refused, and invalid features are listed and left out',
    {
        tag: [
            '@S-A34-HAPPY-ROUND-TRIP',
            '@S-A34-BAD-NOT-GEOJSON',
            '@S-A34-BAD-INVALID-FEATURES',
            '@S-A31-HAPPY-EDITORS',
            '@S-A21-BAD-LEAK-CHECK',
        ],
    },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedPoisCity(content, AT);
        await seedCategories(content, AT);
        await seedPlace(
            content,
            {
                id: 'stavropoleos',
                title: 'Biserica Stavropoleos',
                at: [26.0985, 44.4317],
                extra: { yearStart: 1890, links: [{ url: 'https://example.org/stavropoleos', label: 'Istoric' }] },
            },
            AT,
        );
        await seedPlace(content, { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302], extra: { category: 'markets' } }, AT);
        const seeded = await content.collection('pois');
        await page.goto(content.address(lang, 'pois'));
        await expect(placeLink(page, 'Hanul lui Manuc')).toBeVisible();
        await expectStateSound(page, adminVisit('pois.list', lang));

        // Export all: a GeoJSON file of both places, with their ids and fields.
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.export') }).click();
        const exported = await (await download).path();
        const collection = JSON.parse(await readFile(exported, 'utf8')) as {
            features: { id: string; properties: Record<string, unknown> }[];
        };
        expect(collection.features.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual(['manuc', 'stavropoleos']);

        // Importing it again changes nothing: both unchanged, no Import offered.
        await page.locator('hcm-poi-list input[type="file"]').setInputFiles(exported);
        // The dialog's texts are slotted content of its element (light DOM), not inside the native dialog of its shadow root.
        const dialog = page.locator('hcm-dialog.import-dialog');
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.unchanged', { count: '2' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '0' }))).toBeVisible();
        await expect(page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // A file that is not GeoJSON: one message, no preview, nothing written.
        await chooseImport(page, { name: 'notes.txt', mimeType: 'text/plain', text: 'Strada Lipscani, 1890' });
        await expect(page.getByText(poisText(lang, 'adminContent.pois.import.file.not-geojson'))).toBeVisible();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.import.dryRun'))).toHaveCount(0);
        await expectStateSound(page, adminVisit('pois.import-refused', lang, { escape: { opener: null } }));
        expect(await content.collection('pois')).toEqual(seeded);

        // Invalid features are listed with their reasons; the valid one is the only one written.
        const features = [
            feature({ type: 'Point', coordinates: [26.1046, 44.4335] }, { title: { ro: 'Biserica Colțea' }, category: 'monuments' }),
            feature({ type: 'MultiPolygon', coordinates: [] }, { title: { ro: 'Parcul Carol' } }),
            feature({ type: 'Point', coordinates: [26.104, 44.433, 80] }, { title: { ro: 'Turnul Colței' }, category: 'monuments' }),
            feature(
                {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [26.1, 44.42],
                            [26.11, 44.42],
                            [26.11, 44.43],
                            [26.1, 44.43],
                        ],
                    ],
                },
                { title: { ro: 'Piața Unirii' }, category: 'markets' },
            ),
            feature({ type: 'Point', coordinates: [28.6, 44.17] }, { title: { ro: 'Cazinoul din Constanța' }, category: 'monuments' }),
            feature({ type: 'Point', coordinates: [26.098, 44.436] }, { title: { ro: 'Teatrul Național' }, category: 'theatres' }),
        ];
        await chooseImport(page, {
            name: 'locuri.geojson',
            mimeType: 'application/geo+json',
            text: JSON.stringify({ type: 'FeatureCollection', features }),
        });
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: '5' }))).toBeVisible();
        for (const [number, title, reason] of [
            ['2', 'Parcul Carol', 'adminContent.pois.import.reason.unsupported-type'],
            ['3', 'Turnul Colței', 'adminContent.pois.import.reason.altitude'],
            ['4', 'Piața Unirii', 'adminContent.pois.import.reason.open-ring'],
            ['5', 'Cazinoul din Constanța', 'adminContent.pois.import.reason.outside'],
            ['6', 'Teatrul Național', 'adminContent.pois.import.reason.unknown-category'],
        ] as const) {
            await expect(
                dialog.getByText(poisText(lang, 'adminContent.pois.import.refusedItem', { number, title, reason: poisText(lang, reason) })),
            ).toBeVisible();
        }
        expect(await content.collection('pois')).toEqual(seeded);
        await expectStateSound(page, adminVisit('pois.import-preview', lang));
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true }).click();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.done', { written: '1' }))).toBeVisible();
        const after = await content.collection('pois');
        const added = Object.entries(after).filter(([id]) => !(id in seeded));
        expect(added).toHaveLength(1);
        expect(added[0]?.[1]).toMatchObject({
            category: 'monuments',
            geometry: { type: 'Point', point: { lat: 44.4335, lng: 26.1046 } },
            title: { ro: 'Biserica Colțea' },
        });
        expect({ manuc: after['manuc'], stavropoleos: after['stavropoleos'] }).toEqual(seeded);
    },
);

test(
    'A city without categories offers the starter categories in the place editor, and the new place then saves in the first',
    { tag: ['@S-A39-BAD-NO-CATEGORIES', '@S-A39-HAPPY-ADD-STARTER', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedPoisCity(content, AT);
        await page.goto(content.address(lang, 'pois', { map: false }));
        await expect(page.getByText(poisText(lang, 'adminContent.pois.empty'))).toBeVisible();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.point'), exact: true }).click();

        // Finding 35 of 2026-11-01: no empty select and no format text; the field says why, and offers the starter
        // categories or a category of the admin's own; Save's note names both fields it waits for, by what to do.
        const editor = page.locator('hcm-poi-editor');
        const category = editor.locator('select#category');
        const choose = poisText(lang, 'adminContent.common.issue.category');
        await expect(page.getByText(poisText(lang, 'adminContent.pois.noCategories'))).toBeVisible();
        await expect(category).toHaveCount(0);
        await expect(editor.locator('#category-error')).toHaveText(choose);
        await expect(editor.locator('#title-ro-error')).toHaveText(poisText(lang, 'adminContent.common.issue.titleRo'));
        await expect(editor.locator('#save-issue')).toContainText(inSentence(lang, choose));
        await expect(page.getByText(translate(lang, 'validation.format'))).toHaveCount(0);
        await expect(page.getByRole('link', { name: poisText(lang, 'adminContent.pois.addCategory') })).toHaveAttribute(
            'href',
            '#/settings/categories/_new',
        );
        await expectStateSound(page, adminVisit('pois.no-categories', lang));

        // One click writes the five starter categories; the new place takes the first, and saves in it.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.addStarters') }).click();
        await expect(category).toHaveValue('cladire');
        await expect(category.locator('option')).toHaveCount(STARTER_POI_CATEGORIES.length);
        await expect
            .poll(async () => Object.keys(await content.collection('poiCategories')).sort((a, b) => a.localeCompare(b)))
            .toEqual(['biserica', 'cladire', 'monument', 'piata', 'strada']);
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') }).click();
        await page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') }).fill('Casa Capșa');
        await page.locator('hcm-poi-editor #yearStart').fill('1890');
        await expect(editor.locator('#save-issue')).toHaveCount(0);
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect
            .poll(async () => Object.values(await content.collection('pois')))
            .toEqual([expect.objectContaining({ category: 'cladire', title: { ro: 'Casa Capșa' } })]);
    },
);

/** A text as part of a longer sentence: its first letter in lower case (Save's note lists its fields so). */
function inSentence(lang: 'ro' | 'en', text: string): string {
    return text.charAt(0).toLocaleLowerCase(lang) + text.slice(1);
}
