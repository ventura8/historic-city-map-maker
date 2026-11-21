// The scan pane's side of the linked views (S-A16-HAPPY-GEOREF-LINKED, S-A16-BAD-GEOREF-LINKED-NO-FIT): the admin's pan or zoom
// says where the pane now is (`hcm-view`); the linked map's place (`follow`) centres it there without a word back, and not while a
// pointer is down.
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { centredView, fitView, MAX_ZOOM } from '../../../src/admin/georef/scan-view.js';
import { blankImage } from '../imagery/fixtures.js';
import { cleanup, mount, updated } from '../shell/fake-app.js';

defineHcmScanViewer();

interface Said {
    readonly views: { readonly centre: { readonly x: number; readonly y: number }; readonly scale: number }[];
}

/** A 400 × 240 pane over a 2000 × 1200 scan whose preview is half its size: fitted, 0.2 CSS px a scan pixel. */
async function viewer(): Promise<HcmScanViewer & Said> {
    const element = await mount<HcmScanViewer>(
        html`<hcm-scan-viewer
            style="inline-size: 400px; block-size: 240px"
            .src=${blankImage()}
            .scanWidth=${2000}
            .scanHeight=${1200}
            .previewScale=${0.5}
            .label=${'The scan'}
        ></hcm-scan-viewer>`,
    );
    const views: Said['views'] = [];
    element.addEventListener('hcm-view', (event) => {
        views.push((event as CustomEvent<Said['views'][number]>).detail);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updated(element);
    return Object.assign(element, { views });
}

function canvasOf(element: HcmScanViewer): HTMLCanvasElement {
    const canvas = element.renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    return canvas;
}

function pointer(element: HcmScanViewer, type: string, x: number, y: number): void {
    const box = element.getBoundingClientRect();
    canvasOf(element).dispatchEvent(new PointerEvent(type, { clientX: box.left + x, clientY: box.top + y, pointerId: 1, bubbles: true }));
}

describe('the scan pane linked to the map', () => {
    afterEach(cleanup);

    it('happyPath_centredViewPutsThePixelMidPaneWithinFitAndMaxZoom @S-A16-HAPPY-GEOREF-LINKED', () => {
        const pane = { width: 400, height: 240 };
        const fit = fitView(pane, { width: 1000, height: 600 });

        expect(centredView(pane, { centre: { x: 1000, y: 600 }, scale: 0.2 }, 0.5, fit)).toEqual(fit);
        expect(centredView(pane, { centre: { x: 100, y: 100 }, scale: 2 }, 0.5, fit)).toEqual({ scale: 4, offset: { x: 0, y: -80 } });
        expect(centredView(pane, { centre: { x: 100, y: 100 }, scale: 1e6 }, 0.5, fit).scale).toBe(fit.scale * MAX_ZOOM);
        expect(centredView(pane, { centre: { x: 100, y: 100 }, scale: 1e-6 }, 0.5, fit).scale).toBe(fit.scale);
    });

    it('happyPath_aPanOrAZoomSaysWhereThePaneIsAndTheMapsPlaceCentresItSilently @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const element = await viewer();

        canvasOf(element).dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: 0, clientY: 0, bubbles: true, cancelable: true }));
        pointer(element, 'pointerdown', 200, 120);
        pointer(element, 'pointermove', 150, 120);
        pointer(element, 'pointerup', 150, 120);
        expect(element.views).toHaveLength(2);
        expect(element.views[1]?.centre.x).toBeCloseTo(element.centre.x, 6);
        expect(element.views[1]?.scale).toBeCloseTo(element.view.scale * 0.5, 9);

        element.follow = { centre: { x: 1500, y: 300 }, scale: 0.8 };
        await updated(element);

        expect(element.centre.x).toBeCloseTo(1500, 6);
        expect(element.centre.y).toBeCloseTo(300, 6);
        expect(element.view.scale * 0.5).toBeCloseTo(0.8, 9);
        expect(element.views).toHaveLength(2);
    });

    it('badPath_theMapsPlaceWaitsNeitherForAPointerDownNorForAPaneNeverShown @S-A16-BAD-GEOREF-LINKED-NO-FIT', async () => {
        const element = await viewer();
        const before = element.centre;

        pointer(element, 'pointerdown', 200, 120);
        element.follow = { centre: { x: 1500, y: 300 }, scale: 0.8 };
        await updated(element);
        expect(element.centre).toEqual(before);
        pointer(element, 'pointerup', 200, 120);

        element.follow = null;
        await updated(element);
        expect(element.centre).toEqual(before);

        const hidden = await mount<HcmScanViewer>(
            html`<hcm-scan-viewer
                style="inline-size: 0; block-size: 0"
                .scanWidth=${2000}
                .scanHeight=${1200}
                .previewScale=${0.5}
            ></hcm-scan-viewer>`,
        );
        hidden.follow = { centre: { x: 1500, y: 300 }, scale: 0.8 };
        await updated(hidden);
        expect(hidden.centre).toEqual({ x: 1000, y: 600 });
    });
});
