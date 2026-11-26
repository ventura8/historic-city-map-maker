import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_TIMELINE_TAG, HcmTimeline, defineHcmTimeline, trackRatio } from '../../src/viewer/hcm-timeline.js';
import { mountElement, recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';

const STOPS = [1966, 1977, null];

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

/** Waits for the card's size to reach the timeline (its ResizeObserver) and for the render that follows. */
async function settled(element: HcmTimeline): Promise<void> {
    await frame();
    await frame();
    await element.updateComplete;
}

async function timeline(properties: Partial<HcmTimeline> = {}, size = { inline: 400, block: 300 }): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, value: null, ...properties });
    element.style.inlineSize = `${String(size.inline)}px`;
    element.style.blockSize = properties.orientation === 'vertical' ? `${String(size.block)}px` : '';
    await settled(element);
    return element;
}

function press(element: HcmTimeline, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true });
    shadowQuery(element, '[role="slider"]').dispatchEvent(event);
    return event;
}

function pointer(target: EventTarget, type: string, x: number, y: number, button = 0): void {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true, composed: true }));
}

function touch(target: EventTarget, type: string, x: number, y: number): void {
    const init = { clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new PointerEvent(type, init));
}

describe('<hcm-timeline>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aSliderWithTheLocalizedYear', async () => {
        await timeline({ value: 1977 });

        const slider = page.getByRole('slider', { name: 'Cronologie' });
        await expect.element(slider).toHaveAttribute('aria-valuenow', '1');
        await expect.element(slider).toHaveAttribute('aria-valuemax', '2');
        await expect.element(slider).toHaveAttribute('aria-valuetext', 'Anul 1977');
        await expect.element(slider).toHaveAttribute('aria-orientation', 'horizontal');
    });

    it('badPath_theThumbTouchTargetIsAtLeast48Pixels', async () => {
        // The e2e tour found the 40 px thumb under the 48 px target size of compact windows.
        const element = await timeline({ value: 1977 });
        const thumb = shadowQuery(element, '.thumb');
        const target = getComputedStyle(thumb, '::after');

        expect(thumb.classList.contains('touch-target')).toBe(true);
        expect(Number.parseFloat(target.width)).toBeGreaterThanOrEqual(48);
        expect(Number.parseFloat(target.height)).toBeGreaterThanOrEqual(48);
    });

    it('happyPath_todayInEnglish', async () => {
        const element = await timeline({ locale: 'en' });

        await expect.element(page.getByRole('slider', { name: 'Timeline' })).toHaveAttribute('aria-valuetext', 'Today');
        expect(shadowQueryAll(element, '.stop .label').map((label) => label.textContent)).toEqual(['1966', '1977', 'Today']);
    });

    it('happyPath_keysMoveBetweenStops', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowLeft');
        press(element, 'Home');
        press(element, 'ArrowRight');
        press(element, 'End');
        press(element, 'PageDown');
        press(element, 'ArrowDown');
        press(element, 'PageUp');
        press(element, 'ArrowUp');

        expect(events.map((event) => event.detail)).toEqual([
            { year: 1977 },
            { year: 1966 },
            { year: 1977 },
            { year: null },
            { year: 1977 },
            { year: 1966 },
            { year: 1977 },
            { year: null },
        ]);
    });

    it('badPath_keysPastTheEndsAndOtherKeysChangeNothing', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');

        expect(press(element, 'End').defaultPrevented).toBe(true);
        press(element, 'ArrowRight');
        expect(press(element, 'a').defaultPrevented).toBe(false);

        expect(events).toEqual([]);
    });

    it('happyPath_dragAlongTheTrackSnapsToStops', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10);
        await element.updateComplete;
        expect(element.dragging).toBe(true);
        expect(element.hasAttribute('dragging')).toBe(true);
        pointer(window, 'pointermove', rect.left + rect.width / 2, rect.top + 10);
        pointer(window, 'pointerup', rect.left + rect.width / 2, rect.top + 10);
        pointer(window, 'pointermove', rect.right, rect.top + 10);

        expect(events.map((event) => event.detail)).toEqual([{ year: 1966 }, { year: 1977 }]);
        expect(element.dragging).toBe(false);
        expect(element.shadowRoot?.activeElement?.getAttribute('role')).toBe('slider');
    });

    it('happyPath_verticalTrackGrowsUpwards', async () => {
        const element = await timeline({ orientation: 'vertical' });
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 10, rect.bottom - 1);
        pointer(window, 'pointercancel', rect.left + 10, rect.bottom - 1);

        expect(events.map((event) => event.detail)).toEqual([{ year: 1966 }]);
        await expect.element(page.getByRole('slider')).toHaveAttribute('aria-orientation', 'vertical');
    });

    it('badPath_secondaryButtonAndDisconnectEndTheDrag', async () => {
        const element = await timeline();
        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();

        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10, 2);
        expect(element.dragging).toBe(false);

        pointer(track, 'pointerdown', rect.right - 1, rect.top + 10);
        element.remove();
        pointer(window, 'pointermove', rect.left + 1, rect.top + 10);

        expect(events).toEqual([]);
        expect(element.dragging).toBe(false);
    });

    it('badPath_noStopsRendersAnEmptySliderThatIgnoresKeys', async () => {
        const element = await timeline({ stops: [] });
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'End');

        expect(events).toEqual([]);
        await expect.element(page.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Azi');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmTimeline();
        defineHcmTimeline();

        expect(customElements.get(HCM_TIMELINE_TAG)).toBe(HcmTimeline);
    });
});

