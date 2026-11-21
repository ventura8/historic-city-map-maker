/**
 * Colour arithmetic of the tour's accessibility checks (WCAG 2.2 relative luminance and contrast ratio, alpha
 * compositing), in-page helpers like e2e/support/dom-walk.ts: `function` declarations that use nothing outside this list.
 */

/** Red, green, blue (0-255) and alpha (0-1). */
export type Rgba = readonly [number, number, number, number];

/** A computed colour (`rgb()`, `rgba()` or `color(srgb ...)`) as RGBA; null when it is none of these. */
export function parseColour(value: string): Rgba | null {
    const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+))?\)$/.exec(value);
    if (srgb !== null) {
        const [, red = '0', green = '0', blue = '0', alpha = '1'] = srgb;
        return [Number(red) * 255, Number(green) * 255, Number(blue) * 255, Number(alpha)];
    }
    const rgb = /^rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)(?: ?[,/] ?([\d.]+))?\)$/.exec(value);
    if (rgb === null) {
        return null;
    }
    const [, red = '0', green = '0', blue = '0', alpha = '1'] = rgb;
    return [Number(red), Number(green), Number(blue), Number(alpha)];
}

/** `fore` drawn over the opaque `back`. */
export function composite(fore: Rgba, back: Rgba): Rgba {
    const alpha = fore[3];
    const mix = (index: 0 | 1 | 2): number => fore[index] * alpha + back[index] * (1 - alpha);
    return [mix(0), mix(1), mix(2), 1];
}

/** WCAG relative luminance of an opaque colour. */
export function luminance(colour: Rgba): number {
    const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(colour[0]) + 0.7152 * linear(colour[1]) + 0.0722 * linear(colour[2]);
}

/** The WCAG contrast ratio of two opaque colours (1 to 21). */
export function contrastRatio(first: Rgba, second: Rgba): number {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The alpha of a computed colour (0 when it is none the checks read). */
export function alphaOf(value: string): number {
    return parseColour(value)?.[3] ?? 0;
}

/** Every helper of this module, for `libraryScript` (e2e/support/page-script.ts). */
export const COLOUR = [parseColour, composite, luminance, contrastRatio, alphaOf] as const;
