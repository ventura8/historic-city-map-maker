import { alphaOf, composite, contrastRatio, parseColour, type Rgba } from './colour.js';
import {
    accessibleName,
    boxOf,
    deepHit,
    deepQuery,
    flatChain,
    flatHasAttribute,
    flatParent,
    flatText,
    isDrawn,
    reaches,
    samplePoints,
    selectorOf,
    visibleBoxOf,
    type Rect,
    standardSheetOverMap,
} from './dom-walk.js';
import { cutterOf, interactiveElements, modalPlace, modalSurfaces, type ModalPlace } from './layout-probe.js';

/**
 * The in-page half of the generic accessibility checker (e2e/support/a11y.ts → `assertAccessible`): the Tab order as
 * the keyboard walks it, each focus ring and its contrast, the non-text contrast of controls, the landmarks. `function`
 * declarations installed in the page by `libraryScript` with the helpers of `DOM_WALK`, `COLOUR` and `LAYOUT_PROBE`; the rules
 * that judge what they return are e2e/support/a11y-rules.ts.
 */

/** An element as the accessibility checks name it. */
export interface Named {
    readonly name: string;
    readonly selector: string;
    readonly box: Rect | null;
}

/** One stop of the Tab walk. */
export interface FocusStop extends Named {
    /** The same number for the same element across the walk (e2e: `window.hcmFocusIds`). */
    readonly id: number;
    /** The selector of the shadow root's host it lives in (`document` outside any). */
    readonly scope: string;
    readonly modal: ModalPlace;
    /** Where the element is in its scrolling content (its box plus the scroll offsets above it): stops compare by it. */
    readonly content: { readonly top: number; readonly bottom: number };
    /** `:focus-visible` matched and an outline or a focus shadow was drawn. */
    readonly ring: boolean;
    /** The ring's contrast against the colour around the element (null: over the map's imagery, not measurable). */
    readonly ringContrast: number | null;
    /** Every sampled point of the focused element hit something else (WCAG 2.4.11). */
    readonly obscured: boolean;
    /** The ancestor that cuts the focus outline off (it hides its overflow and does not scroll), by its selector. */
    readonly ringCutBy: string | null;
}

/** A stop, or the focus leaving the page (Tab past the last element). */
export type FocusEntry = FocusStop | { readonly left: true };

interface FocusWindow {
    hcmFocusIds?: WeakMap<Element, number>;
    hcmFocusNext?: number;
}

/** The walk's number for `element`. */
export function focusIdOf(element: Element): number {
    const scope = window as unknown as FocusWindow;
    scope.hcmFocusIds ??= new WeakMap();
    let id = scope.hcmFocusIds.get(element);
    if (id === undefined) {
        id = (scope.hcmFocusNext ?? 0) + 1;
        scope.hcmFocusNext = id;
        scope.hcmFocusIds.set(element, id);
    }
    return id;
}

/**
 * The background behind `element`, composited from its flat-tree ancestors (a white page when they are all
 * transparent: the viewer and the admin paint their own surfaces); null when it is the map's imagery.
 */
export function backgroundBehind(element: Element): Rgba | null {
    const layers: Rgba[] = [];
    for (let node = flatParent(element); node !== null; node = flatParent(node)) {
        const colour = parseColour(getComputedStyle(node).backgroundColor);
        if (colour !== null && colour[3] > 0) {
            layers.push(colour);
        }
        if (alphaOf(getComputedStyle(node).backgroundColor) >= 0.99) {
            break;
        }
        if (node.querySelector('canvas.mapboxgl-canvas') !== null) {
            return null;
        }
    }
    return layers.reduceRight((back, fore) => composite(fore, back), [255, 255, 255, 1] as Rgba);
}

/** The colour of the focus indicator drawn for `element` now (its outline, else its box shadow), or null when none. */
export function ringColourOf(element: Element): Rgba | null {
    const style = getComputedStyle(element);
    if (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0) {
        return parseColour(style.outlineColor);
    }
    const shadow = /rgba?\([^)]*\)|color\([^)]*\)/.exec(style.boxShadow);
    return shadow === null ? null : parseColour(shadow[0]);
}

