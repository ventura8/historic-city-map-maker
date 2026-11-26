import { registerCatalogue } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { mountElement, shadowQuery, shadowQueryAll } from './doubles.js';

/**
 * The scroll hint and the start at the selected year (the owner, 2026-11-14): a scrolling card fades each edge with
 * years beyond and puts a labelled button there that pages that way and names the furthest year; the card opens on
 * the selected year, centred, also when it had no size yet or rested as its pill; lying every year has a dot.
 */

/** Sixty-one years and today: a scrolling card at every size. */
const VERY_MANY = [...Array.from({ length: 61 }, (_, at) => 1924 + at), null];

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function settled(element: HcmTimeline): Promise<void> {
    await frame();
    await frame();
    await element.updateComplete;
}

async function timeline(properties: Partial<HcmTimeline> = {}, inline = 400): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: VERY_MANY, value: 1924, ...properties });
    element.style.inlineSize = `${String(inline)}px`;
    element.style.blockSize = properties.orientation === 'vertical' ? '360px' : '';
    await settled(element);
    return element;
}

function edges(element: HcmTimeline): HTMLButtonElement[] {
    return shadowQueryAll(element, '.edge') as HTMLButtonElement[];
}

/** The selected stop's centre from the scroller's, along the timeline. */
function offCentre(element: HcmTimeline): number {
    const vertical = element.orientation === 'vertical';
    const view = shadowQuery(element, '.scroller').getBoundingClientRect();
    const stop = shadowQuery(element, '.stop.selected').getBoundingClientRect();
    return vertical ? stop.top + stop.height / 2 - (view.top + view.height / 2) : stop.left + stop.width / 2 - (view.left + view.width / 2);
}

describe('<hcm-timeline> scroll hint', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_lyingTheEndButtonNamesTodayAndPagesOnThenTheStartOneAppears', async () => {
        const element = await timeline();

        expect(edges(element).map((button) => button.getAttribute('aria-label'))).toEqual(['Anii mai noi, până la Azi']);
        expect(shadowQuery(element, '.edge-end .edge-year').textContent).toBe('Azi');
        expect(shadowQuery(element, '.scroller').style.getPropertyValue('--hcm-fade-end')).toBe('56px');
        const box = edges(element)[0]?.getBoundingClientRect() ?? new DOMRect();
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);

        await page.getByRole('button', { name: 'Anii mai noi, până la Azi' }).click();
        await expect.poll(() => shadowQuery(element, '.scroller').scrollLeft).toBeGreaterThan(200);
        await expect.element(page.getByRole('button', { name: 'Anii mai vechi, până la 1924' })).toBeVisible();
        expect(element.value, 'a page never selects a year').toBe(1924);
    });

    it('happyPath_standingTheTopButtonNamesTodayAndTheBottomOneTheFirstYear', async () => {
        const element = await timeline({ value: 1954, orientation: 'vertical', locale: 'en' });

        const labels = edges(element).map((button) => button.getAttribute('aria-label'));
        expect(labels).toEqual(['Later years, up to Today', 'Earlier years, back to 1924']);
        expect(shadowQuery(element, '.edge-start hcm-icon').getAttribute('name')).toBe('expand_less');
        expect(shadowQuery(element, '.edge-end hcm-icon').getAttribute('name')).toBe('expand_more');
    });

    it('badPath_aCardThatFitsOrRestsAsItsPillHasNoButtons', async () => {
        const roomy = await timeline({ stops: [1964, 1966, null] });
        expect(edges(roomy)).toEqual([]);
        roomy.remove();

        const pill = await timeline({ collapsed: true });
        expect(edges(pill)).toEqual([]);
    });

    it('badPath_aFocusedButtonThatGoesHandsItsFocusToTheYear', async () => {
        const element = await timeline({ value: 1980 });
        const start = shadowQuery(element, '.edge-start');
        start.focus();
        shadowQuery(element, '.scroller').scrollLeft = 0;
        await expect.poll(() => element.shadowRoot?.activeElement?.getAttribute('role')).toBe('slider');
        await element.updateComplete;
        expect(shadowQuery(element, '.scroller').scrollLeft, 'the thumb, handed the focus, leaves the years where they are').toBe(0);
    });
});

describe('<hcm-timeline> starts at the selected year', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it.each(['horizontal', 'vertical'] as const)('happyPath_%s_theSelectedYearIsCentredOnLoadAndWhenItChanges', async (orientation) => {
        const element = await timeline({ value: 1954, orientation });
        expect(Math.abs(offCentre(element))).toBeLessThanOrEqual(1);

        element.value = 1970;
        await settled(element);
        expect(Math.abs(offCentre(element))).toBeLessThanOrEqual(1);
    });

    it('badPath_aCardWithNoSizeOrRestingAsItsPillCentresTheYearOnceItOpens', async () => {
        defineHcmTimeline();
        const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: VERY_MANY, value: 1954, collapsed: true });
        element.style.display = 'none';
        await settled(element);
        element.style.display = '';
        element.style.inlineSize = '400px';
        await settled(element);
        element.collapsed = false;
        await settled(element);
        await settled(element);
        expect(Math.abs(offCentre(element))).toBeLessThanOrEqual(1);
    });
});

describe('<hcm-timeline> dots and labels', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_lyingEveryYearHasADotTheSelectedOneBigger', async () => {
        const element = await timeline({ stops: [1964, 1966, 1968, null], value: 1966 });
        const dots = shadowQueryAll(element, '.stop').map((stop) => getComputedStyle(stop, '::before'));
        expect(dots.map((dot) => dot.inlineSize)).toEqual(['6px', '10px', '6px', '6px']);
    });

    it('badPath_standingNoDotsAndALongTodayLeavesOutTheYearItWouldTouch', async () => {
        const standing = await timeline({ stops: [1964, 1966, null], orientation: 'vertical' });
        expect(getComputedStyle(shadowQuery(standing, '.stop'), '::before').content).toBe('none');
        standing.remove();

        registerCatalogue('fr', VIEWER_CATALOGUES.fr);
        const element = await timeline({ stops: [1960, 1964, 1966, null], value: 1960, locale: 'fr' }, 600);
        expect(shadowQueryAll(element, '.stop.minor').map((stop) => stop.textContent.trim())).toEqual(['1966']);
    });
});