describe('<hcm-timeline> right to left', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_rightToLeftTheHorizontalArrowsFollowTheThumb', async () => {
        // In Arabic or Hebrew the value grows to the left: Left moves the thumb left, to a later year.
        const element = await timeline({ value: 1966 });
        element.dir = 'rtl';
        const events = recordEvents(element, 'hcm-year-change');

        press(element, 'ArrowLeft');
        press(element, 'ArrowRight');
        press(element, 'ArrowUp');

        expect(events.map((event) => event.detail)).toEqual([{ year: 1977 }, { year: 1966 }, { year: 1977 }]);
    });

    it('badPath_rightToLeftTheThumbAndAPressLandOnTheirStop', async () => {
        // The review shots at 768 px, right to left: the thumb and the stops sat a whole width beside their place.
        const element = await timeline({ value: 1977 });
        element.dir = 'rtl';
        await element.updateComplete;
        const thumb = shadowQuery(element, '.thumb');
        thumb.style.transition = 'none';
        const tick = shadowQueryAll(element, '.stop .label')[1]?.getBoundingClientRect();
        const box = thumb.getBoundingClientRect();
        expect(Math.abs((tick?.left ?? 0) + (tick?.width ?? 0) / 2 - (box.left + box.width / 2))).toBeLessThanOrEqual(1);

        const events = recordEvents(element, 'hcm-year-change');
        const track = shadowQuery(element, '.track');
        const rect = track.getBoundingClientRect();
        pointer(track, 'pointerdown', rect.left + 1, rect.top + 10);
        pointer(window, 'pointerup', rect.left + 1, rect.top + 10);
        expect(events.map((event) => event.detail)).toEqual([{ year: null }]);
    });
});

describe('trackRatio', () => {
    it('happyPath_horizontalAndVerticalShares', () => {
        const rect = new DOMRect(100, 200, 200, 100);

        expect(trackRatio(rect, { clientX: 150, clientY: 0 }, false)).toBe(0.25);
        expect(trackRatio(rect, { clientX: 0, clientY: 225 }, true)).toBe(0.75);
        expect(trackRatio(rect, { clientX: 150, clientY: 0 }, false, true)).toBe(0.75);
    });

    it('badPath_outsideOrEmptyTracksClamp', () => {
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: 500, clientY: 0 }, false)).toBe(1);
        expect(trackRatio(new DOMRect(0, 0, 100, 10), { clientX: -5, clientY: 0 }, false)).toBe(0);
        expect(trackRatio(new DOMRect(0, 0, 0, 0), { clientX: 0, clientY: 0 }, false)).toBe(0);
    });
});

