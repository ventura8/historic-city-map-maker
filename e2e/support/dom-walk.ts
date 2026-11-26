/**
 * In-page helpers of the tour's checkers (e2e/support/page-script.ts explains how they reach the page): walking the
 * flat tree through open shadow roots and slots, telling what a visitor can see and use, naming an element for a
 * failure message, and hit-testing a point down to the deepest element under it. Each is a `function` declaration that
 * uses only browser globals and the other helpers listed in `DOM_WALK`.
 */

/** A box in CSS px of the viewport. */
export interface Rect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/** The flat-tree parent: the slot an element is assigned to, else its parent element, else its shadow root's host. */
export function flatParent(element: Element): Element | null {
    if (element.assignedSlot !== null) {
        return element.assignedSlot;
    }
    if (element.parentElement !== null) {
        return element.parentElement;
    }
    const root = element.parentNode;
    return root instanceof ShadowRoot ? root.host : null;
}

/** The element and its flat-tree ancestors, innermost first. */
export function flatChain(element: Element): Element[] {
    const chain: Element[] = [];
    for (let node: Element | null = element; node !== null; node = flatParent(node)) {
        chain.push(node);
    }
    return chain;
}

/** Whether `ancestor` is `element` or one of its flat-tree ancestors. */
export function flatContains(ancestor: Element, element: Element): boolean {
    return flatChain(element).includes(ancestor);
}

/** Every element of the document and of every open shadow root inside it. */
export function deepElements(): Element[] {
    const found: Element[] = [];
    const visit = (root: Document | ShadowRoot): void => {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            found.push(element);
            if (element.shadowRoot !== null) {
                visit(element.shadowRoot);
            }
        }
    };
    visit(document);
    return found;
}

/** The elements matching `selector` in the document and every open shadow root. */
export function deepQuery(selector: string): Element[] {
    return deepElements().filter((element) => element.matches(selector));
}

