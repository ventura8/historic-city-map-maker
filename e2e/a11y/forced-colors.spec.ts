import type { Page } from '@playwright/test';

import { SITE_ORIGIN } from '../fixtures/world.js';
import { assertLayoutSound } from '../support/layout.js';
import { mapIdle, myLocationDrawn, pixelsOfColour, screenPointOf } from '../support/map.js';
import { expect, test } from '../support/test.js';
import { chooseMenuItem, menuButton, openLayers, openViewer, t, viewer } from '../support/viewer.js';

/**
 * Forced colours (behaviour V14, bad path; project `a11y-forced-colors`, `forced-colors: active`): with the system
 * palette the viewer stays readable and operable. Axe's colour rules judge the author's colours, which forced colours
 * replace (axe reports the theme's on-primary over the forced Canvas), so readability is measured here on the colours
 * the browser really paints: every visible text against the background behind it. Every control keeps an edge, and the
 * generic layout checker of the tour holds in every state (forced colours change borders and so sizes).
 */

const FORCED_COLOUR_RULES = ['color-contrast', 'color-contrast-enhanced'];

/** Runs in the page: visible texts whose painted colour has less than 4.5:1 against the background painted behind them. */
function lowContrastTexts(): string[] {
    const parse = (value: string): [number, number, number, number] => {
        const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const luminance = ([red, green, blue]: [number, number, number, number]): number => {
        const linear = (channel: number): number => {
            const value = channel / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
    };
    const parentOf = (node: Element): Element | null => {
        const root = node.getRootNode();
        return node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
    };
    const background = (element: Element): [number, number, number, number] => {
        for (let node: Element | null = element; node !== null; node = parentOf(node)) {
            const colour = parse(getComputedStyle(node).backgroundColor);
            if (colour[3] > 0.5) {
                return colour;
            }
        }
        return [255, 255, 255, 1];
    };
    /** Icon ligatures are decorative glyphs, the Mapbox controls are Mapbox's own: neither is the viewer's text. */
    const judged = (element: Element): boolean => {
        const root = element.getRootNode();
        const inIcon = root instanceof ShadowRoot && root.host.tagName === 'HCM-ICON';
        return !inIcon && element.closest('.mapboxgl-ctrl') === null && element.checkVisibility();
    };
    const found: string[] = [];
    const visit = (root: Document | ShadowRoot): void => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            const text = Array.from(element.childNodes).some(
                (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
            );
            if (text && judged(element)) {
                const fore = luminance(parse(getComputedStyle(element).color));
                const back = luminance(background(element));
                const ratio = (Math.max(fore, back) + 0.05) / (Math.min(fore, back) + 0.05);
                if (ratio < 4.5) {
                    found.push(`${element.textContent.trim().slice(0, 30)} ${ratio.toFixed(2)}`);
                }
            }
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    return found;
}

/** Runs in the page: kit controls drawn without any edge (under forced colours their fill is gone, an edge must stay). */
function edgelessControls(): string[] {
    const found: string[] = [];
    const visit = (root: Document | ShadowRoot): void => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.matches('button.fab, button.item, button[role="switch"]') && element.checkVisibility()) {
                const style = getComputedStyle(element);
                const edged = ['top', 'right', 'bottom', 'left'].some(
                    (side) =>
                        style.getPropertyValue(`border-${side}-style`) !== 'none' &&
                        Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) > 0,
                );
                if (!edged) {
                    found.push(element.getAttribute('aria-label') ?? element.textContent.trim());
                }
            }
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    return found;
}

async function expectReadable(
    page: Page,
    axe: { violations(options?: { skipRules?: readonly string[] }): Promise<unknown[]> },
    state: string,
): Promise<void> {
    await assertLayoutSound(page, `forced colours: ${state}`);
    expect(await page.evaluate(lowContrastTexts)).toEqual([]);
    expect(await page.evaluate(edgelessControls)).toEqual([]);
    expect(await axe.violations({ skipRules: FORCED_COLOUR_RULES })).toEqual([]);
}

test(
    'With forced colours every panel stays readable and every control keeps an edge',
    { tag: '@S-V14-BAD-FORCED-COLORS' },
    async ({ page, lang, axe }) => {
        await openViewer(page, { lang, hash: '15/44.42700/26.08530&layers=e2e-1966' });
        expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
        await expect(menuButton(page, lang)).toBeVisible();
        await expectReadable(page, axe, 'home');

        await openLayers(page, lang);
        await expect(page.getByRole('switch', { name: t(lang, 'layers.toggle', { name: 'Corona 1966 (e2e)' }) })).toBeVisible();
        await expectReadable(page, axe, 'layers');

        await page
            .getByRole('button', { name: t(lang, 'action.close'), exact: true })
            .filter({ visible: true })
            .first()
            .click();
        await menuButton(page, lang).click();
        await expect(page.getByRole('menuitem').first()).toBeVisible();
        await expectReadable(page, axe, 'menu open');
        await page.keyboard.press('Escape');
        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        await expect(
            viewer(page)
                .locator('hcm-about-dialog')
                .getByRole('heading', { name: t(lang, 'about.privacy') }),
        ).toBeVisible();
        await expectReadable(page, axe, 'about');
    },
);

// V10 with forced colours: the map's canvas keeps its own colours, so the blue dot with its white ring still shows, and the
// menu's switch says it is on with a 3 px ring in the system's text colour.
test(
    'With forced colours the blue dot still shows and Show my location reads as on',
    { tag: '@S-V14-BAD-FORCED-COLORS' },
    async ({ page, lang, axe }) => {
        await page.context().grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
        await page.context().setGeolocation({ latitude: 44.4301, longitude: 26.1003, accuracy: 25 });
        await openViewer(page, { lang });

        await chooseMenuItem(page, lang, t(lang, 'action.locate'));

        await expect.poll(async () => (await myLocationDrawn(page))[0]?.dot ?? null).not.toBeNull();
        await mapIdle(page);
        const dot = await screenPointOf(page, [26.1003, 44.4301]);
        expect(await pixelsOfColour(page, dot, [26, 115, 232], 4), 'the blue dot').toBeGreaterThan(20);
        await menuButton(page, lang).click();
        const locate = page.getByRole('menuitemcheckbox', { name: t(lang, 'action.locate'), exact: true });
        await expect(locate).toHaveAttribute('aria-checked', 'true');
        expect(await locate.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('3px');
        await expectReadable(page, axe, 'my location on');
    },
);
