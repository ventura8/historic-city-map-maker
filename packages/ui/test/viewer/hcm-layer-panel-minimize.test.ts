/**
 * The extra-large Layers pane minimizes to one floating button on the map's leading edge and comes back (the owner, 2026-11-08): the close
 * button minimizes instead of closing, and says so (its name, `aria-expanded`), that button restores, each tells
 * the viewer (`hcm-layers-minimize`, kept in the store), the focus follows both ways, and the switches and sliders, which
 * are the store's, come back as they were.
 */
import { overlaysFromManifest, withOverlayVisibility } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { deepActiveElement } from '../../src/components/focus.js';
import { HCM_LAYER_PANEL_TAG, defineHcmLayerPanel, type HcmLayerPanel } from '../../src/viewer/hcm-layer-panel.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery } from './doubles.js';
import { testManifest } from './fixtures.js';

async function pane(properties: Partial<HcmLayerPanel> = {}): Promise<HcmLayerPanel> {
    const manifest = testManifest();
    return mountElement<HcmLayerPanel>(HCM_LAYER_PANEL_TAG, {
        manifest,
        overlays: overlaysFromManifest(manifest),
        mode: 'docked',
        open: true,
        minimizable: true,
        ...properties,
    });
}

/** Each overlay's id, switch and slider as the kit list was given them. */
function listed(element: HcmLayerPanel): unknown {
    const list = shadowQuery(element, 'hcm-overlay-list') as HTMLElement & {
        items: readonly { id: string; visible: boolean; opacity: number }[];
    };
    return list.items.map(({ id, visible, opacity }) => [id, visible, opacity]);
}

describe('<hcm-layer-panel>: minimize to one button', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLayerPanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_closeMinimizesToARailWhoseButtonRestoresThePane', async () => {
        const element = await pane();
        const events = recordEvents(element, 'hcm-close');
        const minimized = recordEvents(element, 'hcm-layers-minimize');
        const collapse = page.getByRole('button', { name: 'Restrânge straturile' });
        await expect.element(collapse).toHaveAttribute('aria-expanded', 'true');

        await collapse.click();
        await element.updateComplete;

        expect(element.minimized).toBe(true);
        expect(element.hasAttribute('minimized')).toBe(true);
        expect(events).toEqual([]);
        expect(minimized.map((event) => event.detail)).toEqual([{ minimized: true }]);
        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).toBeNull();
        const rail = page.getByRole('button', { name: 'Straturi' });
        await expect.element(rail).toHaveAttribute('aria-expanded', 'false');
        expect(deepActiveElement()?.textContent.trim()).toBe('Straturi');

        await rail.click();
        await element.updateComplete;

        expect(element.minimized).toBe(false);
        expect(element.hasAttribute('minimized')).toBe(false);
        expect(minimized.map((event) => event.detail)).toEqual([{ minimized: true }, { minimized: false }]);
        await expect.element(page.getByRole('heading', { name: 'Straturi' })).toBeVisible();
        expect(deepActiveElement()?.getAttribute('aria-label')).toBe('Restrânge straturile');
    });

    it('happyPath_theButtonAndItsCollapseSpeakEnglish_noRail', async () => {
        const element = await pane({ locale: 'en' });
        await expect.element(page.getByRole('button', { name: 'Collapse layers' })).toHaveAttribute('aria-expanded', 'true');

        element.minimized = true;

        await expect.element(page.getByRole('button', { name: 'Layers' })).toHaveAttribute('aria-expanded', 'false');
        expect(element.shadowRoot?.querySelector('section')).toBeNull();
    });

    it('badPath_minimizingLosesNoSwitchOrSlider', async () => {
        const manifest = testManifest();
        const overlays = withOverlayVisibility(overlaysFromManifest(manifest), 'kh9-1977', true);
        const element = await pane({ overlays });
        const before = listed(element);

        element.minimized = true;
        await element.updateComplete;
        element.minimized = false;
        await element.updateComplete;

        expect(listed(element)).toEqual(before);
    });

    it('badPath_aPaneThatIsNotMinimizableClosesAsBefore', async () => {
        const element = await pane({ minimizable: false, minimized: true });
        const events = recordEvents(element, 'hcm-close');
        const minimized = recordEvents(element, 'hcm-layers-minimize');
        const close = page.getByRole('button', { name: 'Închide' });
        await expect.element(close).not.toHaveAttribute('aria-expanded');

        await close.click();

        expect(events).toHaveLength(1);
        expect(minimized).toEqual([]);
        expect(element.shadowRoot?.querySelector('hcm-overlay-list')).not.toBeNull();
    });
});
