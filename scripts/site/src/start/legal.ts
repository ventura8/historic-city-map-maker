import type { BuildEnvironment } from '../admin/runtime.js';
import { SiteBuildError } from '../errors.js';
import type { SiteFileSystem } from '../files.js';
import { staticPagePolicy } from '../hosting/static-pages.js';
import { element, renderDocument, type HtmlElement, type HtmlNode } from '../html.js';
import { iconLinks } from '../icons.js';
import {
    PRIVACY_FILE,
    PRIVACY_PAGE,
    SOURCE_URL,
    TERMS_FILE,
    TERMS_PAGE,
    type LegalLanguage,
    type LegalPage,
    type LegalSection,
    type LegalText,
} from './legal-text.js';

/**
 * What Google's OAuth verification asks of the start site (`docs/research/M14-start-your-map.md` §10): a privacy policy and
 * terms at the site's root, both languages on one page, plain HTML with no script; a footer on the home page that names the
 * app and links them; and, when `HCM_START_SITE_VERIFICATION` names one, Search Console's HTML verification file.
 */

/** The start site's own stylesheet: the legal pages, and the home page's footer below the start page's element. */
export const START_SITE_STYLESHEET_FILE = 'start-site.css';

/** Search Console's file name: `google` and the hexadecimal token Search Console gives, `.html`. */
const SITE_VERIFICATION_PATTERN = /^google[0-9a-f]{8,32}\.html$/;
export const SITE_VERIFICATION_ENV = 'HCM_START_SITE_VERIFICATION';

/** The verification file's name from the environment; none when unset or empty, a build error when it is no such name. */
export function siteVerificationOf(env: BuildEnvironment): string | undefined {
    const name = env[SITE_VERIFICATION_ENV];
    if (name === undefined || name === '') {
        return undefined;
    }
    if (!SITE_VERIFICATION_PATTERN.test(name)) {
        throw new SiteBuildError(`${SITE_VERIFICATION_ENV} must be a name like google0123abcd.html (${SITE_VERIFICATION_PATTERN.source})`);
    }
    return name;
}

function inline(text: LegalText): HtmlNode[] {
    if (typeof text === 'string') {
        return [text];
    }
    return text.map((part) => (typeof part === 'string' ? part : element('a', { href: part.href }, [part.text])));
}

function section(part: LegalSection, level: 'h2' | 'h3'): HtmlElement {
    const items =
        part.items === undefined
            ? []
            : [
                  element(
                      'ul',
                      {},
                      part.items.map((item) => element('li', {}, inline(item))),
                  ),
              ];
    return element('section', {}, [
        element(level, {}, [part.heading]),
        ...part.paragraphs.map((paragraph) => element('p', {}, inline(paragraph))),
        ...items,
    ]);
}

function language(text: LegalLanguage, top: 'h1' | 'h2', id: string): HtmlNode[] {
    const level = top === 'h1' ? 'h2' : 'h3';
    return [
        element(top, { id }, [text.title]),
        element('p', { class: 'start-legal-updated' }, [text.updated]),
        element('p', {}, inline(text.intro)),
        ...text.sections.map((part) => section(part, level)),
    ];
}

/** The links between the site's pages, both languages in each. */
function siteLinks(): HtmlElement {
    const link = (href: string, ro: string, en: string): HtmlElement =>
        element('li', {}, [
            element('a', { class: 'start-site-link', href }, [
                element('span', { lang: 'ro' }, [ro]),
                element('span', { lang: 'en' }, [` · ${en}`]),
            ]),
        ]);
    return element('ul', { class: 'start-site-links' }, [
        link('./', 'Pornește-ți harta', 'Start your map'),
        link(PRIVACY_FILE, 'Confidențialitate', 'Privacy policy'),
        link(TERMS_FILE, 'Condiții de utilizare', 'Terms of service'),
        link(SOURCE_URL, 'Codul sursă', 'Source code'),
    ]);
}

/** The home page's footer: the app's name and purpose, and the links, in plain HTML before any script. */
export function startFooter(): HtmlElement {
    return element('footer', { class: 'start-footer' }, [
        element('p', {}, [
            'Historic City Map Maker: pornește-ți propria hartă istorică, într-un proiect Google al tău. ',
            element('span', { lang: 'en' }, ['Start your own historical map, in a Google project of your own.']),
        ]),
        element('nav', { 'aria-label': 'Pagini / Pages' }, [siteLinks()]),
    ]);
}

