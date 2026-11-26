import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { applyTheme } from '../../src/theme/apply.js';
import { HCM_LIGHTBOX_TAG, HcmLightbox, defineHcmLightbox } from '../../src/viewer/hcm-lightbox.js';
import { VIEWER_BASELINE } from '../../src/viewer/viewer-baseline.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

async function lightbox(properties: Partial<HcmLightbox> = {}): Promise<HcmLightbox> {
    const element = await mountElement<HcmLightbox>(HCM_LIGHTBOX_TAG, {
        photos: MANIFEST.photos,
        photoId: 'uranus-1984',
        open: true,
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
    await element.updateComplete;
    return element;
}

function press(element: HcmLightbox, key: string): void {
    shadowQuery(element, '[role="dialog"]').dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
    );
}

function pointer(element: HcmLightbox, type: string, pointerId: number, x: number, y: number): void {
    shadowQuery(element, '.stage').dispatchEvent(
        new PointerEvent(type, { pointerId, clientX: x, clientY: y, bubbles: true, composed: true }),
    );
}

describe('<hcm-lightbox>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFocusedModalDialogWithThePhotoAndItsPosition', async () => {
        const element = await lightbox();

        const dialog = page.getByRole('dialog', { name: 'Fotografie mărită' });
        await expect.element(dialog).toHaveAttribute('aria-modal', 'true');
        expect(element.shadowRoot?.activeElement?.getAttribute('role')).toBe('dialog');
        expect(shadowText(element)).toContain('Strada Uranus');
        expect(shadowText(element)).toContain('2 din 3');
        const image = shadowQuery(element, 'img') as HTMLImageElement;
        expect(image.alt).toBe('Strada Uranus');
        expect(image.getAttribute('src')).toBe(`${location.origin}/seed/bucharest/derived/uranus-colt-mihai-voda/web.webp`);
    });

    it('happyPath_arrowsAndButtonsStepThroughThePhotos', async () => {
        const element = await lightbox({ locale: 'en' });
        const events = recordEvents(element, 'hcm-photo-select');

        press(element, 'ArrowLeft');
        press(element, 'ArrowRight');
        await page.getByRole('button', { name: 'Next photo' }).click();
        await page.getByRole('button', { name: 'Previous photo' }).click();

        expect(events.map((event) => event.detail)).toEqual([
            { photoId: 'mihai-voda-1978' },
            { photoId: 'fara-an' },
            { photoId: 'fara-an' },
            { photoId: 'mihai-voda-1978' },
        ]);
        expect(shadowText(element)).toContain('2 of 3');
    });

    it('badPath_noStepPastTheFirstOrLastPhoto', async () => {
        const element = await lightbox({ photoId: 'mihai-voda-1978' });
        const events = recordEvents(element, 'hcm-photo-select');

        press(element, 'ArrowLeft');
        await expect.element(page.getByRole('button', { name: 'Fotografia anterioară' })).toBeDisabled();

        element.photoId = 'fara-an';
        await element.updateComplete;
        press(element, 'ArrowRight');
        await expect.element(page.getByRole('button', { name: 'Fotografia următoare' })).toBeDisabled();

        expect(events).toEqual([]);
    });

    it('happyPath_escapeAndTheCloseButtonClose', async () => {
        const element = await lightbox();
        const events = recordEvents(element, 'hcm-close');

        press(element, 'Escape');
        await page.getByRole('button', { name: 'Închide' }).click();

        expect(events).toHaveLength(2);
    });

    it('happyPath_keysWheelPinchAndDragZoomAndPan', async () => {
        const element = await lightbox();

        press(element, '+');
        press(element, '=');
        expect(element.zoom.scale).toBeCloseTo(1.5625);
        press(element, '-');
        expect(element.zoom.scale).toBeCloseTo(1.25);
        press(element, '0');
        expect(element.zoom.scale).toBe(1);

        const wheel = new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true, composed: true });
        shadowQuery(element, '.stage').dispatchEvent(wheel);
        expect(wheel.defaultPrevented).toBe(true);
        expect(element.zoom.scale).toBeGreaterThan(1.4);

        pointer(element, 'pointerdown', 1, 100, 100);
        pointer(element, 'pointermove', 1, 140, 100);
        expect(element.zoom.offset.x).toBeGreaterThan(0);
        pointer(element, 'pointerdown', 2, 200, 100);
        pointer(element, 'pointermove', 2, 340, 100);
        expect(element.zoom.scale).toBeGreaterThan(2);
        pointer(element, 'pointerup', 2, 340, 100);
        pointer(element, 'pointercancel', 1, 140, 100);
        pointer(element, 'pointermove', 1, 400, 400);

        const style = (shadowQuery(element, 'img') as HTMLImageElement).style.transform;
        expect(style).toContain('scale(');
        expect(style).toContain('translate(');
    });

    it('badPath_otherKeysAndStrayPointersChangeNothing', async () => {
        const element = await lightbox();

        press(element, 'a');
        pointer(element, 'pointermove', 7, 10, 10);

        expect(element.zoom).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    });

    it('badPath_aBrokenImageShowsAnErrorAndCloseStillWorks', async () => {
        const element = await lightbox({ photoId: 'fara-an', locale: 'en' });
        const events = recordEvents(element, 'hcm-close');

        shadowQuery(element, 'img').dispatchEvent(new Event('error'));
        await element.updateComplete;

        await expect.element(page.getByRole('alert')).toHaveTextContent('The image could not be loaded.');
        press(element, 'Escape');
        expect(events).toHaveLength(1);

        element.photoId = 'uranus-1984';
        await element.updateComplete;
        expect(element.failed).toBe(false);
    });

    it('badPath_closedOrUnknownPhotoRendersNothing', async () => {
        const closed = await lightbox({ open: false });
        expect(closed.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();

        const unknown = await lightbox({ photoId: 'nu-exista' });
        expect(unknown.shadowRoot?.querySelector('[role="dialog"]')).toBeNull();
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmLightbox();

        expect(customElements.get(HCM_LIGHTBOX_TAG)).toBe(HcmLightbox);
    });
});

