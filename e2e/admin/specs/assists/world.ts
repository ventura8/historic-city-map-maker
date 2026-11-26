import { translateAdminContent, type AdminContentKey, type LngLat } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { E2E_TOKEN } from '../../../fixtures/world.js';
import { PROJECT_CITY, projectCity, type CityWorld } from '../../support/content.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { ADMIN_PATH } from '../../world.js';

/**
 * The editors' assists in the admin tier (behaviours A09, A45; docs/research/M4-interfaces.md §4): the project's own city
 * (`bucharest`), edited by its owner, since the geocoding queue's cool-down (`ops/assist`), its cache cells
 * (`assistGeocodes/*`), the month's AI counters (`usage/ai-*`) and the server's fake upstreams are one per project: the
 * specs hold the admin tier's lock, whose reset empties them before each test. The address names the city and the e2e
 * map token, so the admin map draws without `setup/status`.
 */

/** When everything was written: a fixed time, never the wall clock. */
export const AT = new Date('2026-10-24T09:00:00.000Z');

/** Ateneul Român: the fake Nominatim names it (Romanian and English) within about 150 m. */
export const ATHENAEUM: LngLat = [26.0973, 44.4413];

/** Where the seeded photos are before the pin moves (Calea Victoriei, a road the fake Nominatim names). */
export const START: LngLat = [26.1, 44.43];

/**
 * Where the title specs' photo starts: about 500 m from the Athenaeum, so both are on the map at the zoom the editor
 * opens with in a 360 px window, and a click on the Athenaeum lands well clear of the pin.
 */
export const NEAR_ATHENAEUM: LngLat = [26.1003, 44.4373];

/** An admin text (`adminContent.*`, the assists' and notifications' included). */
export function assistText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The project's city as its owner (the persona the specs sign in as) edits it. */
export function ownerCity(world: {
    readonly emulators: EmulatorWorld;
    readonly accounts: { readonly owner: { readonly uid: string } };
}): CityWorld {
    return projectCity(world.emulators, world.accounts.owner.uid);
}

/** The admin's address at `route` in `lang`, with the city and the e2e map token (and the test's id, when given). */
export function cityAddress(lang: 'ro' | 'en', route: string, test?: string): string {
    const query = new URLSearchParams({ lang, city: PROJECT_CITY, mapToken: E2E_TOKEN, ...(test === undefined ? {} : { test }) });
    return `${ADMIN_PATH}?${query.toString()}#/${route}`;
}

/** One assist slot of an editor (`title`, `draft-title`, `draft-description`, `draft-label`). */
export function assistSlot(page: Page, slot: string): Locator {
    return page.locator(`[data-assist="${slot}"]`);
}

/** The slot's own button (Suggest a title, English draft, Romanian draft). */
export function slotButton(page: Page, slot: string): Locator {
    return assistSlot(page, slot).locator('.actions').getByRole('button');
}
