import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { seedPublicCity } from '../../support/flows.js';
import { seedPhoto } from '../../support/photos.js';
import {
    AT,
    addressWithoutCity,
    cityChoice,
    cityMenuButton,
    cityText,
    openCityMenu,
    recordFirestoreBodies,
    retireCities,
    secondCityOf,
    seedCity,
    setCities,
    shellText,
} from './world.js';

/**
 * The city switcher (behaviour A49, docs/research/M5-interfaces.md §1.5): an admin of two cities sees the open one named
 * and switches with a page load into the other's Home; the editors then read that city only. An address names its city
 * (`#/c/<city>/...`) for an admin of two cities, never for an admin of one, whose shell is as before. A link to a city
 * the admin does not administer opens their own, saying why, and reads nothing of the other; an unsaved draft is asked
 * about first. Content specs: each test's own cities and account.
 */

const OWN = 'Orașul A (e2e)';
const SECOND = 'Orașul B (e2e)';

test('An admin of two cities switches between them', { tag: '@S-A49-HAPPY' }, async ({ page, lang, content, inputBudget }) => {
    const second = secondCityOf(content);
    await seedCity(content.emulators, content.city, OWN);
    await seedCity(content.emulators, second, SECOND);
    await setCities(content, { [content.city]: 'owner', [second]: 'editor' });
    await seedPhoto(content, { id: 'fotografia-a', title: 'Fotografia A (e2e)' }, AT);
    await seedPhoto(
        { emulators: content.emulators, city: second, uid: content.uid },
        { id: 'fotografia-b', title: 'Fotografia B (e2e)' },
        AT,
    );
    try {
        await page.goto(content.address(lang, 'photos', { map: false }));
        await expect(page.getByText('Fotografia A (e2e)')).toBeVisible();

        // docs/LESSONS.md 250: the tab's title names the open city (a phone's top bar too; the wider bar's menu names it).
        await expect(page).toHaveTitle(`${shellText(lang, 'adminShell.appName')} · ${OWN}`);
        const flow = inputBudget.flow('switchCity', contentFlowBudget('switchCity'));
        const menu = await openCityMenu(page, flow);
        // docs/LESSONS.md 249: the open city's state reaches the focused inner button, where assistive technology reads it.
        await expect(cityChoice(menu, content.city).getByRole('button')).toHaveAttribute('aria-current', 'true');
        await expect(cityChoice(menu, second).getByRole('button')).not.toHaveAttribute('aria-current', /.*/);
        await expect(cityChoice(menu, second)).toContainText(`${SECOND} · ${shellText(lang, 'adminShell.city.role.editor')}`);
        await expectStateSound(page, adminVisit('cities.switcher-menu', lang));
        await flow.click(cityChoice(menu, second));

        await expect(page).toHaveURL(new RegExp(`#/c/${second}/home$`));
        await page.goto(content.address(lang, `c/${second}/photos`, { map: false }));
        await expect(page.getByText('Fotografia B (e2e)')).toBeVisible();
        await expect(page.getByText('Fotografia A (e2e)')).toHaveCount(0);
        expect(flow.used).toBe(2);
    } finally {
        await retireCities(content.emulators, [second]);
    }
});

test(
    'The admin reopens on the city chosen last; a fresh browser opens the first by name',
    { tag: '@S-A49-HAPPY-REMEMBERED' },
    async ({ page, lang, content, inputBudget }) => {
        const second = secondCityOf(content);
        await seedCity(content.emulators, content.city, OWN);
        await seedCity(content.emulators, second, SECOND);
        await setCities(content, { [content.city]: 'owner', [second]: 'owner' });
        try {
            // No city in the address and none chosen yet on this browser: the first by name.
            await page.goto(addressWithoutCity(lang, 'photos'));
            await expect(page).toHaveURL(new RegExp(`#/c/${content.city}/photos$`));

            const menu = await openCityMenu(page, inputBudget.flow('switchCity', contentFlowBudget('switchCity')));
            await cityChoice(menu, second).click();
            await expect(page).toHaveURL(new RegExp(`#/c/${second}/home$`));

            await page.goto(addressWithoutCity(lang, 'photos'));
            await expect(page).toHaveURL(new RegExp(`#/c/${second}/photos$`));
        } finally {
            await retireCities(content.emulators, [second]);
        }
    },
);

test('An admin of one city sees the shell as before', { tag: '@S-A49-HAPPY-ONE-CITY' }, async ({ page, lang, content }) => {
    await seedCity(content.emulators, content.city, OWN);

    await page.goto(content.address(lang, 'photos', { map: false }));

    await expect(page.locator('hcm-admin-shell')).toBeVisible();
    await expect(page).toHaveURL(/#\/photos$/);
    await expect(cityMenuButton(page)).toHaveCount(0);
    await expect(page.locator('[data-city]')).toHaveCount(0);
});

test(
    'A link to a city the admin does not administer opens their own',
    { tag: '@S-A49-BAD-NOT-MEMBER' },
    async ({ page, lang, content }) => {
        const other = secondCityOf(content);
        await seedCity(content.emulators, content.city, OWN);
        await seedCity(content.emulators, other, SECOND);
        const bodies = recordFirestoreBodies(page);
        try {
            await page.goto(content.address(lang, `c/${other}/photos`, { map: false }));

            const notice = shellText(lang, 'adminShell.city.notMember', { cityId: other, city: OWN });
            await expect(page.locator('hcm-snackbar').filter({ hasText: notice })).toBeVisible();
            await expect(page).toHaveURL(/#\/photos$/);
            await expectStateSound(page, adminVisit('cities.not-member', lang));
            expect(bodies.filter((body) => body.includes(`cities/${other}`))).toEqual([]);
        } finally {
            await retireCities(content.emulators, [other]);
        }
    },
);

test('Switching with an unsaved draft asks first', { tag: '@S-A49-BAD-UNSAVED' }, async ({ page, lang, content, inputBudget }) => {
    const second = secondCityOf(content);
    await seedPublicCity(content, AT);
    await seedCity(content.emulators, second, SECOND);
    await setCities(content, { [content.city]: 'owner', [second]: 'editor' });
    try {
        await page.goto(content.address(lang, 'settings/theme', { map: false }));
        await page.getByRole('button', { name: cityText(lang, 'adminContent.settings.preset', { hex: '#006a6a' }) }).click();
        const ask = page.locator('hcm-dialog[open]');

        // Keep editing: the draft and the city stay.
        const first = await openCityMenu(page, inputBudget.flow('first', 2));
        await cityChoice(first, second).click();
        await expect(ask).toContainText(cityText(lang, 'adminContent.common.unsavedTitle'));
        await ask.getByRole('button', { name: cityText(lang, 'adminContent.common.keepEditing'), exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#/c/${content.city}/settings/theme$`));
        await expect(page.getByRole('button', { name: cityText(lang, 'adminContent.common.discard'), exact: true })).toBeEnabled();

        // Discard: the other city opens.
        const again = await openCityMenu(page, inputBudget.flow('again', 2));
        await cityChoice(again, second).click();
        await ask.getByRole('button', { name: cityText(lang, 'adminContent.common.discard'), exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`#/c/${second}/home$`));
    } finally {
        await retireCities(content.emulators, [second]);
    }
});
