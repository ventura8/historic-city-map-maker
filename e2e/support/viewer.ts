import { expect, type Locator, type Page, type Route } from '@playwright/test';
import {
    registerCatalogue,
    translate,
    VIEWER_LOCALES,
    type MessageKey,
    type ValidationIssue,
    type ValidationResult,
    type ViewerLocale,
} from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';

import { readInstrumentation } from './instrumentation.js';
import { mapIdle } from './map.js';
import { sitePath, type OpenOptions, type SiteName } from './site.js';

/**
 * Driving the built viewer from outside, as a visitor does (docs/research/design-review-testability.md §4.2): open
 * the page (with a hash or a language), serve a changed manifest for a bad path, and find its controls by role and
 * by their localized names. Expected texts come from the i18n catalogues of @hcm/shared, so the same spec runs in the
 * Romanian and the English projects.
 */

/** The data/manifest.json of the Bucharest site (a bad path serves its own copy). */
export const BUCHAREST_MANIFEST = '**/bucharest/data/manifest.json';

// The tests read every viewer language's texts (the engine fetches them; the specs only compare).
for (const locale of VIEWER_LOCALES) {
    registerCatalogue(locale, VIEWER_CATALOGUES[locale]);
}

/** The catalogue text of `key` in `lang`. */
export function t(lang: ViewerLocale, key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    return translate(lang, key, params);
}

/** Serves `manifest` instead of the built fixture (a page route wins over the site server). */
export async function serveManifest(page: Page, manifest: unknown, url = BUCHAREST_MANIFEST): Promise<void> {
    await page.route(url, (route: Route) => route.fulfill({ json: manifest }));
}

/** The engine events the page fired so far, by type. */
export async function engineEvents(page: Page, type: string): Promise<unknown[]> {
    const { events } = await readInstrumentation(page);
    return events.filter((event) => event.type === type).map((event) => event.detail);
}

/**
 * Runs in the page: resolves once the engine event `type` reached `document`, at once when the instrumentation already
 * recorded one (false without the instrumentation, so the caller tries again).
 */
function engineEventInPage(type: string): Promise<boolean> {
    const state = (window as unknown as { __hcmE2e?: { events: { type: string }[] } }).__hcmE2e;
    if (state === undefined) {
        return Promise.resolve(false);
    }
    if (state.events.some((event) => event.type === type)) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        document.addEventListener(
            type,
            () => {
                resolve(true);
            },
            { capture: true, once: true },
        );
    });
}

/** Waits for the engine event `type`, when it fires (it may have fired before the spec looked). */
export async function waitForEngineEvent(page: Page, type: string): Promise<void> {
    await expect.poll(() => page.evaluate(engineEventInPage, type), { message: `the page receives ${type}` }).toBe(true);
}

export interface ViewerOpenOptions extends OpenOptions {
    readonly site?: SiteName;
}

/** Opens a site, waits for `hcm-ready` and for the map to be idle. */
export async function openViewer(page: Page, options: ViewerOpenOptions = {}): Promise<void> {
    await page.goto(sitePath(options.site ?? 'bucharest', options));
    await waitForEngineEvent(page, 'hcm-ready');
    await mapIdle(page);
}

/** The `<hcm-map-viewer>` element (Playwright locators pierce its open shadow root). */
export function viewer(page: Page): Locator {
    return page.locator('hcm-map-viewer');
}

/**
 * On a phone the timeline rests as its year's pill (V67, `packages/ui/src/viewer/timeline-dock.ts`): a tap on it opens the
 * whole card; elsewhere the card is always open and this does nothing.
 */
export async function openTimelineCard(page: Page): Promise<void> {
    const timeline = viewer(page).locator('hcm-timeline');
    if ((await timeline.getAttribute('collapsed')) !== null) {
        await timeline.click();
        await expect(timeline).not.toHaveAttribute('collapsed');
    }
}

/** The floating menu button. */
export function menuButton(page: Page, lang: ViewerLocale): Locator {
    return page.getByRole('button', { name: t(lang, 'action.menu'), exact: true });
}

/** The open FAB menu's item named `label`: an action, or a switch such as Show my location (`menuitemcheckbox`). */
export function menuItemNamed(page: Page, label: string): Locator {
    return page.getByRole('menuitem', { name: label, exact: true }).or(page.getByRole('menuitemcheckbox', { name: label, exact: true }));
}

/** Opens the FAB menu and picks the item named `label`. */
export async function chooseMenuItem(page: Page, lang: ViewerLocale, label: string): Promise<void> {
    await menuButton(page, lang).click();
    await menuItemNamed(page, label).click();
}

/** Settings' language dropdown, its first choice (slotted into the kit's dialog: found through `<hcm-about-dialog>`). */
export function languageList(page: Page): Locator {
    return viewer(page).locator('hcm-about-dialog hcm-language-select select');
}

/**
 * The menu's Settings (Setări) offers the viewer's 25 languages by their own names in one dropdown: picks `to`
 * there and closes the dialog once the page has switched (`<html lang>`).
 */
