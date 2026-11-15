import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmFabMenu, type FabMenuItem, type HcmFabMenu } from '../../src/components/fab-menu.js';
import { cleanup, deepFocus, fixture, part, press, recordEvents, shadowPart, shadowRootOf } from '../helpers.js';

defineHcmFabMenu();

const ITEMS: readonly FabMenuItem[] = [
    { value: 'layers', label: 'Straturi', icon: 'layers' },
    { value: 'share', label: 'Distribuie', icon: 'share' },
    { value: 'about', label: 'Despre', icon: 'info' },
];

async function menu(): Promise<HcmFabMenu> {
    const box = await fixture<HTMLElement>(
        html`<div>
            <hcm-fab-menu label="Meniu" close-label="Închide meniul" .items=${ITEMS}></hcm-fab-menu><button id="outside">Outside</button>
        </div>`,
    );
    const element = part(box, 'hcm-fab-menu') as HcmFabMenu;
    await element.updateComplete;
    return element;
}

function focusedText(): string {
    return (deepFocus()?.textContent ?? '').trim();
}

describe('<hcm-fab-menu>', () => {
    afterEach(cleanup);

    it('happyPath_theFabOpensTheMenuAndFocusesTheFirstItem', async () => {
        const element = await menu();
        const toggles = recordEvents(element, 'hcm-toggle');
        const fab = page.getByRole('button', { name: 'Meniu' });

        await expect.element(fab).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(fab);
        await element.updateComplete;

        await expect.element(page.getByRole('menu', { name: 'Meniu' })).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Închide meniul' })).toHaveAttribute('aria-expanded', 'true');
        expect(focusedText()).toBe('Straturi');
        expect(toggles).toEqual([{ open: true }]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_arrowsHomeEndAndChoosingAnItem', async () => {
        const element = await menu();
        const selections = recordEvents(element, 'hcm-select');
        shadowPart(element, '.fab').click();
        await element.updateComplete;
        const list = shadowPart(element, '[role="menu"]');

        press(list, 'ArrowDown');
        expect(focusedText()).toBe('Distribuie');
        press(list, 'ArrowUp');
        press(list, 'ArrowUp');
        expect(focusedText()).toBe('Despre');
        press(list, 'Home');
        expect(focusedText()).toBe('Straturi');
        press(list, 'End');
        await userEvent.keyboard('{Enter}');
        await element.updateComplete;

        expect(selections).toEqual([{ value: 'about' }]);
        expect(element.open).toBe(false);
        expect(deepFocus()).toBe(shadowPart(element, '.fab'));
    });

    it('badPath_theFabHasTheFocusWhenTheChoiceIsAnnounced', async () => {
        // S-V15-BAD-SHEET-DRAG-CLOSE found it: the viewer remembered the vanished menu item as the opener of the sheet
        // it opened, so closing the sheet left the focus nowhere.
        const element = await menu();
        const focusAtSelect: (Element | null)[] = [];
        element.addEventListener('hcm-select', () => {
            focusAtSelect.push(deepFocus());
        });
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        press(shadowPart(element, '[role="menu"]'), 'End');
        await userEvent.keyboard('{Enter}');

        expect(focusAtSelect).toEqual([shadowPart(element, '.fab')]);
    });

    it('happyPath_escapeClosesAndReturnsToTheFab', async () => {
        const element = await menu();
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        press(shadowPart(element, '[role="menu"]'), 'Escape');
        await element.updateComplete;

        expect(element.open).toBe(false);
        expect(deepFocus()).toBe(shadowPart(element, '.fab'));
    });

    it('badPath_focusLeavingTheMenuClosesItButMovingInsideDoesNot', async () => {
        const element = await menu();
        const toggles = recordEvents(element, 'hcm-toggle');
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        shadowPart(element, '.fab').focus();
        expect(element.open).toBe(true);
        shadowPart(element, '[role="menuitem"]').focus();
        part(document, '#outside').focus();
        await element.updateComplete;

        expect(toggles).toEqual([{ open: true }, { open: false }]);
        expect(element.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    });

    it('badPath_aWrappedMenuAlignedToTheStartKeepsItsFabInPlace', async () => {
        // UX review: on a landscape phone the menu docks on the leading edge and wraps into two columns; aligned to the
        // end, the wider open menu moved the FAB about 300 px from where it was tapped.
        const element = await menu();
        element.style.setProperty('--hcm-fab-menu-align', 'flex-start');
        element.style.setProperty('--hcm-fab-menu-max-block-size', '120px');
        const fab = shadowPart(element, '.fab');
        const closed = fab.getBoundingClientRect();

        fab.click();
        await element.updateComplete;

        const items = [...(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const lefts = new Set(items.map((item) => Math.round(item.getBoundingClientRect().left)));
        expect(lefts.size).toBe(2);
        expect(fab.getBoundingClientRect().left).toBeCloseTo(closed.left, 0);
        expect(Math.min(...lefts)).toBeCloseTo(closed.left, 0);
    });

    it('happyPath_byDefaultTheFabAndTheItemsLineUpOnTheInlineEnd', async () => {
        const element = await menu();
        const fab = shadowPart(element, '.fab');
        fab.click();
        await element.updateComplete;

        const rights = [...(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map((item) =>
            Math.round(item.getBoundingClientRect().right),
        );
        expect(new Set(rights)).toEqual(new Set([Math.round(fab.getBoundingClientRect().right)]));
    });

    it('badPath_theOpenMenuTakesNoTapBesideTheFab', async () => {
        // The tour: the open menu's box (as wide as its widest item) blocked the timeline beside the FAB on a tablet.
        const element = await menu();
        const fab = shadowPart(element, '.fab');
        fab.click();
        await element.updateComplete;
        const host = element.getBoundingClientRect();
        const button = fab.getBoundingClientRect();
        const item = shadowPart(element, '[role="menuitem"]');
        const first = item.getBoundingClientRect();
        const root = shadowRootOf(element);

        expect(button.left - host.left).toBeGreaterThan(16);
        expect(document.elementFromPoint(host.left + 4, button.top + button.height / 2)).not.toBe(element);
        expect(root.elementFromPoint(button.left + button.width / 2, button.top + button.height / 2)?.closest('.fab')).toBe(fab);
        expect(root.elementFromPoint(first.left + 8, first.top + first.height / 2)?.closest('[role="menuitem"]')).toBe(item);
    });

    it('badPath_keysOnAClosedFabDoNothing', async () => {
        const element = await menu();
        const fab = shadowPart(element, '.fab');

        const escape = press(fab, 'Escape');
        const arrow = press(fab, 'ArrowDown');

        expect(escape.defaultPrevented).toBe(false);
        expect(arrow.defaultPrevented).toBe(false);
        expect(element.open).toBe(false);
    });
});

describe('<hcm-fab-menu>: an item that is on or off', () => {
    afterEach(cleanup);

    it('happyPath_anItemThatIsOnOrOffIsACheckboxItemTheArrowsReach', async () => {
        const element = await menu();
        element.items = [...ITEMS, { value: 'locate', label: 'Arată-mi locația', icon: 'my_location', checked: true }];
        shadowPart(element, '.fab').click();
        await element.updateComplete;
        const list = shadowPart(element, '[role="menu"]');

        const locate = page.getByRole('menuitemcheckbox', { name: 'Arată-mi locația' });
        await expect.element(locate).toHaveAttribute('aria-checked', 'true');
        press(list, 'End');
        expect(focusedText()).toBe('Arată-mi locația');
        expect(shadowPart(element, '[role="menuitem"]').hasAttribute('aria-checked')).toBe(false);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anOffItemSaysSoAndLooksLikeTheOthers', async () => {
        const element = await menu();
        element.items = [{ value: 'locate', label: 'Arată-mi locația', icon: 'my_location', checked: false }, ...ITEMS];
        shadowPart(element, '.fab').click();
        await element.updateComplete;

        const off = shadowPart(element, '[role="menuitemcheckbox"]');
        const action = shadowPart(element, '[role="menuitem"]');
        expect(off.getAttribute('aria-checked')).toBe('false');
        expect(getComputedStyle(off).borderTopWidth).toBe(getComputedStyle(action).borderTopWidth);
        element.items = [{ value: 'locate', label: 'Arată-mi locația', icon: 'my_location', checked: true }, ...ITEMS];
        await element.updateComplete;
        expect(getComputedStyle(off).borderTopWidth).toBe('3px');
        expect(getComputedStyle(action).borderTopWidth).toBe('0px');
    });
});

describe('<hcm-fab-menu> on iOS Safari, which never focuses a tapped button', () => {
    afterEach(cleanup);

    it('badPath_aTapOnTheCloseFabThatBlursTheItemToNothingClosesTheMenu', async () => {
        // iOS Safari never focuses a tapped button: the item blurred to nothing, focusout closed the menu and the tap's
        // click opened it again (the owner, 2026-11-15; lesson 740).
        const element = await menu();
        const toggles = recordEvents(element, 'hcm-toggle');
        const fab = shadowPart(element, '.fab');
        fab.click();
        await element.updateComplete;
        shadowPart(element, '[role="menuitem"]').focus();

        fab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        (deepFocus() as HTMLElement).blur();
        fab.click();
        await element.updateComplete;

        expect(toggles).toEqual([{ open: true }, { open: false }]);
        expect(element.shadowRoot?.querySelector('[role="menu"]')).toBeNull();
    });

    it('badPath_aCancelledPressOnTheFabNoLongerKeepsTheMenuOpen', async () => {
        const element = await menu();
        const fab = shadowPart(element, '.fab');
        fab.click();
        await element.updateComplete;
        shadowPart(element, '[role="menuitem"]').focus();

        fab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        fab.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, composed: true }));
        part(document, '#outside').focus();
        await element.updateComplete;

        expect(element.open).toBe(false);
    });
});