describe('<hcm-timeline> size', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_itsHeightIsTheViewersWhateverThePageFontSize', async () => {
        // The viewer stacks the FAB 8 px above an 84 px timeline; the list's browser margin (1em) made it 100 px tall,
        // more on a page with larger text, and the FAB landed on it (the tour found 0 px between them on phones).
        const element = await timeline({ value: 1977 });
        element.style.fontSize = '24px';
        await element.updateComplete;

        expect(element.getBoundingClientRect().height).toBe(84);
        const track = shadowQuery(element, '.track').getBoundingClientRect();
        expect(track.top - element.getBoundingClientRect().top).toBe(8);
    });

    it('badPath_theVerticalThumbStaysInsideAtBothEnds', async () => {
        // With the list's margin the vertical track sat 16 px low and the thumb at the first year stuck out below it.
        const element = await timeline({ orientation: 'vertical', value: null });
        const box = element.getBoundingClientRect();
        const thumb = shadowQuery(element, '.thumb');

        await expect.poll(() => thumb.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top);
        element.value = 1966;
        await element.updateComplete;
        await expect.poll(() => thumb.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.bottom);
    });
});

/** A city with many layer years: 1964 to 1984 and today, twenty-two stops (the review rendered such a city, 2026-11-08). */
const MANY = [...Array.from({ length: 21 }, (_, at) => 1964 + at), null];
/** Sixty-one years and today: too many for a phone's card even every other one labelled. */
const VERY_MANY = [...Array.from({ length: 61 }, (_, at) => 1924 + at), null];

function meets(a: DOMRect, b: DOMRect): boolean {
    return a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
}

/** The labels shown, other than the selected one (the pill names it). */
function shownLabels(element: HcmTimeline): { readonly text: string; readonly box: DOMRect }[] {
    return shadowQueryAll(element, '.stop:not(.selected):not(.minor) .label').map((label) => ({
        text: label.textContent,
        box: label.getBoundingClientRect(),
    }));
}

/** The labels shown that meet the pill or another label. */
function crowdedLabels(element: HcmTimeline): string[] {
    const thumb = shadowQuery(element, '.thumb').getBoundingClientRect();
    const labels = shownLabels(element);
    return labels
        .filter(({ box }, at) => meets(box, thumb) || labels.some((other, otherAt) => otherAt !== at && meets(box, other.box)))
        .map(({ text }) => text);
}

function scroller(element: HcmTimeline): HTMLElement {
    return shadowQuery(element, '.scroller');
}

function scrolls(element: HcmTimeline): boolean {
    const box = scroller(element);
    return box.scrollWidth > box.clientWidth || box.scrollHeight > box.clientHeight;
}

/** The centres of the stops' labels along the timeline, in stop order (all of them, a hidden one's box included). */
function labelCentres(element: HcmTimeline, orientation: 'horizontal' | 'vertical'): number[] {
    return shadowQueryAll(element, '.stop .label').map((label) => {
        const box = label.getBoundingClientRect();
        return orientation === 'vertical' ? box.top + box.height / 2 : box.left + box.width / 2;
    });
}

function stillThumb(element: HcmTimeline): void {
    for (const part of shadowQueryAll(element, '.thumb, .active')) {
        part.style.transition = 'none';
    }
}

