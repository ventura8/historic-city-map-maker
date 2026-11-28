import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { deepActiveElement } from '../../src/components/focus.js';
import { shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { EXPANDED, mountViewer, part } from './viewer-harness.js';

describe('year pill and its date panel', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_enterKeepsThePillFocusedAndAPickComesToTheFront', async () => {
        const manifest = testManifest((raw) => {
            const layers = raw['layers'] as Record<string, unknown>[];
            layers.push({ ...layers[1], id: 'kh4-1966b', date: '1966-09-03', order: 3 });
        });
        const mounted = await mountViewer(readyState(manifest, { year: 1966 }), EXPANDED);
        const thumb = shadowQuery(part(mounted, 'hcm-timeline'), '.thumb');
        thumb.focus();
        thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));

        await expect.element(page.getByRole('menu', { name: 'Datele din 1966' })).toBeVisible();
        expect(part(mounted, '.frame').inert).toBe(false);
        expect(deepActiveElement()).toBe(thumb);
        const menu = part(mounted, 'hcm-date-menu');
        shadowQuery(menu, '[data-item="kh4-1966"]').click();
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([['kh4-1966']]);
        expect(part(mounted, 'hcm-date-menu'), 'a pick keeps the menu open').not.toBeNull();
        shadowQuery(menu, '[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
        await vi.waitFor(() => {
            expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
        });
    });
});
