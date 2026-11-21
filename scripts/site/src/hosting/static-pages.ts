import { element, renderDocument, type HtmlElement, type HtmlNode } from '../html.js';
import { iconLinks } from '../icons.js';
import { ADMIN_PATH, ADMIN_REDIRECT_FILE } from './admin-redirect.js';

/**
 * The Hosting site's own small pages (docs/research/M6-interfaces.md §2.1, §2.5, §2.7): the bilingual `404.html`, the
 * start-up root ("this map is being set up", before **Publish the map**) and the GitHub Pages redirect page ("the map
 * moved"). Each is generated like the city pages (`../page.ts`): elements and text only, no inline code, its own meta
 * policy first (Hosting sends no Content-Security-Policy outside `/admin/`, and GitHub Pages none at all), one `main`
 * landmark headed by a level-one heading in Romanian, the English text in an element of its own (`lang="en"`), the
 * styles of `hosting.css` (system colours, so light and dark follow the browser, and links of at least 44 px).
 */

/** The stylesheet of these pages, at the Hosting site's root (`HOSTING_STYLESHEET_SOURCE`). */
export const HOSTING_STYLESHEET_FILE = 'hosting.css';

/** One language's part of a page: a heading, its paragraphs and its links (at least one: where to go from here). */
interface PageSection {
    readonly heading: string;
    readonly paragraphs: readonly string[];
    readonly links: readonly { readonly href: string; readonly text: string }[];
}

interface StaticPage {
    readonly title: string;
    readonly description: string;
    /** The page's meta policy. */
    readonly csp: string;
    /** Where the stylesheet is, from the page (`/hosting.css`, or relative on GitHub Pages). */
    readonly stylesheet: string;
    /** A script that runs first (the root's `admin-redirect.js`, the Pages page's `pages-redirect.js`). */
    readonly script?: string;
    /** Attributes of `<html>` the script reads (`data-target`). */
    readonly data?: Readonly<Record<string, string>>;
    readonly ro: PageSection;
    readonly en: PageSection;
}

/** The pages' theme colour (București dispărut's seed colour, as the admin page's). */
const THEME_COLOR = '#8B5E3C';

/** A policy for a page that loads its stylesheet and, at most, one script of its own origin. */
export function staticPagePolicy(withScript: boolean): string {
    return [
        "default-src 'none'",
        `script-src ${withScript ? "'self'" : "'none'"}`,
        "style-src 'self'",
        "img-src 'self' data:",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
    ].join('; ');
}

function head(page: StaticPage): HtmlElement {
    return element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { 'http-equiv': 'Content-Security-Policy', content: page.csp }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        // The map's own pages are its city pages and the admin: these small ones stay out of search results.
        element('meta', { name: 'robots', content: 'noindex' }),
        element('meta', { name: 'description', content: page.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('meta', { name: 'theme-color', content: THEME_COLOR }),
        element('title', {}, [page.title]),
        ...iconLinks(),
        ...(page.script === undefined ? [] : [element('script', { src: page.script })]),
        element('link', { rel: 'stylesheet', href: page.stylesheet }),
    ]);
}

function links(section: PageSection): HtmlNode[] {
    const items = section.links.map((link) => element('li', {}, [element('a', { class: 'hosting-link', href: link.href }, [link.text])]));
    return [element('ul', { class: 'hosting-links' }, items)];
}

function section(part: PageSection, level: 'h1' | 'h2'): HtmlNode[] {
    return [element(level, {}, [part.heading]), ...part.paragraphs.map((text) => element('p', {}, [text])), ...links(part)];
}

/** The page's HTML: Romanian first under the level-one heading, then the English section. */
function renderStaticPage(page: StaticPage): string {
    const body = element('body', {}, [
        element('main', { class: 'hosting-page' }, [
            ...section(page.ro, 'h1'),
            element('section', { lang: 'en', 'aria-labelledby': 'hosting-en' }, [
                element('h2', { id: 'hosting-en' }, [page.en.heading]),
                ...page.en.paragraphs.map((text) => element('p', {}, [text])),
                ...links(page.en),
            ]),
        ]),
    ]);
    const data = Object.fromEntries(Object.entries(page.data ?? {}).map(([key, value]) => [`data-${key}`, value]));
    return renderDocument(element('html', { lang: 'ro', ...data }, [head(page), body]));
}

/** The map's and the admin's addresses on the Hosting site, both languages. */
const MAP_LINKS = {
    ro: [
        { href: '/', text: 'Deschide harta' },
        { href: ADMIN_PATH, text: 'Administrarea hărții' },
    ],
    en: [
        { href: '/', text: 'Open the map' },
        { href: ADMIN_PATH, text: "The map's admin" },
    ],
} as const;

/** `404.html`: what Hosting answers for an address that is no page, a city or the admin (status 404). */
export function renderNotFoundPage(): string {
    return renderStaticPage({
        title: 'Pagina nu există · Page not found',
        description: 'Adresa nu este o pagină a hărții. The address is not a page of the map.',
        csp: staticPagePolicy(false),
        stylesheet: `/${HOSTING_STYLESHEET_FILE}`,
        ro: {
            heading: 'Pagina nu există',
            paragraphs: ['Adresa nu este o pagină a hărții. Verifică adresa sau deschide harta.'],
            links: MAP_LINKS.ro,
        },
        en: {
            heading: 'Page not found',
            paragraphs: ['The address is not a page of the map. Check the address or open the map.'],
            links: MAP_LINKS.en,
        },
    });
}

