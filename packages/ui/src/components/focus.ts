/**
 * Focus helpers that see through shadow roots and slots: the kit's dialogs and modal sheets trap Tab inside
 * themselves and give focus back to their opener, even when the focusable parts sit in other elements' shadow trees.
 */

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]';

/** True when `element` itself takes focus from the Tab key (not disabled, not negative tabindex, rendered). */
function isTabbable(element: Element): element is HTMLElement {
    return (
        element instanceof HTMLElement &&
        element.matches(FOCUSABLE) &&
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.checkVisibility()
    );
}

function childrenOf(node: Element | ShadowRoot): Element[] {
    if (node instanceof HTMLSlotElement) {
        return node.assignedElements({ flatten: true });
    }
    return [...node.children];
}

/**
 * Every tabbable element inside `root`, in tree order, descending into open shadow roots and slotted content (the
 * composed tree). A shadow host with a negative tabindex is skipped with its whole tree, as the browser does.
 */
export function tabbableElements(root: Element | ShadowRoot): HTMLElement[] {
    return childrenOf(root).flatMap((element) => {
        if (element instanceof HTMLElement && element.shadowRoot !== null) {
            return shadowTabbables(element, element.shadowRoot);
        }
        return [...(isTabbable(element) ? [element] : []), ...tabbableElements(element)];
    });
}

/** A shadow host's tabbable content; none when the host itself has a negative tabindex (roving tabindex). */
function shadowTabbables(host: HTMLElement, shadowRoot: ShadowRoot): HTMLElement[] {
    return host.tabIndex < 0 && host.hasAttribute('tabindex') ? [] : tabbableElements(shadowRoot);
}

/** The focused element, followed into shadow roots (`document.activeElement` stops at the outermost host). */
export function deepActiveElement(doc: Document = document): Element | null {
    let active = doc.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    return active;
}

/**
 * Keeps Tab and Shift+Tab inside `root`: from the last tabbable element Tab wraps to the first, and back. Shift+Tab on
 * `root` itself (a modal sheet or the lightbox takes the focus on its container when it opens) also goes to the last,
 * instead of leaving the modal. Call it from a `keydown` listener; returns true when it moved the focus (the event is
 * then cancelled).
 */
export function trapTab(event: KeyboardEvent, root: Element | ShadowRoot): boolean {
    if (event.key !== 'Tab') {
        return false;
    }
    const target = wrapTarget(event.shiftKey, root);
    if (target === null) {
        return false;
    }
    event.preventDefault();
    target.focus();
    return true;
}

/** Where Tab must wrap to from the current focus, or null when the browser's own move stays inside. */
function wrapTarget(backwards: boolean, root: Element | ShadowRoot): HTMLElement | null {
    const tabbable = tabbableElements(root);
    const first = tabbable[0];
    const last = tabbable.at(-1);
    if (first === undefined || last === undefined) {
        return null;
    }
    const doc = root instanceof ShadowRoot ? root.host.ownerDocument : root.ownerDocument;
    return edgeTarget(backwards, focusedInside(deepActiveElement(doc), root), first, last);
}

/** The focused element, or null when the trap's own container has the focus (a modal focuses it when it opens). */
function focusedInside(active: Element | null, root: Element | ShadowRoot): Element | null {
    return root instanceof Element && active === root ? null : active;
}

/** `active` is null when nothing in particular has the focus, or the trap's own container has it. */
function edgeTarget(backwards: boolean, active: Element | null, first: HTMLElement, last: HTMLElement): HTMLElement | null {
    if (backwards) {
        return active === first || active === null ? last : null;
    }
    return active === last ? first : null;
}

/** Moves the focus back to `element` if it is still in the document (the opener of a closed dialog or sheet). */
export function restoreFocus(element: Element | null): void {
    if (element instanceof HTMLElement && element.isConnected) {
        element.focus();
    }
}

/** Inert reaches into a shadow tree from any host above it, which `closest` alone does not cross. */
export function isInert(element: Element): boolean {
    if (element.closest('[inert]') !== null) {
        return true;
    }
    const root = element.getRootNode();
    return root instanceof ShadowRoot && isInert(root.host);
}
