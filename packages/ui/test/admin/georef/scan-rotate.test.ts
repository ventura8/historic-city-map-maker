// Each pane of the georeferencer turns on its own (S-A16-HAPPY-GEOREF-ROTATE): the scan by its buttons, r / R / n and Ctrl with a drag,
// the map by its buttons; the conversions between the pane and the scan hold under a turn; without a fit the panes cannot be turned
// together (S-A16-BAD-GEOREF-ROTATE-APART).
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { drawScan } from '../../../src/admin/georef/scan-draw.js';
import { draggedView, TURN_STEP, type Gesture } from '../../../src/admin/georef/scan-input.js';
import { detailScene, TileCache, type ScanTiles } from '../../../src/admin/georef/scan-tiles.js';
import { centredView, fitView, paneToScan, panView, rotateView, scanToPane, zoomView } from '../../../src/admin/georef/scan-view.js';
import { blankImage, defineImagery, georefPage, georefState } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll, mount, updated } from '../shell/fake-app.js';

defineHcmScanViewer();

const PANE = { width: 400, height: 240 };
const CENTRE = { x: 200, y: 120 };

async function viewer(): Promise<HcmScanViewer> {
    const element = await mount<HcmScanViewer>(
        html`<hcm-scan-viewer
            style="display: block; inline-size: 400px; block-size: 240px"
            .src=${blankImage()}
            .scanWidth=${2000}
            .scanHeight=${1200}
            .previewScale=${0.5}
            .label=${'The scan'}
        ></hcm-scan-viewer>`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updated(element);
    return element;
}

function canvasOf(element: HcmScanViewer): HTMLCanvasElement {
    const canvas = element.renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    return canvas;
}

describe('the scan view under a turn', () => {
    it('happyPath_thePaneAndTheScanConvertBothWaysAndATurnKeepsTheCentresPlace @S-A16-HAPPY-GEOREF-ROTATE', () => {
        const upright = { scale: 2, offset: { x: 30, y: -40 } };
        const turned = rotateView(upright, Math.PI / 6, CENTRE);
        expect(turned.angle).toBeCloseTo(Math.PI / 6, 12);
        expect(turned.scale).toBe(2);

        // What was at the pane's centre is still there; a pixel goes to the pane and back.
        const before = paneToScan(upright, CENTRE, 0.5);
        const after = paneToScan(turned, CENTRE, 0.5);
        expect([after.x, after.y].map((value) => Math.round(value * 1e6))).toEqual(
            [before.x, before.y].map((value) => Math.round(value * 1e6)),
        );
        const pixel = { x: 321, y: 123 };
        const back = paneToScan(turned, scanToPane(turned, pixel, 0.5), 0.5);
        expect([back.x, back.y].map((value) => Math.round(value * 1e6) / 1e6)).toEqual([321, 123]);
        // A quarter turn: the scan's x axis runs down the pane.
        const quarter = { scale: 1, offset: { x: 0, y: 0 }, angle: Math.PI / 2 };
        const drawn = scanToPane(quarter, { x: 10, y: 0 }, 1);
        expect([Math.round(drawn.x), Math.round(drawn.y)]).toEqual([0, 10]);

        // Panning and zooming keep the turn; a camera with an angle centres the turned scan, one without leaves it upright.
        expect([panView(turned, 5, 5).angle, zoomView(turned, 2, CENTRE, { scale: 0.1, offset: { x: 0, y: 0 } }).angle]).toEqual([
            turned.angle,
            turned.angle,
        ]);
        const fit = fitView(PANE, { width: 1000, height: 600 });
        const camera = { centre: { x: 800, y: 300 }, scale: 1, angle: 1 };
        const centred = centredView(PANE, camera, 0.5, fit);
        const shown = paneToScan(centred, CENTRE, 0.5);
        expect([Math.round(shown.x), Math.round(shown.y), centred.angle]).toEqual([800, 300, 1]);
        expect('angle' in centredView(PANE, { centre: camera.centre, scale: 1 }, 0.5, fit)).toBe(false);
    });

    it('happyPath_aDragPansAndCtrlWithADragTurnsAboutThePanesCentre @S-A16-HAPPY-GEOREF-ROTATE', () => {
        const view = { scale: 1, offset: { x: 0, y: 0 } };
        const gesture: Gesture = { start: { x: 300, y: 120 }, view, marker: null, moved: true, last: { x: 300, y: 120 } };

        expect(draggedView(gesture, { x: 310, y: 130 }, PANE)).toEqual({ scale: 1, offset: { x: 10, y: 10 } });
        // From the right of the centre to below it: a quarter turn clockwise.
        const turned = draggedView({ ...gesture, turning: true }, { x: 200, y: 220 }, PANE);
        expect(turned.angle).toBeCloseTo(Math.PI / 2, 9);
        expect(TURN_STEP).toBeCloseTo(Math.PI / 12, 12);
    });

    it('happyPath_aTurnedPaneAsksForTheTilesUnderItsCornersAndIsDrawnTurned @S-A16-HAPPY-GEOREF-ROTATE', () => {
        const tiles: ScanTiles = {
            tile: 1024,
            width: 8192,
            height: 8192,
            columns: 8,
            pieces: Array.from({ length: 64 }, () => new Blob(['t'])),
        };
        const asked: Blob[] = [];
        const cache = new TileCache(
            tiles,
            () => undefined,
            (piece) => {
                asked.push(piece);
                return new Promise(() => undefined);
            },
        );
        const shown = { tiles, cache, scale: 1 };
        // A 400 × 240 pane, two sharper pixels a pane pixel: upright it shows 800 × 480 of them, one tile.
        detailScene(shown, { view: { scale: 2, offset: { x: 0, y: 0 } }, pane: PANE, previewScale: 0.25, ratio: 1 });
        expect(asked).toHaveLength(1);
        // A quarter turn about the scan's origin: the pane now covers pixels above the scan (none) and the same first tile.
        detailScene(shown, { view: { scale: 2, offset: { x: 0, y: 0 }, angle: Math.PI / 2 }, pane: PANE, previewScale: 0.25, ratio: 1 });
        expect(asked).toHaveLength(1);
        // Turned about a point far into the scan: the tiles under its four corners, more than the upright pane's one.
        const far = rotateView({ scale: 2, offset: { x: -3000, y: -3000 } }, Math.PI / 4, CENTRE);
        detailScene(shown, { view: far, pane: PANE, previewScale: 0.25, ratio: 1 });
        expect(asked.length).toBeGreaterThan(1);
        expect(asked.length).toBeLessThanOrEqual(5);

        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const transforms = vi.spyOn(CanvasRenderingContext2D.prototype, 'setTransform');
        const scene = { markers: [], selected: null, half: null, crosshair: false, dragged: null, previewScale: 0.5 };
        drawScan(canvas, {
            ...scene,
            image: document.createElement('canvas'),
            view: { scale: 1, offset: { x: 0, y: 0 }, angle: Math.PI / 2 },
        });
        // A quarter turn: the transform's second term (the sine) is the scale, its first (the cosine) nothing.
        const terms = transforms.mock.calls.map((call) => call as unknown as readonly number[]);
        expect(terms.some(([cos = 1, sin = 0]) => Math.abs(cos) < 1e-9 && sin > 0)).toBe(true);
        vi.restoreAllMocks();
        canvas.remove();
    });
});

describe('the scan pane turns', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('happyPath_theKeysAndCtrlWithADragTurnTheScanAndSayItsAngle @S-A16-HAPPY-GEOREF-ROTATE', async () => {
        const element = await viewer();
        const said: { centre: { x: number; y: number }; angle: number }[] = [];
        element.addEventListener('hcm-view', (event) => said.push((event as CustomEvent<(typeof said)[number]>).detail));
        const key = (name: string): void => {
            canvasOf(element).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
        };
        const centre = element.centre;

        key('r');
        expect(said.at(-1)?.angle).toBeCloseTo(TURN_STEP, 12);
        key('R');
        key('R');
        expect(said.at(-1)?.angle).toBeCloseTo(-TURN_STEP, 12);
        expect(said.at(-1)?.centre.x).toBeCloseTo(centre.x, 6);
        expect(said.at(-1)?.centre.y).toBeCloseTo(centre.y, 6);
        key('n');
        expect(said.at(-1)?.angle).toBeCloseTo(0, 12);
        expect(element.rotateBy(0.25)).toBe(true);
        expect(element.view.angle).toBeCloseTo(0.25, 12);
        expect(element.upright()).toBe(true);

        // Ctrl and a drag from the right of the centre to below it: a quarter turn, and no pair is picked or moved.
        const picked: unknown[] = [];
        element.addEventListener('hcm-select', (event) => picked.push(event));
        // A made-up pointer cannot be captured: the capture is the browser's, not the pane's.
        vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => undefined);
        const box = element.getBoundingClientRect();
        const pointer = (type: string, x: number, y: number): void => {
            canvasOf(element).dispatchEvent(
                new PointerEvent(type, {
                    clientX: box.left + x,
                    clientY: box.top + y,
                    pointerId: 7,
                    button: 0,
                    ctrlKey: true,
                    bubbles: true,
                }),
            );
        };
        pointer('pointerdown', 300, 120);
        pointer('pointermove', 200, 220);
        pointer('pointerup', 200, 220);
        expect(element.view.angle).toBeCloseTo(Math.PI / 2, 6);
        expect(picked).toEqual([]);

        // The linked map's place with an angle turns the pane; one without keeps the turn the owner gave it.
        element.follow = { centre: { x: 1000, y: 600 }, scale: 1, angle: 1 };
        await updated(element);
        expect(element.view.angle).toBe(1);
        element.follow = { centre: { x: 900, y: 600 }, scale: 1 };
        await updated(element);
        expect(element.view.angle).toBe(1);
    });
});

