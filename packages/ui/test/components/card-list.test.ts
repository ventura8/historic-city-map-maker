import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmCard, type HcmCard } from '../../src/components/card.js';
import { defineHcmList, type HcmList, type HcmListItem } from '../../src/components/list.js';
import { cleanup, fixture, part, recordEvents, shadowPart } from '../helpers.js';

defineHcmCard();
defineHcmList();

describe('<hcm-card>', () => {
    afterEach(cleanup);

    it.each(['elevated', 'filled', 'outlined'] as const)('happyPath_variant_%s_rendersItsSlots', async (variant) => {
        const card = await fixture<HcmCard>(
            html`<hcm-card variant=${variant}
                ><span slot="headline">Eroare</span>Manifestul nu a putut fi încărcat.<button slot="actions">Reîncearcă</button></hcm-card
            >`,
        );

        await expect.element(page.getByText('Eroare')).toBeVisible();
        await expect.element(page.getByRole('button', { name: 'Reîncearcă' })).toBeVisible();
        expect(shadowPart(card, '.card')).toBeTruthy();
        expect(await axeViolations(card)).toEqual([]);
    });
});

describe('<hcm-list> and <hcm-list-item>', () => {
    afterEach(cleanup);

    it('happyPath_listSemanticsAndSupportingText', async () => {
        const list = await fixture<HcmList>(
            html`<hcm-list
                ><hcm-list-item headline="Strada Uranus" supporting-text="1978"></hcm-list-item
                ><hcm-list-item headline="Mihai Vodă"></hcm-list-item
            ></hcm-list>`,
        );

        const first = part(list, 'hcm-list-item') as HcmListItem;

        expect(list.getAttribute('role')).toBe('list');
        expect(shadowPart(first, '.text').textContent.replaceAll(/\s+/g, ' ').trim()).toBe('Strada Uranus 1978');
        expect(page.getByRole('listitem').all()).toHaveLength(2);
        expect(await axeViolations(list)).toEqual([]);
    });

    it('happyPath_anInteractiveItemIsAButton', async () => {
        const list = await fixture<HcmList>(
            html`<hcm-list role="menu"><hcm-list-item interactive headline="Open"></hcm-list-item></hcm-list>`,
        );
        const item = part(list, 'hcm-list-item') as HcmListItem;
        const clicks = recordEvents(item, 'click');

        await userEvent.click(page.getByRole('button', { name: 'Open' }));

        expect(clicks).toHaveLength(1);
        expect(list.getAttribute('role')).toBe('menu');
    });

    it('badPath_anExistingRoleIsKept', async () => {
        const item = await fixture<HcmListItem>(html`<hcm-list-item role="option" headline="A"></hcm-list-item>`);

        expect(item.getAttribute('role')).toBe('option');
        expect(item.shadowRoot?.querySelector('button')).toBeNull();
        expect(item.shadowRoot?.querySelector('.supporting')).toBeNull();
    });
});
