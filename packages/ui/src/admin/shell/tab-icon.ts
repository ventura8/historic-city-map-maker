/**
 * The admin's tab icon wears the admin's theme (the owner, 2026-11-12: "make sure the icon in the tab uses the theme set
 * by the user"; `docs/ENGINE_API.md` → *The page's tab icon*): the page links the default in the light and the dark
 * palette's colours, each under its `prefers-color-scheme`; once the shell has themed the page's root, the glyph is
 * drawn again in that theme's `primary` and `on-primary` (the chosen mode, the city's colours, a seed colour being
 * previewed), and again when the system's scheme or contrast changes (the `system` mode). `paintTabIcon` of
 * `@hcm/shared` draws it on a canvas: a `data:` address, no request.
 */
import { MAP_GLYPH_PATH, MAP_ICON_GEOMETRY, paintTabIcon, type TabIconScope } from '@hcm/shared/tab-icon';

const GLYPH = { path: MAP_GLYPH_PATH, ...MAP_ICON_GEOMETRY };
const QUERIES = ['(prefers-color-scheme: dark)', '(prefers-contrast: more)'];
const WATCHED = new WeakSet<Document>();

function scopeOf(document: Document): TabIconScope<Element> {
    return {
        document: {
            querySelectorAll: (selector) => Array.from(document.querySelectorAll<HTMLLinkElement>(selector)),
            createElement: () => document.createElement('canvas'),
        },
        getComputedStyle: (host) => getComputedStyle(host),
        Path2D,
    };
}

/** Paints `document`'s default tab icon in the theme its root wears, now and whenever the system's scheme changes. */
export function paintAdminTabIcon(document: Document): void {
    const paint = (): void => {
        paintTabIcon(scopeOf(document), document.documentElement, GLYPH);
    };
    paint();
    if (!WATCHED.has(document)) {
        WATCHED.add(document);
        for (const query of QUERIES) {
            matchMedia(query).addEventListener('change', paint);
        }
    }
}
