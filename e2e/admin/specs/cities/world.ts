import { translateAdminContent, translateAdminShell, type AdminContentKey, type AdminShellKey, type CityRole } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { E2E_TOKEN } from '../../../fixtures/world.js';
import type { InputFlow } from '../../../support/budget.js';
import { contentIdsOf } from '../../support/content-ids.js';
import type { ContentWorld } from '../../support/content.js';
import type { EmulatorWorld } from '../../support/emulators.js';
import { ADMIN_PATH, ADMIN_URL } from '../../world.js';

/**
 * The M5 multi-city world of the admin tier (docs/research/M5-interfaces.md §1.5 to §1.8, §8; behaviours A49 to A52):
 * cities written past the rules as the server leaves them, a content world's admin joined to a second city, made the
 * project's owner, and the city menu reached the way the window offers it (the top bar's button from the medium window
 * class, the account menu's list on a phone). A second city of a content world is itself a content city (`w-<10 hex>`),
 * so a locked test's reset keeps it as it keeps the world's own; every value is a generated test value.
 */

export const AT = new Date('2026-10-20T09:00:00.000Z');
const CITY_BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 } as const;

export function shellText(lang: 'ro' | 'en', key: AdminShellKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminShell(lang, key, params);
}

export function cityText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** A city document as `cities.create` or Setup leaves it (unpublished, its bounds, its names). */
export async function seedCity(emulators: EmulatorWorld, cityId: string, name: string): Promise<void> {
    await emulators.setDocument(`cities/${cityId}`, {
        name: { ro: name, en: name },
        bounds: CITY_BOUNDS,
        published: false,
        updatedBy: 'system:cities',
        updatedAt: AT,
    });
}

/** The second city of a content world: a content city of its own (`w-<10 hex>`), derived from the world's. */
export function secondCityOf(world: ContentWorld): string {
    return contentIdsOf(world.city, 'second').city;
}

/** The world's admin as `roles` say (its own city as owner unless named), as the functions leave `admins/<uid>.cities`. */
export async function setCities(world: ContentWorld, roles: Readonly<Record<string, CityRole>>): Promise<void> {
    await world.emulators.updateFields(`admins/${world.uid}`, { cities: roles }, ['cities']);
}

/** The world's admin made the project's owner (`admins/<uid>.role`): who creates cities and sets their budgets. */
export async function makeProjectOwner(world: ContentWorld): Promise<void> {
    await world.emulators.updateFields(`admins/${world.uid}`, { role: 'owner' }, ['role']);
}

/** Deletes cities a test wrote besides its world's own, as `ContentWorld.retire` deletes that one. */
export async function retireCities(emulators: EmulatorWorld, cityIds: readonly string[]): Promise<void> {
    for (const cityId of cityIds) {
        await emulators.deleteDocument(`cities/${cityId}`);
    }
}

/**
 * The admin's address without a city of the `e2e` build (`?city=`): the shell then chooses the city itself, the one
 * the hash names, the one chosen last on this browser, or the first by name (S-A49-HAPPY-REMEMBERED).
 */
export function addressWithoutCity(lang: 'ro' | 'en', route?: string): string {
    const query = new URLSearchParams({ lang, mapToken: 'none' });
    const hash = route === undefined ? '' : `#/${route}`;
    return `${ADMIN_URL}?${query.toString()}${hash}`;
}

/** The project's admin address with the admin map's e2e token (a locked spec's `adminPath` names none). */
export function addressWithMap(lang: 'ro' | 'en', route: string): string {
    const query = new URLSearchParams({ lang, mapToken: E2E_TOKEN });
    return `${ADMIN_PATH}?${query.toString()}#/${route}`;
}

/** The top bar's city button, from the medium window class (the account menu holds the cities below it). */
export function cityMenuButton(page: Page): Locator {
    return page.locator('hcm-city-menu:not([inline]) [data-city-menu]');
}

/** Whether the window shows the top bar's city button (from 600 px of width with a top bar). */
function hasCityButton(page: Page): boolean {
    const size = page.viewportSize();
    return size !== null && size.width >= 600 && size.height >= 480;
}

/**
 * Opens the cities' list the way the window offers it, one input: the top bar's city button, or (on a phone) the
 * account menu, which lists them inline. Returns where the choices are.
 */
export async function openCityMenu(page: Page, flow: InputFlow): Promise<Locator> {
    if (hasCityButton(page)) {
        await flow.click(cityMenuButton(page));
        return page.locator('hcm-city-menu:not([inline]) hcm-dialog[open]');
    }
    await flow.click(page.locator('hcm-account-menu hcm-icon-button').first());
    return page.locator('hcm-city-menu[inline]');
}

/** A city of the menu, by its id. */
export function cityChoice(menu: Locator, cityId: string): Locator {
    return menu.locator(`[data-city="${cityId}"]`);
}

/** Every Firestore request body the page sends, decoded, so a spec can tell which documents it listened to or read. */
export function recordFirestoreBodies(page: Page): string[] {
    const bodies: string[] = [];
    page.on('request', (request) => {
        const body = request.postData();
        if (request.url().includes('google.firestore') && body !== null) {
            bodies.push(decodeURIComponent(body.replaceAll('+', ' ')));
        }
    });
    return bodies;
}
