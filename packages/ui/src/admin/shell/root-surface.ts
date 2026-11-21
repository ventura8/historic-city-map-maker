/**
 * The page's root wears the admin's surface (M6 setup-ux, `docs/research/M6-interfaces.md` §3.1; finding 22 of the live
 * test of 2026-10-25): the shell paints the window, but the document's own canvas showed below it wherever the page
 * went past the shell (a scroll past the end, an overscroll, a window taller than what it held), a band of another
 * colour in the dark scheme above all. The root takes the shell's theme (its tokens and colour scheme, through the
 * same constructed sheet `applyTheme` writes) and one more constructed rule paints it with the surface. No inline style:
 * the admin's CSP stays strict.
 */
import type { ThemeTokens } from '@hcm/shared';

import { applyTheme, clearTheme, type ThemeMode } from '../../theme/apply.js';

import { paintAdminTabIcon } from './tab-icon.js';

const SURFACES = new WeakMap<Document, CSSStyleSheet>();

/** Gives `document`'s root the theme and paints it with the theme's surface (again: the theme is replaced in place). */
export function paintRoot(document: Document, tokens: ThemeTokens, mode: ThemeMode): void {
    applyTheme(document.documentElement, tokens, mode, false);
    if (!SURFACES.has(document)) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(':root { background-color: var(--md-sys-color-surface, Canvas); }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        SURFACES.set(document, sheet);
    }
    // The tab's icon wears the same theme (`tab-icon.ts`).
    paintAdminTabIcon(document);
}

/** Takes the root's theme and paint away (the shell left the page). */
export function unpaintRoot(document: Document): void {
    clearTheme(document.documentElement);
    const sheet = SURFACES.get(document);
    if (sheet !== undefined) {
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter((candidate) => candidate !== sheet);
        SURFACES.delete(document);
    }
}
