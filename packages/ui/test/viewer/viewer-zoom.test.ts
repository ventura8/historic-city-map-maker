import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineViewerElements } from '../../src/viewer/define.js';
import { coverZoom } from '../../src/viewer/viewer-zoom.js';
import { defineKitDoubles, shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, LANDSCAPE_PHONE, MEDIUM, mountViewer, part, type Box, type Mounted } from './viewer-harness.js';

/** The map's zoom buttons (scenario V52): Zoom in and Zoom out over the map, soft-disabled at the city's zoom limits (10 to 20). */
beforeAll(() => {
    defineKitDoubles();
    defineViewerElements();
});

const VIEW = { center: [26.0853, 44.4271] as const, zoom: 14.5, bearing: 0 };

function ariaDisabled(mounted: Mounted, index: number): string | null {
    const button = mounted.element.shadowRoot?.querySelectorAll('.dock.zoom hcm-icon-button')[index];
    return button === undefined ? null : shadowQuery(button, 'button').getAttribute('aria-disabled');
}

async function atZoom(zoom: number, box: Box = COMPACT): Promise<Mounted> {
    return mountViewer(readyState(testManifest(), { view: { ...VIEW, zoom } }), box);
}

describe('<hcm-map-viewer>: the zoom buttons', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_eachButtonAsksTheStoreForOneLevel', async () => {
        const mounted = await atZoom(14.5);

        await userEvent.click(page.getByRole('button', { name: 'Mărește harta' }));
        await userEvent.click(page.getByRole('button', { name: 'Micșorează harta' }));

        expect(mounted.store.callsOf('zoomBy')).toEqual([[1], [-1]]);
        expect([ariaDisabled(mounted, 0), ariaDisabled(mounted, 1)]).toEqual(['false', 'false']);
    });

    it('happyPath_theNamesAndTooltipsFollowTheLanguage', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { locale: 'en' }));

        const buttons = [...(mounted.element.shadowRoot?.querySelectorAll('.dock.zoom hcm-icon-button') ?? [])];

        expect(buttons.map((button) => button.getAttribute('title'))).toEqual(['Zoom in', 'Zoom out']);
        expect(buttons.map((button) => button.getAttribute('icon'))).toEqual(['add', 'remove']);
    });

    it('badPath_atTheCityMaximumZoomInSaysItIsDisabled', async () => {
        const mounted = await atZoom(20);

        await userEvent.click(page.getByRole('button', { name: 'Mărește harta' }), { force: true });

        expect([ariaDisabled(mounted, 0), ariaDisabled(mounted, 1)]).toEqual(['true', 'false']);
        expect(mounted.store.callsOf('zoomBy')).toEqual([]);
    });

    it('badPath_atTheCityMinimumZoomOutSaysItIsDisabled', async () => {
        const mounted = await atZoom(10);

        expect([ariaDisabled(mounted, 0), ariaDisabled(mounted, 1)]).toEqual(['false', 'true']);
    });

    it('badPath_withoutWebglThereAreNoZoomButtons', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { webgl: false }));

        expect(mounted.element.shadowRoot?.querySelector('.dock.zoom')).toBeNull();
    });

    // Where the group sits (the kit doubles have no size of their own: kit-timeline-layout.test.ts and the viewer tour
    // check the real boxes): on a phone held upright beside the standing timeline, above the chip's row (42 + 56 + 40 +
    // 2 x 8 px), its foot level with the card's; 8 px over the 56 px FAB from medium up, centred over it (16 + 4 px or
    // 24 + 4 px from the trailing edge); on a short window over the FAB on the leading side, which the lying card leaves.
    it('happyPath_aPhoneHeldUprightStacksThemAboveTheChipRow', async () => {
        const zoom = getComputedStyle(part(await atZoom(14.5), '.dock.zoom'));

        expect([zoom.bottom, zoom.right, zoom.flexDirection]).toEqual(['154px', '20px', 'column']);
    });

    it('happyPath_aWideMapPutsThemJustOverTheMenu', async () => {
        const zoom = getComputedStyle(part(await atZoom(14.5, MEDIUM), '.dock.zoom'));

        expect([zoom.bottom, zoom.right, zoom.flexDirection]).toEqual(['106px', '28px', 'column']);
    });

    it('badPath_aShortWindowPutsThemOverTheMenuOnTheLeadingSide', async () => {
        const zoom = getComputedStyle(part(await atZoom(14.5, LANDSCAPE_PHONE), '.dock.zoom'));

        expect([zoom.bottom, zoom.left, zoom.flexDirection]).toEqual(['106px', '28px', 'column']);
    });

    it('badPath_aCityWithoutLayersKeepsThemJustOverTheMenu', async () => {
        const mounted = await mountViewer(readyState({ ...testManifest(), layers: [] }));

        expect(getComputedStyle(part(mounted, '.dock.zoom')).bottom).toBe('106px');
    });
});

