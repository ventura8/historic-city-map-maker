/** Edges of small viewer pieces: no levels, the locate item's default, no hint, sub-groups without a name or a list. */
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readOpen, renderSubgroups } from '../../src/components/overlay-subgroups.js';
import { layersHintSnackbar } from '../../src/viewer/layers-hint.js';
import { planItems } from '../../src/viewer/place-plans.js';
import { menuItem } from '../../src/viewer/viewer-menu.js';

function rendered(template: Parameters<typeof render>[0]): HTMLElement {
    const host = document.createElement('div');
    render(template, host);
    return host;
}

const host = Object.assign(document.createElement('div'), { requestUpdate: vi.fn() });

afterEach(() => {
    localStorage.removeItem('hcm.layerPanel.groupsOpen');
});

describe('small viewer pieces', () => {
    it('happyPath_theLocateItemIsAnUncheckedSwitchByDefault_andSubgroupsFallBackToTheRowsId', () => {
        expect(menuItem('locate', 'en')).toMatchObject({ value: 'locate', checked: false });
        const groups = [
            { id: 'a', label: 'A', visible: true },
            { id: 'b', label: 'B', visible: false },
        ];
        const row = rendered(renderSubgroups(host, { id: 'row-1', subgroups: groups }, (name) => name));
        expect(row.querySelector('button')?.getAttribute('aria-label')).toBe('row-1');
    });

    it('badPath_noLevelsNoHintNoSubgroupsRenderNothing', () => {
        const plans = rendered(planItems({ levels: [], chosen: null, locale: 'en', choose: vi.fn(), plan: vi.fn(), photo: vi.fn() }));
        expect(plans.querySelector('fieldset')).toBeNull();
        expect(rendered(layersHintSnackbar('en', undefined)).querySelector('hcm-snackbar')).toBeNull();
        expect(rendered(renderSubgroups(host, { id: 'row-2' }, (name) => name)).querySelector('button')).toBeNull();
    });

    it('badPath_rememberedGroupsThatAreNotAListOrNotNamesAreIgnored', () => {
        localStorage.setItem('hcm.layerPanel.groupsOpen', '{"row-3":true}');
        expect([...readOpen()]).toEqual([]);

        localStorage.setItem('hcm.layerPanel.groupsOpen', '[1, "row-4"]');
        expect([...readOpen()]).toEqual(['row-4']);

        localStorage.setItem('hcm.layerPanel.groupsOpen', '{not json');
        expect([...readOpen()]).toEqual([]);
    });
});
