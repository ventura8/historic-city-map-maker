import type { Page } from '@playwright/test';

import { mapFacts } from '../../../support/map.js';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { seedLayer, text } from '../settings/world.js';

/**
 * A satellite or aerial layer's shot direction in the layer editor (behaviour A233, the owner on 2026-11-23): a compass
 * dial the admin drags or turns from the keyboard, the same value typed in degrees, Clear; a layer from a USGS scene whose
 * corners say how the frame lies offers that direction. Save writes `shotDirection`; the public map's button reads it.
 */

const AT = new Date('2026-11-23T09:00:00.000Z');
const LAYER = 'corona-1968';
const SCENE = 'DS1105-2248DF071';

/** A harvested scene whose frame's top edge points north-east (44°). */
function scene(): Record<string, unknown> {
    return {
        entityId: SCENE,
        dataset: 'corona2',
        sensor: 'KH-4B',
        acquisitionDate: '1968-09-10',
        status: 'imported',
        downloadAvailable: true,
        footprint: [
            { lat: 44.3, lng: 25.9 },
            { lat: 44.6, lng: 26.3 },
            { lat: 44.7, lng: 26.6 },
        ],
        corners: { sw: { lat: 44.3, lng: 25.9 }, nw: { lat: 44.6, lng: 26.3 }, ne: { lat: 44.7, lng: 26.6 }, se: { lat: 44.4, lng: 26.2 } },
        resolutionM: 1.8,
        coverage: 1,
        browse: { state: 'none' },
        rank: { score: 50, reasons: [], version: 1 },
        harvestedAt: AT,
        updatedBy: 'system:imagery',
        updatedAt: AT,
    };
}

function degrees(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('textbox', { name: text(lang, 'adminContent.layers.shot.degrees'), exact: true });
}

async function openLayer(page: Page, lang: 'ro' | 'en', content: ContentWorld, extra: Record<string, unknown> = {}): Promise<void> {
    await seedPublicCity(content, AT);
    await seedLayer(content, LAYER, AT, { attribution: 'USGS EarthExplorer (e2e)', ...extra });
    await page.goto(content.address(lang, `layers/${LAYER}`));
    await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
}

async function save(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true }).click();
}

test(
    'The dial, the degrees and the USGS direction set the shot direction, and Save writes it',
    { tag: ['@S-A233-HAPPY-SHOT-DIAL', '@S-A233-HAPPY-SHOT-USGS'] },
    async ({ page, lang, content }) => {
        await content.emulators.setDocument(`cities/${content.city}/usgsScenes/${SCENE}`, scene());
        await openLayer(page, lang, content, { provenance: { usgsEntityId: SCENE, usgsDataset: 'corona2' } });
        const dial = page.getByRole('slider', { name: text(lang, 'adminContent.layers.shot'), exact: true });
        await expect(dial).toHaveAttribute('aria-valuetext', text(lang, 'adminContent.layers.shot.none'));

        await page.getByRole('button', { name: text(lang, 'adminContent.layers.shot.useUsgs', { degrees: '44' }), exact: true }).click();
        await expect(degrees(page, lang)).toHaveValue('44');
        await dial.focus();
        await page.keyboard.press('ArrowRight');
        await expect(dial).toHaveAttribute('aria-valuenow', '45');
        await save(page, lang);
        await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['shotDirection']).toBe(45);

        await degrees(page, lang).fill('270');
        await degrees(page, lang).blur();
        await save(page, lang);
        await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['shotDirection']).toBe(270);
    },
);

test(
    'Clear removes the shot direction, and a drawn map has none to set',
    { tag: ['@S-A233-BAD-SHOT-DIAL', '@S-A233-BAD-SHOT-USGS'] },
    async ({ page, lang, content }) => {
        await openLayer(page, lang, content, { shotDirection: 90 });
        await expect(degrees(page, lang)).toHaveValue('90');
        await expect(page.locator('[data-shot-suggestion]')).toHaveCount(0);

        await page.getByRole('button', { name: text(lang, 'adminContent.layers.shot.clear'), exact: true }).click();
        await save(page, lang);
        await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['shotDirection']).toBeUndefined();

        await page.getByRole('radio', { name: text(lang, 'adminContent.layers.kind.map'), exact: true }).click();
        await expect(page.locator('[data-shot-direction]')).toHaveCount(0);
    },
);

test('The preview map direction is saved on the layer', { tag: '@S-A233-HAPPY-SHOT-VIEW' }, async ({ page, lang, content }) => {
    await openLayer(page, lang, content);
    const button = page.getByRole('button', { name: text(lang, 'adminContent.layers.shot.fromView'), exact: true });
    await expect(button).toBeEnabled();
    const box = await page.locator('hcm-admin-map canvas').boundingBox();
    expect(box).not.toBeNull();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move(x, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(x + 100, y, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    await expect.poll(async () => Math.abs((await mapFacts(page)).bearing)).toBeGreaterThan(1);
    // The rotation eases out after the mouse is released: read the bearing once two reads in a row agree.
    let last = Number.NaN;
    await expect
        .poll(async () => {
            const previous = last;
            last = (await mapFacts(page)).bearing;
            return last === previous;
        })
        .toBe(true);
    const bearing = ((Math.round(last) % 360) + 360) % 360;
    await button.click();
    await expect(degrees(page, lang)).toHaveValue(String(bearing));
    await save(page, lang);
    await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['shotDirection']).toBe(bearing);
});
