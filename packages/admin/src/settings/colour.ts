/**
 * Colour arithmetic of the settings (`docs/research/M2c-interfaces.md` §8.5): WCAG contrast, and the nearest tone of a
 * colour that passes a contrast check, found by moving its HSL lightness step by step (darker first, then lighter) with
 * its hue and saturation kept. A POI category's colour needs 3:1 against the white glyph drawn on it
 * (S-A39-BAD-LOW-CONTRAST-COLOUR); a theme's seed is moved the same way until its generated schemes pass
 * (S-A19-BAD-LOW-CONTRAST-SEED). Pure, without the colour library: the admin's node tests run it as is.
 */

const HEX = /^#([0-9a-f]{6})$/i;

/** WCAG 2.2's minimum for graphical objects and large text: the pin's white glyph on the category's colour. */
const GLYPH_CONTRAST = 3;

/** Lightness steps of `nearestTone`, in percent: from 1 to 100 away from the colour. */
const STEPS = 100;

export function isHex(value: string): boolean {
    return HEX.test(value);
}

/** `#rrggbb` lower case; an invalid value gives null. */
export function normalizeHex(value: string): string | null {
    const trimmed = value.trim();
    return isHex(trimmed) ? trimmed.toLowerCase() : null;
}

function channels(hex: string): [number, number, number] {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function linear(channel: number): number {
    const value = channel / 255;
    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of `#rrggbb`. */
export function luminance(hex: string): number {
    const [r, g, b] = channels(hex).map(linear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

interface Hsl {
    readonly h: number;
    readonly s: number;
    readonly l: number;
}

/** The hue in degrees of a colour whose largest channel is `max` and whose channels spread over `delta` (> 0). */
function hueOf([r, g, b]: readonly [number, number, number], max: number, delta: number): number {
    if (max === r) {
        return 60 * (((g - b) / delta + 6) % 6);
    }
    return max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
}

function toHsl(hex: string): Hsl {
    const [r, g, b] = channels(hex).map((channel) => channel / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const l = (max + min) / 2;
    if (delta === 0) {
        return { h: 0, s: 0, l };
    }
    return { h: hueOf([r, g, b], max, delta), s: delta / (1 - Math.abs(2 * l - 1)), l };
}

function byte(value: number): string {
    return Math.round(Math.min(Math.max(value, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0');
}

function toHex({ h, s, l }: Hsl): string {
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - chroma / 2;
    const sector = Math.floor(h / 60) % 6;
    const rgb: readonly (readonly [number, number, number])[] = [
        [chroma, x, 0],
        [x, chroma, 0],
        [0, chroma, x],
        [0, x, chroma],
        [x, 0, chroma],
        [chroma, 0, x],
    ];
    const [r, g, b] = rgb[sector] ?? [0, 0, 0];
    return `#${byte(r + m)}${byte(g + m)}${byte(b + m)}`;
}

/** `hex` with its lightness moved by `delta` (-1 to 1), hue and saturation kept. */
export function withLightness(hex: string, delta: number): string {
    const hsl = toHsl(hex);
    return toHex({ ...hsl, l: Math.min(Math.max(hsl.l + delta, 0), 1) });
}

/**
 * The colour nearest to `hex` (by lightness) that `passes`: `hex` itself when it does, else the first passing tone
 * one percent darker, one lighter, two darker, ...; null when no lightness passes.
 */
export function nearestTone(hex: string, passes: (candidate: string) => boolean): string | null {
    if (passes(hex)) {
        return hex;
    }
    for (let step = 1; step <= STEPS; step += 1) {
        const found = [withLightness(hex, -step / STEPS), withLightness(hex, step / STEPS)].find(passes);
        if (found !== undefined) {
            return found;
        }
    }
    return null;
}

/** Whether the white glyph of a POI icon reads on `hex` (3:1). */
export function readsWithWhite(hex: string): boolean {
    return contrast(hex, '#ffffff') >= GLYPH_CONTRAST;
}
