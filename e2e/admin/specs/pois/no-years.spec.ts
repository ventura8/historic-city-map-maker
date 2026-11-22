import { writeFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { poisText, seedCategories, seedPlace } from './places.js';

/**
 * Places with no years (the owner's request of 2026-11-22; docs/research/M27-lost-streets.md → *Places without years*):
 * a GeoJSON file of railway lines without any year imports, a file that mixes updates (the id on the feature or among its
 * properties) with new features counts and writes both, an update clears the years the file leaves out, and the list's
 * No years filter shows the research backlog. A year that is not a year is still refused with its reason.
 */

const AT = new Date('2026-11-22T09:00:00.000Z');

const line = (from: number): Record<string, unknown> => ({
    type: 'LineString',
    coordinates: [
        [from, 44.43],
        [from + 0.004, 44.434],
    ],
});

function importDialog(page: Page): Locator {
    return page.locator('hcm-dialog.import-dialog');
}

async function openPlaces(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    // Seen on the 2026 plan: the fake year an import needed before places could have none.
    const railway = (id: string, title: string, from: number): Promise<void> =>
        content.emulators.setDocument(`cities/${content.city}/pois/${id}`, {
            category: 'monuments',
            geometry: { type: 'LineString', points: [{ lng: from, lat: 44.43 }, { lng: from + 0.004, lat: 44.434 }] },
            title: { ro: title },
            yearSeen: 2026,
            published: true,
            createdAt: AT,
            createdBy: content.uid,
            updatedBy: content.uid,
            updatedAt: AT,
        });
    await railway('cf-1', 'Linia Filaret', 26.09);
    await railway('cf-2', 'Linia Obor', 26.11);
    await seedPlace(content, { id: 'gara', title: 'Gara de Nord', at: [26.0726, 44.4467] }, AT);
    await page.goto(content.address(lang, 'pois', { map: false }));
    await expect(page.getByRole('link', { name: /Gara de Nord/ })).toBeVisible();
}

async function chooseFile(page: Page, path: string, features: readonly unknown[]): Promise<void> {
    await writeFile(path, JSON.stringify({ type: 'FeatureCollection', features }));
    await page.locator('hcm-poi-list input[type="file"]').setInputFiles(path);
}

test(
    'A file mixing updates and new lines without years imports both, and No years lists the research backlog',
    { tag: ['@S-A34-HAPPY-MIXED', '@S-A34-HAPPY-NO-YEARS', '@S-A32-HAPPY-NO-YEARS-FILTER'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(150_000);
        await openPlaces(page, content, lang);
        const properties = (title: string): Record<string, unknown> => ({ category: 'monuments', title: { ro: title } });

        await chooseFile(page, testInfo.outputPath('cale-ferata.geojson'), [
            { type: 'Feature', id: 'cf-1', geometry: line(26.09), properties: properties('Linia Filaret') },
            { type: 'Feature', geometry: line(26.11), properties: { id: 'cf-2', ...properties('Linia Obor') } },
            { type: 'Feature', geometry: line(26.13), properties: properties('Linia Cotroceni') },
        ]);
        const dialog = importDialog(page);
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.updated', { count: '2' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: '0' }))).toBeVisible();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true }).click();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.done', { written: '3' }))).toBeVisible();

        const places = await content.collection('pois');
        expect(Object.keys(places)).toHaveLength(4);
        expect(places['cf-1']).not.toHaveProperty('yearSeen');
        expect(places['cf-2']).not.toHaveProperty('yearSeen');
        await page.keyboard.press('Escape');

        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.filter.noYears'), exact: true }).click();
        const rows = page.locator('hcm-poi-list a.row');
        await expect(rows).toHaveCount(3);
        await expect(page.getByRole('link', { name: /Gara de Nord/ })).toHaveCount(0);
        await expect(rows.first()).toContainText(poisText(lang, 'adminContent.pois.yearMissing'));
    },
);

test(
    'A year that is not a year is refused, an unknown id makes a new place, and No years leaves the dated places out',
    { tag: ['@S-A34-BAD-NO-YEARS-TEXT', '@S-A34-BAD-MIXED-UNKNOWN-ID', '@S-A32-BAD-NO-YEARS-FILTER'] },
    async ({ page, lang, content }, testInfo) => {
        test.setTimeout(150_000);
        await openPlaces(page, content, lang);

        await chooseFile(page, testInfo.outputPath('an-gresit.geojson'), [
            { type: 'Feature', geometry: line(26.13), properties: { category: 'monuments', title: { ro: 'Linia Grant' }, yearStart: 'demult' } },
            { type: 'Feature', geometry: line(26.15), properties: { id: 'nu-exista', category: 'monuments', title: { ro: 'Linia nouă' } } },
        ]);
        const dialog = importDialog(page);
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(/Linia Grant/)).toBeVisible();
        // An id that names no place of the city is a new place, never an update.
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.updated', { count: '0' }))).toBeVisible();
        await page.keyboard.press('Escape');
        expect(Object.keys(await content.collection('pois'))).toHaveLength(3);

        // The two railways seen on the 2026 plan are dated: No years shows none of the seeded places.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.filter.noYears'), exact: true }).click();
        await expect(page.locator('hcm-poi-list a.row')).toHaveCount(0);
    },
);
