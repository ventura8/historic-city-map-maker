import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmOverlayList, type HcmOverlayList, type OverlayListItem } from '../../src/components/overlay-list.js';
import { cleanup, fixture, recordEvents } from '../helpers.js';

defineHcmOverlayList();

const RIVERS: OverlayListItem = {
    id: 'old-rivers',
    kind: 'poi',
    label: 'Cursuri vechi',
    visible: true,
    opacity: 1,
    subgroups: [
        { id: 'lines', label: 'Linii', visible: true },
        { id: 'poduri', label: 'poduri', visible: false },
    ],
    expandLabel: 'Grupurile din Cursuri vechi',
    mixed: true,
};

async function list(items: readonly OverlayListItem[]): Promise<HcmOverlayList> {
    localStorage.removeItem('hcm.layerPanel.groupsOpen');
    return fixture<HcmOverlayList>(html`<hcm-overlay-list .items=${items} toggleLabel="Arată {name}"></hcm-overlay-list>`);
}

describe('<hcm-overlay-list> sub-groups of a place category', () => {
    afterEach(cleanup);

    it('happyPath_theChevronOpensOneSwitchPerGroupAndASwitchSendsItsGroup', async () => {
        const element = await list([RIVERS]);
        const chevron = element.shadowRoot?.querySelector<HTMLButtonElement>('.subgroups-toggle');
        expect(chevron?.getAttribute('aria-expanded')).toBe('false');
        expect(chevron?.getAttribute('aria-label')).toBe('Grupurile din Cursuri vechi');
        expect(element.shadowRoot?.querySelector('[data-overlay="old-rivers"] > hcm-switch')?.hasAttribute('data-mixed')).toBe(true);

        chevron?.click();
        await element.updateComplete;
        expect(chevron?.getAttribute('aria-expanded')).toBe('true');
        const rows = [...(element.shadowRoot?.querySelectorAll<HTMLElement>('.subgroup') ?? [])];
        expect(rows.map((row) => row.dataset['group'])).toEqual(['lines', 'poduri']);

        const events = recordEvents(element, 'hcm-overlay-group');
        rows[1]?.querySelector('hcm-switch')?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        expect(events).toEqual([{ id: 'old-rivers', group: 'poduri', visible: true }]);
        expect(localStorage.getItem('hcm.layerPanel.groupsOpen')).toBe('["old-rivers"]');
        chevron?.click();
    });

    it('badPath_aCategoryOfOneGroupHasNoChevron', async () => {
        const element = await list([{ ...RIVERS, subgroups: [{ id: 'lines', label: 'Linii', visible: true }], mixed: false }]);
        expect(element.shadowRoot?.querySelector('.subgroups-toggle')).toBeNull();
        expect(element.shadowRoot?.querySelector('[data-overlay="old-rivers"] > hcm-switch')?.hasAttribute('data-mixed')).toBe(false);
    });
});
