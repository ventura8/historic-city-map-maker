/** The update controller's Layers hint on its own (`viewer-update.ts`): offered before any newer build, it opens Layers. */
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ViewerState } from '../../src/viewer/store-port.js';
import { toastDock, ViewerUpdates, type UpdateHost } from '../../src/viewer/viewer-update.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

function host(state: ViewerState | null, root: HTMLElement): UpdateHost & { updates: number } {
    const fake = {
        updates: 0,
        viewState: state,
        mapMenu: null,
        renderRoot: root,
        addController: vi.fn(),
        removeController: vi.fn(),
        requestUpdate: () => {
            fake.updates += 1;
        },
        updateComplete: Promise.resolve(true),
    };
    return fake;
}

afterEach(() => {
    localStorage.removeItem('hcm.layersHint.seen');
    document.body.replaceChildren();
});

describe('the update controller and the Layers hint', () => {
    it('happyPath_beforeANewerBuildOnlyTheHintShows_andItsOpenSelectsLayers', () => {
        localStorage.removeItem('hcm.layersHint.seen');
        const root = document.createElement('div');
        const menu = document.createElement('hcm-fab-menu');
        const selected = vi.fn();
        menu.addEventListener('hcm-select', (event) => {
            selected((event as CustomEvent<{ value: string }>).detail.value);
        });
        root.append(menu);
        const fake = host(readyState(testManifest(), { webgl: true, windowClass: 'compact' }), root);
        const updates = new ViewerUpdates(fake);

        const offer = updates.offer();
        expect(offer?.hintOnly).toBe(true);
        const dock = document.createElement('div');
        render(toastDock('en', null, vi.fn(), offer), dock);
        expect(dock.querySelector('hcm-snackbar[data-layout-check="layers-hint"]')).not.toBeNull();
        expect(dock.querySelector('hcm-snackbar[data-layout-check="update"]')).toBeNull();

        offer?.layersHint?.onOpen();
        expect(selected).toHaveBeenCalledWith('layers');
        expect(fake.updates).toBeGreaterThan(0);
    });

    it('badPath_noStateNoOffer_andDisconnectingBeforeConnectingIsHarmless', () => {
        const updates = new ViewerUpdates(host(null, document.createElement('div')));

        expect(updates.offer()).toBeNull();
        expect(() => {
            updates.hostDisconnected();
        }).not.toThrow();
    });
});
