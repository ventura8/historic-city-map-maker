import { expect, type Locator, type Page } from '@playwright/test';

import { COLOUR } from './colour.js';
import { DOM_WALK } from './dom-walk.js';
import { LAYOUT_PROBE, movingAnimations, probeLayout, type ChromeSource, type LayoutSnapshot, type ProbeOptions } from './layout-probe.js';
import { layoutViolations, windowClassOf, type Sanctioned } from './layout-rules.js';
import { callLibrary, libraryKey, libraryScript, type PageFunction } from './page-script.js';
import { reportViolations } from './report.js';
import { violationLines, type Violation } from './violations.js';

/**
 * Layout invariants of the tour and the responsive scenarios (docs/research/design-review-testability.md §4.3; the
 * user's request of 2026-10-12, docs/TESTING.md → *The tour's checkers*). `assertLayoutSound` is the generic checker
 * every tour state runs, independent of hand-placed markers: (a) every usable interactive element is on top at its
 * centre and four inner points, and with a modal open everything outside it is inert, hidden or out of the Tab order;
 * (b) no two pieces of usable floating chrome overlap (but for `SANCTIONED_STACKINGS`) and on compact and medium windows
 * their touch targets keep 8 px apart; (c) nothing a visitor uses or reads is partly off screen unless it scrolls into
 * view, and the page never scrolls sideways; (d) with a map in view, exactly one Mapbox logo and one attribution show,
 * uncovered or under nothing but a translucent scrim (none is owed where the lightbox or a full-screen dialog hides the map);
 * (e) no label cuts its text and no text runs over another. The helpers below it serve the functional specs' own
 * layout assertions; every check runs in the page and walks into open shadow roots, where the viewer renders.
 */

/**
 * The floating chrome kept apart, found by the kit's components (not by markers): the FAB and its open menu, toolbars
 * and the timeline, chips, snackbars, banners, sheets, the admin's navigation and top bar, Mapbox's logo, attribution
 * and controls, plus anything an app marks with `data-layout-check`. An element that contains other chrome is
 * represented by its parts.
 */
const FLOATING_CHROME: readonly ChromeSource[] = [
    { kind: 'fab', selector: 'hcm-fab-menu >>> button.fab' },
    { kind: 'fab', selector: 'hcm-fab >>> button' },
    { kind: 'menu', selector: 'hcm-fab-menu >>> [role="menu"]' },
    { kind: 'context-menu', selector: 'hcm-map-menu >>> [role="menu"]' },
    { kind: 'timeline', selector: 'hcm-timeline' },
    { kind: 'toolbar', selector: 'hcm-toolbar, [role="toolbar"]' },
    { kind: 'chip', selector: 'hcm-chip' },
    { kind: 'snackbar', selector: 'hcm-snackbar >>> .snackbar' },
    { kind: 'banner', selector: 'hcm-consent-banner' },
    { kind: 'sheet', selector: 'hcm-sheet >>> section.sheet' },
    { kind: 'navigation', selector: 'hcm-admin-nav' },
    { kind: 'top-bar', selector: 'header.top-bar' },
    { kind: 'mapbox-logo', selector: 'a.mapboxgl-ctrl-logo' },
    { kind: 'attribution', selector: '.mapboxgl-ctrl-attrib' },
    { kind: 'mapbox-control', selector: '.mapboxgl-ctrl' },
    { kind: 'date-menu', selector: 'hcm-date-menu >>> [role="menu"]' },
    { kind: 'marked', selector: '[data-layout-check]' },
];

/**
 * The sanctioned stackings, kept minimal (docs/TESTING.md lists each with its reason). A modal surface over chrome needs
 * no entry: whatever it covers must be inert (check a), so it is not usable chrome. The open menu covered any chrome
 * until the visual audit of 2026-10-17 found its last item on the timeline's thumb at 768 px: it now covers only the map
 * and what is drawn on it, and the two top docks it is designed to grow over on a short phone.
 */
const SANCTIONED_STACKINGS: readonly Sanctioned[] = [
    {
        over: 'menu',
        under: 'content',
        why: 'the open FAB menu is a transient popup over the map and its markers until it closes (M3 FAB menu); its items must still be on top, on screen and clear of the floating chrome around it',
    },
    {
        over: 'context-menu',
        under: '*',
        why: "the map's menu (V62) opens where the visitor pressed, or at the map's centre from the keyboard, so what it covers is the visitor's choice: a transient popup until Esc or a press anywhere else; its own items must still be on top and on screen",
    },
    {
        over: 'date-menu',
        under: 'content',
        why: "a timeline year's date menu (V68) is a transient popup over the map until a date is picked, Esc, a press elsewhere, or the pointer leaves (its peek, DECISIONS-for-review.md §195i); it must keep clear of every floating control, and its own items must be on top and on screen",
    },
    {
        over: 'menu',
        under: 'banner',
        why: 'on a short phone the open menu grows up to the consent banner docked at the top and stays above it until it closes',
    },
    {
        over: 'menu',
        under: 'snackbar',
        why: 'on a short phone the open menu grows up to the toast docked at the top and stays above it until it closes',
    },
];

