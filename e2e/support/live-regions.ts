/**
 * The live-region recorder of the tour (an init script, so it sees every shadow root from the first): every change of a
 * live region's text (`aria-live`, `role="status"`, `"alert"` or `"log"`), with its politeness and whether the region
 * was inserted in the same change (a polite region created together with its text is not announced, WCAG 4.1.3;
 * `docs/LESSONS.md` #20). e2e/support/a11y.ts reads it with `liveAnnouncements`.
 */

/** One recorded change: the region's politeness and role, its whole text after the change, and whether it was new. */
export interface LiveEntry {
    readonly politeness: string;
    readonly role: string;
    readonly text: string;
    readonly fresh: boolean;
}

/** Runs in the page, serialized by Playwright: it must not reference anything outside its own body. */
export function recordLiveRegions(): void {
    const scope = window as unknown as { hcmLiveLog?: LiveEntry[] };
    if (scope.hcmLiveLog !== undefined) {
        return;
    }
    const log: LiveEntry[] = [];
    scope.hcmLiveLog = log;
    const isRegion = (node: Node): node is Element =>
        node instanceof Element && (node.hasAttribute('aria-live') || ['status', 'alert', 'log'].includes(node.getAttribute('role') ?? ''));
    const parentOf = (node: Node): Node | null => (node instanceof ShadowRoot ? node.host : node.parentNode);
    const regionAround = (node: Node | null): Element | null => {
        for (let current = node; current !== null; current = parentOf(current)) {
            if (isRegion(current)) {
                return current;
            }
        }
        return null;
    };
    const regionsIn = (node: Node): Element[] =>
        node instanceof Element
            ? [
                  ...(isRegion(node) ? [node] : []),
                  ...Array.from(node.querySelectorAll('[aria-live], [role="status"], [role="alert"], [role="log"]')),
              ]
            : [];
    const record = (mutations: MutationRecord[]): void => {
        const added = mutations.flatMap((mutation) => Array.from(mutation.addedNodes));
        const fresh = new Set(added.flatMap(regionsIn));
        const changed = new Set([
            ...fresh,
            ...mutations.map((mutation) => regionAround(mutation.target)).filter((region) => region !== null),
        ]);
        for (const region of changed) {
            const role = region.getAttribute('role') ?? '';
            const politeness = region.getAttribute('aria-live') ?? (role === 'alert' ? 'assertive' : 'polite');
            log.push({ politeness, role, text: region.textContent.replace(/\s+/g, ' ').trim(), fresh: fresh.has(region) });
        }
    };
    const observer = new MutationObserver(record);
    const observe = (root: Node): void => {
        observer.observe(root, { childList: true, subtree: true, characterData: true });
    };
    observe(document);
    const attach = Object.getOwnPropertyDescriptor(Element.prototype, 'attachShadow')?.value as (
        this: Element,
        init: ShadowRootInit,
    ) => ShadowRoot;
    Element.prototype.attachShadow = function attachObserved(this: Element, init: ShadowRootInit): ShadowRoot {
        const root = attach.call(this, init);
        observe(root);
        return root;
    };
}

/** Runs in the page: the changes recorded since the last read, which it clears. */
export function takeLiveLog(): LiveEntry[] {
    const scope = window as unknown as { hcmLiveLog?: LiveEntry[] };
    const log = scope.hcmLiveLog ?? [];
    scope.hcmLiveLog = log;
    return log.splice(0, log.length);
}