/**
 * The start-up root (the first deploy of a new map, before **Publish the map**): no engine, no Mapbox, a link to the
 * admin; `admin-redirect.js` first, so an old admin address still reaches the admin.
 */
export function renderStartUpPage(): string {
    return renderStaticPage({
        title: 'Harta este în pregătire · This map is being set up',
        description: 'Harta istorică este în pregătire. The historical map is being set up.',
        csp: staticPagePolicy(true),
        stylesheet: HOSTING_STYLESHEET_FILE,
        script: ADMIN_REDIRECT_FILE,
        ro: {
            heading: 'Harta este în pregătire',
            paragraphs: ['Administratorul hărții o pregătește acum. Revino curând.'],
            links: [{ href: ADMIN_PATH, text: 'Administrarea hărții' }],
        },
        en: {
            heading: 'This map is being set up',
            paragraphs: ["The map's admin is setting it up now. Come back soon."],
            links: [{ href: ADMIN_PATH, text: "The map's admin" }],
        },
    });
}

/** The page's script on GitHub Pages and the attribute it reads (`pages-redirect.ts`). */
export interface RedirectPage {
    /** Where the map is now: `https://<project>.web.app/` and the page's own path below the Pages root. */
    readonly target: string;
    /**
     * The tree's root on GitHub Pages, absolute (`/bucurestiuldisparut.github.io/`): Pages answers every missing address
     * with the root's `404.html`, so its files cannot be relative to the page.
     */
    readonly base: string;
    readonly script: string;
}

/** A page of the GitHub Pages redirect tree: it sends the visitor to `target` with the same query and hash. */
export function renderRedirectPage(redirect: RedirectPage): string {
    const link = { href: redirect.target, text: redirect.target };
    return renderStaticPage({
        title: 'Harta s-a mutat · The map has moved',
        description: 'Harta s-a mutat la o adresă nouă. The map has moved to a new address.',
        csp: staticPagePolicy(true),
        stylesheet: `${redirect.base}${HOSTING_STYLESHEET_FILE}`,
        script: `${redirect.base}${redirect.script}`,
        data: { target: redirect.target },
        ro: { heading: 'Harta s-a mutat', paragraphs: ['Harta este acum la adresa de mai jos.'], links: [link] },
        en: { heading: 'The map has moved', paragraphs: ['The map is now at the address below.'], links: [link] },
    });
}

/** `hosting.css`: system colours (light and dark follow the browser), a readable measure, links of at least 44 px. */
export const HOSTING_STYLESHEET_SOURCE = [
    "/* Historic City Map Maker: the Hosting site's own pages (scripts/site/src/hosting/static-pages.ts). */",
    ':root {',
    '    color-scheme: light dark;',
    '}',
    '',
    'html,',
    'body {',
    '    margin: 0;',
    '    min-block-size: 100%;',
    '    background: Canvas;',
    '    color: CanvasText;',
    '    font:',
    '        1.125rem/1.5 system-ui,',
    '        sans-serif;',
    '}',
    '',
    '.hosting-page {',
    '    box-sizing: border-box;',
    '    max-inline-size: 40rem;',
    '    margin: 0 auto;',
    // The page ends at its last link: no trailing blank to scroll into (the tour's no-blank-scroll check).
    '    padding: 2rem 1rem 0.5rem;',
    '    overflow-wrap: anywhere;',
    '}',
    '',
    '.hosting-page h1,',
    '.hosting-page h2 {',
    '    margin-block: 0 0.75rem;',
    '    line-height: 1.25;',
    '}',
    '',
    '.hosting-page h1 {',
    '    font-size: 1.75rem;',
    '}',
    '',
    '.hosting-page h2 {',
    '    margin-block-start: 2rem;',
    '    font-size: 1.375rem;',
    '}',
    '',
    '.hosting-links {',
    '    margin: 0;',
    '    padding: 0;',
    '    list-style: none;',
    '}',
    '',
    '.hosting-link {',
    '    display: inline-block;',
    '    box-sizing: border-box;',
    '    min-block-size: 2.75rem;',
    '    padding-block: 0.625rem;',
    '    color: LinkText;',
    '    text-underline-offset: 0.2em;',
    '}',
    '',
    '.hosting-link:focus-visible {',
    '    outline: 0.1875rem solid currentcolor;',
    '    outline-offset: 0.125rem;',
    '}',
    '',
].join('\n');

/** M14: the script of {@link renderFirstCityPage}, at the Hosting site's root. */
export const FIRST_CITY_FILE = 'first-city.js';

/**
 * The root of a map made from the start page, once it is published (`docs/research/M14-start-your-map.md` §6): no committed
 * city sits at the root, so it sends the visitor to the project's first city, which the project's own file names; the
 * links stay for a browser without JavaScript. Elements and text only.
 */
export function renderFirstCityPage(): string {
    return renderStaticPage({
        title: 'Hartă istorică',
        description: 'Fotografii vechi și straturi istorice ale orașului, așezate pe harta de azi.',
        csp: staticPagePolicy(true).replace("default-src 'none'", "default-src 'none'; connect-src 'self'"),
        stylesheet: `/${HOSTING_STYLESHEET_FILE}`,
        script: `/${FIRST_CITY_FILE}`,
        ro: { heading: 'Hartă istorică', paragraphs: ['Harta se deschide.'], links: [{ href: ADMIN_PATH, text: 'Administrarea hărții' }] },
        en: { heading: 'Historical map', paragraphs: ['The map is opening.'], links: [{ href: ADMIN_PATH, text: "The map's admin" }] },
    });
}