/** The map canvas and Mapbox's own logo and attribution (V18). */
const LEGAL = {
    map: 'canvas.mapboxgl-canvas',
    logo: 'a.mapboxgl-ctrl-logo',
    attribution: '.mapboxgl-ctrl-attrib',
} as const;

const PROBE_OPTIONS: ProbeOptions = {
    chrome: FLOATING_CHROME,
    legal: LEGAL,
    appRoots: ['hcm-map-viewer', 'hcm-admin-shell'],
    surfaceShare: 0.25,
};

/**
 * Calls the in-page helper `entry` with `arg` from the library of `helpers` (e2e/support/page-script.ts), installing the
 * library first when the page has none (a new page after a navigation).
 */
export async function callInPage<T>(page: Page, helpers: readonly PageFunction[], entry: PageFunction, arg: unknown = null): Promise<T> {
    const call = [libraryKeyOf(helpers, entry), entry.name, arg] as const;
    let answer = await page.evaluate(callLibrary, call);
    if ('missing' in answer) {
        await page.evaluate(libraryScript(helpers));
        answer = await page.evaluate(callLibrary, call);
    }
    if ('missing' in answer) {
        throw new Error(`the page has no ${entry.name} after installing its library`);
    }
    return answer.result as T;
}

/** The library key of `helpers`, which must hold `entry`. */
function libraryKeyOf(helpers: readonly PageFunction[], entry: PageFunction): string {
    if (!helpers.includes(entry)) {
        throw new Error(`${entry.name} is not one of the helpers it is called from`);
    }
    return libraryKey(helpers);
}

/** The helpers of the layout probe. */
const LAYOUT_HELPERS: readonly PageFunction[] = [...DOM_WALK, ...COLOUR, ...LAYOUT_PROBE];

/** How long a state may take to stop moving before it is checked anyway (and the moving parts may show as violations). */
const SETTLE_TIMEOUT_MS = 10_000;

/** Runs in the page: resolves once two frames have rendered since the call. */
function twoFrames(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resolve();
            });
        });
    });
}

/**
 * Waits until no finite animation or transition runs (a sheet sliding in, a menu unfolding); soft when it never stops.
 * Then waits two frames, so what follows a frame (a ResizeObserver's callback: the map's canvas follows its box when a
 * pane opens) has happened: on a busy machine a probe before the next frame saw the canvas at its old width.
 */
export async function settleAnimations(page: Page): Promise<void> {
    await expect
        .configure({ soft: true })
        .poll(() => callInPage<number>(page, LAYOUT_HELPERS, movingAnimations), {
            message: 'the page stops moving',
            timeout: SETTLE_TIMEOUT_MS,
        })
        .toBe(0);
    await page.evaluate(twoFrames);
}

/** The layout snapshot of the page once it has stopped moving (e2e/support/layout-probe.ts). */
async function layoutSnapshot(page: Page): Promise<LayoutSnapshot> {
    await settleAnimations(page);
    return callInPage<LayoutSnapshot>(page, LAYOUT_HELPERS, probeLayout, PROBE_OPTIONS);
}

/** The layout violations of the page as it is now. */
export async function layoutViolationsOf(page: Page): Promise<{ snapshot: LayoutSnapshot; violations: Violation[] }> {
    const snapshot = await layoutSnapshot(page);
    const windowClass = windowClassOf(snapshot.viewport.width);
    return { snapshot, violations: layoutViolations(snapshot, { windowClass, sanctioned: SANCTIONED_STACKINGS }) };
}

/**
 * Checks every layout invariant of the state the page is in (`state` names it in the messages), as a soft assertion so
 * a tour reports every state; the violations are recorded and attached with an outlined screenshot (e2e/support/report.ts;
 * `report: false` leaves that to the caller, which reports a state's layout and accessibility violations together).
 */
