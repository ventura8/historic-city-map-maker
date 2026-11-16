import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { compassDescription, defineHcmCompass, type HcmCompass } from '../../src/viewer/hcm-compass.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import { defineKitDoubles, shadowQuery } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { LANDSCAPE_PHONE, MEDIUM, mountViewer, part } from './viewer-harness.js';

/**
 * The compass (scenario V64): an icon button by the zoom group whose needle follows the camera's bearing and
 * tilt frame by frame, quiet when the map is north up and level, and whose press asks the store for north up.
 */
beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

async function compassWith(store: FakeStore | null, locale: 'ro' | 'en' = 'ro'): Promise<HcmCompass> {
    defineHcmCompass();
    const compass = document.createElement('hcm-compass');
    compass.source = store;
    compass.locale = locale;
    document.body.append(compass);
    await compass.updateComplete;
    return compass;
}

function description(compass: HcmCompass): string {
    const button = shadowQuery(compass, 'button');
    return shadowQuery(compass, `#${button.getAttribute('aria-describedby') ?? ''}`).textContent;
}

describe('<hcm-compass>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theNeedleFollowsTheCameraAndTheDescriptionSaysWhere', async () => {
        const store = new FakeStore(readyState());
        const compass = await compassWith(store);
        expect(compass.north).toBe(true);
        expect(description(compass)).toBe('Harta este orientată spre nord.');

        store.moveCamera({ bearing: 90, pitch: 0 });
        await compass.updateComplete;
        expect(compass.hasAttribute('north')).toBe(false);
        expect(description(compass)).toBe('Harta este rotită cu 90° față de nord.');
        expect(shadowQuery(compass, 'svg').style.transform).toBe('rotate(-90deg)');
        // The "N" sits in the turning drawing, so it always points at the map's north.
        expect(shadowQuery(compass, 'svg text.letter').textContent).toBe('N');

        store.moveCamera({ bearing: 270.4, pitch: 35.2 });
        await compass.updateComplete;
        expect(description(compass)).toBe('Harta este rotită cu 270° față de nord și înclinată cu 35°.');
        expect(shadowQuery(compass, 'svg').style.transform).toBe('rotate(-270.4deg)');
    });

    it('happyPath_theNorthAndSouthTrianglesAreTheSameSizeMirrored', async () => {
        const compass = await compassWith(new FakeStore(readyState()));
        const north = shadowQuery(compass, 'path.north') as unknown as SVGPathElement;
        const south = shadowQuery(compass, 'path.south') as unknown as SVGPathElement;
        const [n, s] = [north.getBBox(), south.getBBox()];
        expect(n.width).toBeCloseTo(s.width, 5);
        expect(n.height).toBeCloseTo(s.height, 5);
        // Mirrored about the shared base: the north apex as far above it as the south apex below.
        expect(n.y + n.height).toBeCloseTo(s.y, 5);
        expect(getComputedStyle(north).strokeWidth).toBe(getComputedStyle(south).strokeWidth);
        // The N sits inside the north triangle.
        const letter = (shadowQuery(compass, 'text.letter') as unknown as SVGTextElement).getBBox();
        expect(letter.y).toBeGreaterThanOrEqual(n.y);
        expect(letter.y + letter.height).toBeLessThanOrEqual(n.y + n.height);
    });

    it('happyPath_englishNameAndDescription', async () => {
        const store = new FakeStore(readyState());
        store.camera = { bearing: 12, pitch: 0 };
        const compass = await compassWith(store, 'en');

        await expect.element(page.getByRole('button', { name: 'Compass: turn the map north up' })).toBeVisible();
        expect(description(compass)).toBe('The map is turned 12° from north.');
    });

    it('badPath_almostNorthIsNorthAndQuiet', async () => {
        const store = new FakeStore(readyState());
        store.camera = { bearing: 359.6, pitch: 0.3 };
        const compass = await compassWith(store);

        expect(compass.north).toBe(true);
        expect(compassDescription('en', { bearing: 359.6, pitch: 0 })).toBe('The map faces north.');
        expect(getComputedStyle(shadowQuery(compass, 'button')).color).not.toBe('');
    });

    it('badPath_withoutASourceItShowsNorthAndADetachedOneStopsBeingWatched', async () => {
        const compass = await compassWith(null);
        expect(description(compass)).toBe('Harta este orientată spre nord.');

        const first = new FakeStore(readyState());
        const second = new FakeStore(readyState());
        compass.source = first;
        await compass.updateComplete;
        compass.source = second;
        await compass.updateComplete;
        expect([first.cameraWatchers, second.cameraWatchers]).toEqual([0, 1]);

        compass.remove();
        expect(second.cameraWatchers).toBe(0);
    });
});

describe('<hcm-map-viewer>: the compass', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aClickOrEnterAsksTheStoreForNorthUp', async () => {
        const mounted = await mountViewer(readyState(testManifest()));
        const compass = page.getByRole('button', { name: 'Busolă: orientează harta spre nord' });

        await userEvent.click(compass);
        shadowQuery(part(mounted, 'hcm-compass'), 'button').focus();
        await userEvent.keyboard('{Enter}');
        await userEvent.keyboard(' ');

        expect(mounted.store.callsOf('resetNorth')).toHaveLength(3);
        expect(part(mounted, 'hcm-compass').title).toBe('Busolă: orientează harta spre nord');
        expect(part(mounted, '.dock.compass').firstElementChild?.localName).toBe('hcm-compass');
    });

    it('happyPath_itFollowsTheAttachedStoreInEveryLayout', async () => {
        const mounted = await mountViewer(readyState(testManifest()), LANDSCAPE_PHONE);
        mounted.store.moveCamera({ bearing: 45, pitch: 0 });
        const compass = part(mounted, 'hcm-compass') as HcmCompass;
        await compass.updateComplete;

        expect(compass.north).toBe(false);
        expect(mounted.store.cameraWatchers).toBe(1);
    });

    it('happyPath_overTheGroupOnATallMapBesideItsZoomInOnAShortOne', async () => {
        const px = (value: string): number => Number.parseFloat(value);
        const tall = await mountViewer(readyState(testManifest()), MEDIUM);
        const [tallCompass, tallZoom] = [getComputedStyle(part(tall, '.dock.compass')), getComputedStyle(part(tall, '.dock.zoom'))];
        expect(px(tallCompass.bottom) - px(tallZoom.bottom)).toBe(104);
        expect(tallCompass.right).toBe(tallZoom.right);
        document.body.replaceChildren();

        const short = await mountViewer(readyState(testManifest()), LANDSCAPE_PHONE);
        const [shortCompass, shortZoom] = [getComputedStyle(part(short, '.dock.compass')), getComputedStyle(part(short, '.dock.zoom'))];
        expect(px(shortCompass.bottom) - px(shortZoom.bottom)).toBe(48);
        expect(px(shortCompass.left) - px(shortZoom.left)).toBe(56);
    });

    it('badPath_withoutWebglThereIsNoCompass', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { webgl: false }));

        expect(mounted.element.shadowRoot?.querySelector('hcm-compass')).toBeNull();
    });
});
