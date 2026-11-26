/**
 * Minimizing the extra-large Layers pane (the owner, 2026-11-08): the leading column goes, the map takes the whole width (batch 4,
 * the owner 2026-11-09: no rail) and one floating button on its leading edge brings the pane back; the photo open beside it stays. The store keeps it (`layersHidden`, for the session, not in the hash),
 * so the pane re-created when the window leaves the extra-large layout and comes back is still minimized.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineViewerElements } from '../../src/viewer/define.js';
import { defineKitDoubles } from './doubles.js';
import { readyState } from './fake-store.js';
import { EXTRA_LARGE, mountViewer, part, setBox, type Mounted } from './viewer-harness.js';

function width(mounted: Mounted, selector: string): number {
    return part(mounted, selector).getBoundingClientRect().width;
}

beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

describe('<hcm-map-viewer>: the minimized Layers pane', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_minimizingGivesTheMapThePaneAndRestoringTakesItBack', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);
        mounted.store.openPhoto('mihai-voda-1978');
        await mounted.element.updateComplete;
        const map = width(mounted, '.map-pane');
        const calls = mounted.store.calls.length;

        await page.getByRole('button', { name: 'Restrânge straturile' }).click();
        await expect.element(page.getByRole('button', { name: 'Straturi' })).toHaveAttribute('aria-expanded', 'false');

        expect(width(mounted, '.pane.leading')).toBe(0);
        expect(width(mounted, '.map-pane')).toBe(map + 360);
        const button = page.getByRole('button', { name: 'Straturi' }).element().getBoundingClientRect();
        const pane = part(mounted, '.map-pane').getBoundingClientRect();
        expect([button.left - pane.left, button.top - pane.top], 'floating on the map, at its leading gutter').toEqual([24, 24]);
        expect(button.height).toBeGreaterThanOrEqual(48);
        expect(mounted.store.getState().sheet).toBe('photo');
        // One store action (the photo sheet's own thumbnail timing aside): the minimized pane, which is no sheet.
        const actions = (): unknown => mounted.store.calls.slice(calls).filter((call) => call.method !== 'photoShown');
        expect(actions()).toEqual([{ method: 'setLayersHidden', args: [true] }]);

        await page.getByRole('button', { name: 'Straturi' }).click();
        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();

        expect(width(mounted, '.pane.leading')).toBe(360);
        expect(width(mounted, '.map-pane')).toBe(map);
        expect(mounted.store.getState().sheet).toBe('photo');
        expect(actions()).toEqual([
            { method: 'setLayersHidden', args: [true] },
            { method: 'setLayersHidden', args: [false] },
        ]);
    });

    it('badPath_leavingTheExtraLargeLayoutAndComingBackKeepsThePaneMinimized', async () => {
        const mounted = await mountViewer(readyState(), EXTRA_LARGE);
        await page.getByRole('button', { name: 'Restrânge straturile' }).click();
        await expect.element(page.getByRole('button', { name: 'Straturi' })).toHaveAttribute('aria-expanded', 'false');

        setBox(mounted.element, { width: 1300, height: 800 });
        await vi.waitFor(() => {
            expect(mounted.element.shadowRoot?.querySelector('.pane.leading')).toBeNull();
        });
        setBox(mounted.element, EXTRA_LARGE);

        await expect.element(page.getByRole('button', { name: 'Straturi' })).toHaveAttribute('aria-expanded', 'false');
        expect(width(mounted, '.pane.leading')).toBe(0);
        expect(mounted.store.getState().layersHidden).toBe(true);
    });
});