export async function assertLayoutSound(
    page: Page,
    state: string,
    options: { readonly report?: boolean } = {},
): Promise<{ snapshot: LayoutSnapshot; violations: Violation[] }> {
    const result = await layoutViolationsOf(page);
    if (options.report !== false) {
        await reportViolations(page, state, result.violations);
    }
    expect.soft(violationLines(state, result.violations), `${state}: the layout is sound`).toEqual([]);
    return result;
}

export interface Box {
    readonly name: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Runs in the page: the visible boxes of the elements matching `selectors` (zero-size and hidden ones left out; with
 * `usable`, also those under an `inert` ancestor, such as the frame behind a modal sheet, whose controls no one can use).
 */
function boxesInPage([selectors, usable]: readonly [readonly string[], boolean]): Box[] {
    const inert = (element: Element): boolean => {
        for (let node: Node | null = element; node !== null; node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null)) {
            if (node instanceof Element && node.hasAttribute('inert')) {
                return true;
            }
        }
        return false;
    };
    const query = (selector: string): Element[] => {
        const found: Element[] = [];
        const visit = (root: Document | ShadowRoot): void => {
            found.push(...Array.from(root.querySelectorAll(selector)));
            for (const element of Array.from(root.querySelectorAll('*'))) {
                if (element.shadowRoot !== null) {
                    visit(element.shadowRoot);
                }
            }
        };
        visit(document);
        return found;
    };
    const name = (element: Element): string => {
        const label = element.getAttribute('data-layout-check');
        return label === null || label === '' ? `${element.tagName.toLowerCase()}.${element.className}` : label;
    };
    return selectors.flatMap((selector) =>
        query(selector)
            .filter((element) => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }))
            .filter((element) => !usable || !inert(element))
            .map((element) => ({ element, rect: element.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0 && rect.height > 0)
            .map(({ element, rect }) => ({ name: name(element), x: rect.x, y: rect.y, width: rect.width, height: rect.height })),
    );
}

/**
 * The visible boxes of the elements matching `selectors`, shadow roots included; `usable` leaves out the controls a
 * modal surface makes inert (the tour's overlap check judges what the visitor can see and use).
 */
export async function visibleBoxes(page: Page, selectors: readonly string[], options: { readonly usable?: boolean } = {}): Promise<Box[]> {
    return page.evaluate(boxesInPage, [selectors, options.usable === true] as const);
}

/** The pairs of boxes that overlap by more than `slack` CSS px in both directions. */
export function overlaps(boxes: readonly Box[], slack = 1): string[] {
    const pairs: string[] = [];
    boxes.forEach((first, index) => {
        for (const second of boxes.slice(index + 1)) {
            const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
            const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
            if (width > slack && height > slack) {
                pairs.push(`${first.name} overlaps ${second.name}`);
            }
        }
    });
    return pairs;
}

/** Runs in the page: the document's horizontal overflow in CSS px (0 when nothing scrolls sideways). */
export async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
}

/** Runs in the page: true when the centre of `element` hits the element itself (nothing covers it there). */
function onTopInPage(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    let hit: Element | null = document.elementFromPoint(x, y);
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

/** True when nothing covers the centre of `locator`'s element (a visitor's tap there reaches it). */
export async function isOnTop(locator: Locator): Promise<boolean> {
    return locator.evaluate(onTopInPage);
}

export interface FocusInfo {
    readonly tag: string;
    /** The accessible name as the element carries it (`aria-label`, else its text). */
    readonly name: string;
    readonly role: string;
    /** The tag of the shadow host the element lives in (`''` in the document). */
    readonly host: string;
    /** True when `:focus-visible` matches and an outline or a focus shadow is drawn. */
    readonly ringVisible: boolean;
    /** True when an outline is drawn, whatever `:focus-visible` says (the gamepad draws its own after a mouse click). */
    readonly outlined: boolean;
}

/** Runs in the page: the element that has the keyboard focus, through every shadow root, and its focus ring. */
function focusInPage(): FocusInfo | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    if (active === null || active === document.body) {
        return null;
    }
    const style = getComputedStyle(active);
    const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
    const shadow = style.boxShadow !== 'none' && style.boxShadow !== '';
    const root = active.getRootNode();
    return {
        tag: active.tagName.toLowerCase(),
        name: (active.getAttribute('aria-label') ?? active.textContent).trim(),
        role: active.getAttribute('role') ?? '',
        host: root instanceof ShadowRoot ? root.host.tagName.toLowerCase() : '',
        ringVisible: active.matches(':focus-visible') && (outline || shadow),
        outlined: outline,
    };
}

/** The focused element (null when nothing but the page has focus). */
export async function focused(page: Page): Promise<FocusInfo | null> {
    return page.evaluate(focusInPage);
}
