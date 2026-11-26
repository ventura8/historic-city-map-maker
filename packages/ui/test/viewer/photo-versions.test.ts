/**
 * A photo's versions in the viewer (the owner 2026-11-09; V61) and the full-size view's zoom buttons (V60): which version
 * shows, the switch in the detail sheet and the full-size view, and Zoom in and Zoom out at their limits.
 */
import { streetViewUrl, type Photo } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { HCM_LIGHTBOX_TAG, defineHcmLightbox, type HcmLightbox } from '../../src/viewer/hcm-lightbox.js';
import { HCM_PHOTO_SHEET_TAG, defineHcmPhotoSheet, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { hasVersions, photoViews, shownView, viewImage } from '../../src/viewer/photo-version.js';
import { MAX_SCALE } from '../../src/viewer/zoom.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();
const BASE: Photo = MANIFEST.photos.find((photo) => photo.versions === undefined && photo.id === 'uranus-1984') ?? fail();

function fail(): never {
    throw new Error('the fixture has the photo uranus-1984');
}
const IMPROVED = { web: 'improved/web.webp', thumb: 'improved/thumb.webp', w: 800, h: 600 };
const COLORIZED = { web: 'colorized/web.webp', thumb: 'colorized/thumb.webp', w: 800, h: 600, credit: 'Ana Pop' };
const BOTH: Photo = { ...BASE, versions: { improved: IMPROVED, colorized: COLORIZED } };
const COLOR_ONLY: Photo = { ...BASE, versions: { colorized: COLORIZED } };

describe('photo-version', () => {
    it('happyPath_theViewsAndTheDefault', () => {
        expect(photoViews(BOTH)).toEqual(['original', 'improved', 'colorized']);
        expect(shownView(BOTH, null)).toBe('improved');
        expect(shownView(BOTH, 'colorized')).toBe('colorized');
        expect(viewImage(BOTH, 'colorized').web).toBe('colorized/web.webp');
        expect(hasVersions(BOTH)).toBe(true);
    });

    it('badPath_colorizedIsNeverTheDefaultAndAMissingPickFallsBack', () => {
        expect(shownView(COLOR_ONLY, null)).toBe('original');
        expect(shownView(COLOR_ONLY, 'improved')).toBe('original');
        expect(shownView(BASE, 'colorized')).toBe('original');
        expect(viewImage(BASE, 'improved')).toBe(BASE.image);
        expect(hasVersions(BASE)).toBe(false);
    });
});

async function sheet(photo: Photo, properties: Partial<HcmPhotoSheet> = {}): Promise<HcmPhotoSheet> {
    const element = await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
        photo,
        open: true,
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
    await element.updateComplete;
    return element;
}

async function lightbox(photo: Photo, properties: Partial<HcmLightbox> = {}): Promise<HcmLightbox> {
    const element = await mountElement<HcmLightbox>(HCM_LIGHTBOX_TAG, {
        photos: [photo],
        photoId: photo.id,
        open: true,
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
    await element.updateComplete;
    return element;
}

function radios(host: Element): HTMLElement[] {
    const group = shadowQuery(host, 'hcm-segmented-button');
    return [...(group.shadowRoot?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
}

describe('the version switch', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPhotoSheet();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theSheetShowsTheImprovedVersionAndSwitches', async () => {
        const element = await sheet(BOTH, { locale: 'en' });
        const events = recordEvents(element, 'hcm-photo-version');

        expect(shadowQuery(element, 'img').getAttribute('src')).toContain('improved/thumb.webp');
        expect(radios(element).map((radio) => radio.textContent.trim())).toEqual(['Original', 'Improved', 'Colorized']);
        radios(element)[2]?.click();
        element.photoVersion = 'colorized';
        await element.updateComplete;

        expect(events).toEqual([{ type: 'hcm-photo-version', detail: { view: 'colorized' } }]);
        expect(shadowQuery(element, 'img').getAttribute('src')).toContain('colorized/thumb.webp');
        expect(shadowText(element)).toContain('Colorized by Ana Pop');
    });

    it('happyPath_theSheetLinksToStreetViewLookingAlongTheBearing', async () => {
        const element = await sheet({ ...BASE, bearing: 135 }, { locale: 'en' });

        const link = [...(element.shadowRoot?.querySelectorAll('a') ?? [])].find((anchor) => anchor.href.includes('map_action=pano'));
        expect(link?.textContent).toBe('Open in Google Street View');
        expect(link?.href).toBe(streetViewUrl(BASE.location, 135));
    });

    it('badPath_aPhotoWithOnlyItsOriginalHasNoSwitch', async () => {
        const element = await sheet(BASE);

        expect(shadowQueryAll(element, 'hcm-segmented-button')).toEqual([]);
        expect(shadowText(element)).not.toContain('Colorizată de');
    });

    it('happyPath_theFullSizeViewShowsThePickedVersionInRomanian', async () => {
        const element = await lightbox(BOTH, { photoVersion: 'colorized' });
        const events = recordEvents(element, 'hcm-photo-version');

        expect(shadowQuery(element, 'img').getAttribute('src')).toContain('colorized/web.webp');
        expect(radios(element).map((radio) => radio.textContent.trim())).toEqual(['Original', 'Îmbunătățită', 'Colorizată']);
        expect(shadowText(element)).toContain('Colorizată de Ana Pop');
        radios(element)[0]?.click();

        expect(events).toEqual([{ type: 'hcm-photo-version', detail: { view: 'original' } }]);
    });

    it('badPath_theFullSizeViewOfAnOriginalOnlyPhotoHasNoSwitch', async () => {
        const element = await lightbox(BASE);

        expect(shadowQueryAll(element, '.versions')).toEqual([]);
    });
});

function zoomButton(element: HcmLightbox, icon: 'zoom_in' | 'zoom_out'): HTMLElement {
    return shadowQuery(element, `[data-zoom="${icon}"]`);
}

describe('the full-size view: Zoom in and Zoom out', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLightbox();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theButtonsZoomAroundTheCentre', async () => {
        const element = await lightbox(BASE, { locale: 'en' });

        expect(zoomButton(element, 'zoom_in').getAttribute('title')).toBe('Zoom in on the photo');
        zoomButton(element, 'zoom_in').click();
        zoomButton(element, 'zoom_in').click();
        await element.updateComplete;
        expect(element.zoom.scale).toBeCloseTo(1.5625);
        expect(element.zoom.offset).toEqual({ x: 0, y: 0 });
        zoomButton(element, 'zoom_out').click();
        await element.updateComplete;

        expect(element.zoom.scale).toBeCloseTo(1.25);
        expect(zoomButton(element, 'zoom_out').hasAttribute('soft-disabled')).toBe(false);
    });

    it('badPath_theButtonsAreSoftDisabledAtTheLimits', async () => {
        const element = await lightbox(BASE);

        expect(zoomButton(element, 'zoom_out').hasAttribute('soft-disabled')).toBe(true);
        expect(zoomButton(element, 'zoom_out').getAttribute('title')).toBe('Micșorează fotografia');
        zoomButton(element, 'zoom_out').click();
        expect(element.zoom.scale).toBe(1);
        for (let press = 0; press < 10; press += 1) {
            zoomButton(element, 'zoom_in').click();
        }
        await element.updateComplete;

        expect(element.zoom.scale).toBe(MAX_SCALE);
        expect(zoomButton(element, 'zoom_in').hasAttribute('soft-disabled')).toBe(true);
    });
});
