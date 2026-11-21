import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { scanPixelOf } from '../../support/imagery-geometry.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import {
    georefText,
    halfOnScanHint,
    landmark,
    openGeoreferencer,
    pairRows,
    pointInView,
    scanPane,
    scanPointOf,
    showPane,
} from './georef.js';
import { errorText, detail, importFromList, readyImagery, versionState } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer's context menu (behaviour A16; docs/research/M3-interfaces.md §10.4, addendum of 2026-11-12): a
 * right-click (a long press on a touch screen, the ContextMenu key or Shift+F10 from the keyboard) on the scan or the map
 * offers Add a point here, Move and Delete this point on a pair, and Undo; a version that takes no points offers nothing
 * that edits.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

function menu(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('menu', { name: georefText(lang, 'adminContent.georef.menu.label') });
}

function item(page: Page, lang: 'ro' | 'en', key: 'add' | 'move' | 'delete' | 'undo'): Locator {
    return menu(page, lang).getByRole('menuitem', { name: georefText(lang, `adminContent.georef.menu.${key}`) });
}

test(
    'The context menu adds a pair at the spots clicked, deletes it and takes the delete back',
    { tag: '@S-A16-HAPPY-GEOREF-MENU' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);
        const place = landmark(0);

        // A right-click on the scan where the landmark is: Add a point here is the pair's scan end, exactly there.
        const onScan = await scanPointOf(page, lang, scanPixelOf(place));
        await page.mouse.click(onScan.x, onScan.y, { button: 'right' });
        await expect(item(page, lang, 'add')).toBeFocused();
        await expectStateSound(page, adminVisit('georef.context-menu', lang));
        // The state's Tab round closes it (Tab leaves a menu, as WAI-ARIA's menu button does). Opened again, Esc closes it and
        // the focus goes back to the scan; once more, Add a point here.
        await expect(menu(page, lang)).toHaveCount(0);
        await page.mouse.click(onScan.x, onScan.y, { button: 'right' });
        await expect(item(page, lang, 'add')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page, lang)).toHaveCount(0);
        await expect(scanPane(page, lang)).toBeFocused();
        await page.mouse.click(onScan.x, onScan.y, { button: 'right' });
        await item(page, lang, 'add').click();
        await expect(menu(page, lang)).toHaveCount(0);
        await expect(halfOnScanHint(page, lang)).toBeVisible();

        // The same on the map completes it.
        await showPane(page, lang, 'map');
        const onMap = await pointInView(page, lang, [place.lng, place.lat]);
        await page.mouse.click(onMap.x, onMap.y, { button: 'right' });
        await item(page, lang, 'add').click();
        await expect(pairRows(page, lang)).toHaveCount(5);

        // On the new pair the menu deletes it; from the keyboard (Shift+F10 at the crosshair) Undo brings it back.
        await showPane(page, lang, 'scan');
        const again = await scanPointOf(page, lang, scanPixelOf(place));
        await page.mouse.click(again.x, again.y, { button: 'right' });
        await expect(item(page, lang, 'move')).toBeVisible();
        await item(page, lang, 'delete').click();
        await expect(pairRows(page, lang)).toHaveCount(4);
        await scanPane(page, lang).focus();
        await page.keyboard.press('Shift+F10');
        await expect(menu(page, lang).getByRole('menuitem').first()).toBeFocused();
        await page.keyboard.press('End');
        await expect(item(page, lang, 'undo')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(pairRows(page, lang)).toHaveCount(5);
        await expect(scanPane(page, lang)).toBeFocused();
    },
);

test(
    'A version that takes no points shows a context menu with nothing that edits',
    { tag: '@S-A16-BAD-GEOREF-MENU-READONLY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A failure no retry cures: the version is failed, which takes no points.
        await imagery.script({ attempts: [{ outcome: 'fail', failAt: 'warp', code: 'apiError.mapbox.tokenInvalid' }] });
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');
        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.mapbox.tokenInvalid'))).toBeVisible();
        await page.evaluate((id) => {
            location.hash = `#/georef/${id}`;
        }, versionId);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.notEditable'))).toBeVisible();

        await showPane(page, lang, 'map');
        await page.locator('hcm-admin-map').click({ button: 'right', position: { x: 60, y: 120 } });
        const only = menu(page, lang).getByRole('menuitem');
        await expect(only).toHaveText([georefText(lang, 'adminContent.georef.menu.readOnly')]);
        await expect(only).toHaveAttribute('aria-disabled', 'true');
        await expect(only).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(menu(page, lang)).toHaveCount(0);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.notEditable'))).toBeVisible();
    },
);
