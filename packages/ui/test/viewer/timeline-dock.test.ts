import { afterEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { deepActiveElement } from '../../src/components/focus.js';
import type { HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, EXPANDED, LANDSCAPE_PHONE, mountViewer, part, type Mounted } from './viewer-harness.js';

/**
 * V12: on a phone the timeline rests as its year's pill and opens on a press; a press back on the map or Esc collapses
 * it. V13: a year with several dates opens its date picker, and the date picked comes to the front.
 */

/** The test manifest with a second layer of 1966, dated, so 1966 has two dates. */
function twoDates() {
    return testManifest((raw) => {
        const layers = raw['layers'] as Record<string, unknown>[];
        const [, corona] = layers;
        layers.push({ ...corona, id: 'kh4-1966b', date: '1966-09-03', label: { ro: 'Corona 1966 B', en: 'Corona 1966 B' }, order: 3 });
    });
}

function timelineOf(mounted: Mounted): HcmTimeline {
    return part(mounted, 'hcm-timeline') as HcmTimeline;
}

function collapsed(mounted: Mounted): boolean {
    return part(mounted, '.frame').hasAttribute('data-timeline-collapsed') && timelineOf(mounted).collapsed;
}

function press(target: Element): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true, cancelable: true, composed: true }));
}

describe('<hcm-map-viewer>: the timeline as a pill on a phone (V12)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each([
        { name: 'upright', box: COMPACT },
        { name: 'on its side', box: LANDSCAPE_PHONE },
    ])('happyPath_$name: idleItIsThePillAPressOpensItThePressMovesNoYear', async ({ box }) => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), box);
        expect(collapsed(mounted)).toBe(true);

        press(shadowQuery(timelineOf(mounted), '.thumb'));
        await mounted.element.updateComplete;

        expect(collapsed(mounted)).toBe(false);
        expect(mounted.store.callsOf('setYear')).toEqual([]);
    });

    it('happyPath_aFingerHeldOnThePillOpensTheCardWithItsOpacityCardAndAMovedFingerDoesNot', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
            shadowQuery(timelineOf(mounted), '.thumb').dispatchEvent(
                new PointerEvent('pointerdown', {
                    pointerType: 'touch',
                    clientX: 5,
                    clientY: 5,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                }),
            );
            await mounted.element.updateComplete;
            vi.advanceTimersByTime(600);
            await timelineOf(mounted).updateComplete;
            expect(collapsed(mounted)).toBe(false);
            expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet hcm-slider')).not.toBeNull();
            expect(timelineOf(mounted).hasAttribute('fadable')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('badPath_aFingerThatMovesOffThePillOpensTheCardWithoutTheOpacityCard', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
            shadowQuery(timelineOf(mounted), '.thumb').dispatchEvent(
                new PointerEvent('pointerdown', {
                    pointerType: 'touch',
                    clientX: 5,
                    clientY: 5,
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                }),
            );
            document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 60, clientY: 5 }));
            vi.advanceTimersByTime(600);
            await timelineOf(mounted).updateComplete;
            expect(collapsed(mounted)).toBe(false);
            expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
            mounted.element.remove();
        } finally {
            vi.useRealTimers();
        }
    });

    it('happyPath_aPressOnTheMapOrEscCollapsesItAgain', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;

        press(part(mounted, '.map'));
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(true);

        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(false);
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
        );
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(true);
    });

    it('happyPath_theSkipLinkOpensItWithTheFocusOnTheSlider', async () => {
        const mounted = await mountViewer(readyState(), COMPACT);

        part(mounted, '.skip').click();
        await mounted.element.updateComplete;

        expect(collapsed(mounted)).toBe(false);
        expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
    });

    it('badPath_aLargerWindowNeverCollapsesIt', async () => {
        const mounted = await mountViewer(readyState(), EXPANDED);

        expect(collapsed(mounted)).toBe(false);
        expect(part(mounted, '.frame').hasAttribute('data-timeline-collapsed')).toBe(false);
        press(part(mounted, '.map'));
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
        );
        await mounted.element.updateComplete;
        expect(collapsed(mounted)).toBe(false);
    });

    it.each([
        { name: '360 x 700', box: COMPACT },
        { name: '320 x 568', box: { width: 320, height: 568 } },
    ])('badPath_theLargerPillLeavesTheChipClear_$name', async ({ box }) => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1977 }), box);
        const pill = timelineOf(mounted).getBoundingClientRect();
        const chip = part(mounted, '.dock.chip').getBoundingClientRect();

        expect(Math.round(pill.height)).toBe(64);
        expect(pill.width).toBeGreaterThanOrEqual(96);
        expect(chip.top - pill.bottom).toBeGreaterThanOrEqual(8);
    });
});

