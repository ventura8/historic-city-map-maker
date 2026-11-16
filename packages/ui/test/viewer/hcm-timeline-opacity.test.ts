import type { Overlay } from '@hcm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HCM_TIMELINE_TAG, type HcmTimeline, defineHcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { yearOpacity } from '../../src/viewer/timeline-opacity.js';
import { meanPercent } from '../../src/viewer/timeline-opacity-card.js';
import { mountElement, recordEvents, shadowQuery } from './doubles.js';

/** The selected year's opacity card above the timeline's thumb (the owner, 2026-11-15). */
const LAYER = { year: 1977, layers: [{ id: 'l1977', name: 'Bucharest 1977', date: '1977', opacity: 0.8 }] };
/** A year of two layers: "all" first, then a row per date. */
const TWO = {
    year: 1977,
    layers: [
        { id: 'a', name: 'Spring 1977', date: 'April 1977', opacity: 0.4 },
        { id: 'b', name: 'Autumn 1977', date: 'October 1977', opacity: 0.9 },
    ],
};

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function timeline(opacity: typeof LAYER | null = LAYER): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: [1966, 1977, null], value: 1977, opacity });
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

    it('happyPath_EnterOnThePillShowsItTabReachesItAndEscHidesItBackOnTheThumb', async () => {
        const element = await timeline();
        thumb(element).focus();
        await element.updateComplete;
        expect(card(element), "the focus alone does not open it (the D-pad's path)").toBeNull();
        thumb(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
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

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            pointer(thumb(element), 'pointerover', 'mouse');
            await element.updateComplete;
            pointer(thumb(element), 'pointerout', 'mouse');
            vi.advanceTimersByTime(399);
            await element.updateComplete;
            expect(card(element), 'still there on the way to the card').not.toBeNull();
            vi.advanceTimersByTime(1);
            await element.updateComplete;
            expect(card(element)).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });

    it('badPath_noLayerTodayOrWhileDraggingNoCard', async () => {
        const element = await timeline(null);
        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        expect(card(element)).toBeNull();

        element.opacity = LAYER;
        element.dragging = true;
        await element.updateComplete;
        expect(card(element)).toBeNull();
        expect(yearOpacity([], [{ id: 'l1977', year: 1977, label: { ro: 'L', en: 'L' } }], 1977, 'en')).toBeNull();
        expect(yearOpacity([], [], 1977, 'en')).toBeNull();
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
        thumb(element).focus();
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
        expect(yearOpacity([overlay], [{ id: 'l1977', year: 1977, date: '1977-04', label: { ro: 'L', en: 'L' } }], 1977, 'en')).toEqual({
            year: 1977,
            layers: [{ id: 'l1977', name: 'Layer 1977', date: 'April 1977', opacity: 0.6 }],
        });
    });
});

describe('the timeline opacity card of a year with several layers', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_allFirstThenARowPerLayerAndAllSetsEveryLayer', async () => {
        const element = await timeline(TWO);
        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        type Kit = HTMLElement & { value: number; label: string; updateComplete: Promise<unknown> };
        const sliders = [...(element.shadowRoot?.querySelectorAll<Kit>('.opacity hcm-slider') ?? [])];
        expect(sliders.map((slider) => slider.label)).toEqual([
            'Opacitate: Toate straturile din 1977',
            'Opacitate: Spring 1977',
            'Opacitate: Autumn 1977',
        ]);
        expect(sliders.map((slider) => slider.value)).toEqual([65, 40, 90]);
        expect([...(element.shadowRoot?.querySelectorAll('.opacity-name') ?? [])].map((name) => name.textContent)).toEqual([
            'Toate straturile din 1977',
            'April 1977',
            'October 1977',
        ]);

        const sent = recordEvents(element, 'hcm-overlay-opacity');
        const send = (slider: Kit | undefined, type: string, value: number): void => {
            slider?.dispatchEvent(new CustomEvent(type, { detail: { value }, bubbles: true, composed: true }));
        };
        send(sliders[0], 'hcm-change', 20);
        send(sliders[2], 'hcm-input', 50);
        expect(sent.map((event) => event.detail)).toEqual([
            { id: 'a', opacity: 0.2, final: true },
            { id: 'b', opacity: 0.2, final: true },
            { id: 'b', opacity: 0.5, final: false },
        ]);
    });

    it('badPath_theDateMenuOpeningHidesTheCardSoTheyNeverOverlap', async () => {
        const element = await timeline(TWO);
        element.dateCounts = new Map([[1977, 2]]);
        pointer(thumb(element), 'pointerover', 'mouse');
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
        const opened = recordEvents(element, 'hcm-dates-open');
        thumb(element).dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, composed: true }));
        await element.updateComplete;
        await element.updateComplete;
        expect(opened).toHaveLength(1);
        expect(card(element)).toBeNull();
        expect(meanPercent([])).toBe(0);
    });
});

describe('the timeline opacity card on a long press', () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('happyPath_aFingerHeldOnTheThumbShowsTheCardAndItsLiftDoesNotHideIt', async () => {
        const element = await timeline();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pointer(thumb(element), 'pointerdown', 'touch');
        vi.advanceTimersByTime(600);
        pointer(thumb(element), 'pointerup', 'touch');
        await element.updateComplete;
        expect(card(element)).not.toBeNull();
    });

    it('badPath_aFingerThatMovesOrIsCancelledBeforeTheHoldShowsNothing', async () => {
        const element = await timeline();
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        pointer(thumb(element), 'pointerdown', 'touch');
        await element.updateComplete;
        expect(card(element), 'down').toBeNull();
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: 60, clientY: 10 }));
        await element.updateComplete;
        expect(card(element), 'move').toBeNull();
        document.dispatchEvent(new PointerEvent('pointercancel'));
        vi.advanceTimersByTime(600);
        await element.updateComplete;
        expect(card(element)).toBeNull();
        element.remove();
    });
});

describe('the opacity card on a phone', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aTapEnterALongPressAndTheOpacityButtonAskForTheModalSheet', async () => {
        const element = await timeline(TWO);
        element.setAttribute('phone', '');
        element.requestUpdate();
        await element.updateComplete;
        const asked = recordEvents(element, 'hcm-opacity-sheet');
        pointer(thumb(element), 'pointerdown', 'touch');
        pointer(thumb(element), 'pointerup', 'touch');
        thumb(element).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        const opener = shadowQuery(element, '.opacity-open');
        expect(opener.textContent).toContain('Opacitate: 1977');
        opener.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        opener.click();
        element.holdOpacity();
        await element.updateComplete;
        expect(asked).toHaveLength(4);
        expect(card(element), "no card in the timeline: the sheet is the viewer's").toBeNull();
    });

    it('badPath_aMouseOverThePillShowsNothingAndTheCollapsedPillHasNoButton', async () => {
        const element = await timeline();
        element.setAttribute('phone', '');
        pointer(thumb(element), 'pointerover', 'mouse');
        element.collapsed = true;
        await element.updateComplete;
        expect(card(element)).toBeNull();
        expect(element.shadowRoot?.querySelector('.opacity-open')).toBeNull();
    });
});
