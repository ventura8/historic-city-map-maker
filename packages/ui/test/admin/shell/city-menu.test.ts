/**
 * `<hcm-city-menu>` (M5, `docs/research/M5-interfaces.md` §1.5; behaviour A49): the top bar's switcher from the medium
 * window class, the account menu's list on a compact window, hidden from an admin of one city who does not own the project.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminCityPort, AdminStatePort } from '../../../src/admin/admin-port.js';
import type { HcmAccountMenu } from '../../../src/admin/shell/hcm-account-menu.js';
import type { HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { cityTitle, currentCityLabel, defineHcmCityMenu, showsCityMenu, type HcmCityMenu } from '../../../src/admin/shell/hcm-city-menu.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

const CLUJ: AdminCityPort = { id: 'cluj', role: 'editor', name: { ro: 'Cluj-Napoca' } };
const TWO_CITIES: readonly AdminCityPort[] = [{ id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } }, CLUJ];

/** A state from before M5's session fields (an older app, or one still starting). */
function withoutCities(): AdminStatePort {
    const state: Record<string, unknown> = { ...adminState() };
    delete state['cities'];
    delete state['cityId'];
    delete state['projectOwner'];
    return state as unknown as AdminStatePort;
}

async function shellOf(app: FakeAdminApp, width: number): Promise<HcmAdminShell> {
    const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, width);
    await updated(element);
    return element;
}

describe('<hcm-city-menu>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theTopBarNamesTheCityAndItsDialogSwitchesToAnother @S-A49-HAPPY-SWITCH', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, cities: TWO_CITIES, projectOwner: false }));
        const element = await shellOf(app, 1300);
        const menu = deep(element, 'hcm-city-menu') as HcmCityMenu;

        expect(deep(menu, '[data-city-menu]').textContent).toContain('Bucharest');
        // docs/LESSONS.md 249: the focused inner button says what it opens and which city is open (on the host, nothing).
        const bar = deep(deep(menu, '[data-city-menu]'), 'button');
        expect([bar.getAttribute('aria-haspopup'), bar.getAttribute('aria-label')]).toEqual(['dialog', 'City: Bucharest']);
        expect(deep(menu, '[data-city-menu]').hasAttribute('aria-haspopup')).toBe(false);
        deep(menu, '[data-city-menu]').click();
        await updated(menu);
        expect(deep(menu, 'hcm-dialog').hasAttribute('open')).toBe(true);
        expect(app.calls).toContain('refreshCities');
        expect(
            deepAll(menu, '[data-city]').map((choice) => [choice.dataset['city'], deep(choice, 'button').getAttribute('aria-current')]),
        ).toEqual([
            ['bucharest', 'true'],
            ['cluj', null],
        ]);
        expect(deepText(menu)).toContain('Cluj-Napoca · Editor');
        expect(deepText(menu)).not.toContain('New city');
        expect(await axeViolations(element)).toEqual([]);

        deep(menu, '[data-city="cluj"]').click();
        await updated(menu);

        expect(app.calls).toContain('switchCity "cluj"');
        expect(menu.open).toBe(false);
    });

    it('happyPath_theProjectsOwnerOfOneCityGetsNewCity @S-A50-HAPPY', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, locale: 'ro' }));
        const element = await shellOf(app, 1300);
        const menu = deep(element, 'hcm-city-menu');

        deep(menu, '[data-city-menu]').click();
        await updated(menu);
        deep(menu, '[data-city="bucharest"]').click();
        deep(menu, '[data-city-menu]').click();
        await updated(menu);
        const create = deepAll(menu, 'hcm-button').find((button) => button.textContent.includes('Oraș nou'));
        create?.click();
        await updated(menu);

        expect(app.calls.filter((call) => call.startsWith('switchCity'))).toEqual([]);
        expect(app.calls).toContain('navigate {"id":"cities","params":["new"]}');
        expect((menu as HcmCityMenu).open).toBe(false);
    });

    it('badPath_anAdminOfOneCityWhoDoesNotOwnTheProjectSeesNoMenu @S-A49-HAPPY-ONE-CITY', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, cities: [CLUJ], cityId: 'cluj', projectOwner: false }));
        const element = await shellOf(app, 1300);

        expect(deep(element, 'hcm-city-menu').shadowRoot?.childElementCount).toBe(0);
        expect(deepAll(element, '[data-city-menu]')).toHaveLength(0);
        expect(showsCityMenu(app.state)).toBe(false);
    });

    it('happyPath_onAPhoneTheAccountMenuListsTheCitiesAndChoosingClosesIt', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, cities: TWO_CITIES, projectOwner: false }));
        const element = await shellOf(app, 360);
        const account = deep(element, 'hcm-account-menu') as HcmAccountMenu;

        expect(deepAll(element, '.top-bar > hcm-city-menu')).toHaveLength(0);
        // docs/LESSONS.md 250: a phone names the open city in its top bar and the tab's title.
        expect(deep(element, '.top-bar h1').textContent).toBe('Setup · Bucharest');
        expect(document.title).toBe('Map administration · Bucharest');
        deep(account, 'hcm-icon-button').click();
        await updated(account);
        expect(app.calls).toContain('refreshCities');
        const inline = deep(account, 'hcm-city-menu[inline]');
        expect(deep(inline, 'ul').getAttribute('aria-labelledby')).toBe('cities-label');
        expect(await axeViolations(account)).toEqual([]);

        deep(inline, '[data-city="cluj"]').click();
        await updated(account);

        expect(app.calls).toContain('switchCity "cluj"');
        expect(account.open).toBe(false);
    });

    it('badPath_withoutAnAppOrStateTheMenuIsEmptyAndANamelessCityShowsItsId', async () => {
        defineHcmCityMenu();
        defineHcmCityMenu();
        const bare = await mount<HcmCityMenu>(html`<hcm-city-menu></hcm-city-menu>`);
        expect(bare.shadowRoot?.childElementCount).toBe(0);

        const orphan = await mount<HcmCityMenu>(html`<hcm-city-menu .state=${adminState({ cities: TWO_CITIES })}></hcm-city-menu>`);
        deep(orphan, '[data-city-menu]').click();
        await updated(orphan);
        deep(orphan, '[data-city="cluj"]').click();
        await updated(orphan);
        expect(orphan.open).toBe(false);

        expect(currentCityLabel(adminState({ cities: [], cityId: 'bacau' }))).toBe('bacau');
        expect(cityTitle(adminState({ cities: TWO_CITIES, cityId: 'cluj', locale: 'en' }))).toBe(' · Cluj-Napoca');
        expect(cityTitle(adminState({ cities: [CLUJ], cityId: 'cluj', projectOwner: false }))).toBe('');
        expect(cityTitle(adminState({ cities: [CLUJ], cityId: 'cluj', projectOwner: true }))).toBe('');
        expect(cityTitle(adminState({ cities: TWO_CITIES, cityId: 'bacau' }))).toBe(' · bacau');
        expect(cityTitle(withoutCities())).toBe('');
        expect(currentCityLabel(withoutCities())).toBe('');
        expect(currentCityLabel(adminState({ cities: TWO_CITIES, cityId: 'cluj', locale: 'en' }))).toBe('Cluj-Napoca');
        expect(showsCityMenu(withoutCities())).toBe(false);
    });
});