/** The shadow-including parent: the parent element, else the host of the shadow root the element is in. */
export function composedParent(element: Element): Element | null {
    const root = element.getRootNode();
    return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/**
 * The elements matching `selector`, which may name a component and a part of its shadow DOM with ` >>> `
 * (`hcm-fab-menu >>> button.fab`: a `button.fab` anywhere inside an `hcm-fab-menu`, shadow roots included), where a
 * CSS combinator would stop at the shadow boundary.
 */
export function deepSelect(selector: string): Element[] {
    const split = selector.lastIndexOf('>>>');
    const last = split === -1 ? selector : selector.slice(split + 3).trim();
    const hosts =
        split === -1
            ? []
            : selector
                  .slice(0, split)
                  .split('>>>')
                  .map((part) => part.trim())
                  .toReversed();
    return deepQuery(last).filter((element) => {
        let node = composedParent(element);
        for (const part of hosts) {
            while (node !== null && !node.matches(part)) {
                node = composedParent(node);
            }
            if (node === null) {
                return false;
            }
            node = composedParent(node);
        }
        return true;
    });
}

/** A box as a plain object (a DOMRect does not survive serialization). */
function plainRect(rect: DOMRectReadOnly): Rect {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * The element's box: its bounding box, except for an inline element broken over several lines, whose largest line box
 * is the part a pointer can hit (the bounding box of two lines also covers the gap beside them).
 */
export function boxOf(element: Element): Rect {
    const [first, ...rest] = Array.from(element.getClientRects());
    if (first !== undefined && rest.length > 0 && getComputedStyle(element).display === 'inline') {
        const largest = rest.reduce((best, rect) => (rect.width * rect.height > best.width * best.height ? rect : best), first);
        return plainRect(largest);
    }
    return plainRect(element.getBoundingClientRect());
}

/** The overlap of two boxes, or null when they do not overlap. */
export function intersect(first: Rect, second: Rect): Rect | null {
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    const right = Math.min(first.x + first.width, second.x + second.width);
    const bottom = Math.min(first.y + first.height, second.y + second.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/** Whether the element has a box that clips what overflows it (on either axis). */
export function clips(element: Element): boolean {
    const style = getComputedStyle(element);
    return style.display !== 'contents' && (style.overflowX !== 'visible' || style.overflowY !== 'visible');
}

/** Whether the element scrolls on `axis`: its overflow scrolls there and its content is larger than its box. */
export function scrollsOn(element: Element, axis: 'x' | 'y'): boolean {
    const style = getComputedStyle(element);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const larger = axis === 'x' ? element.scrollWidth > element.clientWidth + 1 : element.scrollHeight > element.clientHeight + 1;
    return (overflow === 'auto' || overflow === 'scroll') && larger;
}

/** Whether nothing above the element can clip it: it is fixed, or in the top layer (a modal dialog, an open popover). */
export function escapesClipping(element: Element): boolean {
    return getComputedStyle(element).position === 'fixed' || element.matches(':modal, :popover-open');
}

/**
 * The part of the element's box a visitor can see: the box cut by the viewport and by every flat-tree ancestor that
 * clips (a scrolled list hides what is scrolled away); null when nothing of it is left. A fixed element, or one in the
 * top layer, is cut by the viewport only (an ancestor's overflow does not contain it).
 */
export function visibleBoxOf(element: Element): Rect | null {
    let visible: Rect | null = intersect(boxOf(element), { x: 0, y: 0, width: innerWidth, height: innerHeight });
    for (let node: Element | null = element; node !== null && visible !== null && !escapesClipping(node);) {
        node = flatParent(node);
        if (node !== null && !(node instanceof HTMLSlotElement) && clips(node)) {
            visible = intersect(visible, plainRect(node.getBoundingClientRect()));
        }
    }
    return visible !== null && visible.width >= 1 && visible.height >= 1 ? visible : null;
}

/** Whether the element is drawn: rendered, not hidden, not fully transparent, with a box. */
export function isDrawn(element: Element): boolean {
    if (!element.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true })) {
        return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

/** Text or a control for screen readers only (the kit's `.visually-hidden`: a 1 px box clipped away), never seen. */
export function isScreenReaderOnly(element: Element): boolean {
    return flatChain(element).some((node) => {
        const style = getComputedStyle(node);
        const clipped = style.clipPath === 'inset(50%)' || style.getPropertyValue('clip') === 'rect(0px, 0px, 0px, 0px)';
        const rect = node.getBoundingClientRect();
        return clipped || (style.overflow === 'hidden' && rect.width <= 1 && rect.height <= 1);
    });
}

/** Whether the element or a flat-tree ancestor has the attribute `name` (with `value`, when given). */
export function flatHasAttribute(element: Element, name: string, value?: string): boolean {
    return flatChain(element).some((node) => node.hasAttribute(name) && (value === undefined || node.getAttribute(name) === value));
}

/** The visible text of a node in the flat tree (slotted content in its slot, shadow content of a host), aria-hidden left out. */
export function flatText(node: Node): string {
    if (node instanceof Text) {
        return node.data;
    }
    if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') {
        return '';
    }
    let children: Node[] = Array.from(node.childNodes);
    if (node instanceof HTMLSlotElement) {
        // Flattened, a slot without assigned nodes gives its fallback content.
        children = node.assignedNodes({ flatten: true });
    } else if (node.shadowRoot !== null) {
        children = Array.from(node.shadowRoot.childNodes);
    }
    return children.map((child) => flatText(child)).join(' ');
}

/** The element's accessible name, as near as the page can tell: aria-label, aria-labelledby, a label, alt, title, text. */
export function accessibleName(element: Element): string {
    const root = element.getRootNode() as Document | ShadowRoot;
    const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .map((id) => (id === '' ? null : root.getElementById(id)))
        .map((label) => (label === null ? '' : flatText(label)))
        .join(' ');
    const labels = element instanceof HTMLInputElement ? Array.from(element.labels ?? []).map((label) => flatText(label)) : [];
    const candidates = [element.getAttribute('aria-label') ?? '', labelledBy, ...labels, element.getAttribute('alt') ?? ''];
    const named = candidates.map((text) => text.replace(/\s+/g, ' ').trim()).find((text) => text !== '');
    const text = named ?? (element.getAttribute('title') ?? flatText(element)).replace(/\s+/g, ' ').trim();
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** One step of a selector path: the tag, an id, two classes and the layout-check name. */
export function selectorStep(element: Element): string {
    const id = element.id === '' ? '' : `#${element.id}`;
    const classes = Array.from(element.classList)
        .slice(0, 2)
        .map((name) => `.${name}`)
        .join('');
    const check = element.getAttribute('data-layout-check');
    const marked = check === null ? '' : '[data-layout-check=' + check + ']';
    return `${element.tagName.toLowerCase()}${id}${classes}${marked}`;
}

/** A readable path to the element: the shadow hosts it lives in, then the element (`hcm-map-viewer > hcm-fab-menu > button.fab`). */
export function selectorOf(element: Element): string {
    const steps = [selectorStep(element)];
    for (let root = element.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) {
        steps.unshift(selectorStep(root.host));
    }
    return steps.join(' > ');
}

/** The deepest element under a point, through every open shadow root. */
export function deepHit(x: number, y: number): Element | null {
    let hit = document.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
        const inner = hit.shadowRoot.elementFromPoint(x, y);
        if (inner === null || inner === hit) {
            break;
        }
        hit = inner;
    }
    return hit;
}

/** The points a pointer check samples in a box: its centre and four points 20 % in from the corners. */
export function samplePoints(box: Rect, centreOnly: boolean): { x: number; y: number }[] {
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (centreOnly || box.width < 4 || box.height < 4) {
        return [centre];
    }
    const xs = [box.x + box.width * 0.2, box.x + box.width * 0.8];
    const ys = [box.y + box.height * 0.2, box.y + box.height * 0.8];
    return [centre, ...xs.flatMap((x) => ys.map((y) => ({ x, y })))];
}

/** A corner's radius along one side, in px: `50%` of a 48 px box is 24; never more than half the side (as CSS scales them). */
export function cornerRadius(part: string, size: number): number {
    const value = part.endsWith('%') ? (Number.parseFloat(part) / 100) * size : Number.parseFloat(part);
    return Math.min(Number.isFinite(value) ? value : 0, size / 2);
}

/**
 * Whether (x, y) falls in the corner a rounded border cuts off: `radius` is the computed `border-*-radius`, the corner at
 * (`cornerX`, `cornerY`) and the box opening towards (`dx`, `dy`).
 */
export function cutCorner(radius: string, box: DOMRect, corner: readonly [number, number, number, number], x: number, y: number): boolean {
    const [cornerX, cornerY, dx, dy] = corner;
    const [first = '0', second = first] = radius.split(' ');
    const rx = cornerRadius(first, box.width);
    const ry = cornerRadius(second, box.height);
    const cx = cornerX + dx * rx;
    const cy = cornerY + dy * ry;
    const inCorner = rx > 0 && ry > 0 && dx * (x - cx) < 0 && dy * (y - cy) < 0;
    return inCorner && ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1;
}

/**
 * Whether (x, y) lies inside the element's own shape: its border box without the corners its rounded border cuts off
 * (a round button's box corners are not the button, and a hit there lands on what is behind it).
 */
export function withinShape(element: Element, x: number, y: number): boolean {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const corners = [
        [style.borderTopLeftRadius, [box.left, box.top, 1, 1]],
        [style.borderTopRightRadius, [box.right, box.top, -1, 1]],
        [style.borderBottomLeftRadius, [box.left, box.bottom, 1, -1]],
        [style.borderBottomRightRadius, [box.right, box.bottom, -1, -1]],
    ] as const;
    return corners.every(([radius, corner]) => !cutCorner(radius, box, corner, x, y));
}

/** Whether a hit at a point reaches `element`: the hit is the element or inside it (a pass-through element: or around it). */
export function reaches(element: Element, hit: Element | null): boolean {
    if (hit === null) {
        return false;
    }
    if (flatContains(element, hit)) {
        return true;
    }
    return getComputedStyle(element).pointerEvents === 'none' && flatContains(hit, element);
}

/**
 * Whether `hit` covering `element` is by design: the map's canvas under a standard (non-modal) `<hcm-sheet>`, the Layers
 * sheet beside a map that stays usable (the owner, 2026-11-15). A modal sheet's cover still counts.
 */
export function standardSheetOverMap(element: Element, hit: Element | null): boolean {
    if (hit === null || !element.classList.contains('mapboxgl-canvas')) {
        return false;
    }
    for (let node: Element | null = hit; node !== null; node = composedParent(node)) {
        if (node.tagName === 'HCM-SHEET') {
            return !node.hasAttribute('modal');
        }
    }
    return false;
}

/** Every helper of this module, for `libraryScript` (e2e/support/page-script.ts). */
export const DOM_WALK = [
    standardSheetOverMap,
    flatParent,
    flatChain,
    flatContains,
    deepElements,
    deepQuery,
    composedParent,
    deepSelect,
    plainRect,
    boxOf,
    intersect,
    clips,
    scrollsOn,
    escapesClipping,
    visibleBoxOf,
    isDrawn,
    isScreenReaderOnly,
    flatHasAttribute,
    flatText,
    accessibleName,
    selectorStep,
    selectorOf,
    deepHit,
    samplePoints,
    cornerRadius,
    cutCorner,
    withinShape,
    reaches,
] as const;
