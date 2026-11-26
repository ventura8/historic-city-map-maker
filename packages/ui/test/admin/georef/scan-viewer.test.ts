import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { drawScan } from '../../../src/admin/georef/scan-draw.js';
import { fitView, hitPair, MAX_ZOOM, panView, paneToScan, scanToPane, zoomView } from '../../../src/admin/georef/scan-view.js';
import { blankImage } from '../imagery/fixtures.js';
import { cleanup, mount, updated } from '../shell/fake-app.js';

const FIRST = { id: 'g1', label: '1', pixel: { x: 100, y: 100 }, enabled: true };
const MARKERS = [FIRST, { id: 'g2', label: '2', pixel: { x: 1500, y: 800 }, enabled: false }];

interface Heard {
    readonly events: string[];
}

async function viewer(options: { readonly adding?: boolean; readonly selected?: string | null } = {}): Promise<HcmScanViewer & Heard> {
    const element = await mount<HcmScanViewer>(
        html`<hcm-scan-viewer
            style="inline-size: 400px; block-size: 240px"
            .src=${blankImage()}
            .scanWidth=${2000}
            .scanHeight=${1200}
            .previewScale=${0.5}
            .markers=${MARKERS}
            .selected=${options.selected ?? null}
            .half=${{ x: 500, y: 500 }}
            ?adding=${options.adding === true}
            .label=${'The scan'}
        ></hcm-scan-viewer>`,
    );
    const events: string[] = [];
    for (const type of ['hcm-pick', 'hcm-select', 'hcm-move', 'hcm-delete', 'hcm-escape']) {
        element.addEventListener(type, (event) => {
            const detail = (event as CustomEvent<unknown>).detail;
            events.push(
                `${type} ${JSON.stringify(detail, (_key, value: unknown) => (typeof value === 'number' ? Math.round(value) : value))}`,
            );
        });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updated(element);
    return Object.assign(element, { events });
}

function canvasOf(element: HcmScanViewer): HTMLCanvasElement {
    const canvas = element.renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    return canvas;
}

/** A pointer gesture on the canvas from one pane point to another. */
function drag(element: HcmScanViewer, from: { x: number; y: number }, to: { x: number; y: number }): void {
    const canvas = canvasOf(element);
    const box = element.getBoundingClientRect();
    const at = (point: { x: number; y: number }) => ({
        clientX: box.left + point.x,
        clientY: box.top + point.y,
        pointerId: 1,
        bubbles: true,
    });
    canvas.dispatchEvent(new PointerEvent('pointerdown', at(from)));
    canvas.dispatchEvent(new PointerEvent('pointermove', at(to)));
    canvas.dispatchEvent(new PointerEvent('pointerup', at(to)));
}

/** Multi-touch helpers for the scan canvas (pinch tests). */
function touchCanvas(element: HcmScanViewer): {
    readonly canvas: HTMLCanvasElement;
    readonly point: (id: number, x: number, y: number) => PointerEventInit;
} {
    const canvas = canvasOf(element);
    canvas.setPointerCapture = () => undefined;
    canvas.releasePointerCapture = () => undefined;
    const box = element.getBoundingClientRect();
    return {
        canvas,
        point: (id, x, y) => ({ clientX: box.left + x, clientY: box.top + y, pointerId: id, bubbles: true }),
    };
}

describe('the scan view', () => {
    it('happyPath_fitZoomPanAndTheConversionsBothWays', () => {
        const fit = fitView({ width: 400, height: 200 }, { width: 1000, height: 500 });
        const zoomed = zoomView(fit, 100, { x: 200, y: 100 }, fit);
        const back = zoomView(zoomed, 0.0001, { x: 0, y: 0 }, fit);

        expect(fit).toEqual({ scale: 0.4, offset: { x: 0, y: 0 } });
        expect(zoomed.scale).toBeCloseTo(0.4 * MAX_ZOOM, 9);
        expect(back.scale).toBeCloseTo(0.4, 9);
        const pixel = paneToScan(panView(fit, 10, 0), { x: 210, y: 100 }, 0.5);
        expect(pixel).toEqual({ x: 1000, y: 500 });
        expect(scanToPane(fit, { x: 1000, y: 500 }, 0.5)).toEqual({ x: 200, y: 100 });
        expect(hitPair(fit, [{ id: 'a', pixel: { x: 1000, y: 500 } }], { x: 205, y: 95 }, 0.5)?.id).toBe('a');
        expect(hitPair(fit, [{ id: 'a', pixel: { x: 1000, y: 500 } }], { x: 300, y: 100 }, 0.5)).toBeNull();
        expect(fitView({ width: 10, height: 10 }, { width: 0, height: 0 }).scale).toBe(10);
    });
});

describe('<hcm-scan-viewer>', () => {
    beforeAll(() => {
        defineHcmScanViewer();
    });
    afterEach(cleanup);

    it('happyPath_aClickPicksWhileAddingAndSelectsOtherwise', async () => {
        const adding = await viewer({ adding: true });
        drag(adding, { x: 200, y: 100 }, { x: 200, y: 100 });
        const plain = await viewer();
        drag(plain, { x: 20, y: 20 }, { x: 21, y: 20 });
        drag(plain, { x: 380, y: 10 }, { x: 380, y: 10 });

        expect(adding.events).toEqual(['hcm-pick {"pixel":{"x":1000,"y":500}}']);
        expect(plain.events).toEqual(['hcm-select {"id":"g1"}', 'hcm-select {"id":null}']);
        expect(canvasOf(plain).getAttribute('aria-label')).toBe('The scan');
    });

    it('badPath_aRightButtonPressPicksNothingAndTheMenuReadsWhatIsUnderIt', async () => {
        const element = await viewer({ adding: true });
        const canvas = canvasOf(element);
        const box = element.getBoundingClientRect();
        const at = { clientX: box.left + 20, clientY: box.top + 20, pointerId: 1, bubbles: true, button: 2 };

        canvas.dispatchEvent(new PointerEvent('pointerdown', at));
        canvas.dispatchEvent(new PointerEvent('pointerup', at));
        const onMarker = element.targetAt({ clientX: box.left + 20, clientY: box.top + 20 });
        const empty = element.targetAt({ clientX: box.left + 200, clientY: box.top + 100 });
        element.cancelGesture();

        expect(element.events).toEqual([]);
        expect(onMarker).toEqual({ pixel: { x: 100, y: 100 }, hit: 'g1' });
        expect(empty).toEqual({ pixel: { x: 1000, y: 500 }, hit: null });
    });

    it('happyPath_aMarkerDraggedMovesAndADragElsewherePans', async () => {
        const element = await viewer();

        drag(element, { x: 20, y: 20 }, { x: 60, y: 40 });
        const centre = element.centre;
        drag(element, { x: 200, y: 220 }, { x: 150, y: 220 });
        canvasOf(element).dispatchEvent(new PointerEvent('pointercancel'));
        canvasOf(element).dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 }));
        canvasOf(element).dispatchEvent(new PointerEvent('pointerup', { clientX: 1, clientY: 1 }));

        expect(element.events).toEqual(['hcm-move {"id":"g1","pixel":{"x":300,"y":200}}']);
        expect(element.centre.x).toBeGreaterThan(centre.x);
    });

    it('happyPath_theZoomButtonsZoomInAndOutAndAreNamed', async () => {
        const element = await viewer({});
        element.zoomInLabel = 'Zoom in';
        element.zoomOutLabel = 'Zoom out';
        await updated(element);
        const buttons = [...(element.shadowRoot?.querySelectorAll('.zoom hcm-icon-button') ?? [])] as HTMLElement[];

        expect(buttons.map((button) => button.getAttribute('label'))).toEqual(['Zoom in', 'Zoom out']);
        buttons[0]?.click();
        buttons[0]?.click();
        buttons[1]?.click();
        expect(element.events).toEqual([]);
    });

    it('happyPath_theWheelAndTheKeysZoomPanMoveDeleteAndPick', async () => {
        const element = await viewer({ selected: 'g1' });
        const canvas = canvasOf(element);
        const key = (name: string, shiftKey = false): void => {
            canvas.dispatchEvent(new KeyboardEvent('keydown', { key: name, shiftKey, bubbles: true, cancelable: true }));
        };

        canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, clientX: 0, clientY: 0, cancelable: true }));
        key('ArrowRight');
        key('ArrowDown', true);
        key('+');
        key('-');
        key('Enter');
        key('Delete');
        key('Escape');
        key('x');
        element.selected = null;
        element.adding = true;
        await updated(element);
        canvas.focus();
        key('ArrowLeft');
        key('Enter');
        key('Backspace');
        canvas.blur();

        expect(element.events).toEqual([
            'hcm-move {"id":"g1","pixel":{"x":102,"y":100}}',
            'hcm-move {"id":"g1","pixel":{"x":100,"y":120}}',
            'hcm-delete {"id":"g1"}',
            'hcm-escape {}',
            expect.stringMatching(/^hcm-pick \{"pixel":\{"x":\d+,"y":\d+\}\}$/),
        ]);
    });

    it('happyPath_aNewImageIsLoadedAndNoImageDrawsOnlyTheMarkers', async () => {
        const element = await viewer();

        element.src = '';
        await updated(element);
        element.src = blankImage();
        await updated(element);
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(canvasOf(element).width).toBeGreaterThan(0);
    });

    it('happyPath_twoFingersPinchZoomAboutTheirMidpoint', async () => {
        const element = await viewer();
        const { canvas, point } = touchCanvas(element);
        const before = element.centre;

        canvas.dispatchEvent(new PointerEvent('pointerdown', point(1, 120, 100)));
        canvas.dispatchEvent(new PointerEvent('pointerdown', point(2, 280, 100)));
        canvas.dispatchEvent(new PointerEvent('pointermove', point(1, 80, 100)));
        canvas.dispatchEvent(new PointerEvent('pointermove', point(2, 320, 100)));
        canvas.dispatchEvent(new PointerEvent('pointerup', point(1, 80, 100)));
        canvas.dispatchEvent(new PointerEvent('pointerup', point(2, 320, 100)));

        expect(element.centre).not.toEqual(before);
        expect(element.events).toEqual([]);
    });
});