describe('<hcm-map-viewer>: the zoom buttons under the open menu', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_theOpenMenuHidesThemUntilItCloses', async () => {
        const mounted = await atZoom(14.5);
        const menu = part(mounted, 'hcm-fab-menu');

        menu.setAttribute('open', '');
        expect(getComputedStyle(part(mounted, '.dock.zoom')).visibility).toBe('hidden');
        menu.removeAttribute('open');
        expect(getComputedStyle(part(mounted, '.dock.zoom')).visibility).toBe('visible');
    });

    it('badPath_theMenusToggleMarksTheFrameSoSafariHidesTheZoomAndTheCompassToo', async () => {
        const mounted = await atZoom(14.5);
        const menu = part(mounted, 'hcm-fab-menu');
        const frame = part(mounted, '.frame');

        menu.dispatchEvent(new CustomEvent('hcm-toggle', { detail: { open: true }, bubbles: true, composed: true }));
        expect(frame.hasAttribute('data-menu-open')).toBe(true);
        expect(getComputedStyle(part(mounted, '.dock.compass')).visibility).toBe('hidden');
        menu.dispatchEvent(new CustomEvent('hcm-toggle', { detail: { open: false }, bubbles: true, composed: true }));
        expect(frame.hasAttribute('data-menu-open')).toBe(false);
        expect(getComputedStyle(part(mounted, '.dock.zoom')).visibility).toBe('visible');
    });
});

describe('coverZoom: where Mapbox stops zooming out inside the city bounds', () => {
    const BOUNDS = [
        [25.93, 44.33],
        [26.25, 44.55],
    ] as const;

    it('happyPath_theWiderOrTallerSideDecides', () => {
        expect(coverZoom(BOUNDS, { width: 1440, height: 900 })).toBeCloseTo(11.63, 2);
        expect(coverZoom(BOUNDS, { width: 360, height: 700 })).toBeCloseTo(10.64, 2);
    });

    it('badPath_aMapWithNoBoxHasNoFloor', () => {
        expect(coverZoom(BOUNDS, { width: 0, height: 0 })).toBe(Number.NEGATIVE_INFINITY);
    });
});

describe('<hcm-map-viewer>: Zoom out at the bounds', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    // The map's box is read at each render; the first render comes before the map container exists, and the map's
    // `moveend` (here the store's next view) renders again.
    async function settledAt(zoom: number): Promise<Mounted> {
        const mounted = await atZoom(zoom);
        mounted.store.set({ view: { ...VIEW, zoom } });
        await mounted.element.updateComplete;
        return mounted;
    }

    it('badPath_whereTheBoundsJustCoverThePhoneZoomOutIsSoftDisabled', async () => {
        const mounted = await settledAt(10.64);

        expect([ariaDisabled(mounted, 0), ariaDisabled(mounted, 1)]).toEqual(['false', 'true']);
    });

    // Mapbox would clamp the flight back, but only after moving the map and rewriting the address: a press at the limit
    // never reaches the store (the store knows only the city's minZoom, not the map's box).
    it('badPath_aPressAtTheBoundsNeverReachesTheStore', async () => {
        const mounted = await settledAt(10.64);

        await userEvent.click(page.getByRole('button', { name: 'Micșorează harta' }), { force: true });
        await userEvent.click(page.getByRole('button', { name: 'Mărește harta' }));

        expect(mounted.store.callsOf('zoomBy')).toEqual([[1]]);
    });

    it('happyPath_aLittleAboveItZoomOutStaysEnabled', async () => {
        const mounted = await settledAt(10.7);

        expect(ariaDisabled(mounted, 1)).toBe('false');
    });
});
