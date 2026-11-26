import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery } from './doubles.js';

/** Sixty-one years and today: the card scrolls. */
const VERY_MANY = [...Array.from({ length: 61 }, (_, at) => 1924 + at), null];

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function timeline(orientation: 'horizontal' | 'vertical' = 'horizontal'): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: VERY_MANY, value: 1924, orientation });
    element.style.inlineSize = '320px';
    element.style.blockSize = orientation === 'vertical' ? '360px' : '';
    await frame();
    await frame();
    await element.updateComplete;
    return element;
}

function mouse(target: EventTarget, type: string, x: number, y: number, pointerType = 'mouse'): void {
    target.dispatchEvent(
        new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerType, bubbles: true, cancelable: true, composed: true }),
    );
}

function middle(element: HcmTimeline): { readonly x: number; readonly y: number } {
    const box = shadowQuery(element, '.scroller').getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

async function years(element: HcmTimeline, events: readonly { readonly detail: unknown }[]): Promise<unknown[]> {
    await frame();
    await element.updateComplete;
    return events.map((event) => (event.detail as { year: unknown }).year);
}

describe('<hcm-timeline> mouse on a scrolling card', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each(['horizontal', 'vertical'] as const)('happyPath_%s_aMouseDragScrollsTheYearsWithoutSelecting', async (orientation) => {
        const element = await timeline(orientation);
        const scroller = shadowQuery(element, '.scroller');
        const track = shadowQuery(element, '.track');
        const events = recordEvents(element, 'hcm-year-change');
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
        scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
        const before = { left: scroller.scrollLeft, top: scroller.scrollTop };
        const { x, y } = middle(element);
        const vertical = orientation === 'vertical';

        mouse(track, 'pointerdown', x, y);
        mouse(window, 'pointermove', vertical ? x : x - 60, vertical ? y + 60 : y);
        expect(scroller.hasAttribute('data-panning')).toBe(true);
        expect(getComputedStyle(track).cursor).toBe('grabbing');
        mouse(window, 'pointerup', vertical ? x : x - 60, vertical ? y + 60 : y);

        expect(vertical ? scroller.scrollTop - before.top : scroller.scrollLeft - before.left).toBe(vertical ? -60 : 60);
        expect(scroller.hasAttribute('data-panning')).toBe(false);
        expect(await years(element, events)).toEqual([]);
    });

    it('badPath_aClickWithinTheSlopStillSelectsTheYearUnderIt', async () => {
        const element = await timeline();
        const track = shadowQuery(element, '.track');
        const events = recordEvents(element, 'hcm-year-change');
        const { x, y } = middle(element);

        expect(getComputedStyle(track).cursor).toBe('grab');
        mouse(track, 'pointerdown', x, y);
        mouse(window, 'pointermove', x + 3, y);
        mouse(window, 'pointerup', x + 3, y);

        const sent = await years(element, events);
        expect(sent).toHaveLength(1);
        expect(sent[0]).not.toBe(1924);
    });

    it('badPath_aCancelledPanSelectsNothing', async () => {
        const element = await timeline();
        const track = shadowQuery(element, '.track');
        const events = recordEvents(element, 'hcm-year-change');
        const { x, y } = middle(element);

        mouse(track, 'pointerdown', x, y);
        mouse(window, 'pointercancel', x, y);

        expect(await years(element, events)).toEqual([]);
    });

    it('happyPath_aPenStillDragsTheThumb', async () => {
        const element = await timeline();
        const track = shadowQuery(element, '.track');
        const events = recordEvents(element, 'hcm-year-change');
        const { x, y } = middle(element);

        mouse(track, 'pointerdown', x, y, 'pen');
        mouse(window, 'pointerup', x, y, 'pen');

        expect(await years(element, events)).toHaveLength(1);
    });

    it.each([
        ['a plain wheel', { deltaY: 100 }, 100],
        ['a shift-wheel', { deltaY: 100, shiftKey: true }, 100],
        ['a sideways wheel (left to the browser)', { deltaX: 100, deltaY: 10 }, 0],
        ['no turn', { deltaY: 0 }, 0],
    ])('happyPath_%s', async (_name, init, moved) => {
        const element = await timeline();
        const scroller = shadowQuery(element, '.scroller');
        const before = scroller.scrollLeft;

        scroller.dispatchEvent(new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true, composed: true }));

        expect(scroller.scrollLeft - before).toBe(moved);
    });

    it('badPath_aStandingCardLeavesTheWheelToTheBrowser', async () => {
        const element = await timeline('vertical');
        const scroller = shadowQuery(element, '.scroller');
        const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true, composed: true });

        scroller.dispatchEvent(wheel);

        expect(wheel.defaultPrevented).toBe(false);
    });

    it('happyPath_keyboardFocusScrollsTheSelectedYearIntoView', async () => {
        const element = await timeline();
        const scroller = shadowQuery(element, '.scroller');
        scroller.scrollLeft = scroller.scrollWidth;
        const thumb = shadowQuery(element, '.thumb');

        await userEvent.keyboard('{Tab}');
        expect(element.shadowRoot?.activeElement).toBe(thumb);

        const view = scroller.getBoundingClientRect();
        const box = thumb.getBoundingClientRect();
        expect(box.left).toBeGreaterThanOrEqual(view.left);
        expect(box.right).toBeLessThanOrEqual(view.right);
    });
});
