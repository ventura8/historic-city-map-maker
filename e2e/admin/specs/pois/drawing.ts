import type { LngLat } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { recordLiveRegions } from '../../../support/live-regions.js';
import { adminMapReady } from '../../support/map.js';
import { expect } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { poisText, seedCategories } from './places.js';

/**
 * What the drawing specs share (e2e/admin/specs/pois/drawing.spec.ts and the tour's e2e/tour/admin-drawing.tour.ts): a
 * city of the admin's own with its categories, the places page, the editor's controls and what it refused.
 */

/** When the city and its categories were written (a fixed time). */
export const AT = new Date('2026-10-17T09:00:00.000Z');

/** Four corners around Piața Universității, a few hundred metres apart (all on screen at the city's zoom 13). */
export const AREA: readonly LngLat[] = [
    [26.095, 44.427],
    [26.105, 44.427],
    [26.105, 44.433],
    [26.095, 44.433],
];

export async function openPlaces(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await page.context().addInitScript(recordLiveRegions);
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    await page.goto(content.address(lang, 'pois'));
    await expect(page.getByText(poisText(lang, 'adminContent.pois.empty'))).toBeVisible();
}

export function addPlace(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') });
}

export function shape(page: Page, lang: 'ro' | 'en', kind: 'point' | 'linestring' | 'polygon'): Locator {
    return page.getByRole('button', { name: poisText(lang, `adminContent.pois.shape.${kind}`), exact: true });
}

export function titleField(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') });
}

/** The start year: every place names a year (the owner's request of 2026-11-12), so a new place fills it before Save. */
export function yearField(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('spinbutton', { name: poisText(lang, 'adminContent.pois.field.yearStart') });
}

export function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true });
}

/** What the editor said it refused (its alert region). */
export function refusal(page: Page, lang: 'ro' | 'en', kind: 'outside' | 'self-intersection' | 'too-many-vertices'): Locator {
    return page.locator('hcm-poi-editor .alert-region').filter({ hasText: poisText(lang, `adminContent.map.refused.${kind}`) });
}

/** A coordinate field of the list of positions: `v<index>-lat` or `v<index>-lng`. */
export function coordinate(page: Page, id: string): Locator {
    return page.locator(`hcm-vertex-list #${id}`);
}

/** The city's single place once saved, with its id. */
export async function savedPlace(content: ContentWorld): Promise<[string, Record<string, unknown>]> {
    await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(1);
    const [found] = Object.entries(await content.collection('pois'));
    return found ?? ['', {}];
}

/**
 * Waits until the map can be drawn on: the map ready (its own controls shown) and the Draw tool pressed, which the editor
 * shows once the drawing session follows the new place. A click before that would land in no drawing session.
 */
export async function readyToDraw(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await adminMapReady(page);
    await expect(
        page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.draw'), exact: true, pressed: true }),
    ).toBeVisible();
}