/** A legal page: Romanian first under the level-one heading, then English in its own section. */
export function renderLegalPage(page: LegalPage): string {
    const head = element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { 'http-equiv': 'Content-Security-Policy', content: staticPagePolicy(false) }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        element('meta', { name: 'description', content: page.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('title', {}, [`${page.ro.title} · ${page.en.title}`]),
        ...iconLinks(),
        element('link', { rel: 'stylesheet', href: START_SITE_STYLESHEET_FILE }),
    ]);
    const body = element('body', { class: 'start-legal-body' }, [
        element('main', { class: 'start-legal' }, [
            element('p', {}, [element('a', { href: '#en', lang: 'en' }, ['English below'])]),
            ...language(page.ro, 'h1', 'ro'),
            element('section', { lang: 'en', 'aria-labelledby': 'en' }, language(page.en, 'h2', 'en')),
        ]),
        element('footer', { class: 'start-footer' }, [element('nav', { 'aria-label': 'Pagini / Pages' }, [siteLinks()])]),
    ]);
    return renderDocument(element('html', { lang: 'ro' }, [head, body]));
}

/** `start-site.css`: system colours (light and dark follow the browser), a readable measure, links of at least 48 px (M3's touch target). */
const START_SITE_STYLESHEET_SOURCE = [
    "/* Historic City Map Maker: the start site's own pages and the home page's footer (scripts/site/src/start/legal.ts). */",
    ':root {',
    '    color-scheme: light dark;',
    '}',
    '',
    'body {',
    '    margin: 0;',
    '    background: Canvas;',
    '    color: CanvasText;',
    '    font:',
    '        1rem/1.5 system-ui,',
    '        sans-serif;',
    '}',
    '',
    '.start-legal,',
    '.start-footer {',
    '    box-sizing: border-box;',
    '    max-inline-size: 44rem;',
    '    margin-inline: auto;',
    '    padding: 1rem;',
    '    overflow-wrap: anywhere;',
    '}',
    '',
    '.start-legal h1 {',
    '    font-size: 2rem;',
    '    line-height: 1.2;',
    '}',
    '',
    '.start-legal h2 {',
    '    margin-block-start: 2rem;',
    '    font-size: 1.375rem;',
    '}',
    '',
    '.start-legal h3 {',
    '    font-size: 1.125rem;',
    '}',
    '',
    '.start-legal a,',
    '.start-footer a {',
    '    color: LinkText;',
    '    text-underline-offset: 0.2em;',
    '}',
    '',
    '.start-legal-updated {',
    '    font-style: italic;',
    '}',
    '',
    '.start-footer {',
    '    border-block-start: 1px solid GrayText;',
    '}',
    '',
    '.start-site-links {',
    '    display: flex;',
    '    flex-wrap: wrap;',
    '    gap: 0 1.5rem;',
    '    margin: 0;',
    '    padding: 0;',
    '    list-style: none;',
    '}',
    '',
    '.start-site-link {',
    '    display: inline-block;',
    '    box-sizing: border-box;',
    '    min-block-size: 3rem;',
    '    padding-block: 0.75rem;',
    '}',
    '',
    '.start-legal a:focus-visible,',
    '.start-footer a:focus-visible {',
    '    outline: 0.1875rem solid currentcolor;',
    '    outline-offset: 0.125rem;',
    '}',
    '',
].join('\n');

/** Writes the stylesheet, both legal pages and, when named, the verification file into the start site's `outDir`. */
export function writeLegalFiles(outDir: string, verification: string | undefined, files: SiteFileSystem): void {
    files.write(`${outDir}/${START_SITE_STYLESHEET_FILE}`, START_SITE_STYLESHEET_SOURCE);
    files.write(`${outDir}/${PRIVACY_FILE}`, renderLegalPage(PRIVACY_PAGE));
    files.write(`${outDir}/${TERMS_FILE}`, renderLegalPage(TERMS_PAGE));
    if (verification !== undefined) {
        files.write(`${outDir}/${verification}`, `google-site-verification: ${verification}`);
    }
}
