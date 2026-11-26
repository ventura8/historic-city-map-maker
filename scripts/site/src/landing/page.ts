import { element, renderDocument, type HtmlElement } from '../html.js';
import { SOURCE_URL } from '../start/legal-text.js';
import type { LandingCatalogue, LandingLanguage } from './texts.js';

/**
 * The project's landing page on GitHub Pages (`docs/research/DECISIONS-for-review.md` §162): what Historic City Map Maker
 * is, the start page's button, the terminal road pinned to this release, the example map and the links. Plain HTML from
 * elements and text only (`../html.ts`), one stylesheet, no script, no cookie and no third-party request; light and dark
 * follow the browser. One page per language, each linking the other.
 */

/** The start page, its legal pages and the example map. */
export const START_SITE_URL = 'https://start-historic-city.web.app/';
export const EXAMPLE_URL = 'https://bucurestiul-disparut.web.app/';
/** The repository's documents on GitHub (`master`, what the Pages workflow deploys from). */
const DOCS_URL = `${SOURCE_URL}/blob/master/docs/`;
/** Every release, pre-releases included (`/releases/latest` skips a pre-release). */
const RELEASES_URL = `${SOURCE_URL}/releases`;

export const LANDING_STYLESHEET_FILE = 'landing.css';
/** Each language's file: English is the page Pages serves at the root. */
export const LANDING_FILES: Readonly<Record<LandingLanguage, string>> = { en: 'index.html', ro: 'ro.html' };

const POLICY = [
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
].join('; ');

/** What a page needs besides its words: the release whose CLI the terminal road names. */
export interface LandingInputs {
    readonly version: string;
}

function head(words: LandingCatalogue): HtmlElement {
    return element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('meta', { 'http-equiv': 'Content-Security-Policy', content: POLICY }),
        element('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
        element('meta', { name: 'description', content: words.description }),
        element('meta', { name: 'color-scheme', content: 'light dark' }),
        element('title', {}, [words.title]),
        element('link', { rel: 'icon', href: 'data:,' }),
        element('link', { rel: 'stylesheet', href: LANDING_STYLESHEET_FILE }),
    ]);
}

function link(href: string, text: string): HtmlElement {
    return element('li', {}, [element('a', { class: 'landing-link', href }, [text])]);
}

function links(words: LandingCatalogue): HtmlElement {
    return element('section', { 'aria-labelledby': 'links' }, [
        element('h2', { id: 'links' }, [words['links.heading']]),
        element('ul', { class: 'landing-links' }, [
            link(SOURCE_URL, words['link.repository']),
            link(`${DOCS_URL}SETUP.md`, words['link.setup']),
            link(`${DOCS_URL}SELF_HOST.md`, words['link.selfHost']),
            link(`${DOCS_URL}ENGINE_API.md`, words['link.engineApi']),
            link(RELEASES_URL, words['link.releases']),
            link(`${START_SITE_URL}privacy.html`, words['link.privacy']),
            link(`${START_SITE_URL}terms.html`, words['link.terms']),
        ]),
    ]);
}

function languageSwitch(lang: LandingLanguage, words: LandingCatalogue): HtmlElement {
    const other: LandingLanguage = lang === 'en' ? 'ro' : 'en';
    return element('nav', { class: 'landing-switch', 'aria-label': words['switch.label'] }, [
        element('a', { class: 'landing-link', href: LANDING_FILES[other], lang: other, hreflang: other }, [words['switch.name']]),
    ]);
}

