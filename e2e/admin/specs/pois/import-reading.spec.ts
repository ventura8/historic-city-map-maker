import { readFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { chooseImport, feature, poisText, seedCategories } from './places.js';

/**
 * What Export all and an import's plan do with the city's whole read (docs/research/M2c-interfaces.md §7.3, §7.4; behaviour
 * A34): a place whose document fails its schema is said to be left out of the file and is never made a second place by a file
 * that names it, and a file chosen while another one's read still waits gets its own plan.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
/** Firestore's listen channel of the emulator (WebChannel), and what cutting it logs (e2e/admin/specs/ops/stream.spec.ts). */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;
const CUT = /ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|Listen\/channel|cleardot\.gif/;
/** How long a read waits for the server (`READ_WAIT_MS`). */
const READ_WAIT_MS = 30_000;

const point = (lng: number, lat: number): Record<string, unknown> => ({ type: 'Point', coordinates: [lng, lat] });

async function openPlaces(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    await page.goto(content.address(lang, 'pois', { map: false }));
}

function importDialog(page: Page): Locator {
    return page.locator('hcm-dialog.import-dialog');
}

function geojson(name: string, features: readonly Record<string, unknown>[]): { name: string; mimeType: string; text: string } {
    return { name, mimeType: 'application/geo+json', text: JSON.stringify({ type: 'FeatureCollection', features }) };
}

test(
    'A place that cannot be read is said to be left out of Export all, and a file naming it does not make it twice',
    { tag: '@S-A34-BAD-UNREADABLE-PLACE' },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await content.setDocument('pois/stricat', { title: 42, updatedBy: 'u-other', updatedAt: AT });
        await openPlaces(page, content, lang);
        await page.locator('hcm-poi-list input[type="file"]').waitFor({ state: 'attached' });

        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.export') }).click();
        const saved = await (await download).path();
        const exported = JSON.parse(await readFile(saved, 'utf8')) as { features: { id: string }[] };
        expect(exported.features.map((item) => item.id)).not.toContain('stricat');
        await expect(page.getByText(poisText(lang, 'adminContent.pois.exportPartial', { count: '1' }))).toBeVisible();

        const named = { ...feature(point(26.1, 44.43), { title: { ro: 'Loc stricat' }, category: 'monuments' }), id: 'stricat' };
        await chooseImport(page, geojson('stricat.geojson', [named]));
        const dialog = importDialog(page);
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '0' }))).toBeVisible();
    },
);

test(
    "A file chosen while another one's read still waits keeps its own plan",
    { tag: '@S-A34-BAD-FILE-CHANGED-WHILE-READING' },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        await openPlaces(page, content, lang);
        await page.locator('hcm-poi-list input[type="file"]').waitFor({ state: 'attached' });

        // The first file's read of the city waits for a server it cannot reach; the dialog is closed meanwhile.
        await page.route(LISTEN, (route) => route.abort('connectionreset'));
        await page.context().setOffline(true);
        await chooseImport(page, geojson('a.geojson', [feature(point(26.1, 44.43), { title: { ro: 'Primul' }, category: 'monuments' })]));
        const dialog = importDialog(page);
        // The dialog's action, not its corner's × of the same name.
        const close = dialog.getByRole('button', { name: poisText(lang, 'adminContent.common.close'), exact: true }).last();
        await expect(close).toBeVisible();
        await close.click();

        // Back online, a second file gets its plan.
        await page.context().setOffline(false);
        await page.unroute(LISTEN);
        const two = ['Al doilea', 'Al treilea'].map((ro) => feature(point(26.1, 44.43), { title: { ro }, category: 'monuments' }));
        await chooseImport(page, geojson('b.geojson', two));
        const created = dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '2' }));
        await expect(created).toBeVisible();

        // The first file's read gives up now: its refusal must not replace the second file's plan.
        await page.clock.fastForward(READ_WAIT_MS);
        await expect(created).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.file.places-unread'))).toHaveCount(0);
        consoleErrors.takeMatching(CUT);
    },
);