describe('<hcm-lightbox> double tap', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aDoubleTapZoomsInAtThePointAndASecondOneZoomsBackOut', async () => {
        const element = await lightbox();
        const stage = shadowQuery(element, '.stage').getBoundingClientRect();
        const x = stage.left + stage.width / 2 + 40;
        const y = stage.top + stage.height / 2;
        const tap = (id: number): void => {
            pointer(element, 'pointerdown', id, x, y);
            pointer(element, 'pointerup', id, x, y);
        };

        tap(1);
        expect(element.zoom.scale).toBe(1);
        tap(2);
        const zoomed = element.zoom;
        tap(3);
        tap(4);

        expect(zoomed.scale).toBe(2.5);
        expect(zoomed.offset.x).toBeLessThan(0);
        expect(element.zoom).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    });

    it('badPath_twoTapsApartADragOrAPinchAreNoDoubleTap', async () => {
        const element = await lightbox();

        pointer(element, 'pointerdown', 1, 100, 100);
        pointer(element, 'pointerup', 1, 100, 100);
        pointer(element, 'pointerdown', 2, 300, 300);
        pointer(element, 'pointerup', 2, 300, 300);
        pointer(element, 'pointerdown', 3, 300, 300);
        pointer(element, 'pointermove', 3, 360, 300);
        pointer(element, 'pointerup', 3, 360, 300);
        pointer(element, 'pointerdown', 4, 360, 300);
        pointer(element, 'pointercancel', 4, 360, 300);
        pointer(element, 'pointerdown', 5, 360, 300);
        pointer(element, 'pointerdown', 6, 400, 300);
        pointer(element, 'pointerup', 6, 400, 300);
        pointer(element, 'pointerup', 5, 360, 300);
        pointer(element, 'pointerup', 9, 360, 300);

        expect(element.zoom).toEqual({ scale: 1, offset: { x: 0, y: 0 } });
    });
});

