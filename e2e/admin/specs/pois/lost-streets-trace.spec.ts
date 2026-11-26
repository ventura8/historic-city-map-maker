import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import { adminMapReady } from '../../support/map.js';
import { seedLayer } from '../settings/world.js';
import { AT, addPlace, coordinate, openPlaces, readyToDraw, saveButton, savedPlace, shape, titleField, yearField } from './drawing.js';
import { poisText, seedPlace } from './places.js';

/**
 * M27 "Disappeared streets" (behaviour A154): a lost street is a line traced on one of the city's old maps. The place editor's
 * "Traced on map" select lists the city's layers by year; the chosen one is drawn under the drawing on the places map (its
 * raster source `hcm-source-<layer>`), and the place is saved with its `sourceLayer`. A place naming a map the city no longer
 * has says so in plain words and is saved with another choice.
 */

function tracedOn(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('combobox', { name: poisText(lang, 'adminContent.pois.field.traceLayer') });
}

function optionOf(lang: 'ro' | 'en', year: number, label: string): string {
    return poisText(lang, 'adminContent.pois.trace.layerOption', { year: String(year), label });
}

/** Runs in the page: whether the newest map has the raster source of `layerId`. */
function hasSourceInPage(sourceId: string): boolean {
    interface SourceMap {
        getSource(id: string): unknown;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: SourceMap[] } }).__hcmE2e?.maps.at(-1);
    return map?.getSource(sourceId) !== undefined;
}

async function rasterShown(page: Page, layerId: string): Promise<boolean> {
    return page.evaluate(hasSourceInPage, `hcm-source-${layerId}`);
}

test(
    'A street is traced on the 1911 map: the old map shows under the drawing and the place is saved with it',
    { tag: ['@S-A154-HAPPY-TRACE'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await seedLayer(content, 'plan-1911', AT, { year: 1911, label: { ro: 'Planul 1911' } });
        await openPlaces(page, content, lang);

        // A line of two positions from the keyboard: Add at centre, then the second typed.
        await addPlace(page, lang).click();
        await shape(page, lang, 'linestring').click();
        await readyToDraw(page, lang);
        const addAtCentre = page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') });
        await addAtCentre.click();
        await addAtCentre.click();
        await coordinate(page, 'v1-lat').fill('44.4331');
        await coordinate(page, 'v1-lng').fill('26.1043');
        await coordinate(page, 'v1-lng').press('Tab');

        // The old map goes under the drawing.
        await tracedOn(page, lang).selectOption({ label: optionOf(lang, 1911, 'Planul 1911') });
        await expect.poll(() => rasterShown(page, 'plan-1911')).toBe(true);
        await expect(page.getByRole('slider', { name: poisText(lang, 'adminContent.pois.field.traceOpacity') })).toHaveValue('100');

        await titleField(page, lang).fill('Strada Francmasonă');
        await yearField(page, lang).fill('1911');
        await saveButton(page, lang).click();
        const [, place] = await savedPlace(content);
        expect(place).toMatchObject({ sourceLayer: 'plan-1911', geometry: { type: 'LineString' } });
    },
);

test(
    'A place naming a map that no longer exists says so and is saved with another map',
    { tag: ['@S-A154-BAD-GONE-LAYER'] },
    async ({ page, lang, content }) => {
        test.setTimeout(120_000);
        await seedLayer(content, 'corona-1968', AT);
        await openPlaces(page, content, lang);
        await seedPlace(content, { id: 'lipscani', title: 'Strada Lipscani', at: [26.1, 44.43], extra: { sourceLayer: 'sters-1900' } }, AT);
        await page.goto(content.address(lang, 'pois/lipscani'));
        await adminMapReady(page);

        const select = tracedOn(page, lang);
        await expect(select).toHaveValue('sters-1900');
        await expect(select.locator('option:checked')).toHaveText(poisText(lang, 'adminContent.pois.trace.gone'));
        await expect(page.getByText(poisText(lang, 'adminContent.pois.trace.goneHint'))).toBeVisible();
        expect(await rasterShown(page, 'sters-1900')).toBe(false);

        await select.selectOption({ label: optionOf(lang, 1968, 'Corona 1968') });
        await expect.poll(() => rasterShown(page, 'corona-1968')).toBe(true);
        await saveButton(page, lang).click();
        await expect.poll(async () => (await content.document('pois/lipscani'))?.['sourceLayer']).toBe('corona-1968');
    },
);
