/**
 * The Layers panel's pinned strip and its scrolling list (the owner, 2026-11-16): where the strip is sticky (the docked pane
 * of a large window), its height becomes `--hcm-pinned-height` on the panel, which the list's rows take as their scroll
 * margin and the pane as its scroll padding. A revealed row then lands just under the strip, never behind it, and a row
 * the focus scrolls to is never hidden by it. Where the strip scrolls with the list (a modal sheet), the offset is 0.
 */

export const PINNED_HEIGHT_PROPERTY = '--hcm-pinned-height';

/** The strip's height in px while it is sticky, else 0. */
export function pinnedOffset(root: ParentNode): number {
    const strip = root.querySelector<HTMLElement>('.body .pinned');
    if (strip === null || getComputedStyle(strip).position !== 'sticky') {
        return 0;
    }
    return strip.getBoundingClientRect().height;
}

/** Writes the strip's height on the panel's host, for its rows and its scroller. */
export function syncPinnedOffset(host: HTMLElement, root: ParentNode): void {
    host.style.setProperty(PINNED_HEIGHT_PROPERTY, `${String(pinnedOffset(root))}px`);
}

/** Scrolls every overlay list to these layers' rows (the first at the top, under the strip) and marks them. */
export function revealLayers(host: HTMLElement, root: ParentNode, ids: readonly string[]): void {
    syncPinnedOffset(host, root);
    for (const list of root.querySelectorAll('hcm-overlay-list')) {
        list.reveal(ids);
    }
}
