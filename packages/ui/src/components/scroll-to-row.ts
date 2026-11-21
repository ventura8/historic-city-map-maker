/**
 * Scrolls one row to the top of its own scroller, never the page (live bug 2026-11-16: `scrollIntoView` with `block: 'start'`
 * scrolled the viewer's host in desktop Chrome and left the app in the top 60 % of the window). The scroller is the nearest
 * ancestor, across shadow roots, whose content overflows a vertical `auto` or `scroll`; the row's own
 * `scroll-margin-block-start` (the Layers panel's pinned strip) is kept clear above it.
 */

function parentAcrossShadow(node: Element): Element | null {
    const root = node.getRootNode();
    return node.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

/** The nearest ancestor that scrolls vertically, or null (then nothing scrolls). */
export function scrollerOf(row: Element): Element | null {
    for (let node = parentAcrossShadow(row); node !== null; node = parentAcrossShadow(node)) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return null;
}

/** Puts the row at the top of its scroller, below its scroll margin; false: no scroller. */
export function scrollRowToTop(row: Element, behavior: ScrollBehavior): boolean {
    const scroller = scrollerOf(row);
    if (scroller === null) {
        return false;
    }
    const margin = Number.parseFloat(getComputedStyle(row).scrollMarginBlockStart);
    const top = scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin;
    scroller.scrollTo({ top: Math.max(0, top), behavior });
    return true;
}