describe('<hcm-scan-viewer> pinch edges and an empty pane', () => {
    beforeAll(() => {
        defineHcmScanViewer();
    });
    afterEach(cleanup);

    it('happyPath_coincidentFingersAndALoneFingerAfterPinchDoNotThrow', async () => {
        const element = await viewer();
        const { canvas, point } = touchCanvas(element);

        canvas.dispatchEvent(new PointerEvent('pointerdown', point(1, 200, 100)));
        canvas.dispatchEvent(new PointerEvent('pointerdown', point(2, 200, 100)));
        canvas.dispatchEvent(new PointerEvent('pointermove', point(1, 200, 100)));
        canvas.dispatchEvent(new PointerEvent('pointerup', point(2, 200, 100)));
        canvas.dispatchEvent(new PointerEvent('pointermove', point(1, 220, 110)));
        canvas.dispatchEvent(new PointerEvent('pointerup', point(1, 220, 110)));

        expect(element.events).toEqual([]);
    });

    it('happyPath_centreIsTheScanMiddleWhileThePaneHasNoSize', async () => {
        const element = await mount<HcmScanViewer>(
            html`<hcm-scan-viewer
                style="inline-size: 0; block-size: 0"
                .src=${blankImage()}
                .scanWidth=${2000}
                .scanHeight=${1200}
                .previewScale=${0.5}
                .markers=${MARKERS}
                .label=${'The scan'}
            ></hcm-scan-viewer>`,
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
        await updated(element);

        expect(element.centre).toEqual({ x: 1000, y: 600 });
    });
});

describe('the scan drawing', () => {
    afterEach(cleanup);

    it('happyPath_theThemesColoursOrTheFallbacksAndACanvasWithoutA2dContext', () => {
        const plain = document.createElement('canvas');
        plain.style.inlineSize = '100px';
        plain.style.blockSize = '50px';
        document.body.append(plain);
        const scene = {
            ...{ image: null, view: { scale: 1, offset: { x: 0, y: 0 } }, previewScale: 1, markers: MARKERS, selected: 'g1' },
            ...{ half: null, crosshair: true, dragged: { ...FIRST, pixel: { x: 5, y: 5 } } },
        };
        drawScan(plain, scene);
        const webgl = document.createElement('canvas');
        webgl.getContext('webgl');
        drawScan(webgl, scene);

        expect([plain.width, plain.height]).toEqual([100, 50]);
    });
});
