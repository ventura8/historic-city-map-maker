import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    defineHcmPhotosControl,
    HCM_PHOTOS_CONTROL_TAG,
    LONG_PRESS_MS,
    type HcmPhotosControl,
} from '../../src/viewer/hcm-photos-control.js';
import { defineKitDoubles, fireKitEvent, mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

async function control(properties: Partial<HcmPhotosControl> = {}): Promise<HcmPhotosControl> {
    return mountElement<HcmPhotosControl>(HCM_PHOTOS_CONTROL_TAG, { locale: 'en', ...properties });
}

/** The radios of the popover's segmented button `name` (`scope` or `window`). */
function radios(element: HcmPhotosControl, name: string): HTMLElement[] {
    return shadowQueryAll(shadowQuery(element, `hcm-segmented-button.${name}`), '[role="radio"]');
}

function checked(radio: HTMLElement | undefined): boolean {
    return radio?.getAttribute('aria-checked') === 'true';
}

describe('<hcm-photos-control> (design B)', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPhotosControl();
        defineHcmPhotosControl();
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('happyPath_theSwitchShowsOrHidesEveryPhoto', async () => {
        const element = await control();
        const events = recordEvents(document.body, 'hcm-overlay-visibility');

        fireKitEvent(shadowQuery(element, 'hcm-switch'), 'hcm-change', { checked: false });

        expect(events).toEqual([{ type: 'hcm-overlay-visibility', detail: { id: 'photos', visible: false } }]);
    });

    it('happyPath_theChevronOpensThePopoverAndAChoiceSetsTheScope', async () => {
        const element = await control();
        const chevron = shadowQuery(element, '.chevron');
        expect(chevron.getAttribute('aria-haspopup')).toBe('true');
        expect(chevron.getAttribute('aria-expanded')).toBe('false');
        expect(chevron.getAttribute('aria-label')).toBe('Photo options');
        const events = recordEvents(document.body, 'hcm-photos-near');

        chevron.click();
        await element.updateComplete;

        expect(chevron.getAttribute('aria-expanded')).toBe('true');
        expect(shadowQueryAll(element, 'hcm-segmented-button')).toHaveLength(2);
        expect(checked(radios(element, 'scope')[0])).toBe(true);
        expect(checked(radios(element, 'window')[1])).toBe(true);
        radios(element, 'scope')[1]?.click();
        radios(element, 'window')[2]?.click();
        radios(element, 'scope')[0]?.click();
        expect(events.map((event) => event.detail)).toEqual([{ near: 10 }, { near: 25 }, { near: null }]);

        chevron.click();
        await element.updateComplete;
        expect(element.open).toBe(false);
    });

    it('happyPath_nearYearShowsTheCalendarBadgeAndItsWindowChecked', async () => {
        const element = await control({ near: 5, open: true });

        expect(shadowQuery(element, '.badge').getAttribute('aria-label')).toBe('Only the photos within 5 years of the selected year');
        expect(checked(radios(element, 'scope')[1])).toBe(true);
        expect(checked(radios(element, 'window')[0])).toBe(true);
    });

    it('badPath_everyPhotoShowsNoBadge', async () => {
        const element = await control();

        expect(shadowQueryAll(element, '.badge')).toEqual([]);
        expect(shadowQueryAll(element, '.popover')).toEqual([]);
    });

    it('happyPath_arrowDownOnTheSwitchOrARightClickOpensItAndEscClosesIt', async () => {
        const element = await control();
        const other = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true });
        shadowQuery(element, 'hcm-switch').dispatchEvent(other);
        await element.updateComplete;
        expect(element.open).toBe(false);

        shadowQuery(element, 'hcm-switch').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));
        await element.updateComplete;
        expect(element.open).toBe(true);

        shadowQuery(element, '.popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(element.open).toBe(true);
        shadowQuery(element, '.popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await element.updateComplete;
        await element.updateComplete;
        expect(element.open).toBe(false);
        expect(element.shadowRoot?.activeElement).toBe(shadowQuery(element, '.chevron'));

        shadowQuery(element, '.row').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await element.updateComplete;
        expect(element.open).toBe(true);
    });

    it('happyPath_aLongPressOfAFingerOpensIt', async () => {
        vi.useFakeTimers();
        const element = await control();
        const row = shadowQuery(element, '.row');

        row.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
        vi.advanceTimersByTime(LONG_PRESS_MS);

        expect(element.open).toBe(true);
    });

    it('badPath_aShortTapAMouseOrALeavingElementOpensNothing', async () => {
        vi.useFakeTimers();
        const element = await control();
        const row = shadowQuery(element, '.row');

        row.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
        row.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
        row.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', bubbles: true }));
        row.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
        element.remove();
        vi.advanceTimersByTime(LONG_PRESS_MS);

        expect(element.open).toBe(false);
    });
});