/** The box the element's focus outline covers: its border box grown by the outline's offset and width; else null. */
export function ringBoxOf(element: Element): Rect | null {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth);
    if (style.outlineStyle === 'none' || !Number.isFinite(width) || width <= 0) {
        return null;
    }
    const grow = Math.max(0, Number.parseFloat(style.outlineOffset) + width);
    const box = boxOf(element);
    return { x: box.x - grow, y: box.y - grow, width: box.width + 2 * grow, height: box.height + 2 * grow };
}

/**
 * The ancestor that cuts the focused element's ring off, by its selector, or null: a ring drawn past the edge of a box
 * that hides its overflow is partly not drawn (the bottom sheet's drag handle at the sheet's top edge).
 */
export function ringCutterOf(element: Element): string | null {
    const ring = element.matches(':focus-visible') ? ringBoxOf(element) : null;
    const cutter = ring === null ? null : cutterOf(element, ring);
    return cutter === null ? null : selectorOf(cutter);
}

/** Where the focused element is visible, and whether every sampled point of it hits something else. */
export function focusView(element: Element): { box: Rect | null; obscured: boolean } {
    const box = visibleBoxOf(element);
    const points = box === null ? [] : samplePoints(box, false);
    return {
        box,
        obscured:
            points.length > 0 &&
            points.every(({ x, y }) => {
                const hit = deepHit(x, y);
                return !reaches(element, hit) && !standardSheetOverMap(element, hit);
            }),
    };
}

/** The element's place in its scrolling content: its box moved by every scroll offset above it, the page's included. */
export function contentPlace(element: Element): { top: number; bottom: number } {
    const rect = element.getBoundingClientRect();
    const scrolled = flatChain(element)
        .slice(1)
        .reduce((sum, node) => sum + node.scrollTop, scrollY);
    return { top: rect.top + scrolled, bottom: rect.bottom + scrolled };
}

/** The stop the walk records for `element`, which has the focus now. */
export function focusStopOf(element: Element): FocusStop {
    const ringColour = element.matches(':focus-visible') ? ringColourOf(element) : null;
    const back = backgroundBehind(element);
    const root = element.getRootNode();
    return {
        id: focusIdOf(element),
        name: accessibleName(element),
        selector: selectorOf(element),
        ...focusView(element),
        scope: root instanceof ShadowRoot ? selectorOf(root.host) : 'document',
        modal: modalPlace(element, modalSurfaces(), []),
        content: contentPlace(element),
        ring: ringColour !== null && ringColour[3] > 0,
        ringCutBy: ringCutterOf(element),
        ringContrast: ringColour === null || back === null ? null : contrastRatio(composite(ringColour, back), back),
    };
}

/**
 * A frame after the focus moved, the browser has scrolled the element into view: the stop keeps the better of both
 * views (a skip link shows only while focused, a list item only once scrolled to).
 */
export function refreshStop(stop: { box: Rect | null; obscured: boolean }, element: Element): void {
    const later = focusView(element);
    stop.box = stop.box ?? later.box;
    stop.obscured = stop.obscured && later.obscured;
}

/**
 * Records where the focus is after a key press: the deep active element as a stop (when hidden or covered, measured
 * again a frame later, once the browser has scrolled it into view), or the focus leaving the page (Tab past the last
 * element). Called after every
 * press: a `focusin` listener on the document would miss every move inside one shadow root, whose event stops there
 * (the target and the related target retarget to the same host).
 */
export async function recordFocus(): Promise<FocusEntry> {
    const active = deepActive();
    if (active === null) {
        return { left: true };
    }
    const stop = { ...focusStopOf(active) };
    if (stop.box === null || stop.obscured) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        refreshStop(stop, active);
    }
    return stop;
}

/** Remembers the element that has the focus now, for `restoreFocus` after a walk. */
export function rememberFocus(): void {
    (window as unknown as { hcmFocusBefore?: Element | null }).hcmFocusBefore = deepActive();
}