describe('the turn buttons on the page', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_eachPaneHasItsTurnButtonsAndThePanesTurnTogetherByDefault @S-A16-HAPPY-GEOREF-ROTATE', async () => {
        const { element, area } = await georefPage(georefState());
        const scan = deep(element, '.scan-pane hcm-scan-viewer') as HcmScanViewer;
        const turnedBy = vi.spyOn(scan, 'rotateBy');
        const upright = vi.spyOn(scan, 'upright');
        const press = (pane: string, name: string): void => {
            deep(deep(element, `.${pane} [data-turn="${name}"]`), 'button').click();
        };

        expect(deepAll(element, '[role="group"].turn').map((group) => group.getAttribute('aria-label'))).toEqual([
            'Turn the scan',
            'Turn the map',
        ]);
        press('scan-pane', 'left');
        press('scan-pane', 'right');
        press('scan-pane', 'scanUp');
        // Upright turns back by what the pane is turned (nothing here), through the same method.
        expect(turnedBy.mock.calls.slice(0, 2).map((call) => Math.round((call[0] * 180) / Math.PI))).toEqual([-15, 15]);
        expect(upright).toHaveBeenCalledTimes(1);

        press('map-pane', 'left');
        press('map-pane', 'right');
        press('map-pane', 'mapUp');
        const together = deep(element, '[data-action="rotate-together"]') as HTMLElement & { pressed: boolean };
        expect(together.pressed).toBe(true);
        deep(together, 'button').click();
        expect(area.calls.filter((call) => call.startsWith('rotateMap') || call.startsWith('setRotateLinked'))).toEqual([
            'rotateMap -15',
            'rotateMap 15',
            'rotateMap null',
            'setRotateLinked false',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAFitThePanesCannotBeTurnedTogetherAndTurnedApartTheToggleIsOff @S-A16-BAD-GEOREF-ROTATE-APART', async () => {
        const fit = { ...georefState().fit, refusal: 'too-few' as const };
        const none = await georefPage(georefState({ fit }), { locale: 'ro' });
        const off = deep(none.element, '[data-action="rotate-together"]') as HTMLElement & { pressed: boolean };
        expect([off.hasAttribute('disabled'), off.pressed, off.textContent.trim()]).toEqual([true, false, 'Rotește panourile împreună']);
        cleanup();

        const apart = await georefPage(georefState({ rotateLinked: false }));
        expect((deep(apart.element, '[data-action="rotate-together"]') as HTMLElement & { pressed: boolean }).pressed).toBe(false);
    });
});
