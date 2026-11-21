/**
 * The default tab icon in the colours of the theme the user chose (the owner, 2026-11-12: "make sure the icon in the tab
 * uses the theme set by the user"; `docs/ENGINE_API.md` → *The page's tab icon*).
 *
 * A page links the default twice, each under its `prefers-color-scheme` (`DEFAULT_TAB_ICONS`), so the tab follows the
 * system before any script runs. `paintTabIcon` then reads the theme a host element wears (`--md-sys-color-primary` and
 * `--md-sys-color-on-primary`, which `applyTheme` sets for the chosen mode and the city's own colours), draws the glyph on
 * a canvas and puts the PNG, a `data:` address, into the page's icon link: no request, no HTML. A city's own uploaded
 * icon (a link that is no `data:` address) is never repainted.
 *
 * Both functions are self-contained: the site build writes them into a page's `config.js` with `toString()`
 * (`scripts/site/src/hosting/city-page.ts`), where no module can be imported and the engine gains no byte; the admin
 * calls `paintTabIcon` from its bundle.
 */

// The glyph and the default's files, with the painter: the whole tab icon is this entry (`@hcm/shared/tab-icon`), outside
// the root index, where each module costs the engine's IIFE an empty initialiser (DECISIONS-for-review.md §166h).
export * from './map-icon.js';

/** The 2D context `paintTabIcon` draws with. */
export interface TabIconContext {
    fillStyle: unknown;
    scale(x: number, y: number): void;
    translate(x: number, y: number): void;
    beginPath(): void;
    roundRect(x: number, y: number, width: number, height: number, radius: number): void;
    fill(path?: unknown): void;
}

/** A `<link rel="icon">` of the page. */
export interface TabIconLink {
    href: string;
    removeAttribute(name: string): void;
    remove(): void;
}

/** What `paintTabIcon` uses of the page's `window`; `Host` is the themed element's type. */
export interface TabIconScope<Host> {
    readonly document: {
        /** `link[rel="icon"]` gives the icon links, `meta[name="theme-color"]` the browser UI colour's metas. */
        querySelectorAll(selector: string): ArrayLike<TabIconLink & { setAttribute(name: string, value: string): void }>;
        createElement(tag: 'canvas'): {
            width: number;
            height: number;
            getContext(kind: '2d'): TabIconContext | null;
            toDataURL(type: string): string;
        };
    };
    getComputedStyle(host: Host): { getPropertyValue(name: string): string };
    readonly Path2D: new (path: string) => unknown;
}

/** The glyph's outline and the icon's geometry (`MAP_GLYPH_PATH`, `MAP_ICON_GEOMETRY`). */
export interface TabIconGlyph {
    readonly path: string;
    readonly em: number;
    readonly radius: number;
    readonly scale: number;
}

/**
 * Sets the page's `<meta name="theme-color">` (an installed app's title bar, a mobile browser's toolbar) to the
 * `--md-sys-color-surface` `host` wears: the chosen mode, the city's colours, the device accent; the meta's `media` goes,
 * so it no longer follows the system's scheme by itself. Then draws the default icon in the colours of `host`'s theme into
 * the page's icon link, which then no longer follows the
 * system's scheme by itself. The title bar is set even for a city's own icon. Nothing happens to the icon, and false is returned, when the page has no icon link, when a link is a
 * city's own icon (no `data:` address), when `host` wears no theme yet or when the browser gives no canvas.
 */
export function paintTabIcon<Host>(scope: TabIconScope<Host>, host: Host, glyph: TabIconGlyph): boolean {
    const style = scope.getComputedStyle(host);
    const surface = style.getPropertyValue('--md-sys-color-surface').trim();
    Array.from(scope.document.querySelectorAll('meta[name="theme-color"]')).forEach((meta) => {
        if (surface !== '') {
            meta.removeAttribute('media');
            meta.setAttribute('content', surface);
        }
    });
    const colours = ['primary', 'on-primary'].map((role) => style.getPropertyValue(`--md-sys-color-${role}`).trim());
    const links = Array.from(scope.document.querySelectorAll('link[rel="icon"]'));
    const drawn = (): string | null => {
        const canvas = scope.document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        if (context === null) {
            return null;
        }
        const half = glyph.em / 2;
        context.scale(32 / glyph.em, 32 / glyph.em);
        context.fillStyle = colours[0];
        context.beginPath();
        context.roundRect(0, 0, glyph.em, glyph.em, glyph.radius);
        context.fill();
        context.translate(half, half);
        context.scale(glyph.scale, -glyph.scale);
        context.translate(-half, -half);
        context.fillStyle = colours[1];
        context.fill(new scope.Path2D(glyph.path));
        return canvas.toDataURL('image/png');
    };
    // Every link is still the inlined default (none is a city's own icon), and the host wears a theme.
    const themed = links.length > 0 && colours.every((colour) => colour !== '') && links.every((link) => link.href.startsWith('data:'));
    const address = themed ? drawn() : null;
    if (address === null) {
        return false;
    }
    links.forEach((link, index) => {
        if (index > 0) {
            link.remove();
            return;
        }
        link.removeAttribute('media');
        link.href = address;
    });
    return true;
}

/** What `followViewerTheme` uses of the page's `window`. */
export interface ViewerThemeScope<Host> {
    readonly document: {
        querySelector(selector: string): Host | null;
        addEventListener(name: string, listener: () => void): void;
    };
    matchMedia(query: string): { addEventListener(name: 'change', listener: () => void): void };
}

/**
 * Keeps a viewer page's default tab icon in the theme `<hcm-map-viewer>` wears: painted when the page has loaded (the
 * stored choice, else the system's scheme), when the map is ready or failed (the city's own colours arrive with its
 * manifest), after each click or key inside the page (the visitor picked a theme in the settings menu) and when the
 * system's scheme or contrast changes (the `system` choice). `paint` is `paintTabIcon`, passed in because this function
 * is written into a page as text.
 */
export function followViewerTheme<Host, Scope extends ViewerThemeScope<Host>>(
    scope: Scope,
    paint: (scope: Scope, host: Host, glyph: TabIconGlyph) => boolean,
    glyph: TabIconGlyph,
): void {
    const repaint = (): void => {
        const viewer = scope.document.querySelector('hcm-map-viewer');
        if (viewer !== null) {
            paint(scope, viewer, glyph);
        }
    };
    for (const name of ['DOMContentLoaded', 'hcm-ready', 'hcm-error', 'click', 'keyup']) {
        scope.document.addEventListener(name, repaint);
    }
    for (const query of ['(prefers-color-scheme: dark)', '(prefers-contrast: more)']) {
        scope.matchMedia(query).addEventListener('change', repaint);
    }
}
