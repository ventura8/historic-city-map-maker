/** Edges of small viewer pieces: no levels, the locate item's default, no hint, sub-groups without a name or a list. */
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as subgroupsModule from '../../src/components/overlay-subgroups.js';
import { renderSubgroups } from '../../src/components/overlay-subgroups.js';

type Subgroups = typeof subgroupsModule;
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
    vi.resetModules();
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

    it('badPath_rememberedGroupsThatAreNotAListOrNotNamesAreIgnored', async () => {
        localStorage.setItem('hcm.layerPanel.groupsOpen', '{"row-3":true}');
        const fresh = (await import('../../src/components/overlay-subgroups.js?object')) as Subgroups;
        const groups = [
            { id: 'a', label: 'A', visible: true },
            { id: 'b', label: 'B', visible: true },
        ];
        const closed = rendered(fresh.renderSubgroups(host, { id: 'row-3', subgroups: groups }, (name) => name));
        expect(closed.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');

        localStorage.setItem('hcm.layerPanel.groupsOpen', '[1, "row-4"]');
        const mixed = (await import('../../src/components/overlay-subgroups.js?mixed')) as Subgroups;
        const open = rendered(mixed.renderSubgroups(host, { id: 'row-4', subgroups: groups }, (name) => name));
        expect(open.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    });
});
