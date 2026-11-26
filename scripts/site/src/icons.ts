import { DEFAULT_TAB_ICONS } from '@hcm/shared/tab-icon';

import { element, type HtmlElement } from './html.js';

/**
 * The tab icon of every page the build writes (the owner, 2026-11-08: the Layers panel's map glyph by default, and a
 * city's admins can change it; 2026-11-12: the default wears the theme the user chose; `docs/ENGINE_API.md` → *The
 * page's tab icon*): the default is inlined twice, in the light and in the dark palette's colours
 * (`DEFAULT_TAB_ICONS`), each link under its `prefers-color-scheme`, so the tab follows the system before any script
 * runs and nothing is fetched (every page's policy allows `data:` images). A viewer page's `config.js` then paints the
 * chosen theme and swaps in a city's own uploaded icon (`tabIconSource`, `hosting/city-page.ts`); the admin paints its
 * own theme (`packages/ui/src/admin/shell/root-surface.ts`).
 */
export function iconLinks(): HtmlElement[] {
    return (['light', 'dark'] as const).map((scheme) =>
        element('link', {
            rel: 'icon',
            type: 'image/png',
            sizes: '32x32',
            media: `(prefers-color-scheme: ${scheme})`,
            href: DEFAULT_TAB_ICONS[scheme],
        }),
    );
}
