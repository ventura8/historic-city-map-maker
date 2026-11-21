import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { GeorefViewState } from '../../../src/admin/georef/georef-port.js';
import { defineImagery, georefPage, georefState } from '../imagery/fixtures.js';
import { cleanup, deep, updated } from '../shell/fake-app.js';

/**
 * The residual table fits a phone's page (WCAG 1.4.10, the e2e checker's `sideways-scroll`): six pairs placed far apart
 * by keyboard have residuals of a kilometre and more, and in Romanian, at 320 px, or at 360 px and on a tablet with a
 * reader's text spacing (WCAG 1.4.12), the table grew past its box (CR-M3-47: `S-A16-HAPPY-KEYBOARD`'s six pairs found
 * it).
 */

/** The e2e checker's text-spacing sheet (e2e/support/a11y.ts), adopted in the document and every shadow root. */
const TEXT_SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }';

function spaceText(): void {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(TEXT_SPACING);
    const roots: (Document | ShadowRoot)[] = [document];
    for (const root of roots) {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.shadowRoot !== null) {
                roots.push(element.shadowRoot);
            }
        }
    }
    for (const root of roots) {
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
}

/** Six pairs at places written to the metre (six decimals) and pixels to the tenth, the last two far from where the first
 * four put the scan: residuals up to 12,345.6 m. */
function farPairs(): GeorefViewState {
    const base = georefState();
    const precise = base.pairs.map((pair, index) => ({
        ...pair,
        pixel: { x: pair.pixel.x + 0.25 + index, y: pair.pixel.y + 0.75 + index },
        geo: { lat: pair.geo.lat + 0.123456, lng: pair.geo.lng + 0.123456 },
    }));
    const pairs = [
        ...precise,
        { id: 'g5', pixel: { x: 1960.5, y: 1480.5 }, geo: { lat: 44.441234, lng: 26.091234 }, enabled: true, origin: 'manual' as const },
        { id: 'g6', pixel: { x: 1900.5, y: 1420.5 }, geo: { lat: 44.431234, lng: 26.111234 }, enabled: true, origin: 'manual' as const },
    ];
    const residuals = { g1: 1234.5, g2: 987.6, g3: 2345.6, g4: 456.7, g5: 12_345.6, g6: 10_987.6 };
    return georefState({ pairs, fit: { ...base.fit, residuals } });
}

/** How far the table reaches past its box, in CSS px (0 when it fits). */
function overflow(element: HTMLElement): number {
    const box = deep(element, '.table-box').getBoundingClientRect();
    const table = deep(element, 'table.residuals').getBoundingClientRect();
    return Math.max(0, table.right - box.right);
}

describe('<hcm-georef-page>: the residual table on a phone', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('badPath_sixFarPairsInRomanianFitA320PxPage', async () => {
        const { element } = await georefPage(farPairs(), { width: 320, locale: 'ro', state: { windowClass: 'compact' } });

        expect(overflow(element)).toBeLessThanOrEqual(0.5);
    });

    it('badPath_sixFarPairsInRomanianFitA360PxPageWithTextSpacing', async () => {
        const { element } = await georefPage(farPairs(), { width: 360, locale: 'ro', state: { windowClass: 'compact' } });

        spaceText();
        await updated(element);

        expect(overflow(element)).toBeLessThanOrEqual(0.5);
    });

    it('badPath_sixFarPairsWithEveryColumnFitATabletsPageWithTextSpacing', async () => {
        // A 768 px window less its 96 px rail: a 640 px table, wide enough for the pixel and place columns.
        const { element } = await georefPage(farPairs(), { width: 672, locale: 'ro', state: { windowClass: 'medium' } });

        spaceText();
        await updated(element);

        expect(getComputedStyle(deep(element, 'table.residuals td.position')).display).not.toBe('none');
        expect(overflow(element)).toBeLessThanOrEqual(0.5);
    });
});
