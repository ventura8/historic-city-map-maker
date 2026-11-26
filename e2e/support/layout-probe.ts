import { alphaOf } from './colour.js';
import {
    accessibleName,
    boxOf,
    deepElements,
    deepHit,
    deepQuery,
    deepSelect,
    escapesClipping,
    flatChain,
    flatParent,
    flatContains,
    flatHasAttribute,
    isDrawn,
    isScreenReaderOnly,
    reaches,
    samplePoints,
    scrollsOn,
    selectorOf,
    visibleBoxOf,
    withinShape,
    type Rect,
    standardSheetOverMap,
} from './dom-walk.js';

/**
 * The in-page half of the generic layout checker (e2e/support/layout.ts → `assertLayoutSound`): one snapshot of what a
 * visitor sees and can reach on the page as it is now, through every open shadow root. The rules that judge it run in
 * Node (e2e/support/layout-rules.ts). Every function here is a `function` declaration sent to the page by
 * `libraryScript` (e2e/support/page-script.ts) with the helpers of `DOM_WALK`; the unit tests call them on synthetic DOM.
 */

/** Floating chrome to keep apart: a kind and the selector that finds it (e2e/support/layout.ts → `FLOATING_CHROME`). */
export interface ChromeSource {
    readonly kind: string;
    readonly selector: string;
}

export interface ProbeOptions {
    readonly chrome: readonly ChromeSource[];
    /** The map canvas, and Mapbox's own logo and attribution. */
    readonly legal: { readonly map: string; readonly logo: string; readonly attribution: string };
    /** Elements the app roots render everything into (their shadow root is not one component). */
    readonly appRoots: readonly string[];
    /** Interactive elements larger than this share of the viewport sample only their centre (the map canvas). */
    readonly surfaceShare: number;
}

/** An element of the snapshot: what names it in a failure message, and where it is. */
export interface NodeInfo {
    readonly id: number;
    readonly name: string;
    readonly selector: string;
    readonly box: Rect;
    /** The part of `box` a visitor can see (cut by the viewport and by clipping ancestors); null when none. */
    readonly visible: Rect | null;
    /** The ids of the snapshot's other elements that contain this one in the flat tree. */
    readonly ancestors: readonly number[];
}

/** One sampled point: what the pointer hits there (an id of `nodes`) and whether that reaches the element. */
export interface Sample {
    readonly x: number;
    readonly y: number;
    readonly hit: number | null;
    readonly ok: boolean;
    /** What it hits is pinned to the viewport (fixed or sticky, as a navigation bar) while the element is not. */
    readonly pinned: boolean;
}

/** Where an element stands to the open modal surfaces. */
export type ModalPlace = 'none' | 'inside' | 'outside' | 'exempt';

export interface InteractiveInfo {
    readonly node: number;
    readonly role: string;
    readonly focusable: boolean;
    readonly disabled: boolean;
    /** Inert: an `inert` ancestor, or outside an open modal `<dialog>` (the platform makes the rest inert). */
    readonly inert: boolean;
    readonly ariaHidden: boolean;
    readonly modal: ModalPlace;
    readonly samples: readonly Sample[];
    /** The box a pointer can hit: the element's, or the kit's 48 × 48 `::after` touch target when larger. */
    readonly target: { readonly width: number; readonly height: number };
    /** A link inside a sentence (WCAG 2.5.8 exempts it from the target size). */
    readonly inline: boolean;
    /** A control Mapbox GL draws (its size and look are Mapbox's). */
    readonly thirdParty: boolean;
    readonly screenReaderOnly: boolean;
    readonly scrolls: { readonly x: boolean; readonly y: boolean };
    /** The ancestor that cuts it off without letting anyone scroll to the rest (overflow hidden or clip), else null. */
    readonly cutBy: number | null;
}

export interface ChromeInfo {
    readonly node: number;
    readonly kind: string;
    /** The component it belongs to (two parts of one component, as a FAB and its menu, are one unit), else null. */
    readonly group: number | null;
    /** Not inert, not hidden from assistive technology, not behind an open modal surface. */
    readonly usable: boolean;
}

