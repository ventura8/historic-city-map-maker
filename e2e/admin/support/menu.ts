import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The open dialog of the overflow menu named `menu`, as its host element: the actions are slotted into the kit's
 * `hcm-dialog`, so they are children of that element, not of the native `<dialog>` in its shadow root (a locator scoped
 * to the role `dialog` would see only its close button).
 */
export function menuDialog(page: Page, menu: string): Locator {
    return page.locator('hcm-overflow-menu hcm-dialog').filter({ has: page.getByRole('dialog', { name: menu }) });
}

/**
 * An overflow menu of the editing kit (`hcm-overflow-menu`, DECISIONS-for-review.md §42e): its button, named `menu`, opens a
 * dialog of the same name listing the actions; choosing one closes the dialog, then the action runs. Pierces the shadow
 * roots as a person sees the page.
 */
export async function chooseInMenu(page: Page, scope: Locator, menu: string, action: string): Promise<void> {
    await scope.getByRole('button', { name: menu, exact: true }).click();
    await expect(page.getByRole('dialog', { name: menu })).toBeVisible();
    await menuDialog(page, menu).getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('dialog', { name: menu })).toBeHidden();
}
