/**
 * The shell's page registry (`docs/research/M2b-interfaces.md` §1.1): a route shows the custom element its loader
 * resolves, imported lazily (each editor area is a chunk of its own, `./area-pages.ts`), so a later workstream adds a page
 * (`registerAdminPage`) without touching the shell. A route without a page stays out of the navigation and opens Setup.
 */
import type { AdminRouteId } from './routes.js';

/** Resolves the tag of the page's custom element once its module is loaded and the element defined. */
export type PageLoader = () => Promise<string>;

/** A page element's tag: the kit's `hcm-` prefix, lower case (it is created with `document.createElement`). */
const PAGE_TAG = /^hcm-[a-z0-9]+(?:-[a-z0-9]+)+$/;

export class PageRegistry {
    readonly #loaders = new Map<AdminRouteId, PageLoader>();

    /** Adds (or replaces) the page of `id`. */
    register(id: AdminRouteId, load: PageLoader): void {
        this.#loaders.set(id, load);
    }

    has(id: AdminRouteId): boolean {
        return this.#loaders.has(id);
    }

    /**
     * The page's tag; null when no page is registered or it names no `hcm-` element. Rejects when the page's module does
     * not load (an area's chunk lost on the way, or replaced by a new deploy: `DECISIONS-for-review.md` §34b), so the
     * shell offers Retry instead of saying the page does not exist.
     */
    async load(id: AdminRouteId): Promise<string | null> {
        const load = this.#loaders.get(id);
        const tag = load === undefined ? null : await load();
        return tag !== null && PAGE_TAG.test(tag) ? tag : null;
    }
}