export async function chooseLanguage(page: Page, from: ViewerLocale, to: ViewerLocale): Promise<void> {
    await chooseMenuItem(page, from, t(from, 'settings.title'));
    await expect(page.getByRole('dialog', { name: t(from, 'settings.title') })).toBeVisible();
    await languageList(page).selectOption(to);
    await expect(page.locator('html')).toHaveAttribute('lang', to);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: t(to, 'settings.title') })).toBeHidden();
}

/** Keeps a toast open while a check looks at it: the pointer rests on it, as a visitor's would (M3 pauses the timeout). */
export async function holdToast(page: Page, message: string): Promise<void> {
    const toast = viewer(page).locator('hcm-snackbar .snackbar').filter({ hasText: message });
    await expect(toast).toBeVisible();
    await toast.dispatchEvent('pointerenter');
}

/** Closes the toast on show, if one is (a state that is not about a toast is checked without one). */
export async function dismissToast(page: Page, lang: ViewerLocale): Promise<void> {
    const close = viewer(page)
        .locator('hcm-snackbar')
        .getByRole('button', { name: t(lang, 'action.close'), exact: true });
    if (await close.isVisible()) {
        await close.click();
        await expect(close).toBeHidden();
    }
}

/**
 * Opens the Layers panel unless it is already shown: the Photos switch's options button marks it (2026-11-16).
 */
export async function openLayers(page: Page, lang: ViewerLocale): Promise<void> {
    const options = page.getByRole('button', { name: t(lang, 'photosScope.options'), exact: true });
    if (!(await options.isVisible())) {
        await chooseMenuItem(page, lang, t(lang, 'layers.title'));
    }
    await expect(options).toBeVisible();
}

/** Opens the Photos switch's popover in the open Layers panel (its scope and the photos' opacity slider), unless it is open. */
export async function openPhotoOptions(page: Page, lang: ViewerLocale): Promise<void> {
    const options = page.getByRole('button', { name: t(lang, 'photosScope.options'), exact: true });
    if ((await options.getAttribute('aria-expanded')) !== 'true') {
        await options.click();
    }
    await expect(options).toHaveAttribute('aria-expanded', 'true');
}

/** The opacity slider of the overlay named `name` in the Layers panel. */
export function opacitySlider(page: Page, lang: ViewerLocale, name: string): Locator {
    return page.getByRole('slider', { name: t(lang, 'layers.opacity', { name }), exact: true });
}

/** The visibility switch of the overlay named `name` in the Layers panel. */
export function visibilitySwitch(page: Page, lang: ViewerLocale, name: string): Locator {
    return page.getByRole('switch', { name: t(lang, 'layers.toggle', { name }), exact: true });
}

/** Calls a method of the page viewer's controller (docs/ENGINE_API.md → JavaScript API), as an embedding page does. */
export async function callController(page: Page, method: string, ...args: unknown[]): Promise<void> {
    await page.evaluate(
        ({ name, values }) => {
            type Controller = Record<string, ((...parameters: unknown[]) => unknown) | undefined>;
            const element = document.querySelector<Element & { controller?: Controller | null }>('hcm-map-viewer');
            element?.controller?.[name]?.(...values);
        },
        { name: method, values: args },
    );
}

/** The page's current hash without `#`. */
export async function currentHash(page: Page): Promise<string> {
    return (await page.evaluate(() => location.hash)).replace(/^#/, '');
}

/** One parameter of the current hash (`op`, `layers`, `photo`), or null. */
export async function hashParam(page: Page, name: string): Promise<string | null> {
    const [, ...parameters] = (await currentHash(page)).split('&');
    const found = parameters.find((parameter) => parameter.startsWith(`${name}=`));
    return found === undefined ? null : decodeURIComponent(found.slice(name.length + 1));
}

/** The window class of a viewport width (M3: compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large < 1600). */
export function windowClassOf(width: number): 'compact' | 'medium' | 'expanded' | 'large' | 'extra-large' {
    if (width < 600) {
        return 'compact';
    }
    if (width < 840) {
        return 'medium';
    }
    if (width < 1200) {
        return 'expanded';
    }
    return width < 1600 ? 'large' : 'extra-large';
}

/**
 * Windows from 760 px wide (a medium one too: the Pixel Tablet upright, 2026-11-12) dock the detail sheet in a pane unless
 * they are short (a phone on its side); the others open it as a modal sheet (packages/ui/src/viewer/layout.ts).
 */
export function sheetsDock(size: { readonly width: number; readonly height: number } | null): boolean {
    return size !== null && size.width >= 760 && size.height >= 480;
}

export function isDocked(page: Page): boolean {
    return sheetsDock(page.viewportSize());
}

/**
 * Closes the modal sheet on top (a photo's, the Layers'), which makes the map and its menu inert in compact and medium
 * windows; a docked pane stays open. Window-class branches live in helpers like this one, so spec bodies stay linear
 * (`playwright/no-conditional-in-test`).
 */
export async function closeModalSheet(page: Page): Promise<void> {
    if (!isDocked(page)) {
        await page.keyboard.press('Escape');
    }
}

/** The issues `validateManifest` reports (none for a valid manifest). */
export function manifestIssues(result: ValidationResult<unknown>): readonly ValidationIssue[] {
    return result.ok ? [] : result.issues;
}
