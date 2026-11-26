import type { Locator, Page } from '@playwright/test';

import { E2E_XYZ_LAYER } from '../../../fixtures/world.js';
import type { ContentWorld } from '../../support/content.js';
import { expect, test } from '../../support/content-test.js';
import { awaitManifest, entry, flowText, seedPublicCity } from '../../support/flows.js';

/**
 * A layer's rights corrected after the import (behaviour A197; the owner, 2026-11-22): a drawn map imported as `permission`
 * gets its true licence and author in the layer editor; the attribution's licence part follows, and the manifest the publish
 * trigger builds carries the corrected credit line. An author over 200 characters is marked at its field and Save stays off, nothing written.
 */

const AT = new Date('2026-11-22T09:00:00.000Z');
const PATH = `layers/${E2E_XYZ_LAYER.id}`;
const CREDIT = 'Ion Ionescu, Planul Bucureștiului, 1911 · permission · scan: Biblioteca Națională';

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: flowText(lang, 'adminContent.common.save'), exact: true });
}

async function seedDrawnMap(content: ContentWorld): Promise<void> {
    await seedPublicCity(content, AT);
    await content.setDocument(PATH, {
        year: 1911,
        label: { ro: 'Planul Bucureștiului 1911', en: 'Bucharest plan 1911' },
        kind: 'map',
        attribution: CREDIT,
        rights: { licence: 'permission', author: 'Ion Ionescu', source: { label: 'Biblioteca Națională' } },
        source: { type: 'xyz', tiles: [E2E_XYZ_LAYER.tiles], tileSize: 256 },
        minzoom: 0,
        maxzoom: 22,
        order: 1,
        opacity: 1,
        defaultVisible: true,
        status: 'ready',
        published: true,
        updatedBy: 'system:pipeline',
        updatedAt: AT,
    });
}

test(
    "A layer's licence corrected after the import reaches the public credit line",
    { tag: '@S-A197-HAPPY' },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await seedDrawnMap(content);
        await page.goto(content.address(lang, PATH, { map: false }));
        const licence = page.getByLabel(flowText(lang, 'adminContent.layers.licence'), { exact: true });
        await expect(licence).toHaveValue('permission');
        await licence.selectOption('PD');
        await expect(page.getByRole('textbox', { name: flowText(lang, 'adminContent.layers.attribution'), exact: true })).toHaveValue(
            'Ion Ionescu, Planul Bucureștiului, 1911 · PD · scan: Biblioteca Națională',
        );
        await page.getByLabel(flowText(lang, 'adminContent.layers.rightsAuthor'), { exact: true }).fill('Institutul Geografic');
        await saveButton(page, lang).click();
        await expect
            .poll(async () => await content.document(PATH))
            .toMatchObject({
                rights: { licence: 'PD', author: 'Institutul Geografic', source: { label: 'Biblioteca Națională' } },
                attribution: 'Ion Ionescu, Planul Bucureștiului, 1911 · PD · scan: Biblioteca Națională',
            });
        const manifest = await awaitManifest(content, 'carries the corrected credit', (built) => {
            const attribution = entry(built, 'layers', E2E_XYZ_LAYER.id)?.['attribution'];
            return typeof attribution === 'string' && attribution.includes(' · PD · ');
        });
        expect(entry(manifest, 'layers', E2E_XYZ_LAYER.id)?.['attribution']).not.toContain('permission');
    },
);

test('An author over 200 characters is refused at its field', { tag: '@S-A197-BAD-AUTHOR-TOO-LONG' }, async ({ page, lang, content }) => {
    await seedDrawnMap(content);
    await page.goto(content.address(lang, PATH, { map: false }));
    const author = page.getByLabel(flowText(lang, 'adminContent.layers.rightsAuthor'), { exact: true });
    await author.fill('x'.repeat(201));
    await expect(author).toHaveAttribute('aria-invalid', 'true');
    await expect(saveButton(page, lang)).toBeDisabled();
    expect(await content.document(PATH)).toMatchObject({ rights: { licence: 'permission', author: 'Ion Ionescu' } });
});
