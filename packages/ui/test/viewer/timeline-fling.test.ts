import { afterEach, describe, expect, it } from 'vitest';

import { EdgeScroll, edgeSpeed, fling, releaseSpeed, startPan, type Motion } from '../../src/viewer/timeline-pan.js';

/** A fake clock and frame queue: `run` advances `ms` per frame until none is asked for or `limit` frames ran. */
function fakeMotion(reduced = false): Motion & { run: (ms: number, limit?: number) => number; time: number } {
    let queue: (() => void)[] = [];
    const motion = {
        time: 0,
        now: () => motion.time,
        frame: (callback: () => void) => queue.push(callback),
        cancel: () => {
            queue = [];
        },
        reduced: () => reduced,
        run: (ms: number, limit = 10_000): number => {
            let frames = 0;
            while (queue.length > 0 && frames < limit) {
                const next = queue;
                queue = [];
                motion.time += ms;
                next.forEach((callback) => {
                    callback();
                });
                frames += 1;
            }
            return frames;
        },
    };
    return motion;
}

function scroller(): HTMLElement {
    const outer = document.createElement('div');
    outer.style.cssText = 'position:fixed;left:0;top:0;inline-size:200px;block-size:100px;overflow:auto';
    const inner = document.createElement('div');
    inner.style.cssText = 'inline-size:20000px;block-size:20000px';
    outer.append(inner);
    document.body.append(outer);
    outer.scrollLeft = 10_000;
    outer.scrollTop = 10_000;
    return outer;
}

function pointer(type: string, x: number, y = 50): PointerEvent {
    return new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true });
}

describe('the mouse fling', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theSpeedIsThatOfTheLastMovesBeforeRelease', () => {
        const samples = [
            { at: 0, along: 0 },
            { at: 200, along: 10 },
            { at: 250, along: 60 },
            { at: 300, along: 110 },
        ];
        expect(releaseSpeed(samples, 300)).toBe(1);
        expect(
            releaseSpeed(
                [
                    { at: 0, along: 0 },
                    { at: 300, along: 60 },
                ],
                300,
            ),
            'slow frames: the last two moves',
        ).toBe(0.2);
    });

    it('badPath_aPauseBeforeReleaseOrOneMoveHasNoSpeed', () => {
        expect(
            releaseSpeed(
                [
                    { at: 0, along: 0 },
                    { at: 10, along: 50 },
                ],
                500,
            ),
        ).toBe(0);
        expect(releaseSpeed([{ at: 0, along: 0 }], 0)).toBe(0);
        expect(releaseSpeed([], 0)).toBe(0);
    });

    it('happyPath_aFlingKeepsMovingThenDecaysToAStop', () => {
        const motion = fakeMotion();
        const element = scroller();
        fling(element, 2, false, motion);
        motion.run(16, 1);
        const first = element.scrollLeft - 10_000;
        expect(first).toBeGreaterThan(20);
        const frames = motion.run(16);
        expect(frames).toBeGreaterThan(10);
        expect(frames).toBeLessThan(10_000);
        expect(element.scrollLeft - 10_000).toBeGreaterThan(first * 5);
    });

    it('badPath_reducedMotionOrANewPressStopsAtOnce', () => {
        const reduced = fakeMotion(true);
        const element = scroller();
        fling(element, 2, true, reduced);
        expect(reduced.run(16)).toBe(0);
        expect(element.scrollTop).toBe(10_000);

        const motion = fakeMotion();
        const stop = fling(element, 2, true, motion);
        motion.run(16, 2);
        const at = element.scrollTop;
        stop();
        expect(motion.run(16)).toBe(0);
        expect(element.scrollTop).toBe(at);
    });

    it('happyPath_aReleasedPanFlingsOnAndANoMovePanDoesNot', () => {
        const motion = fakeMotion();
        const element = scroller();
        let flung: (() => void) | null = null;
        const hooks = { vertical: false, onClick: () => undefined, onEnd: () => undefined, onFling: (stop: () => void) => (flung = stop) };
        const stop = startPan(element, pointer('pointerdown', 150), hooks, motion);
        for (let at = 1; at <= 5; at += 1) {
            motion.time += 16;
            window.dispatchEvent(pointer('pointermove', 150 - at * 16));
        }
        window.dispatchEvent(pointer('pointerup', 70));
        stop();
        const released = element.scrollLeft;
        expect(flung).not.toBeNull();
        motion.run(16);
        expect(element.scrollLeft).toBeGreaterThan(released + 50);
    });

    it('badPath_aClickPanFlingsNothing', () => {
        const motion = fakeMotion();
        const element = scroller();
        let flung = false;
        const hooks = { vertical: false, onClick: () => undefined, onEnd: () => undefined, onFling: () => (flung = true) };
        const stop = startPan(element, pointer('pointerdown', 150), hooks, motion);
        window.dispatchEvent(pointer('pointerup', 150));
        stop();
        expect(flung).toBe(false);
    });
});

describe('the thumb at an edge', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theEdgesScrollTowardsTheirSideAndTheMiddleDoesNot', () => {
        const rect = new DOMRect(0, 0, 200, 100);
        expect(edgeSpeed(rect, { clientX: 199, clientY: 50 }, false)).toBeGreaterThan(0);
        expect(edgeSpeed(rect, { clientX: 1, clientY: 50 }, false)).toBeLessThan(0);
        expect(edgeSpeed(rect, { clientX: 100, clientY: 50 }, false)).toBe(0);
        expect(edgeSpeed(rect, { clientX: 100, clientY: 1 }, true)).toBeLessThan(0);
    });

    it('happyPath_aThumbHeldAtTheEdgeScrollsAndReselectsUntilStopped', () => {
        const motion = fakeMotion();
        const element = scroller();
        const seen: number[] = [];
        const edges = new EdgeScroll(element, false, (event) => seen.push(event.clientX), motion);
        edges.update(pointer('pointermove', 199));
        motion.run(16, 5);
        expect(element.scrollLeft).toBeGreaterThan(10_000);
        expect(seen.length).toBeGreaterThan(0);
        edges.stop();
        expect(motion.run(16)).toBe(0);
    });

    it('badPath_aThumbAwayFromTheEdgesNeverScrolls', () => {
        const motion = fakeMotion();
        const element = scroller();
        const edges = new EdgeScroll(element, false, () => undefined, motion);
        edges.update(pointer('pointermove', 100));
        expect(motion.run(16)).toBe(0);
        expect(element.scrollLeft).toBe(10_000);
    });
});
