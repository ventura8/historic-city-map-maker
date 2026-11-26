import type { Photo } from '@hcm/shared';
import { render } from 'lit';
import { describe, expect, it, vi } from 'vitest';

import { nearYearChip, textChip } from '../../src/viewer/viewer-near-year.js';

const PHOTOS = [{ year: 1966 } as Photo];

function rendered(wide: boolean, year: number | null, onNearYear = vi.fn()): HTMLElement {
    const host = document.createElement('div');
    render(nearYearChip({ locale: 'en', wide }, year, PHOTOS, onNearYear), host);
    return host;
}

describe('the photos near the year', () => {
    it('happyPath_onlyAnExpandedOrWiderWindowThatIsNotShortMayShowTheText', () => {
        // The owner, 2026-11-13: phones and tablets get the icon button.
        expect(textChip('expanded', false)).toBe(true);
        expect(textChip('large', false)).toBe(true);
        expect(textChip('extra-large', false)).toBe(true);
        expect(textChip('medium', false)).toBe(false);
        expect(textChip('compact', false)).toBe(false);
        expect(textChip('large', true)).toBe(false);
    });

    it('happyPath_aNarrowWindowGetsTheIconButtonNamedInFull', () => {
        const onNearYear = vi.fn();
        const host = rendered(false, 1966, onNearYear);
        const icon = host.querySelector('hcm-icon-button') as HTMLElement & { label: string };

        expect(host.querySelector('hcm-button')).toBeNull();
        expect(icon.label).toBe('Photos from around 1966');
        expect(icon.title).toBe('Photos from around 1966');
        icon.click();
        expect(onNearYear).toHaveBeenCalledOnce();
    });

    it('happyPath_aLargeWindowUnderAMouseGetsTheTextChip', () => {
        const onNearYear = vi.fn();
        const host = rendered(true, 1966, onNearYear);

        expect(host.querySelector('.dock.chip > hcm-button')?.textContent).toContain('Photos from around 1966');
        expect(host.querySelector('hcm-icon-button')).toBeNull();
        (host.querySelector('hcm-button') as HTMLElement).click();
        expect(onNearYear).toHaveBeenCalledOnce();
    });

    it('badPath_todayOrAYearWithoutPhotosShowsNothing', () => {
        expect(rendered(true, null).querySelector('.dock')).toBeNull();
        expect(rendered(false, 1900).querySelector('.dock')).toBeNull();
    });
});