describe('<hcm-map-viewer>: the date picker of a year (V13)', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    function enter(mounted: Mounted): void {
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }),
        );
    }

    async function menuOf(mounted: Mounted): Promise<Element> {
        await vi.waitFor(() => {
            expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).not.toBeNull();
        });
        await mounted.element.updateComplete;
        return part(mounted, 'hcm-date-menu');
    }

    async function opened(box = EXPANDED): Promise<Mounted> {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), box);
        expect(shadowQuery(timelineOf(mounted), '.thumb .badge').textContent.trim()).toBe('2');
        enter(mounted);
        await menuOf(mounted);
        return mounted;
    }

    it('happyPath_aClickOnTheYearOpensTheDatesWithTheFocusOnTheOneShown', async () => {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), EXPANDED);
        const track = shadowQuery(timelineOf(mounted), '.track');
        const thumb = shadowQuery(timelineOf(mounted), '.thumb').getBoundingClientRect();
        // The year's own stop, not the pill: the pill may still be gliding there from today (its 350 ms spring).
        const year = shadowQuery(timelineOf(mounted), '.stop.selected').getBoundingClientRect();
        const at = { clientX: year.x + year.width / 2, clientY: thumb.y + thumb.height / 2, button: 0, bubbles: true, composed: true };

        track.dispatchEvent(new PointerEvent('pointerdown', { ...at, cancelable: true }));
        window.dispatchEvent(new PointerEvent('pointerup', at));
        const menu = await menuOf(mounted);

        await vi.waitFor(() => {
            expect(menu.shadowRoot?.activeElement?.getAttribute('data-item')).toBe('kh4-1966b');
        });
        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
    });

    it('happyPath_onAPhonesPillEnterOpensTheCardThenTheDatesBesideItsThumb', async () => {
        const mounted = await opened(COMPACT);

        expect(collapsed(mounted)).toBe(false);
        const card = timelineOf(mounted).getBoundingClientRect();
        const anchor = (part(mounted, 'hcm-date-menu') as unknown as { anchor: { y: number; height: number } }).anchor;
        expect(anchor.height, 'the thumb of the open card, not the pill').toBeLessThan(card.height);
        expect(anchor.y).toBeGreaterThanOrEqual(card.top);
        expect(anchor.y + anchor.height).toBeLessThanOrEqual(card.bottom);
    });

    it('badPath_theGamepadsBClosesTheDatesAndKeepsTheDateShown', async () => {
        const mounted = await opened();

        mounted.element.runInput('close');
        await mounted.element.updateComplete;

        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
        expect(mounted.store.callsOf('closeSheet')).toEqual([]);
    });

    it('happyPath_enterOnTheYearOpensTheDatesTheFramesInertAPickComesToTheFront', async () => {
        const mounted = await opened();

        await expect.element(page.getByRole('menu', { name: 'Datele din 1966' })).toBeVisible();
        expect(part(mounted, '.frame').inert).toBe(true);
        const menu = part(mounted, 'hcm-date-menu');
        shadowQuery(menu, '[data-item="kh4-1966"]').click();
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([['kh4-1966']]);
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
        await vi.waitFor(() => {
            expect(deepActiveElement()?.getAttribute('role')).toBe('slider');
        });
    });

    it('badPath_escClosesThePickerWithoutAPick', async () => {
        const mounted = await opened();
        const menu = part(mounted, 'hcm-date-menu');

        shadowQuery(menu, '[role="menu"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
    });

    it('happyPath_theCheckedDateIsTheOneOnTop', async () => {
        const mounted = await opened();
        const menu = part(mounted, 'hcm-date-menu');

        expect(shadowQuery(menu, '[aria-checked="true"]').getAttribute('data-item')).toBe('kh4-1966b');
    });
});

