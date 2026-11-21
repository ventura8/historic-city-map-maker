/**
 * Mapbox's logo and attribution move into the part of the map a modal sheet leaves in view (V18; the Pixel 9 Pro review,
 * P3): above a bottom sheet's top edge, beside a side sheet; the sheets, the lightbox and the dialogs draw above them.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { defineUiKit } from '../../src/components/define.js';
import { defineViewerElements } from '../../src/viewer/define.js';
import type { HcmMapViewer } from '../../src/viewer/hcm-map-viewer.js';
import { LegalLiftWatcher, NO_LIFT, liftFor, openModalSheet, sameLift } from '../../src/viewer/legal-lift.js';
import { FakeStore, readyState } from './fake-store.js';
import { fakeServices, setBox, COMPACT, MEDIUM, type Box } from './viewer-harness.js';

const VIEWER = { left: 0, right: 400, top: 0, bottom: 800 };

describe('liftFor', () => {
    it('happyPath_aBottomSheetLiftsBothCornersAndASideSheetMovesItsCorner', () => {
        expect(liftFor(VIEWER, { left: 0, right: 400, top: 400, bottom: 800 })).toEqual({ bottom: 400, left: 0, right: 0 });
        expect(liftFor(VIEWER, { left: 40, right: 400, top: 0, bottom: 800 })).toEqual({ bottom: 0, left: 0, right: 360 });
        expect(liftFor(VIEWER, { left: 0, right: 300.4, top: 0, bottom: 800 })).toEqual({ bottom: 0, left: 300, right: 0 });
    });

    it('badPath_noSheetAClosedOneOrOneAwayFromTheEdgesMovesNothing', () => {
        expect(liftFor(VIEWER, null)).toBe(NO_LIFT);
        expect(liftFor(VIEWER, { left: 0, right: 400, top: 800, bottom: 800 })).toBe(NO_LIFT);
        expect(liftFor(VIEWER, { left: 50, right: 350, top: 100, bottom: 700 })).toBe(NO_LIFT);
        expect(sameLift(NO_LIFT, { bottom: 0, left: 0, right: 0 })).toBe(true);
        expect(sameLift(NO_LIFT, { bottom: 1, left: 0, right: 0 })).toBe(false);
    });

    it('badPath_noOpenModalSheetAndNoRootFindNothing', () => {
        const host = document.createElement('div');
        host.attachShadow({ mode: 'open' }).append(document.createElement('hcm-sheet'));
        const root = document.createElement('div');
        root.append(host, document.createElement('span'));
        const reported: unknown[] = [];
        const watcher = new LegalLiftWatcher(
            () => null,
            () => VIEWER,
            (lift) => reported.push(lift),
        );

        watcher.refresh();
        watcher.stop();

        expect(openModalSheet(root)).toBeNull();
        expect(reported).toEqual([]);
    });
});

async function viewer(box: Box, state: Parameters<typeof readyState>[1]): Promise<{ element: HcmMapViewer; store: FakeStore }> {
    const element = document.createElement('hcm-map-viewer');
    const store = new FakeStore(readyState(undefined, state));
    element.services = fakeServices();
    setBox(element, box);
    element.attach(store, null);
    document.body.append(element);
    await element.updateComplete;
    return { element, store };
}

/** Mapbox GL's bottom corner as the engine's map draws it in the viewer's map container. */
function corner(element: HcmMapViewer, side: 'left' | 'right'): HTMLElement {
    const box = document.createElement('div');
    box.className = `mapboxgl-ctrl-bottom-${side}`;
    box.style.cssText = 'position: absolute; width: 80px; height: 24px';
    element.mapContainer?.append(box);
    return box;
}

function sheetBox(element: HcmMapViewer): DOMRect {
    const sheet = element.shadowRoot === null ? null : openModalSheet(element.shadowRoot);
    if (sheet === null) {
        throw new Error('no open modal sheet');
    }
    return sheet.getBoundingClientRect();
}

describe('<hcm-map-viewer> Mapbox corners and the modal sheets (real kit)', () => {
    beforeAll(async () => {
        defineUiKit();
        defineViewerElements();
        await page.viewport(1280, 900);
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_onAPhoneTheCornersRiseAboveTheBottomSheetAndComeBackWhenItCloses', async () => {
        const { element, store } = await viewer(COMPACT, { sheet: 'photos' });
        const [left, right] = [corner(element, 'left'), corner(element, 'right')];

        await vi.waitFor(() => {
            expect(left.getBoundingClientRect().bottom).toBeLessThanOrEqual(sheetBox(element).top + 0.5);
        });
        expect(right.getBoundingClientRect().bottom).toBeLessThanOrEqual(sheetBox(element).top + 0.5);
        expect(element.shadowRoot?.querySelector('.legal')).toBeNull();

        store.set({ sheet: 'none' });
        await vi.waitFor(() => {
            expect(left.getBoundingClientRect().bottom).toBeCloseTo(element.mapContainer?.getBoundingClientRect().bottom ?? -1, 0);
        });
    });

    it('badPath_besideASideSheetOnlyTheCornerItCoversMoves', async () => {
        const { element } = await viewer(MEDIUM, { sheet: 'photos' });
        const [left, right] = [corner(element, 'left'), corner(element, 'right')];

        await vi.waitFor(() => {
            expect(right.getBoundingClientRect().right).toBeLessThanOrEqual(sheetBox(element).left + 0.5);
        });
        const map = element.mapContainer?.getBoundingClientRect();
        expect(left.getBoundingClientRect().left).toBeCloseTo(map?.left ?? -1, 0);
        expect(left.getBoundingClientRect().bottom).toBeCloseTo(map?.bottom ?? -1, 0);
    });
});
