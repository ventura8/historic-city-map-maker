import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, shadowQuery } from './doubles.js';

const STOPS = [1966, 1977, null];

export function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

/** Waits for the card's size to reach the timeline (its ResizeObserver) and for the render that follows. */
export async function settled(element: HcmTimeline): Promise<void> {
    await frame();
    await frame();
    await element.updateComplete;
}

export async function timeline(properties: Partial<HcmTimeline> = {}, size = { inline: 400, block: 300 }): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: null, ...properties });
    element.style.inlineSize = `${String(size.inline)}px`;
    element.style.blockSize = properties.orientation === 'vertical' ? `${String(size.block)}px` : '';
    await settled(element);
    return element;
}

export function press(element: HcmTimeline, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
    shadowQuery(element, '[role="slider"]').dispatchEvent(event);
    return event;
}

export function pointer(target: EventTarget, type: string, x: number, y: number, button = 0): void {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true, composed: true }));
}

export function touch(target: EventTarget, type: string, x: number, y: number): void {
    const init = { clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent(type, init));
}