/** Gives the focus back to the element `rememberFocus` noted, if it is still in the page (else to nothing). */
export function restoreFocus(): void {
    const before = (window as unknown as { hcmFocusBefore?: Element | null }).hcmFocusBefore ?? null;
    if (before instanceof HTMLElement && before.isConnected) {
        before.focus({ preventScroll: true });
        return;
    }
    const active = deepActive();
    if (active instanceof HTMLElement) {
        active.blur();
    }
}

/** The deep element that has the focus now, or null (the page's body). */
export function deepActive(): Element | null {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active === document.body ? null : active;
}

/** The popups open on top now (modal surfaces, menus and list boxes on screen), each by its selector. */
export function openPopups(): string[] {
    const popups = [...modalSurfaces(), ...deepQuery('[role="menu"], [role="listbox"]').filter((popup) => isDrawn(popup))];
    return popups.map((popup) => selectorOf(popup));
}

/** The name of the element that has the focus now ('' when none). */
export function activeName(): string {
    const active = deepActive();
    return active === null ? '' : accessibleName(active);
}

/** Whether a radio button is the one of its named group the Tab key stops at (the checked one, else the first). */
export function isGroupStop(element: Element): boolean {
    if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.name === '') {
        return true;
    }
    const root = element.getRootNode() as Document | ShadowRoot;
    const group = Array.from(root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(element.name)}"]`));
    const checked = group.find((radio) => radio.checked);
    return checked === undefined ? group[0] === element : checked === element;
}

/** An element the Tab key should reach. */
export interface ExpectedStop extends Named {
    readonly id: number;
}

/**
 * What the Tab key should reach now: drawn (a list item scrolled away included: Tab scrolls it into view), in the Tab
 * order, enabled, not inert, inside the open modal if there is one.
 */
export function expectedStops(): ExpectedStop[] {
    const modals = modalSurfaces();
    return interactiveElements()
        .filter((element) => (element as HTMLElement).tabIndex >= 0 && !element.matches(':disabled') && !flatHasAttribute(element, 'inert'))
        .filter((element) => isGroupStop(element) && !flatHasAttribute(element, 'aria-hidden', 'true'))
        .filter((element) => ['none', 'inside'].includes(modalPlace(element, modals, [])))
        .map((element) => ({
            id: focusIdOf(element),
            name: accessibleName(element),
            selector: selectorOf(element),
            box: visibleBoxOf(element),
        }));
}

/** The contrast of one control's visual boundary with what is around it, where WCAG 1.4.11 asks for one. */
export interface ControlContrast extends Named {
    readonly kind: 'state' | 'field' | 'icon';
    /** The best ratio of its boundary, parts or glyph against the colour around it. */
    readonly ratio: number;
}

/** The colours a control is drawn with: its own background and border, and those of its parts in the flat tree. */
export function partColours(element: Element): Rgba[] {
    const parts = [
        element,
        ...(element.shadowRoot === null ? [] : Array.from(element.shadowRoot.querySelectorAll('*'))),
        ...Array.from(element.querySelectorAll('*')),
    ];
    return parts
        .filter((part) => isDrawn(part))
        .flatMap((part) => {
            const style = getComputedStyle(part);
            const border = ['top', 'right', 'bottom', 'left'].find(
                (side) =>
                    style.getPropertyValue(`border-${side}-style`) !== 'none' &&
                    Number.parseFloat(style.getPropertyValue(`border-${side}-width`)) >= 1,
            );
            const colours = [style.backgroundColor, border === undefined ? '' : style.getPropertyValue(`border-${border}-color`)];
            return colours.map((value) => parseColour(value)).filter((colour): colour is Rgba => colour !== null && colour[3] > 0);
        });
}

/** Which WCAG 1.4.11 case a control is, or null when its text identifies it (no boundary is required then). */
export function contrastKind(element: Element): ControlContrast['kind'] | null {
    const stateRoles = ['slider', 'switch', 'checkbox', 'radio'];
    if (
        stateRoles.includes(element.getAttribute('role') ?? '') ||
        element.matches('input[type="checkbox"], input[type="radio"], input[type="range"]')
    ) {
        return 'state';
    }
    if (element.matches('input, textarea, select')) {
        return 'field';
    }
    const words = flatText(element).replace(/\s+/g, ' ').trim();
    const icons = [
        ...Array.from(element.querySelectorAll('hcm-icon')),
        ...Array.from(element.shadowRoot?.querySelectorAll('hcm-icon') ?? []),
    ].map((icon) => (icon.getAttribute('name') ?? '').replace(/_/g, ' '));
    const text = icons.reduce((rest, icon) => rest.replace(icon, ''), words).trim();
    return text === '' ? 'icon' : null;
}

