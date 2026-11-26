import type { LngLat } from '@hcm/shared';

import { mapFacts } from '../../../support/map.js';
import { expect, test } from '../../support/content-test.js';
import { seedPublicCity } from '../../support/flows.js';
import { addPlace, AT, readyToDraw, shape } from './drawing.js';
import { poisText, seedCategories, seedPlace } from './places.js';

/**
 * The places map follows the place opened (behaviour A32; docs/research/M2c-interfaces.md §4.4): a place of the list
 * may lie outside the city's start view (zoom 13 around 44.43 N, 26.1 E), so opening it centres the map on it, its zoom
 * kept; a new place has nothing to show yet, so the map stays where it was.
 */

/** The city's start view (`seedPublicCity`). */
const CITY: LngLat = [26.1, 44.43];

/** Gara Băneasa, about 6 km north of the start view: off the map at zoom 13 on every project's window. */
const NORTH: LngLat = [26.08, 44.49];

function near(actual: readonly number[], expected: LngLat): boolean {
    return Math.abs((actual[0] ?? 0) - expected[0]) < 1e-4 && Math.abs((actual[1] ?? 0) - expected[1]) < 1e-4;
}

test(
    'A new place leaves the map at the start view, and a place opened from its address is brought into view',
    { tag: ['@S-A32-HAPPY-OPEN-IN-VIEW', '@S-A32-BAD-NEW-PLACE-KEEPS-VIEW'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPlace(content, { id: 'baneasa', title: 'Gara Băneasa', at: NORTH }, AT);
        await page.goto(content.address(lang, 'pois'));
        await expect(page.getByRole('link', { name: /Gara Băneasa/ }).first()).toBeAttached();

        // A new point: nothing drawn yet, so the map stays at the city's start view.
        await addPlace(page, lang).click();
        await shape(page, lang, 'point').click();
        await expect(page.getByRole('heading', { name: poisText(lang, 'adminContent.pois.newPlace') })).toBeVisible();
        await readyToDraw(page, lang);
        expect(near((await mapFacts(page)).center, CITY)).toBe(true);

        // The saved place, by its address as a person types it: the same map centres on it. The new place was never
        // touched, so leaving it asks nothing (finding 42 of 2026-11-01).
        await page.evaluate(() => {
            window.location.hash = '#/pois/baneasa';
        });
        await expect(page.getByRole('heading', { name: 'Gara Băneasa' })).toBeVisible();
        await expect(page.locator('hcm-dialog[open]')).toHaveCount(0);
        await expect.poll(async () => near((await mapFacts(page)).center, NORTH)).toBe(true);
    },
);
