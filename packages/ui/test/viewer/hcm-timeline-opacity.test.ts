import type { Overlay } from '@hcm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HCM_TIMELINE_TAG, type HcmTimeline, defineHcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { OpacityReveal, yearOpacity } from '../../src/viewer/timeline-opacity.js';
import { mountElement, recordEvents, shadowQuery } from './doubles.js';

/** The selected year's opacity card above the timeline's thumb (the owner, 2026-11-15). */
const LAYER = { id: 'l1977', name: 'Bucharest 1977', opacity: 0.8 };
type TimelineWithOpacity = HcmTimeline & { opacity: typeof LAYER | null };

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function timeline(opacity: typeof LAYER | null = LAYER): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: [1966, 1977, null], value: 1977 });
    (element as TimelineWithOpacity).opacity = opacity;
    element.style.inlineSize = '400px';
    await frame();
    await element.updateComplete;
    return element;
}

function thumb(element: HcmTimeline): HTMLElement {
    return shadowQuery(element, '.thumb');
}

function card(element: HcmTimeline): HTMLElement | null {
    return element.shadowRoot?.querySelector<HTMLElement>('.opacity:not([hidden])') ?? null;
}

function pointer(target: EventTarget, type: string, pointerType: string, x = 10, y = 10): void {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerType, bubbles: true, composed: true }));
}

describe('the timeline opacity card', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aMouseOnTheSelectedYearShowsALabelledSliderThatSendsTheLayersOpacity', async () => {
        const element = await timeline();
        expect(card(element)).toBeNull();

        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        const slider = shadowQuery(element, '.opacity hcm-slider') as HTMLElement & { value: number; label: string; valueText: string };
        await (slider as unknown as { updateComplete: Promise<unknown> }).updateComplete;
        expect(slider.label).toBe('Opacitate: Bucharest 1977');
        expect(slider.valueText).toBe('80 %');
        expect(slider.value).toBe(80);

        const sent = recordEvents(element, 'hcm-overlay-opacity');
        slider.dispatchEvent(new CustomEvent('hcm-input', { detail: { value: 35 }, bubbles: true, composed: true }));
        slider.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 35 }, bubbles: true, composed: true }));
        expect(sent.map((event) => event.detail)).toEqual([
            { id: 'l1977', opacity: 0.35, final: false },
            { id: 'l1977', opacity: 0.35, final: true },
        ]);
    });

    it('happyPath_theKeyboardsFocusShowsItTabReachesItAndEscHidesItBackOnTheThumb', async () => {
        const element = await timeline();
        thumb(element).focus({ focusVisible: true });
        await element.updateComplete;
        const input = shadowQuery(element, '.opacity hcm-slider');

        shadowQuery(input, '[role="slider"]').focus();
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        await element.updateComplete;
        expect(card(element)).toBeNull();
        expect(element.shadowRoot?.activeElement).toBe(thumb(element));
    });

    it('happyPath_aFingersTapOnTheThumbTogglesItAndAPressElsewhereClosesIt', async () => {
        const element = await timeline();
        pointer(thumb(element), 'pointerdown', 'touch');
        pointer(thumb(element), 'pointerup', 'touch', 12, 11);
        await element.updateComplete;
        expect(card(element)).not.toBeNull();

        pointer(document.body, 'pointerdown', 'touch');
        await element.updateComplete;
        expect(card(element)).toBeNull();
    });

    it('badPath_aScrubIsNotATapAndTheMouseLeavingHidesItAfterADelay', async () => {
        const element = await timeline();
        pointer(thumb(element), 'pointerdown', 'touch');
        pointer(thumb(element), 'pointerup', 'touch', 80, 10);
        await element.updateComplete;
        expect(card(element)).toBeNull();

        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        pointer(thumb(element), 'pointerout', 'mouse');
        await new Promise((resolve) => {
            setTimeout(resolve, 450);
        });
        await element.updateComplete;
        expect(card(element)).toBeNull();
    });

    it('badPath_noLayerTodayOrWhileDraggingNoCard', async () => {
        const element = await timeline(null);
        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        expect(card(element)).toBeNull();

        (element as TimelineWithOpacity).opacity = LAYER;
        element.dragging = true;
        await element.updateComplete;
        expect(card(element)).toBeNull();
        expect(yearOpacity([], 'l1977', 'en')).toBeNull();
        expect(yearOpacity([], null, 'en')).toBeNull();
    });

    it('badPath_touchHoversAndEscWithNothingShownDoNothingAndTheCollapsedPillHasNoCard', async () => {
        const element = await timeline();
        pointer(thumb(element), 'pointerover', 'touch');
        pointer(thumb(element), 'pointerout', 'touch');
        pointer(thumb(element), 'pointerdown', 'mouse');
        pointer(thumb(element), 'pointerup', 'mouse');
        thumb(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        await element.updateComplete;
        expect(card(element)).toBeNull();

        element.remove();
        document.body.append(element);
        thumb(element).dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
        pointer(thumb(element), 'pointerover', 'mouse');
        element.collapsed = true;
        await element.updateComplete;
        expect(card(element)).toBeNull();

        element.collapsed = false;
        await element.updateComplete;
        const box = shadowQuery(element, '.opacity');
        box.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        pointer(box, 'pointerleave', 'mouse');
        pointer(box, 'pointerenter', 'mouse');
        const input = shadowQuery(element, '.opacity hcm-slider');
        shadowQuery(input, '[role="slider"]').focus();
        thumb(element).focus({ focusVisible: true });
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
        pointer(shadowQuery(element, '.opacity'), 'pointerdown', 'touch');
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
    });
});