/**
 * The non-text contrast of every usable control that needs one (over the map's imagery it cannot be measured). WCAG 1.4.11
 * exempts an inactive control: a disabled one, and a soft-disabled one (`aria-disabled="true"`, focusable: the map's
 * zoom buttons at a zoom limit, DECISIONS-for-review.md §128e).
 */
export function controlContrasts(): ControlContrast[] {
    const inactive = (element: Element): boolean => element.matches(':disabled') || flatHasAttribute(element, 'aria-disabled', 'true');
    return interactiveElements()
        .filter((element) => !flatHasAttribute(element, 'inert') && !flatHasAttribute(element, 'aria-hidden', 'true') && !inactive(element))
        .filter((element) => element.closest('.mapboxgl-ctrl') === null && visibleBoxOf(element) !== null)
        .flatMap((element): ControlContrast[] => {
            const kind = contrastKind(element);
            const back = backgroundBehind(element);
            if (kind === null || back === null) {
                return [];
            }
            const glyphs = kind === 'icon' ? [parseColour(getComputedStyle(element).color)].filter((colour) => colour !== null) : [];
            const colours = [...partColours(element), ...glyphs];
            const ratio = Math.max(1, ...colours.map((colour) => contrastRatio(composite(colour, back), back)));
            return [{ kind, ratio, name: accessibleName(element), selector: selectorOf(element), box: visibleBoxOf(element) }];
        });
}

/** One landmark of the page. */
export interface Landmark extends Named {
    readonly role: string;
}

/** The landmark role an element has, explicit or implicit (a form or section only with a name). */
export function landmarkRole(element: Element): string | null {
    const explicit = element.getAttribute('role');
    const landmarks = ['main', 'navigation', 'complementary', 'banner', 'contentinfo', 'region', 'form', 'search'];
    if (explicit !== null) {
        return landmarks.includes(explicit) ? explicit : null;
    }
    const named = accessibleName(element) !== '' && (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby'));
    const sectioned = element.closest('article, aside, main, nav, section') !== null;
    const implicit: Readonly<Record<string, string | null>> = {
        MAIN: 'main',
        NAV: 'navigation',
        ASIDE: 'complementary',
        SEARCH: 'search',
        HEADER: sectioned ? null : 'banner',
        FOOTER: sectioned ? null : 'contentinfo',
        FORM: named ? 'form' : null,
        SECTION: named ? 'region' : null,
    };
    return implicit[element.tagName] ?? null;
}

/** The landmarks a visitor's assistive technology lists now (drawn, not inert, not hidden). */
export function landmarks(): Landmark[] {
    return deepQuery('main, nav, aside, header, footer, form, section, search, [role]')
        .filter((element) => isDrawn(element) && !flatHasAttribute(element, 'inert') && !flatHasAttribute(element, 'aria-hidden', 'true'))
        .flatMap((element): Landmark[] => {
            const role = landmarkRole(element);
            return role === null
                ? []
                : [{ role, name: accessibleName(element), selector: selectorOf(element), box: visibleBoxOf(element) }];
        });
}

/** Every helper of this module, for `libraryScript`. */
export const A11Y_PROBE = [
    focusIdOf,
    backgroundBehind,
    ringColourOf,
    ringBoxOf,
    ringCutterOf,
    focusView,
    contentPlace,
    focusStopOf,
    refreshStop,
    recordFocus,
    rememberFocus,
    restoreFocus,
    deepActive,
    openPopups,
    activeName,
    isGroupStop,
    expectedStops,
    partColours,
    contrastKind,
    controlContrasts,
    landmarkRole,
    landmarks,
] as const;
