import { afterEach, describe, expect, it } from 'vitest';

import { applyTheme, type ThemeMode } from '../../src/theme/apply.js';
import { HCM_TIMELINE_TAG, defineHcmTimeline, type HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { VIEWER_BASELINE } from '../../src/viewer/viewer-baseline.js';
import { mountElement, shadowQuery, shadowQueryAll } from './doubles.js';

/**
 * The timeline's chips follow the theme (the owner's Android in dark, 2026-11-13: the year chips were light): the year chip,
 * the pill and the badge are dark in the dark theme and light in the light one, each painted with its theme roles, never
 * with M3's inverse surface, `primary` or `error`, whose dark-theme tones are light.
 */

/** Six stops, 1964 to 1968 and today, roomy in a 420 px card; 1964 has two dates (a badge). */
const STOPS = [...Array.from({ length: 5 }, (_, at) => 1964 + at), null];
const COUNTS = new Map([[1964, 2]]);

function frame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function themed(mode: ThemeMode): Promise<HcmTimeline> {
    defineHcmTimeline();
    const element = await mountElement<HcmTimeline>(HCM_TIMELINE_TAG, { stops: STOPS, dateCounts: COUNTS, value: 1964 });
    element.style.inlineSize = '420px';
    element.style.marginBlockStart = '120px';
    applyTheme(element, VIEWER_BASELINE, mode, false);
    await frame();
    await element.updateComplete;
    return element;
}

/** The rgb() of a `#rrggbb` token, as getComputedStyle writes a colour. */
function rgb(token: string | undefined): string {
    const hex = token ?? '#000000';
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

/** The relative luminance of an `rgb(r, g, b)` colour (WCAG 2). */
function luminance(colour: string): number {
    const [r = 0, g = 0, b = 0] = (colour.match(/\d+/g) ?? []).slice(0, 3).map((part) => {
        const channel = Number(part) / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

async function showTip(element: HcmTimeline): Promise<void> {
    const box = shadowQueryAll(element, '.stop')[1]?.getBoundingClientRect() ?? new DOMRect();
    const point = {
        clientX: box.left + box.width / 2,
        clientY: box.top + 4,
        pointerType: 'touch',
        pointerId: 2,
        bubbles: true,
        composed: true,
    };
    shadowQuery(element, '.track').dispatchEvent(new PointerEvent('pointerdown', point));
    await element.updateComplete;
}

/** The chips of the timeline: background and text colours, and the role pair each must use. */
const CHIPS = [
    { name: 'year chip', selector: '.tip', background: 'surface-container-highest', text: 'on-surface' },
    { name: 'pill', selector: '.thumb', background: 'primary-container', text: 'on-primary-container' },
    { name: 'badge', selector: '.thumb .badge', background: 'error-container', text: 'on-error-container' },
] as const;

describe('<hcm-timeline> chips in the light and the dark theme', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    for (const mode of ['light', 'dark'] as const) {
        it(`happyPath_everyChipTakesTheRolesOfThe${mode}Theme`, async () => {
            const element = await themed(mode);
            await showTip(element);
            const tokens = VIEWER_BASELINE[mode];

            for (const chip of CHIPS) {
                const style = getComputedStyle(shadowQuery(element, chip.selector));
                expect(style.backgroundColor, `${chip.name} in ${mode}`).toBe(rgb(tokens[`--md-sys-color-${chip.background}`]));
                expect(style.color, `${chip.name} in ${mode}`).toBe(rgb(tokens[`--md-sys-color-${chip.text}`]));
                expect(contrast(style.backgroundColor, style.color), `${chip.name}: AA text`).toBeGreaterThanOrEqual(4.5);
            }
        });
    }

    it('badPath_noChipIsLightInTheDarkTheme', async () => {
        const element = await themed('dark');
        await showTip(element);

        for (const chip of CHIPS) {
            const style = getComputedStyle(shadowQuery(element, chip.selector));
            expect(luminance(style.backgroundColor), `${chip.name}: a dark fill`).toBeLessThan(0.18);
            expect(luminance(style.color), `${chip.name}: light text`).toBeGreaterThan(luminance(style.backgroundColor));
        }
        expect(getComputedStyle(element).colorScheme).toMatch(/dark/);
    });
});