function main(words: LandingCatalogue, inputs: LandingInputs): HtmlElement {
    const command = `npx create-historic-city@${inputs.version} self-host`;
    return element('main', { class: 'landing' }, [
        element('h1', {}, [words.title]),
        element('p', { class: 'landing-lead' }, [words.lead]),
        element('ul', { class: 'landing-points' }, [
            element('li', {}, [words['point.photos']]),
            element('li', {}, [words['point.imagery']]),
            element('li', {}, [words['point.admin']]),
        ]),
        element('p', {}, [element('a', { class: 'landing-start', href: START_SITE_URL }, [words['start.action']])]),
        element('p', {}, [words['start.note']]),
        element('section', { 'aria-labelledby': 'terminal' }, [
            element('h2', { id: 'terminal' }, [words['terminal.heading']]),
            element('p', {}, [words['terminal.text']]),
            element('p', { class: 'landing-command' }, [element('code', {}, [command])]),
        ]),
        element('section', { 'aria-labelledby': 'example' }, [
            element('h2', { id: 'example' }, [words['example.heading']]),
            element('p', {}, [words['example.text'], element('a', { href: EXAMPLE_URL }, [words['example.link']])]),
        ]),
        links(words),
    ]);
}

/** One language's page. */
export function renderLandingPage(lang: LandingLanguage, words: LandingCatalogue, inputs: LandingInputs): string {
    const body = element('body', {}, [
        element('header', { class: 'landing-header' }, [languageSwitch(lang, words)]),
        main(words, inputs),
        element('footer', { class: 'landing-footer' }, [element('p', {}, [words.footer])]),
    ]);
    return renderDocument(element('html', { lang }, [head(words), body]));
}

/** `landing.css`: system colours (light and dark follow the browser), a readable measure, targets of at least 48 px (M3's touch target). */
export const LANDING_STYLESHEET = [
    '/* Historic City Map Maker: the landing page on GitHub Pages (scripts/site/src/landing/page.ts). */',
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
    '.landing,',
    '.landing-header,',
    '.landing-footer {',
    '    box-sizing: border-box;',
    '    max-inline-size: 44rem;',
    '    margin-inline: auto;',
    '    padding-inline: 1rem;',
    '    overflow-wrap: anywhere;',
    '}',
    '',
    '.landing-header {',
    '    display: flex;',
    '    justify-content: flex-end;',
    '}',
    '',
    '.landing h1 {',
    '    font-size: 2rem;',
    '    line-height: 1.2;',
    '}',
    '',
    '.landing h2 {',
    '    margin-block-start: 2rem;',
    '    font-size: 1.375rem;',
    '}',
    '',
    '.landing-lead {',
    '    font-size: 1.125rem;',
    '}',
    '',
    '.landing a {',
    '    color: LinkText;',
    '    text-underline-offset: 0.2em;',
    '}',
    '',
    '.landing-link {',
    '    display: inline-block;',
    '    box-sizing: border-box;',
    '    min-block-size: 3rem;',
    '    padding-block: 0.75rem;',
    '    color: LinkText;',
    '}',
    '',
    '.landing .landing-start {',
    '    display: inline-block;',
    '    box-sizing: border-box;',
    '    min-block-size: 3rem;',
    '    padding: 0.75rem 1.5rem;',
    '    border: 0.125rem solid ButtonText;',
    '    border-radius: 1.5rem;',
    '    background: ButtonFace;',
    '    color: ButtonText;',
    '    font-weight: 600;',
    '    text-decoration: none;',
    '}',
    '',
    '.landing-command {',
    '    padding: 0.75rem;',
    '    overflow-x: auto;',
    '    border: 1px solid GrayText;',
    '    border-radius: 0.5rem;',
    '}',
    '',
    '.landing-links {',
    '    display: flex;',
    '    flex-wrap: wrap;',
    '    gap: 0 1.5rem;',
    '    margin: 0;',
    '    padding: 0;',
    '    list-style: none;',
    '}',
    '',
    '.landing-footer {',
    '    margin-block-start: 2rem;',
    '    border-block-start: 1px solid GrayText;',
    '}',
    '',
    'a:focus-visible {',
    '    outline: 0.1875rem solid currentcolor;',
    '    outline-offset: 0.125rem;',
    '}',
    '',
].join('\n');
