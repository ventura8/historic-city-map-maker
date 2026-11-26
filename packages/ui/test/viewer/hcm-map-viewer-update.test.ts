/**
 * The map keeps itself up to date (`packages/ui/src/viewer/viewer-update.ts`, `../../src/app-update.ts`): the viewer holds
 * the page script's reload while a dialog, the full-size view, swipe compare or the map's menu is open, and shows "A new
 * version of the map is ready" with Reload while a newer build waits; closing the snackbar hides it.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { reloadHeld } from '../../src/viewer/viewer-update.js';
import { fireKitEvent, shadowQueryAll } from './doubles.js';
import { readyState } from './fake-store.js';
import { mountViewer } from './viewer-harness.js';

interface FakeApp {
    updateReady: boolean;
    held: (() => boolean) | null;
    reloads: number;
    holdReload(held: () => boolean): () => void;
    reload(): void;
}

function fakeApp(): FakeApp {
    const app: FakeApp = {
        updateReady: false,
        held: null,
        reloads: 0,
        holdReload: (held) => {
            app.held = held;
            return () => {
                app.held = null;
            };
        },
        reload: () => {
            app.reloads += 1;
        },
    };
    return app;
}

function updateBars(element: HTMLElement): HTMLElement[] {
    return shadowQueryAll(element, 'hcm-snackbar[data-layout-check="update"]');
}

/** The one update snackbar; fails the test when there is none. */
function updateBar(element: HTMLElement): HTMLElement {
    const [bar] = updateBars(element);
    if (bar === undefined) {
        throw new Error('no update snackbar');
    }
    return bar;
}

afterEach(() => {
    document.body.replaceChildren();
    delete window.HistoricCityMapApp;
});

describe('<hcm-map-viewer>: a newer build', () => {
    it('happyPath_theSnackbarOffersReload_andItsActionReloadsThroughThePageScript', async () => {
        const app = fakeApp();
        window.HistoricCityMapApp = app;
        const { element } = await mountViewer();
        expect(updateBars(element)).toEqual([]);
        expect(app.held?.()).toBe(false);

        app.updateReady = true;
        window.dispatchEvent(new Event('hcm-update-ready'));
        await element.updateComplete;
        const bar = updateBar(element);
        expect(bar.getAttribute('timeout-ms')).toBe('0');
        expect((bar as unknown as { message: string }).message).toBe(
            'O versiune nouă a hărții este gata. Reîncărcați pagina ca să o folosiți; harta se deschide unde sunteți.',
        );
        fireKitEvent(bar, 'hcm-action');

        expect(app.reloads).toBe(1);
    });

    it('badPath_closingTheSnackbarHidesIt_andDisconnectingLetsTheHoldGo', async () => {
        const app = fakeApp();
        window.HistoricCityMapApp = app;
        app.updateReady = true;
        const { element } = await mountViewer();
        fireKitEvent(updateBar(element), 'hcm-dismiss', { reason: 'close' });
        await element.updateComplete;

        expect(updateBars(element)).toEqual([]);
        element.remove();
        expect(app.held).toBeNull();
    });
});

describe('reloadHeld', () => {
    it.each([
        ['the full-size view', { lightbox: true }],
        ['swipe compare', { compare: { layerId: null, position: 0.5 } }],
        ['Settings', { sheet: 'settings' as const }],
        ['About', { sheet: 'about' as const }],
    ])('badPath_%s_holdsTheReload', (_name, change) => {
        expect(reloadHeld({ ...readyState(), ...change }, null)).toBe(true);
    });

    it('badPath_theMapsMenuHoldsTheReload', () => {
        expect(reloadHeld(readyState(), { x: 1, y: 2, lngLat: [26.1, 44.4] } as never)).toBe(true);
    });

    it('happyPath_theMapAloneOrNoStateLetsItReload', () => {
        expect(reloadHeld(readyState(), null)).toBe(false);
        expect(reloadHeld({ ...readyState(), sheet: 'photo' }, null)).toBe(false);
        expect(reloadHeld(null, null)).toBe(false);
    });
});