describe('<hcm-map-viewer>: the year opacity sheet on a phone', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_theOpacityButtonOpensAModalSheetItsSliderSetsTheLayerAndEscClosesIt', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        await timelineOf(mounted).updateComplete;
        shadowQuery(timelineOf(mounted), '.opacity-open').click();
        await mounted.element.updateComplete;
        await mounted.element.updateComplete;
        const sheet = part(mounted, '.opacity-sheet');
        expect(sheet.getAttribute('role')).toBe('dialog');
        expect(part(mounted, '.frame').inert).toBe(true);
        const slider = part(mounted, '.opacity-sheet hcm-slider');
        slider.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 30 }, bubbles: true, composed: true }));
        expect(mounted.store.callsOf('setOverlayOpacity').at(-1)?.[1]).toBeCloseTo(0.3);

        sheet.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, composed: true }));
        const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true, composed: true });
        sheet.dispatchEvent(back);
        expect(back.defaultPrevented, 'Tab stays in the sheet').toBe(true);
        part(mounted, '.opacity-close').click();
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        shadowQuery(timelineOf(mounted), '.opacity-open').click();
        await mounted.element.updateComplete;
        const reopened = part(mounted, '.opacity-sheet');
        reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
    });

    it('badPath_aYearOfSeveralDatesOpensItsDatesInsteadOfTheSheet_BClosesThem', async () => {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        const open = async (): Promise<void> => {
            timelineOf(mounted).dispatchEvent(new CustomEvent('hcm-opacity-sheet', { bubbles: true, composed: true }));
            await mounted.element.updateComplete;
        };
        // A year of several dates never shows the sheet alone: its dates come with the sliders (the owner, 2026-11-22).
        await open();
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).not.toBeNull();
        mounted.element.runInput('close');
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(collapsed(mounted), 'the card stays open').toBe(false);

        await open();
        timelineOf(mounted).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true }));
        shadowQuery(timelineOf(mounted), '.thumb').dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        await mounted.element.updateComplete;
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).not.toBeNull();
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        // The year's sliders come with its dates, in the same popup (side by side, also on a phone).
        const menu = mounted.element.shadowRoot?.querySelector('hcm-date-menu');
        expect(menu?.querySelectorAll('.opacity-sliders hcm-slider')).toHaveLength(3);
        expect(menu?.side).toBe(true);
        expect(menu?.shadowRoot?.querySelector('.side slot')).not.toBeNull();
        menu?.shadowRoot
            ?.querySelector('.side')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
        menu?.shadowRoot?.querySelector('.side')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, composed: true }));
    });

    it('happyPath_theGamepadsBClosesTheSheetAndAnotherCommandLeavesItOpen', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        timelineOf(mounted).dispatchEvent(new CustomEvent('hcm-opacity-sheet', { bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(part(mounted, '.opacity-sheet').getAttribute('role')).toBe('dialog');

        mounted.element.runInput('opacity-up');
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet'), 'only a close closes it').not.toBeNull();
        mounted.element.runInput('close');
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
    });

    it('badPath_aSecondSheetRequestWhileTheDatesAreOpenKeepsThemAndBWithNothingOpenDoesNothing', async () => {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), COMPACT);
        press(timelineOf(mounted));
        await mounted.element.updateComplete;
        const ask = async (): Promise<void> => {
            timelineOf(mounted).dispatchEvent(new CustomEvent('hcm-opacity-sheet', { bubbles: true, composed: true }));
            await mounted.element.updateComplete;
        };
        await ask();
        const first = mounted.element.shadowRoot?.querySelector('hcm-date-menu')?.anchor;
        await ask();
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')?.anchor, 'the open menu stays where it is').toEqual(first);
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();

        mounted.element.runInput('close');
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        mounted.element.runInput('close');
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('hcm-date-menu')).toBeNull();
        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
    });

    it('badPath_todayHasNoSheetAndTheFrameStaysLive', async () => {
        const mounted = await mountViewer(readyState(testManifest(), { year: null }), COMPACT);
        timelineOf(mounted).dispatchEvent(new CustomEvent('hcm-opacity-sheet', { bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(mounted.element.shadowRoot?.querySelector('.opacity-sheet')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
    });
});
