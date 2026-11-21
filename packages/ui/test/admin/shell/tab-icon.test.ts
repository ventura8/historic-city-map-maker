/**
 * The admin's tab icon in the admin's theme (`packages/ui/src/admin/shell/tab-icon.ts`), in a real browser: the canvas
 * draws the glyph in the root's `primary`, the icon link takes it, and a city's own icon is never repainted.
 */
import { DEFAULT_TAB_ICONS } from '@hcm/shared/tab-icon';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { paintRoot, unpaintRoot } from '../../../src/admin/shell/root-surface.js';
import { paintAdminTabIcon } from '../../../src/admin/shell/tab-icon.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';

function link(href: string, media?: string): HTMLLinkElement {
    const element = document.createElement('link');
    element.rel = 'icon';
    element.href = href;
    if (media !== undefined) {
        element.media = media;
    }
    document.head.append(element);
    return element;
}

function links(): HTMLLinkElement[] {
    return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
}

/** The colour of the icon's square, read near its top edge's middle (above the glyph). */
async function squareColour(address: string): Promise<string> {
    const image = new Image();
    image.src = address;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d');
    context?.drawImage(image, 0, 0);
    const [red = 0, green = 0, blue = 0] = context?.getImageData(16, 2, 1, 1).data ?? [];
    return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function removeLinks(): void {
    links().forEach((element) => {
        element.remove();
    });
}

// The test runner's own page has an icon link: each test starts from the links it adds.
beforeEach(removeLinks);

afterEach(() => {
    unpaintRoot(document);
    removeLinks();
});

describe('the admin tab icon', () => {
    it('happyPath_theChosenThemesPrimaryIsDrawnIntoTheOneIconLink', async () => {
        link(DEFAULT_TAB_ICONS.light, '(prefers-color-scheme: light)');
        link(DEFAULT_TAB_ICONS.dark, '(prefers-color-scheme: dark)');

        paintRoot(document, BASELINE_THEME, 'dark');

        expect(links()).toHaveLength(1);
        expect(links()[0]?.media).toBe('');
        expect(links()[0]?.href).toMatch(/^data:image\/png;base64,/);
        expect(await squareColour(links()[0]?.href ?? '')).toBe(BASELINE_THEME.dark['--md-sys-color-primary']);

        paintRoot(document, BASELINE_THEME, 'light');

        expect(await squareColour(links()[0]?.href ?? '')).toBe(BASELINE_THEME.light['--md-sys-color-primary']);
    });

    it('badPath_aCitysOwnIconAndAPageWithoutAThemeAreLeftAlone', () => {
        const own = link('https://storage.googleapis.com/demo-hcm-public/cities/bacau/icon-32.png');

        paintRoot(document, BASELINE_THEME, 'dark');

        expect(own.href).toBe('https://storage.googleapis.com/demo-hcm-public/cities/bacau/icon-32.png');

        own.remove();
        unpaintRoot(document);
        const untouched = link(DEFAULT_TAB_ICONS.light, '(prefers-color-scheme: light)');
        paintAdminTabIcon(document);

        expect(untouched.href).toBe(DEFAULT_TAB_ICONS.light);
        expect(untouched.media).toBe('(prefers-color-scheme: light)');
    });
});
