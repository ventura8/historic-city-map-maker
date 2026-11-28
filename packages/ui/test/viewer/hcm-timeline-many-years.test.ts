import { afterEach, describe, expect, it } from 'vitest';

import type { HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { recordEvents, shadowQuery, shadowQueryAll } from './doubles.js';
import { frame, settled, timeline, press, pointer, touch } from './timeline-harness.js';

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