describe('<hcm-lightbox> focus', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_theArrowThatGetsDisabledHandsTheFocusToTheDialog', async () => {
        // A focused button that becomes disabled drops the focus: Esc and the arrow keys then stopped working.
        const element = await lightbox({ locale: 'en' });
        const closes = recordEvents(element, 'hcm-close');
        const next = page.getByRole('button', { name: 'Next photo' });

        await next.click();
        element.photoId = 'fara-an';
        await element.updateComplete;

        await expect.element(next).toBeDisabled();
        expect(element.shadowRoot?.activeElement?.getAttribute('role')).toBe('dialog');
        press(element, 'Escape');
        expect(closes).toHaveLength(1);
    });

    it('badPath_anArrowThatStaysEnabledKeepsTheFocus', async () => {
        const element = await lightbox({ locale: 'en' });
        shadowQuery(shadowQuery(element, '[data-arrow="previous"]'), 'button').focus();

        press(element, 'ArrowRight');

        expect(element.shadowRoot?.activeElement?.getAttribute('data-arrow')).toBe('previous');
        (element.shadowRoot?.activeElement as HTMLElement | null)?.blur();
        press(element, 'ArrowLeft');
        expect(element.shadowRoot?.activeElement).toBeNull();
    });

    it('badPath_shiftTabFromTheDialogWrapsInsideItInsteadOfLeaving', async () => {
        const element = await lightbox({ locale: 'en' });
        const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true, composed: true });

        shadowQuery(element, '[role="dialog"]').dispatchEvent(shiftTab);

        expect(shiftTab.defaultPrevented).toBe(true);
        expect(element.shadowRoot?.activeElement?.getAttribute('data-arrow')).toBe('next');
    });
});

describe('<hcm-lightbox> layout', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aLandscapePhotoOnAShortWindowIsFittedOnAnOpaqueScrim', async () => {
        const frame = document.createElement('div');
        frame.style.cssText = 'position: relative; width: 640px; height: 300px;';
        document.body.append(frame);
        const element = document.createElement('hcm-lightbox');
        Object.assign(element, { photos: MANIFEST.photos, photoId: 'uranus-1984', open: true, manifestUrl: TEST_MANIFEST_URL });
        frame.append(element);
        // The viewer sets the scrim token (theme-tokens.test.ts); the baseline's is black.
        applyTheme(element, VIEWER_BASELINE, 'light', false);
        await element.updateComplete;
        const image = shadowQuery(element, 'img') as HTMLImageElement;
        await image.decode();

        const stage = shadowQuery(element, '.stage').getBoundingClientRect();
        const box = image.getBoundingClientRect();
        expect(box.height).toBeGreaterThan(0);
        expect(box.top).toBeGreaterThanOrEqual(stage.top - 0.5);
        expect(box.bottom).toBeLessThanOrEqual(stage.bottom + 0.5);
        expect(box.width / box.height).toBeCloseTo(image.naturalWidth / image.naturalHeight, 1);
        expect(getComputedStyle(shadowQuery(element, '[role="dialog"]')).backgroundColor).toBe('rgb(0, 0, 0)');
    });

    it('badPath_aLongTitleWrapsInsteadOfBeingCutOnANarrowPhone', async () => {
        // The tour, with WCAG 1.4.12's text spacing at 320 px: the title ended in an ellipsis.
        const frame = document.createElement('div');
        frame.style.cssText = 'position: relative; width: 240px; height: 480px; letter-spacing: 0.12em; word-spacing: 0.16em;';
        document.body.append(frame);
        const element = document.createElement('hcm-lightbox');
        Object.assign(element, { photos: MANIFEST.photos, photoId: 'uranus-1984', open: true, manifestUrl: TEST_MANIFEST_URL });
        frame.append(element);
        await element.updateComplete;

        const title = shadowQuery(element, '.title');
        expect(title.textContent).toBe('Strada Uranus');
        expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth);
        expect(getComputedStyle(title).textOverflow).toBe('clip');
    });
});

describe('<hcm-lightbox> landmarks', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_itsArrowsAreANamedNavigationAndItsHeaderNoBanner', async () => {
        // The tour: the lightbox's navigation had no name, and its header was a banner beside the photo sheet's.
        await lightbox({ locale: 'en' });

        await expect.element(page.getByRole('navigation', { name: 'Photo navigation' })).toBeVisible();
        expect(page.getByRole('banner').query()).toBeNull();
    });

    it('badPath_theNavigationIsNamedInRomanianToo', async () => {
        await lightbox();

        await expect.element(page.getByRole('navigation', { name: 'Navigare între fotografii' })).toBeVisible();
    });
});
