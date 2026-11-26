import { APP_ICON_FILES, WEB_APP_MANIFEST_FILE } from '@hcm/shared/app';

import { element, renderDocument, type HtmlElement } from '../html.js';
import { iconLinks } from '../icons.js';

/**
 * The admin's `index.html` (docs/research/M2b-interfaces.md §4, admin-e2e), generated like the city pages instead of
 * committed (`DECISIONS-for-review.md` §1, §12d). Firebase Hosting serves it from `packages/admin/dist` for every path
 * (the `**` rewrite) with the Content Security Policy as a header (`./csp.ts`), so the page holds no meta policy and
 * no inline code: the admin's stylesheet, then its ES module entry (`dist/admin.mjs`, a module script, deferred by
 * nature), which starts the admin in the page's `<hcm-admin-shell>`, loads the kit's fonts from `fonts/` next to the page
 * (`build.ts` copies them) and fetches each editor area's chunk when its route first opens (`DECISIONS-for-review.md`
 * §34b; the bundle budget measures the entry and every chunk). Mapbox GL JS is added by the first map (`loadMapboxGl` of `@hcm/ui/map`), with the
 * Subresource Integrity digest the page names in `<html data-mapbox-integrity>` (`DECISIONS-for-review.md` §34h).
 * Without JavaScript a bilingual note explains that the admin needs it.
 */

/** The shell element the admin's entry starts in (`packages/admin/src/index.ts`, admin-shell). */
export const ADMIN_SHELL_ELEMENT = 'hcm-admin-shell';

/** The two files of the Vite build the page loads (packages/admin/vite.config.ts writes them into `dist/`). */
export const ADMIN_SCRIPT_FILE = 'admin.mjs';
/** The installable app's page script (`app.ts`), before the admin's entry. */
export const ADMIN_APP_SCRIPT_FILE = 'app.js';
export const ADMIN_STYLESHEET_FILE = 'admin.css';

export interface AdminPageSpec {
    /** `<html lang>` until the admin resolves the language (`?lang=`, the stored choice, the browser). */
    readonly lang: 'ro' | 'en';
    readonly title: string;
    readonly description: string;
    /** The browser UI colour (`<meta name="theme-color">`). */
    readonly themeColor: string;
    /** Shown when JavaScript is off: one paragraph per language. */
    readonly noscript: { readonly ro: string; readonly en: string };
}

/** What the build computes for the page: the digest of the pinned `mapbox-gl.js` (`scripts/site/src/sri.ts`). */
export interface AdminPageBuild {
    readonly mapboxGlIntegrity?: string;
}

/** The `<html>` attribute that names it (`MAPBOX_INTEGRITY_ATTRIBUTE` of `@hcm/ui/map`, which the loader reads). */
export const MAPBOX_INTEGRITY_ATTRIBUTE = 'data-mapbox-integrity';

/** The admin page every city project deploys (Romanian is the default language). */
export const ADMIN_PAGE: AdminPageSpec = {
    lang: 'ro',
    title: 'Administrarea hărții',
    description: 'Administrarea hărții istorice: configurare, fotografii, straturi istorice.',
    themeColor: '#8B5E3C',
    noscript: {
        ro: 'Administrarea hărții are nevoie de JavaScript. Activează JavaScript în browser.',
        en: 'The map admin needs JavaScript. Turn JavaScript on in your browser.',
    },
};

function head(spec: AdminPageSpec): HtmlElement {
    return element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' }),
        // The admin is a tool, not content: search engines leave it out.
        element('meta', { name: 'robots', content: 'noindex, nofollow' }),
        element('meta', { name: 'description', content: spec.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('meta', { name: 'theme-color', content: spec.themeColor }),
        element('title', {}, [spec.title]),
        // The admin's own tab keeps the default: it serves many cities (docs/research/DECISIONS-for-review.md).
        ...iconLinks(),
        // The installable app (docs/ENGINE_API.md → Installable app; `app.ts`): its manifest, and the script that registers
        // its worker and keeps the install prompt, before the admin's entry.
        element('link', { rel: 'manifest', href: WEB_APP_MANIFEST_FILE }),
        element('link', { rel: 'apple-touch-icon', href: APP_ICON_FILES.small }),
        element('link', { rel: 'stylesheet', href: ADMIN_STYLESHEET_FILE }),
        element('script', { src: ADMIN_APP_SCRIPT_FILE, defer: true }),
        element('script', { type: 'module', src: ADMIN_SCRIPT_FILE }),
    ]);
}

function body(spec: AdminPageSpec): HtmlElement {
    return element('body', {}, [
        element(ADMIN_SHELL_ELEMENT),
        element('noscript', {}, [
            element('p', { lang: 'ro', class: 'admin-noscript' }, [spec.noscript.ro]),
            element('p', { lang: 'en', class: 'admin-noscript' }, [spec.noscript.en]),
        ]),
    ]);
}

/** The admin page's HTML. */
export function renderAdminPage(spec: AdminPageSpec = ADMIN_PAGE, build: AdminPageBuild = {}): string {
    const integrity = build.mapboxGlIntegrity === undefined ? {} : { [MAPBOX_INTEGRITY_ATTRIBUTE]: build.mapboxGlIntegrity };
    return renderDocument(element('html', { lang: spec.lang, ...integrity }, [head(spec), body(spec)]));
}
