import { describe, expect, test } from 'vitest';

import { alphaOf, composite, contrastRatio, luminance, parseColour } from '../support/colour.js';

/** e2e/support/colour.ts: the WCAG colour arithmetic of the accessibility checks. */

describe('parseColour', () => {
    test.each([
        ['rgb(255, 0, 0)', [255, 0, 0, 1]],
        ['rgba(0, 0, 0, 0.5)', [0, 0, 0, 0.5]],
        ['rgb(10 20 30 / 0.25)', [10, 20, 30, 0.25]],
        ['color(srgb 1 0.5 0)', [255, 127.5, 0, 1]],
        ['color(srgb 0 0 1 / 0.5)', [0, 0, 255, 0.5]],
    ])('happyPath_%s', (value, expected) => {
        expect(parseColour(value)).toEqual(expected);
    });

    test.each(['transparent', 'red', 'oklch(0.5 0.1 120)', ''])('badPath_%s_isNotAColourItReads', (value) => {
        expect(parseColour(value)).toBeNull();
        expect(alphaOf(value)).toBe(0);
    });

    test('happyPath_theAlphaOfAComputedColour', () => {
        expect(alphaOf('rgba(0, 0, 0, 0.5)')).toBe(0.5);
        expect(alphaOf('rgb(1, 2, 3)')).toBe(1);
    });
});

describe('contrast', () => {
    test('happyPath_blackOnWhiteIs21AndAColourAgainstItselfIs1', () => {
        expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 5);
        expect(contrastRatio([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5);
        expect(contrastRatio([120, 30, 200, 1], [120, 30, 200, 1])).toBe(1);
    });

    test('happyPath_luminanceOfDarkAndLightChannels', () => {
        expect(luminance([0, 0, 0, 1])).toBe(0);
        expect(luminance([255, 255, 255, 1])).toBeCloseTo(1, 5);
        expect(luminance([5, 5, 5, 1])).toBeCloseTo(5 / 255 / 12.92, 6);
    });

    test('happyPath_compositeBlendsByAlpha', () => {
        expect(composite([0, 0, 0, 0.5], [255, 255, 255, 1])).toEqual([127.5, 127.5, 127.5, 1]);
        expect(composite([10, 20, 30, 1], [255, 255, 255, 1])).toEqual([10, 20, 30, 1]);
    });
});
