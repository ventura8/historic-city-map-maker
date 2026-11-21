/**
 * The elements of one editor area (`docs/research/M2c-interfaces.md` §11.2) as the admin's lazy page loaders take them
 * (`DECISIONS-for-review.md` §34b): `@hcm/ui/admin/areas/<area>` is the area's own entry, so the admin's bundler puts each
 * page and what only it renders into a chunk of its own, loaded when its route first opens. The shell, the Setup pages and
 * the editing kit stay in the admin's entry (`defineAdminElements`).
 */
export interface AreaElements {
    /** The page's custom element (`hcm-` prefix). */
    readonly tag: string;
    /** Registers the page and what it renders; idempotent per registry. */
    define(registry: CustomElementRegistry): void;
}
