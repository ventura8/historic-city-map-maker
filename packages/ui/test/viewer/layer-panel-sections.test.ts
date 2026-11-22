import { overlaysFromManifest } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HCM_LAYER_PANEL_TAG, defineHcmLayerPanel, type HcmLayerPanel } from '../../src/viewer/hcm-layer-panel.js';
import { DEFAULT_SECTIONS, SECTIONS_STORAGE_KEY, loadSections, saveSections } from '../../src/viewer/layer-panel-sections.js';
import { defineKitDoubles, mountElement, shadowQuery, shadowQueryAll } from './doubles.js';
import { testManifest } from './fixtures.js';

async function panel(): Promise<HcmLayerPanel> {
    // The first layer a map, the second a satellite photo: one in Layers, one in Aerial and satellite photos.
    const manifest = testManifest((raw) => {
        const layers = raw['layers'] as Record<string, unknown>[];
        for (const layer of layers.slice(0, 1)) {
            layer['kind'] = 'map';
        }
    });
    return mountElement<HcmLayerPanel>(HCM_LAYER_PANEL_TAG, {
        manifest,
        overlays: overlaysFromManifest(manifest),
        open: true,
        locale: 'en',
        canCompare: true,
    });
}

function toggle(element: HcmLayerPanel, id: string): HTMLButtonElement {
    return shadowQuery(element, `[data-section="${id}"] .section-toggle`) as HTMLButtonElement;
}

function body(element: HcmLayerPanel, id: string): HTMLElement {
    return shadowQuery(element, `#section-${id}`);
}

beforeAll(() => {
    defineKitDoubles();
    defineHcmLayerPanel();
});

afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(SECTIONS_STORAGE_KEY);
    document.body.replaceChildren();
});

describe('layer panel sections', () => {
    it('happyPath_pinnedThenPlacesThenLayers_layersCollapsedByDefault', async () => {
        const element = await panel();
        const order = shadowQueryAll(element, '[data-section]').map((section) => section.dataset['section']);
        expect(order).toEqual(['pinned', 'places', 'layers', 'aerial']);
        expect(toggle(element, 'pinned').getAttribute('aria-expanded')).toBe('true');
        expect(toggle(element, 'places').getAttribute('aria-expanded')).toBe('true');
        expect(toggle(element, 'layers').getAttribute('aria-expanded')).toBe('false');
        expect(body(element, 'layers').hidden).toBe(true);
        expect(toggle(element, 'aerial').getAttribute('aria-expanded')).toBe('false');
        expect(toggle(element, 'aerial').textContent).toContain('Aerial and satellite photos');
        expect(toggle(element, 'layers').getAttribute('aria-controls')).toBe('section-layers');
        expect(toggle(element, 'layers').textContent).toContain('Historical layers');
    });

    it('happyPath_headerButtonExpandsAndCollapses_andIsRemembered', async () => {
        const element = await panel();
        toggle(element, 'layers').click();
        await element.updateComplete;
        expect(toggle(element, 'layers').getAttribute('aria-expanded')).toBe('true');
        expect(body(element, 'layers').hidden).toBe(false);
        expect(shadowQuery(element, '[data-section="layers"] hcm-icon').getAttribute('name')).toBe('expand_less');
        toggle(element, 'places').click();
        await element.updateComplete;
        expect(body(element, 'places').hidden).toBe(true);
        expect(loadSections()).toEqual({ pinned: true, places: false, layers: true, aerial: false });
        document.body.replaceChildren();
        const again = await panel();
        expect(toggle(again, 'layers').getAttribute('aria-expanded')).toBe('true');
        expect(toggle(again, 'places').getAttribute('aria-expanded')).toBe('false');
    });

    it('happyPath_aNewTimelineYearExpandsTheLayers', async () => {
        const element = await panel();
        element.year = 1977;
        await element.updateComplete;
        await element.updateComplete;
        expect(toggle(element, 'layers').getAttribute('aria-expanded')).toBe('true');
        expect(toggle(element, 'aerial').getAttribute('aria-expanded')).toBe('true');
    });

    it('happyPath_switchesAreCompact', async () => {
        const element = await panel();
        element.labels = { shown: { streets: true, pois: false }, available: ['streets'] };
        await element.updateComplete;
        expect(shadowQuery(element, 'hcm-switch').hasAttribute('compact')).toBe(true);
    });

    it('badPath_unreadableOrBlockedStorage_fallsBackToTheDefaults', () => {
        localStorage.setItem(SECTIONS_STORAGE_KEY, '{not json');
        expect(loadSections()).toEqual(DEFAULT_SECTIONS);
        localStorage.setItem(SECTIONS_STORAGE_KEY, '42');
        expect(loadSections()).toEqual(DEFAULT_SECTIONS);
        localStorage.setItem(SECTIONS_STORAGE_KEY, '{"layers":"yes","places":false}');
        expect(loadSections()).toEqual({ pinned: true, places: false, layers: false, aerial: false });
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(loadSections()).toEqual(DEFAULT_SECTIONS);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota');
        });
        expect(() => {
            saveSections(DEFAULT_SECTIONS);
        }).not.toThrow();
    });

    it('badPath_noLocalStorageAtAll_stillWorks', () => {
        vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(loadSections()).toEqual(DEFAULT_SECTIONS);
        expect(() => {
            saveSections(DEFAULT_SECTIONS);
        }).not.toThrow();
    });
});
