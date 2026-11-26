/**
 * The New city map's rectangle gesture (`packages/ui/src/admin/cities/area-gesture.ts`, M5-interfaces §1.6): a drag or
 * two clicks on the map's element make the rectangle, the map's own drag is held back while drawing, and Move the map
 * hands the pointer back.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { AreaGesture } from '../../../src/admin/cities/area-gesture.js';

function mapElement(): { readonly map: HTMLElement; readonly canvas: HTMLElement } {
    const map = document.createElement('div');
    map.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px';
    const canvas = document.createElement('canvas');
    map.append(canvas);
    document.body.append(map);
    return { map, canvas };
}

function press(target: HTMLElement, type: string, x: number, y: number, extra: PointerEventInit = {}): void {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, bubbles: true, ...extra }));
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('the area gesture', () => {
    it('happyPath_aDragMakesTheRectangleInTheMapsPixelsAndTheMapNeverSeesThePress', () => {
        const drawn: string[] = [];
        const gesture = new AreaGesture((from, to, size) => drawn.push(JSON.stringify([from, to, size])));
        const { map, canvas } = mapElement();
        const seen: string[] = [];
        canvas.addEventListener('mousedown', () => seen.push('mousedown'));
        canvas.addEventListener('pointerdown', () => seen.push('pointerdown'));
        gesture.attach(map);
        gesture.attach(map);

        press(canvas, 'pointerdown', 10, 20);
        canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        press(canvas, 'pointermove', 100, 120);
        press(canvas, 'pointerup', 110, 130);

        expect(drawn).toEqual([
            JSON.stringify([
                { x: 10, y: 20 },
                { x: 110, y: 130 },
                { width: 400, height: 300 },
            ]),
        ]);
        expect(seen).toEqual([]);
        expect(map.style.cursor).toBe('crosshair');
    });

    it('happyPath_twoClicksMakeItTooAndMovingTheMapLetsTheMapHaveThePointer', () => {
        const drawn: unknown[] = [];
        const gesture = new AreaGesture((from, to) => drawn.push([from, to]));
        const { map, canvas } = mapElement();
        const seen: string[] = [];
        canvas.addEventListener('mousedown', () => seen.push('mousedown'));
        gesture.attach(map);

        press(canvas, 'pointerdown', 10, 10);
        press(canvas, 'pointerup', 11, 10);
        expect(drawn).toEqual([]);
        press(canvas, 'pointerdown', 60, 70);
        press(canvas, 'pointerup', 60, 70);
        expect(drawn).toEqual([
            [
                { x: 11, y: 10 },
                { x: 60, y: 70 },
            ],
        ]);

        gesture.setDrawing(false);
        press(canvas, 'pointerdown', 10, 10);
        canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        press(canvas, 'pointerup', 90, 90);
        expect(drawn).toHaveLength(1);
        expect(seen).toEqual(['mousedown']);
        expect([gesture.drawing, map.style.cursor]).toEqual([false, '']);
    });

    it('badPath_anotherButtonACancelledPressOrAPointerTheBrowserForgotDrawNothing', () => {
        const drawn: unknown[] = [];
        const gesture = new AreaGesture((from, to) => drawn.push([from, to]));
        const { map, canvas } = mapElement();
        gesture.attach(map);

        press(canvas, 'pointerdown', 10, 10, { button: 2 });
        press(canvas, 'pointerup', 90, 90);
        press(canvas, 'pointerdown', 10, 10, { pointerId: 987 });
        map.dispatchEvent(new PointerEvent('pointercancel'));
        press(canvas, 'pointermove', 50, 50);
        press(canvas, 'pointerup', 90, 90);

        expect(drawn).toEqual([]);
    });

    it('happyPath_anotherElementReplacesTheFirstAndDetachingStopsListening', () => {
        const drawn: unknown[] = [];
        const gesture = new AreaGesture((from, to) => drawn.push([from, to]));
        const first = mapElement();
        const second = mapElement();
        gesture.attach(first.map);
        gesture.attach(second.map);

        press(first.canvas, 'pointerdown', 10, 10);
        press(first.canvas, 'pointerup', 90, 90);
        expect([drawn, first.map.style.cursor]).toEqual([[], '']);

        gesture.detach();
        gesture.detach();
        press(second.canvas, 'pointerdown', 10, 10);
        press(second.canvas, 'pointerup', 90, 90);
        expect(drawn).toEqual([]);
    });
});

function touchAt(target: HTMLElement, x: number, y: number): Touch {
    return new Touch({ identifier: Math.round(x), target, clientX: x, clientY: y });
}

describe('the area gesture: touch and its band', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_aSecondFingerCancelsTheDragAndThePinchReachesTheMap', () => {
        // docs/LESSONS.md 253: the second finger overwrote the press, and lifting the first drew between the two fingers.
        const drawn: unknown[] = [];
        const gesture = new AreaGesture((from, to) => drawn.push([from, to]));
        const { map, canvas } = mapElement();
        const seen: string[] = [];
        canvas.addEventListener('touchstart', () => seen.push('touchstart'));
        gesture.attach(map);

        press(canvas, 'pointerdown', 10, 10);
        canvas.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touchAt(canvas, 10, 10)] }));
        press(canvas, 'pointerdown', 200, 200, { pointerId: 2, isPrimary: false });
        canvas.dispatchEvent(
            new TouchEvent('touchstart', { bubbles: true, touches: [touchAt(canvas, 10, 10), touchAt(canvas, 200, 200)] }),
        );
        press(canvas, 'pointermove', 150, 150, { pointerId: 2, isPrimary: false });
        press(canvas, 'pointerup', 150, 150, { pointerId: 2, isPrimary: false });
        press(canvas, 'pointerup', 40, 40);

        expect(drawn).toEqual([]);
        expect(seen).toEqual(['touchstart']);
        expect(map.querySelector('[data-area-band]')).toBeNull();
    });

    it('happyPath_aBandShowsTheRectangleUnderWayAndGoesWithIt', () => {
        const drawn: unknown[] = [];
        const gesture = new AreaGesture((from, to) => drawn.push([from, to]));
        const { map, canvas } = mapElement();
        gesture.attach(map);
        const band = (): HTMLElement | null => map.querySelector<HTMLElement>('[data-area-band]');

        press(canvas, 'pointerdown', 10, 20);
        press(canvas, 'pointermove', 7, 9, { pointerId: 2 });
        expect(band()).toBeNull();
        press(canvas, 'pointermove', 110, 70);
        expect([band()?.style.left, band()?.style.top, band()?.style.width, band()?.style.height]).toEqual([
            '6px',
            '16px',
            '108px',
            '58px',
        ]);
        press(canvas, 'pointerup', 110, 70);
        expect(band()).toBeNull();

        press(canvas, 'pointerdown', 50, 50);
        press(canvas, 'pointerup', 50, 50);
        expect([band()?.style.width, band()?.style.height]).toEqual(['8px', '8px']);
        press(canvas, 'pointermove', 90, 80);
        expect([band()?.style.width, band()?.style.height]).toEqual(['48px', '38px']);
        map.dispatchEvent(new PointerEvent('pointercancel'));
        expect(band()).not.toBeNull();
        gesture.setDrawing(false);
        expect(band()).toBeNull();
        expect(drawn).toHaveLength(1);

        gesture.setDrawing(true);
        press(canvas, 'pointerdown', 50, 50);
        map.dispatchEvent(new PointerEvent('pointercancel'));
        expect(band()).toBeNull();
    });
});