describe('<hcm-timeline> many years', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFewYearsFitWithEveryLabel', async () => {
        const element = await timeline({ value: 1977 });

        expect(element.getAttribute('density')).toBe('roomy');
        expect(scrolls(element)).toBe(false);
        expect(shadowQueryAll(element, '.stop.minor')).toEqual([]);
        expect(crowdedLabels(element)).toEqual([]);
    });

    it.each(['horizontal', 'vertical'] as const)('happyPath_%s_aWideCardKeepsTheYears40PxApartFromItsLeadingEdge', async (orientation) => {
        // The owner, 2026-11-14: "the spacing is way nuked"; a fixed gap at every size, never stretched to the card.
        const element = await timeline({ stops: [1964, 1966, 1968, null], value: 1964, orientation }, { inline: 1300, block: 700 });
        stillThumb(element);

        expect(element.getAttribute('density')).toBe('roomy');
        expect(scrolls(element)).toBe(false);
        const centres = labelCentres(element, orientation);
        const gaps = centres.slice(1).map((centre, at) => Math.abs(centre - (centres[at] ?? 0)));
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(39);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(41);
        // Lying, the first year sits 44 px in from the card's leading edge; standing, today 24 px below its top.
        const card = element.getBoundingClientRect();
        const first = orientation === 'vertical' ? (centres.at(-1) ?? 0) - card.top : (centres[0] ?? 0) - card.left;
        expect(Math.abs(first - (orientation === 'vertical' ? 24 : 44))).toBeLessThanOrEqual(1);
    });

    it.each(['horizontal', 'vertical'] as const)('badPath_%s_twentyTwoYearsScrollEveryYearLabelled40PxApart', async (orientation) => {
        // The owner, 2026-11-14: "too crowded"; no dots, every year a label, a comfortable gap, the card scrolls instead.
        const element = await timeline({ stops: MANY, value: 1964, orientation }, { inline: 420, block: 380 });
        stillThumb(element);

        expect(element.getAttribute('density')).toBe('scroll');
        expect(scrolls(element)).toBe(true);
        expect(shadowQueryAll(element, '.tick')).toEqual([]);
        expect(shadowQueryAll(element, '.stop.minor')).toEqual([]);
        const centres = labelCentres(element, orientation);
        const gaps = centres.slice(1).map((centre, at) => Math.abs(centre - (centres[at] ?? 0)));
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(39);
        expect(Math.max(...gaps)).toBeLessThanOrEqual(41);
        expect(crowdedLabels(element)).toEqual([]);
        // The live site, 2026-11-14: without a tick above it the label sat on the rail (lying; standing it interrupts the rail).
        const rail = shadowQuery(element, '.rail').getBoundingClientRect();
        const tops = shadowQueryAll(element, '.stop .label').map((label) => label.getBoundingClientRect().top);
        expect(orientation === 'vertical' || Math.min(...tops) >= rail.bottom, 'the labels below the rail').toBe(true);
    });

    it.each(['horizontal', 'vertical'] as const)(
        'badPath_%s_whenTheYearsDoNotFitTheCardScrollsFadesItsEdgeAndKeepsTheSelectedYearInView',
        async (orientation) => {
            // The review, 2026-11-08: twenty-two stops squeezed 17 px apart; the device test: no finger could scroll the card.
            const element = await timeline({ stops: VERY_MANY, value: 1924, orientation }, { inline: 320, block: 360 });
            const vertical = orientation === 'vertical';
            stillThumb(element);

            expect(element.getAttribute('density')).toBe('scroll');
            expect(scrolls(element)).toBe(true);
            expect(getComputedStyle(element).touchAction).toBe(vertical ? 'pan-y' : 'pan-x');
            expect(getComputedStyle(shadowQuery(element, '.thumb')).touchAction).toBe('none');
            for (const key of ['End', 'Home', 'End']) {
                // The scroll starts at the leading edge lying and at the top (today) standing: the far years fade there.
                const faded = (key === 'End') === vertical ? '--hcm-fade-end' : '--hcm-fade-start';
                press(element, key);
                await element.updateComplete;
                const view = element.getBoundingClientRect();
                const thumb = shadowQuery(element, '.thumb');
                await expect
                    .poll(() => {
                        const box = thumb.getBoundingClientRect();
                        return box.left >= view.left && box.right <= view.right && box.top >= view.top && box.bottom <= view.bottom;
                    })
                    .toBe(true);
                await expect.poll(() => scroller(element).style.getPropertyValue(faded), { message: `${faded} after ${key}` }).toBe('56px');
                expect(crowdedLabels(element), `labels crowded after ${key}`).toEqual([]);
            }
        },
    );

    it('happyPath_aDragKeepsTheCardStillAlsoAfterRelease', async () => {
        // Moving the card while a drag is on would move the track under the finger, and the next move would select a later year.
        const element = await timeline({ stops: VERY_MANY, value: 1924 }, { inline: 320, block: 300 });
        const track = shadowQuery(element, '.track');
        const view = element.getBoundingClientRect();

        pointer(track, 'pointerdown', view.right - 60, view.top + 30);
        pointer(window, 'pointermove', view.right - 50, view.top + 30);
        await element.updateComplete;
        expect(element.hasAttribute('dragging')).toBe(true);
        expect(element.value).not.toBe(1924);
        await frame();
        expect(scroller(element).scrollLeft, 'no scroll while dragging').toBe(0);

        pointer(window, 'pointerup', view.right - 50, view.top + 30);
        await element.updateComplete;
        await frame();
        // The owner, 2026-11-14: centring the year on release panned the bar under the pill (lesson 716).
        expect(scroller(element).scrollLeft, 'no scroll after release').toBe(0);
        expect(element.value).not.toBe(1924);
    });
});