describe('the timeline opacity card, standing', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_standingTheCardSitsBesideTheThumbAndTheLayerIsTheFrontOverlay', async () => {
        const element = await timeline();
        element.orientation = 'vertical';
        thumb(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        expect(shadowQuery(element, '.opacity').style.top).not.toBe('');
        thumb(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        await element.updateComplete;
        expect(card(element)).toBeNull();

        const overlay = {
            id: 'l1977',
            kind: 'layer',
            label: { ro: 'Strat 1977', en: 'Layer 1977' },
            visible: true,
            opacity: 0.6,
            defaultVisible: true,
            defaultOpacity: 1,
        } as unknown as Overlay;
        expect(yearOpacity([overlay], 'l1977', 'en')).toEqual({ id: 'l1977', name: 'Layer 1977', opacity: 0.6 });
    });
});

function revealRoot(): HTMLDivElement {
    const root = document.createElement('div');
    const thumb = document.createElement('button');
    thumb.className = 'thumb';
    thumb.type = 'button';
    const card = document.createElement('div');
    card.className = 'opacity';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'x';
    card.append(button);
    root.append(thumb, card);
    return root;
}

describe('the opacity reveal control', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('badPath_touchDownOnTheThumbHidesAndDisconnectRemovesTheOutsideClose', () => {
        const root = revealRoot();
        document.body.append(root);
        const host = Object.assign(new EventTarget(), { renderRoot: root, requestUpdate: vi.fn() });
        const reveal = new OpacityReveal(host);
        reveal.listen(root);
        reveal.listen(root);
        reveal.show();
        expect(reveal.shown).toBe(true);

        const thumb = root.querySelector('.thumb');
        if (!(thumb instanceof HTMLElement)) {
            throw new Error('no thumb');
        }
        pointer(thumb, 'pointerdown', 'touch');
        expect(reveal.shown).toBe(false);

        reveal.show();
        reveal.disconnect();
        pointer(document.body, 'pointerdown', 'mouse');
        expect(reveal.shown).toBe(true);
    });

    it('badPath_pointerLeaveWaitsWhileTheCardKeepsFocusThenHides', () => {
        vi.useFakeTimers();
        const root = revealRoot();
        document.body.append(root);
        const host = Object.assign(new EventTarget(), { renderRoot: root, requestUpdate: vi.fn() });
        const reveal = new OpacityReveal(host);
        reveal.listen(root);
        reveal.show();

        const thumbButton = root.querySelector('.thumb');
        const cardButton = root.querySelector('.opacity button');
        if (!(thumbButton instanceof HTMLElement) || !(cardButton instanceof HTMLElement)) {
            throw new Error('missing reveal controls');
        }
        cardButton.focus();
        pointer(thumbButton, 'pointerout', 'mouse');
        vi.advanceTimersByTime(450);
        expect(reveal.shown).toBe(true);

        cardButton.blur();
        pointer(thumbButton, 'pointerout', 'mouse');
        vi.advanceTimersByTime(450);
        expect(reveal.shown).toBe(false);
    });
});
