import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';

import { contrastRatio, type Rgba } from './colour.js';
import type { Violation } from './violations.js';

/**
 * The contrast of a control as it is painted, read from the screen's pixels (the Pixel 9 Pro review, P2). Axe and the
 * tour's non-text contrast read computed styles: the light theme's FAB said #33406D on #BAC7FD (6.9:1) to both while
 * Chrome's dark theme for sites painted its icon and the menu's labels pale lilac on lilac (1.2:1), a repaint no style
 * shows. Each filled control of the FAB menu is cut from a screenshot (its middle, inside its rounded corners), its
 * fill is the commonest colour there and its ink the pixel furthest from it in luminance; a label needs 4.5:1, an icon
 * alone 3:1. A control another surface covers (a scrim, a sheet) is not measured: what shows there is not its own.
 */

/** The FAB menu's filled controls: the FAB and, while open, its items. */
const FILLED = 'hcm-fab-menu .fab, hcm-fab-menu [role^="menuitem"]';

const WHITE: Rgba = [255, 255, 255, 1];

interface Painted {
    readonly fill: Rgba;
    readonly ink: Rgba;
}

/** Runs in the page: whether the control is on top at its centre (the deepest hit is it or inside it, across shadow roots). */
function onTop(element: Element): boolean {
    const box = element.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === hit) {
            break;
        }
        hit = inner;
    }
    for (let node: Node | null = hit; node !== null; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
        if (node === element) {
            return true;
        }
    }
    return false;
}

/** The fill and the ink of the middle of `control` as the screen shows it: half its height, inside its rounded ends. */
async function paintedColours(page: Page, control: Locator): Promise<Painted | null> {
    const box = await control.boundingBox();
    if (box === null || box.width < 8 || box.height < 8) {
        return null;
    }
    const inset = Math.min(box.height / 2, box.width / 4);
    const clip = { x: box.x + inset, y: box.y + box.height / 4, width: box.width - 2 * inset, height: box.height / 2 };
    const png = await page.screenshot({ clip, scale: 'css', animations: 'disabled', caret: 'hide' });
    const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixels: Rgba[] = [];
    for (let offset = 0; offset + 2 < data.length; offset += 3) {
        pixels.push([Number(data[offset]), Number(data[offset + 1]), Number(data[offset + 2]), 1]);
    }
    const counts = new Map<string, { colour: Rgba; count: number }>();
    for (const pixel of pixels) {
        const key = pixel.slice(0, 3).join(',');
        const entry = counts.get(key) ?? { colour: pixel, count: 0 };
        counts.set(key, { colour: entry.colour, count: entry.count + 1 });
    }
    const fill = [...counts.values()].reduce((best, entry) => (entry.count > best.count ? entry : best), {
        colour: pixels[0] ?? WHITE,
        count: 0,
    }).colour;
    const ink = pixels.reduce((best, pixel) => (contrastRatio(pixel, fill) > contrastRatio(best, fill) ? pixel : best), fill);
    return { fill, ink };
}

function hex(colour: Rgba): string {
    return `#${colour
        .slice(0, 3)
        .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
        .join('')}`;
}

/** One control's violation, or none: a label needs 4.5:1 between its painted ink and fill, an icon alone 3:1. */
async function controlViolation(page: Page, control: Locator, scheme: string, selector: string): Promise<Violation[]> {
    if (!(await control.isVisible()) || !(await control.evaluate(onTop))) {
        return [];
    }
    const painted = await paintedColours(page, control);
    if (painted === null) {
        return [];
    }
    const name = (await control.getAttribute('aria-label')) ?? (await control.innerText()).trim();
    const labelled = (await control.innerText()).trim() !== '';
    const needed = labelled ? 4.5 : 3;
    const ratio = contrastRatio(painted.ink, painted.fill);
    if (ratio >= needed) {
        return [];
    }
    const box = await control.boundingBox();
    const message = `${name} is painted ${hex(painted.ink)} on ${hex(painted.fill)}, ${ratio.toFixed(2)}:1 in ${scheme} (${String(needed)}:1 needed)`;
    return [{ check: 'rendered-contrast', message, elements: [{ name, selector, box }] }];
}

/**
 * The rendered contrast of every filled control on top in the page (`scheme`: for the message): the FAB menu's, or those of
 * `selector` (the timeline's chips: the pill, the year chip, the badge).
 */
export async function renderedContrastViolations(page: Page, scheme: string, selector = FILLED): Promise<Violation[]> {
    const controls = await page.locator(selector).all();
    const found: Violation[] = [];
    for (const control of controls) {
        found.push(...(await controlViolation(page, control, scheme, selector)));
    }
    return found;
}