describe('<hcm-timeline> many years under a finger', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aFingerTapOnAScrollingTrackSelectsTheYearThere', async () => {
        const element = await timeline({ stops: VERY_MANY, value: 1924 }, { inline: 320, block: 300 });
        const track = shadowQuery(element, '.track');
        const view = element.getBoundingClientRect();
        const events = recordEvents(element, 'hcm-year-change');

        touch(track, 'pointerdown', view.left + 200, view.top + 30);
        expect(element.hasAttribute('dragging'), 'a finger on the track does not drag: the card may scroll').toBe(false);
        touch(window, 'pointerup', view.left + 203, view.top + 31);
        await element.updateComplete;

        expect(events).toHaveLength(1);
        expect(element.value).not.toBe(1924);
    });

    it('badPath_aFingerThatScrollsTheTrackSelectsNothing', async () => {
        const element = await timeline({ stops: VERY_MANY, value: 1924 }, { inline: 320, block: 300 });
        const track = shadowQuery(element, '.track');
        const view = element.getBoundingClientRect();
        const events = recordEvents(element, 'hcm-year-change');

        touch(track, 'pointerdown', view.left + 200, view.top + 30);
        touch(window, 'pointerup', view.left + 120, view.top + 30);
        touch(track, 'pointerdown', view.left + 200, view.top + 30);
        touch(window, 'pointercancel', view.left + 200, view.top + 30);
        touch(window, 'pointerup', view.left + 200, view.top + 30);
        await element.updateComplete;

        expect(events).toHaveLength(0);
        expect(element.value).toBe(1924);
    });

    it('happyPath_aFingerOnTheThumbScrubsAScrollingTrackSelectingLive', async () => {
        const element = await timeline({ stops: VERY_MANY, value: 1924 }, { inline: 320, block: 300 });
        const thumb = shadowQuery(element, '.thumb').getBoundingClientRect();

        touch(shadowQuery(element, '.thumb-label'), 'pointerdown', thumb.left + thumb.width / 2, thumb.top + 20);
        touch(window, 'pointermove', thumb.left + thumb.width / 2 + 40, thumb.top + 20);
        await element.updateComplete;

        expect(element.value, 'selected while the finger is down').not.toBe(1924);
        expect(shadowQuery(element, '.tip').textContent).toBe(String(element.value));
        touch(window, 'pointerup', thumb.left + thumb.width / 2 + 40, thumb.top + 20);
        await element.updateComplete;
        expect(element.shadowRoot?.querySelector('.tip')).toBeNull();
    });

    it('badPath_aResizedCardChangesItsDensity', async () => {
        const element = await timeline({ stops: MANY, value: 1964 }, { inline: 1300, block: 300 });
        expect(element.getAttribute('density')).toBe('roomy');

        element.style.inlineSize = '260px';
        await settled(element);
        expect(element.getAttribute('density')).toBe('scroll');

        element.remove();
        element.style.inlineSize = '1300px';
        await settled(element);
        expect(element.getAttribute('density'), 'a removed card is no longer measured').toBe('scroll');
    });
});