export interface TextInfo {
    readonly node: number;
    /** Its line boxes, cut to what is visible. */
    readonly lines: readonly Rect[];
    /** Its own box hides content larger than itself (overflow hidden or clip). */
    readonly clipped: boolean;
    /** Nothing opaque covers its first line's centre (`showsThrough`). */
    readonly shown: boolean;
    readonly scrolls: { readonly x: boolean; readonly y: boolean };
    /** Text Mapbox GL draws (its collapsed attribution cuts its own text by design). */
    readonly thirdParty: boolean;
    /** The ancestor that cuts it off without letting anyone scroll to the rest, else null. */
    readonly cutBy: number | null;
}

/** A box that scrolls sideways inside the page (the page itself is `page.scrollsX`). */
export interface SidewaysInfo {
    readonly node: number;
    /** How many CSS px its content is wider than it. */
    readonly overflow: number;
    /** The innermost elements that stick out past its inline end (none when only a pseudo-element does). */
    readonly culprits: readonly number[];
}

interface LegalItem {
    readonly node: number;
    readonly samples: readonly Sample[];
}

/**
 * A loading indicator's shape, which turns and morphs without end: it must stay clear of every text but its own (M6,
 * finding 6 of 2026-10-25: a step's busy indicator was drawn over its chip's label, and no check saw it, since the
 * occlusion samples only a text's centre and the overlap check only floating chrome).
 */
interface GraphicInfo {
    readonly node: number;
}

export interface LayoutSnapshot {
    readonly viewport: { readonly width: number; readonly height: number };
    readonly page: { readonly scrollWidth: number; readonly scrollsX: boolean; readonly scrollsY: boolean };
    readonly nodes: readonly NodeInfo[];
    readonly interactives: readonly InteractiveInfo[];
    readonly chrome: readonly ChromeInfo[];
    readonly texts: readonly TextInfo[];
    readonly sideways: readonly SidewaysInfo[];
    /** The animated graphics drawn in the page (the loading indicators' shapes). */
    readonly graphics: readonly GraphicInfo[];
    /**
     * `map`: a drawn map shows a strip of its foot that reaches a legal control, and some of it is in view (not all under
     * the lightbox or a full-screen dialog); `owes`: which of the two the strip reaches (a control drawn above the strip
     * cannot show, so it is not owed); the visible logos and attributions.
     */
    readonly legal: {
        readonly map: boolean;
        readonly owes: { readonly logo: boolean; readonly attribution: boolean };
        readonly logos: readonly LegalItem[];
        readonly attributions: readonly LegalItem[];
    };
    /** The open modal surfaces (`aria-modal="true"` boxes and modal `<dialog>`s). */
    readonly modals: readonly number[];
}

/** The elements of a snapshot, each with its id. */
export interface Registry {
    readonly elements: Element[];
    readonly ids: Map<Element, number>;
}

/** The id of `element` in `registry`, registering it on first sight. */
function idOf(registry: Registry, element: Element): number {
    let id = registry.ids.get(element);
    if (id === undefined) {
        id = registry.elements.length;
        registry.elements.push(element);
        registry.ids.set(element, id);
    }
    return id;
}

/** The id of `element` (registered on first sight), or null for no element (a point nothing takes). */
export function idOrNull(registry: Registry, element: Element | null): number | null {
    return element === null ? null : idOf(registry, element);
}

