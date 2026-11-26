import type { Locator } from '@playwright/test';

import { contrastRatio, luminance, parseColour, type Rgba } from './colour.js';

/**
 * The timeline's chips against the theme (the owner's Android in dark, 2026-11-13: the year chips were light): an element's
 * computed fill and text, and the colours of the theme roles it must take, each resolved by the browser in the element's
 * own scope (the theme's tokens are custom properties the viewer's host sets and its shadow trees inherit).
 */

export interface ChipColours {
    readonly fill: Rgba;
    readonly text: Rgba;
    readonly fillRole: Rgba;
    readonly textRole: Rgba;
}

/** The `--md-sys-color-<role>` pair a chip paints with. */
export interface ChipRoles {
    readonly fill: string;
    readonly text: string;
}

const BLACK: Rgba = [0, 0, 0, 1];

/** Runs in the page: the computed fill and text of `element`, and its two roles' colours as computed colours. */
function readColours(element: Element, roles: ChipRoles): readonly string[] {
    const style = getComputedStyle(element);
    const probe = document.createElement('i');
    element.parentNode?.appendChild(probe);
    const resolve = (role: string): string => {
        probe.style.color = `var(--md-sys-color-${role})`;
        return getComputedStyle(probe).color;
    };
    const colours = [style.backgroundColor, style.color, resolve(roles.fill), resolve(roles.text)];
    probe.remove();
    return colours;
}

/** The chip's colours and its roles' (opaque black for a value that is not a colour, which then fails the comparison). */
export async function chipColours(chip: Locator, roles: ChipRoles): Promise<ChipColours> {
    const [fill, text, fillRole, textRole] = (await chip.evaluate(readColours, roles)).map((value) => parseColour(value) ?? BLACK);
    return { fill: fill ?? BLACK, text: text ?? BLACK, fillRole: fillRole ?? BLACK, textRole: textRole ?? BLACK };
}

/** Whether a fill reads as dark (the dark theme's surfaces and containers) or light (the light theme's). */
export function isDark(colour: Rgba): boolean {
    return luminance(colour) < 0.18;
}

/** The text's contrast on the fill. */
export function chipContrast(colours: ChipColours): number {
    return contrastRatio(colours.text, colours.fill);
}