/** What a visitor can operate: native controls, ARIA widget roles, and anything in the Tab order. */
function interactiveSelector(): string {
    const roles = ['button', 'link', 'slider', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio'];
    const more = ['option', 'combobox', 'spinbutton', 'textbox', 'searchbox'];
    const native = ['a[href]', 'button', 'input:not([type="hidden"])', 'select', 'textarea', 'summary', '[contenteditable="true"]'];
    return [...native, ...[...roles, ...more].map((role) => `[role="${role}"]`), '[tabindex]:not([tabindex^="-"])'].join(', ');
}

/** The drawn interactive elements of the page. */
export function interactiveElements(): Element[] {
    return deepQuery(interactiveSelector()).filter((element) => isDrawn(element));
}

/**
 * The open modal surfaces that are on top: every modal `<dialog>` (the top layer), and every drawn `aria-modal` box
 * whose centre is not covered by something else (a lightbox opened over a modal sheet leaves the sheet beneath it, which
 * then counts as outside the modal).
 */
export function modalSurfaces(): Element[] {
    return deepQuery('[aria-modal="true"], dialog').filter((element) => {
        if (element.tagName === 'DIALOG') {
            return element.matches(':modal');
        }
        const visible = isDrawn(element) ? visibleBoxOf(element) : null;
        return visible !== null && reaches(element, deepHit(visible.x + visible.width / 2, visible.y + visible.height / 2));
    });
}

/** Where `element` stands to the open `modals`; `exempt` ones (the legal line beside a modal sheet) stay usable. */
export function modalPlace(element: Element, modals: readonly Element[], exempt: readonly Element[]): ModalPlace {
    if (modals.length === 0) {
        return 'none';
    }
    if (modals.some((modal) => flatContains(modal, element))) {
        return 'inside';
    }
    return exempt.some((legal) => flatContains(legal, element)) ? 'exempt' : 'outside';
}

/**
 * The points of `element` a pointer check samples, and what it hits at each. A large `surface` (the map's canvas) counts
 * as one sample: the first of its centre and four inner points that reaches it, else its centre. A standard sheet over
 * part of the map (the Layers sheet, 2026-11-15) leaves the rest of it usable.
 */
export function sampleElement(registry: Registry, element: Element, surface: boolean): Sample[] {
    const visible = visibleBoxOf(element);
    if (visible === null) {
        return [];
    }
    const own = isPinned(element);
    const points = samplePoints(visible, false);
    // Only the points of the element's own shape: a round control scrolled to a strip has its box corners outside it.
    const shaped = points.filter(({ x, y }) => withinShape(element, x, y));
    // Inline: the page script carries only the helpers `LAYOUT_PROBE` lists into the page.
    const sampleAt = ({ x, y }: { readonly x: number; readonly y: number }): Sample => {
        const hit = deepHit(x, y);
        const pinned = hit !== null && !own && isPinned(hit);
        return {
            x,
            y,
            hit: idOrNull(registry, hit),
            ok: reaches(element, hit) || ownMapControl(element, hit) || standardSheetOverMap(element, hit),
            pinned,
        };
    };
    const samples = (shaped.length > 0 ? shaped : points.slice(0, 1)).map(sampleAt);
    const reached = samples.find((sample) => sample.ok);
    if (!surface) {
        return samples;
    }
    return reached === undefined ? samples.slice(0, 1) : [reached];
}

/**
 * Whether `hit` is one of Mapbox's own controls over the map `element` belongs to (its canvas): Mapbox draws its logo,
 * attribution and buttons over its canvas by design, and the legal rule checks them. A map scrolled to a strip (the
 * admin tour found one at 915 × 412) has a sample on them.
 */
export function ownMapControl(element: Element, hit: Element | null): boolean {
    const controls = element.closest('.mapboxgl-map')?.querySelector(':scope > .mapboxgl-control-container');
    return hit !== null && controls?.contains(hit) === true;
}

/** Whether the element, or a flat-tree ancestor, is fixed or sticky: it stays where it is while the page scrolls. */
export function isPinned(element: Element): boolean {
    return flatChain(element).some((node) => ['fixed', 'sticky'].includes(getComputedStyle(node).position));
}

/** Whether (x, y) lies outside `rect`. */
function outside(rect: DOMRect, x: number, y: number): boolean {
    return x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom;
}

/**
 * Whether (x, y) is scrolled away from `element`: outside the scrollport of a flat-tree ancestor that scrolls, so a
 * visitor scrolls it back into reach (a control at the edge of a list scrolled half out of view).
 */
export function scrolledAway(element: Element, x: number, y: number): boolean {
    const scrolls = (node: Element): boolean => scrollsOn(node, 'x') || scrollsOn(node, 'y');
    return flatChain(element)
        .slice(1)
        .some((node) => scrolls(node) && outside(node.getBoundingClientRect(), x, y));
}

/**
 * Whether a pointer at (x, y) reaches `element`. A point off screen or scrolled away cannot be tried and counts as
 * reached: the viewport's edge and a scroller's are the edge checks' business, not the target's size. Both are decided
 * at the pixel the hit test rounds the point to: a point in the viewport's last half pixel is tested at the row past it,
 * where nothing is hit (the 412 px English photo editor scrolled to put a draft button's ring 0.25 px short of the
 * viewport's foot read as a 46 px target).
 */
export function pointReaches(element: Element, x: number, y: number): boolean {
    const [px, py] = [Math.round(x), Math.round(y)];
    const onScreen = px >= 0 && py >= 0 && px < innerWidth && py < innerHeight;
    return !onScreen || scrolledAway(element, px, py) || reaches(element, deepHit(x, y));
}

/**
 * How far, from 0 to `extra` px, one side of a touch-target ring reaches a pointer past the element's box; `point(d)`
 * is the point d px past the box on that side. Tried 1 px inside the ring's edge, then narrowed down to a whole pixel.
 */
export function ringReach(element: Element, extra: number, point: (past: number) => readonly [number, number]): number {
    const reached = (past: number): boolean => pointReaches(element, ...point(past));
    if (extra <= 1 || reached(extra - 1)) {
        return Math.max(extra, 0);
    }
    let [low, high] = [0, extra - 1];
    while (high - low > 1) {
        const middle = (low + high) / 2;
        [low, high] = reached(middle) ? [middle, high] : [low, middle];
    }
    // A hit test rounds a fractional point to the pixel: count whole pixels only.
    return Math.floor(low);
}

/**
 * The box a pointer can hit: the element's own, or the kit's centred `::after` touch target (class `touch-target`) as
 * far as a pointer really reaches it. The pseudo-element's computed size stays 48 px when an `overflow: hidden` (the
 * element's own or an ancestor's) cuts it to the element's box, so each side of the ring beyond the box is hit-tested
 * at its middle (`ringReach`) and counts as far as the hit reaches the element (LA-6 of
 * docs/research/layout-a11y-findings.md: a tap 2 px outside a 40 px icon button missed it while this read 48 px).
 */
export function targetSizeOf(element: Element): { width: number; height: number } {
    const box = boxOf(element);
    if (!element.classList.contains('touch-target')) {
        return { width: box.width, height: box.height };
    }
    const after = getComputedStyle(element, '::after');
    const ringOf = (computed: string, own: number): number => Math.max(own, Number.parseFloat(computed) || 0);
    const dx = (ringOf(after.width, box.width) - box.width) / 2;
    const dy = (ringOf(after.height, box.height) - box.height) / 2;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const [left, right, top, bottom] = [box.x, box.x + box.width, box.y, box.y + box.height];
    return {
        width: box.width + ringReach(element, dx, (past) => [left - past, cy]) + ringReach(element, dx, (past) => [right + past, cy]),
        height: box.height + ringReach(element, dy, (past) => [cx, top - past]) + ringReach(element, dy, (past) => [cx, bottom + past]),
    };
}

/**
 * The flat-tree ancestor that cuts `element` off where nobody can scroll to the rest: the first ancestor whose box the
 * element leaves on an axis that it hides (overflow hidden or clip; a visitor cannot scroll it), unless an ancestor
 * before it scrolls on that axis. A fixed or top-layer element is cut by nothing above it. `box` is what must show
 * (the element's own box; its focus ring's for the Tab round).
 */
export function cutterOf(element: Element, box: Rect = boxOf(element)): Element | null {
    const hides = (value: string): boolean => value === 'hidden' || value === 'clip';
    const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll';
    for (let node: Element | null = element; node !== null && !escapesClipping(node);) {
        node = flatParent(node);
        const style = node === null || node instanceof HTMLSlotElement ? null : getComputedStyle(node);
        if (node === null || style === null || style.display === 'contents') {
            continue;
        }
        const outer = node.getBoundingClientRect();
        const leavesX = box.x < outer.x - 1 || box.x + box.width > outer.right + 1;
        const leavesY = box.y < outer.y - 1 || box.y + box.height > outer.bottom + 1;
        if ((leavesX && scrolls(style.overflowX)) || (leavesY && scrolls(style.overflowY))) {
            return null;
        }
        if ((leavesX && hides(style.overflowX)) || (leavesY && hides(style.overflowY))) {
            return node;
        }
    }
    return null;
}

/** The id of the ancestor that cuts `element` off, registered, or null. */
function cutIdOf(registry: Registry, element: Element): number | null {
    const cutter = cutterOf(element);
    return cutter === null ? null : idOf(registry, cutter);
}

/** Whether a flat-tree ancestor of `element` (or the page) scrolls on each axis. */
export function scrollAxes(element: Element): { x: boolean; y: boolean } {
    const chain = flatChain(element).slice(1);
    // In standards mode the root element is the page's scrolling element.
    const page = document.documentElement;
    return {
        x: chain.some((node) => scrollsOn(node, 'x')) || page.scrollWidth > innerWidth,
        y: chain.some((node) => scrollsOn(node, 'y')) || page.scrollHeight > innerHeight,
    };
}

/** The probe of one interactive element. */
function probeInteractive(registry: Registry, element: Element, context: InteractiveContext): InteractiveInfo {
    const visible = visibleBoxOf(element);
    const area = visible === null ? 0 : visible.width * visible.height;
    const modal = modalPlace(element, context.modals, context.exempt);
    const dialogs = context.modals.filter((surface) => surface.tagName === 'DIALOG');
    const blocked = dialogs.length > 0 && !dialogs.some((dialog) => flatContains(dialog, element)) && modal !== 'exempt';
    return {
        node: idOf(registry, element),
        role: element.getAttribute('role') ?? element.tagName.toLowerCase(),
        focusable: (element as HTMLElement).tabIndex >= 0 && !element.matches(':disabled'),
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        inert: blocked || flatHasAttribute(element, 'inert'),
        ariaHidden: flatHasAttribute(element, 'aria-hidden', 'true'),
        modal,
        samples: sampleElement(registry, element, area > innerWidth * innerHeight * context.surfaceShare),
        target: targetSizeOf(element),
        inline: element.tagName === 'A' && getComputedStyle(element).display === 'inline' && element.parentElement?.tagName === 'P',
        thirdParty: element.closest('.mapboxgl-ctrl, .mapboxgl-canvas-container') !== null,
        screenReaderOnly: isScreenReaderOnly(element),
        scrolls: scrollAxes(element),
        cutBy: cutIdOf(registry, element),
    };
}

/** What every interactive element's probe needs to know about the page. */
interface InteractiveContext {
    readonly modals: readonly Element[];
    readonly exempt: readonly Element[];
    readonly surfaceShare: number;
}

/** The component an element belongs to: the host of its shadow root, unless that host is an app root. */
export function componentOf(element: Element, appRoots: readonly string[]): Element | null {
    const root = element.getRootNode();
    if (!(root instanceof ShadowRoot)) {
        return null;
    }
    return appRoots.includes(root.host.tagName.toLowerCase()) ? null : root.host;
}

/** The floating chrome of the page, each element once (under the first kind that finds it). */
function probeChrome(registry: Registry, options: ProbeOptions, context: InteractiveContext): ChromeInfo[] {
    const seen = new Set<Element>();
    const found: ChromeInfo[] = [];
    for (const source of options.chrome) {
        for (const element of deepSelect(source.selector).filter((candidate) => isDrawn(candidate) && !seen.has(candidate))) {
            seen.add(element);
            const component = componentOf(element, options.appRoots);
            const place = modalPlace(element, context.modals, context.exempt);
            const hidden = flatHasAttribute(element, 'inert') || flatHasAttribute(element, 'aria-hidden', 'true');
            found.push({
                node: idOf(registry, element),
                kind: source.kind,
                group: component === null ? null : idOf(registry, component),
                usable: !hidden && place !== 'outside',
            });
        }
    }
    return found;
}

/** Whether the element holds a text node of its own with something to read. */
export function hasOwnText(element: Element): boolean {
    return Array.from(element.childNodes).some((node) => node instanceof Text && node.data.trim() !== '');
}

/** The line boxes of the element's own text, cut to its visible part. */
export function textLines(element: Element, visible: Rect): Rect[] {
    const lines: Rect[] = [];
    for (const node of Array.from(element.childNodes)) {
        if (!(node instanceof Text) || node.data.trim() === '') {
            continue;
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
            const x = Math.max(rect.x, visible.x);
            const y = Math.max(rect.y, visible.y);
            const right = Math.min(rect.right, visible.x + visible.width);
            const bottom = Math.min(rect.bottom, visible.y + visible.height);
            if (right - x >= 1 && bottom - y >= 1) {
                lines.push({ x, y, width: right - x, height: bottom - y });
            }
        }
    }
    return lines;
}

/** Whether the element's own box cuts its content (overflow hidden or clip on an axis it does not fit). */
export function cutsContent(element: Element): boolean {
    const style = getComputedStyle(element);
    const hides = (value: string): boolean => value === 'hidden' || value === 'clip';
    return (
        (hides(style.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
        (hides(style.overflowY) && element.scrollHeight > element.clientHeight + 1)
    );
}

/**
 * Whether `element` shows at a point where the pointer hits `hit`: it is the element (or inside it), or nothing opaque
 * lies between: every element from the hit up to an ancestor they share has neither a background colour of half
 * opacity or more nor a background image (a transparent label drawn over another text lets it show through).
 */
export function showsThrough(element: Element, hit: Element | null): boolean {
    if (hit === null) {
        return false;
    }
    if (reaches(element, hit)) {
        return true;
    }
    const own = new Set(flatChain(element));
    for (const node of flatChain(hit)) {
        if (own.has(node)) {
            return true;
        }
        const style = getComputedStyle(node);
        if (alphaOf(style.backgroundColor) >= 0.5 || style.backgroundImage !== 'none') {
            return false;
        }
    }
    return true;
}

/** The text blocks a visitor reads: drawn, own text, not decorative (aria-hidden), not for screen readers only. */
function probeTexts(registry: Registry): TextInfo[] {
    const texts: TextInfo[] = [];
    for (const element of deepQuery('*')) {
        if (!hasOwnText(element) || !isDrawn(element) || flatHasAttribute(element, 'aria-hidden', 'true') || isScreenReaderOnly(element)) {
            continue;
        }
        const visible = visibleBoxOf(element);
        const lines = visible === null ? [] : textLines(element, visible);
        const first = lines[0];
        const shown = first !== undefined && showsThrough(element, deepHit(first.x + first.width / 2, first.y + first.height / 2));
        texts.push({
            node: idOf(registry, element),
            lines,
            clipped: cutsContent(element),
            shown,
            scrolls: scrollAxes(element),
            thirdParty: element.closest('.mapboxgl-ctrl') !== null,
            cutBy: cutIdOf(registry, element),
        });
    }
    return texts;
}

/**
 * The elements inside `scroller` (its flat-tree descendants) that end past its inline end, without one of their own
 * descendants doing so: what makes it scroll sideways, at most three.
 */
export function sidewaysCulprits(scroller: Element): Element[] {
    const edge = scroller.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(scroller).borderRightWidth) + 1;
    const out = deepElements().filter(
        (element) =>
            element !== scroller && flatContains(scroller, element) && isDrawn(element) && element.getBoundingClientRect().right > edge,
    );
    return out.filter((element) => !out.some((other) => other !== element && flatContains(element, other))).slice(0, 3);
}

/**
 * A box made to scroll sideways only: its block axis is hidden or clipped, so it never scrolls in two directions (the
 * lying timeline of more years than its card, the owner's design of 2026-11-14: one row of years, paged by its edge
 * buttons). A box that scrolls down and, by accident, sideways (`overflow-y: auto` alone) is still a fault.
 */
function scrollsOnlySideways(element: Element): boolean {
    const overflowY = getComputedStyle(element).overflowY;
    return overflowY === 'hidden' || overflowY === 'clip';
}

/**
 * Every drawn box but the page that scrolls sideways: its overflow is auto or scroll on the inline axis (as it becomes
 * when only the block axis was asked to scroll) and its content is wider than it. On a page that reflows (WCAG 1.4.10)
 * nothing scrolls in two directions: the tour found a dialog whose segmented button ran past its edge at 360 px. A row
 * that scrolls sideways only (`scrollsOnlySideways`) is not two-directional scrolling and is left out.
 */
function probeSideways(registry: Registry): SidewaysInfo[] {
    const root = new Set<Element>([document.documentElement, document.body]);
    return deepElements()
        .filter((element) => !root.has(element) && isDrawn(element) && scrollsOn(element, 'x') && !scrollsOnlySideways(element))
        .map((element) => ({
            node: idOf(registry, element),
            overflow: element.scrollWidth - element.clientWidth,
            culprits: sidewaysCulprits(element).map((culprit) => idOf(registry, culprit)),
        }));
}

/**
 * The loading indicators' shapes a visitor can see (their box as drawn now, turned or not): the kit's
 * `hcm-loading-indicator` draws its shape in the part `indicator`, a progress bar without a value. The selector is
 * inline: a page helper may reference only browser globals and the other helpers.
 */
function probeGraphics(registry: Registry): GraphicInfo[] {
    return deepQuery('[part="indicator"][role="progressbar"]')
        .filter((element) => isDrawn(element) && visibleBoxOf(element) !== null)
        .map((element) => ({ node: idOf(registry, element) }));
}

/** The drawn elements matching `selector` that a visitor can see, each with its sampled points. */
/**
 * Whether a map canvas shows its bottom edge, where Mapbox draws its logo and attribution: a map whose foot a scroller or
 * the window cuts off (an admin page scrolled past its map) shows them no more than the rest of what is cut. The scroll
 * sweep checks the same map at the positions that show its foot.
 */
function showsItsFoot(canvas: Element, legal = ''): boolean {
    const visible = visibleBoxOf(canvas);
    const box = boxOf(canvas);
    const gap = legal === '' ? 0 : legalGap(canvas, legal);
    return visible !== null && visible.y + visible.height >= box.y + box.height - 1 && visible.height > gap;
}

/**
 * The band at a map canvas's foot below its lowest legal control (`legal`: the selectors of the controls asked about),
 * 0 without one inside the canvas's box. Mapbox draws them a few pixels above the foot, so a strip of the map no taller
 * than that band (an admin page scrolled to its end, the map's last 4 px left at the top: lesson 144) cannot show them;
 * one pixel more of the map and the rule asks for them again. Asked about each control on its own, a strip that reaches
 * the attribution (on the foot) but not the logo (10 px above it) owes the attribution only (lesson 163).
 */
function legalGap(canvas: Element, legal: string): number {
    const box = boxOf(canvas);
    const foot = box.y + box.height;
    const inside = (item: Rect): boolean =>
        item.x >= box.x && item.x + item.width <= box.x + box.width && item.y >= box.y && item.y + item.height <= foot;
    const bottoms = deepQuery(legal)
        .map((element) => boxOf(element))
        .filter(inside)
        .map((item) => item.y + item.height);
    return bottoms.length === 0 ? 0 : foot - Math.max(...bottoms);
}

/**
 * The visible legal items of `selector`, each with its sampled points. A point seen through a modal sheet's scrim (a
 * translucent layer, `showsThrough`) counts as uncovered: the map shows there, dimmed, and so do Mapbox's credits on it
 * (V18; the Pixel 9 Pro review, P3).
 */
function probeLegal(registry: Registry, selector: string): LegalItem[] {
    return deepQuery(selector)
        .filter((element) => isDrawn(element) && visibleBoxOf(element) !== null)
        .map((element) => ({
            node: idOf(registry, element),
            samples: sampleElement(registry, element, false).map((sample) => ({
                ...sample,
                ok: sample.ok || showsThrough(element, deepHit(sample.x, sample.y)),
            })),
        }));
}

/**
 * Whether any of a map canvas shows: a 5 x 5 grid over its visible box, a point seen when the pointer hits the canvas,
 * one of its own controls, or something translucent over them (a sheet's scrim). Under the lightbox or a full-screen
 * dialog no point shows, so the map owes no credit there (Mapbox terms ask for one where the map is displayed).
 */
function mapSeen(canvas: Element): boolean {
    const box = visibleBoxOf(canvas);
    if (box === null) {
        return false;
    }
    const steps = [0.1, 0.3, 0.5, 0.7, 0.9];
    return steps.some((fx) =>
        steps.some((fy) => {
            const hit = deepHit(box.x + box.width * fx, box.y + box.height * fy);
            return ownMapControl(canvas, hit) || showsThrough(canvas, hit);
        }),
    );
}

/** Every registered element as a `NodeInfo` (registered last, so the hit elements of every sample are named too). */
function describeNodes(registry: Registry): NodeInfo[] {
    return registry.elements.map((element, id) => ({
        id,
        name: accessibleName(element),
        selector: selectorOf(element),
        box: boxOf(element),
        visible: visibleBoxOf(element),
        ancestors: flatChain(element)
            .slice(1)
            .map((ancestor) => registry.ids.get(ancestor))
            .filter((ancestor) => ancestor !== undefined),
    }));
}

/** The snapshot `assertLayoutSound` judges. */
export function probeLayout(options: ProbeOptions): LayoutSnapshot {
    const registry: Registry = { elements: [], ids: new Map() };
    const modals = modalSurfaces();
    const exempt = deepQuery(`${options.legal.logo}, ${options.legal.attribution}`);
    const context: InteractiveContext = { modals, exempt, surfaceShare: options.surfaceShare };
    const interactives = interactiveElements().map((element) => probeInteractive(registry, element, context));
    const chrome = probeChrome(registry, options, context);
    const texts = probeTexts(registry);
    const sideways = probeSideways(registry);
    const graphics = probeGraphics(registry);
    const reaches = (legalSelector: string): boolean =>
        deepQuery(options.legal.map).some((canvas) => isDrawn(canvas) && showsItsFoot(canvas, legalSelector) && mapSeen(canvas));
    const legal = {
        map: reaches(`${options.legal.logo}, ${options.legal.attribution}`),
        owes: { logo: reaches(options.legal.logo), attribution: reaches(options.legal.attribution) },
        logos: probeLegal(registry, options.legal.logo),
        attributions: probeLegal(registry, options.legal.attribution),
    };
    const page = document.documentElement;
    return {
        viewport: { width: innerWidth, height: innerHeight },
        page: {
            scrollWidth: Math.max(page.scrollWidth, document.body.scrollWidth),
            scrollsX: page.scrollWidth > innerWidth,
            scrollsY: page.scrollHeight > innerHeight,
        },
        interactives,
        chrome,
        texts,
        sideways,
        graphics,
        legal,
        modals: modals.map((modal) => idOf(registry, modal)),
        nodes: describeNodes(registry),
    };
}

/**
 * How many finite animations and transitions are running in the page (an endless one, as a loading indicator's, never
 * ends and does not count): a check waits for none, so a sheet still sliding in is not taken for an overlap.
 */
export function movingAnimations(): number {
    return deepElements()
        .flatMap((element) => element.getAnimations())
        .filter((animation) => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)))
        .length;
}

/** Every helper of this module, for `libraryScript`. */
export const LAYOUT_PROBE = [
    movingAnimations,
    idOf,
    idOrNull,
    interactiveSelector,
    interactiveElements,
    modalSurfaces,
    modalPlace,
    isPinned,
    cutterOf,
    cutIdOf,
    sampleElement,
    ownMapControl,
    outside,
    scrolledAway,
    pointReaches,
    ringReach,
    targetSizeOf,
    scrollAxes,
    probeInteractive,
    componentOf,
    probeChrome,
    hasOwnText,
    showsThrough,
    textLines,
    cutsContent,
    probeTexts,
    sidewaysCulprits,
    scrollsOnlySideways,
    probeSideways,
    probeGraphics,
    showsItsFoot,
    legalGap,
    probeLegal,
    mapSeen,
    describeNodes,
    probeLayout,
] as const;
