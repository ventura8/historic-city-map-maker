/**
 * The starter kit's page (`templates/starter-kit/index.html`, M5 `docs/research/M5-interfaces.md` §3.2): one committed
 * template that the CLI `create-historic-city` fills for a new city, the static export fills for an exported one and
 * the release pins to its engine. `fillKitPage` replaces, and only replaces, its slots: the `lang` of `<html>` and of
 * the viewer element, the title, the description and theme-colour metas, the level-one heading, the element's
 * `manifest-url`, the meta CSP's `content` (always recomputed from the engine: `contentSecurityPolicy`) and the engine
 * block between `<!-- hcm:engine -->` and `<!-- /hcm:engine -->`. Every text is escaped for HTML; a template that lacks
 * a slot, or holds one twice, throws `KitPageError`, so a page is never written half filled.
 *
 * The engine block is written the way Prettier formats it (attributes one per line once a tag passes 140 columns), so
 * a pinned template stays Prettier-clean.
 */
import { ENGINE_PAGE_FILES, SRI_PATTERN } from '../schemas/engine-release.js';
import { isHttpsUrl, isRelativeUrl } from '../text/urls.js';
import { contentSecurityPolicy, NO_EXTRA_SOURCES, SELF_SOURCE, type ExtraSources } from './csp.js';

/** A template the kit's page functions cannot fill, or a value they refuse. */
export class KitPageError extends Error {
    override readonly name = 'KitPageError';
}

/** The kit's three files (`templates/starter-kit/`). */
export const KIT_FILES = { page: 'index.html', manifest: 'city.json', readme: 'README.md' } as const;

/** The Mapbox public token of the template's `city.json`: valid by the schema, refused by Mapbox (the README's token step). */
export const KIT_PLACEHOLDER_TOKEN = 'pk.replace-with-your-token';

/** The integrity the template carries until a release pins it: valid in form, the digest of no file. */
export const KIT_UNPINNED_INTEGRITY = `sha384-${'0'.repeat(64)}`;

/** Where a page that carries the engine beside it (an export) finds it. */
export const KIT_LOCAL_ENGINE_FOLDER = 'engine/';

const ENGINE_OPEN = '<!-- hcm:engine -->';
const ENGINE_CLOSE = '<!-- /hcm:engine -->';
const PRINT_WIDTH = 140;
const INDENT = '    ';
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** What a page pins of a release: its folder and the integrity of the two files a page loads (`ENGINE_PAGE_FILES`). */
export interface KitRelease {
    readonly base: string;
    readonly files: readonly { readonly path: string; readonly integrity: string }[];
}

/** Where the page loads the engine from: a release's pinned folder, with integrity, or `engine/` beside the page. */
export type KitEngine = { readonly kind: 'cdn'; readonly release: KitRelease } | { readonly kind: 'local' };

/** The slots `fillKitPage` sets; a text slot left out keeps the template's value. */
export interface KitPageValues {
    readonly engine: KitEngine;
    readonly lang?: 'ro' | 'en';
    readonly title?: string;
    readonly description?: string;
    readonly themeColor?: string;
    /** The visually hidden level-one heading (the city's name). */
    readonly heading?: string;
    /** `city.json` beside the page, or an https address (its origin then belongs in `sources`). */
    readonly manifestUrl?: string;
    /** Origins the page's manifest names beyond its own (tiles, photos elsewhere). */
    readonly sources?: ExtraSources;
    /** The telemetry's hosts in the policy (default true; an export's manifest has no analytics id: false). */
    readonly analytics?: boolean;
    /**
     * The tab icon, a PNG as a `data:` address (an export carries its city's: `docs/ENGINE_API.md` → *The page's tab
     * icon*). Left out, the page keeps its own (the template's: the Layers panel's map glyph). Only this slot is optional:
     * a page made before icons has `<link rel="icon" href="data:," />`, which it fills just the same.
     */
    readonly icon?: string;
}

const TEXT_ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function entity(character: string): string {
    return String(TEXT_ENTITIES[character]);
}

/** One line of plain text, `&`, `<` and `>` escaped (and `"`, for an attribute value). */
function escaped(value: string, attribute: boolean): string {
    const line = value.replace(/\s+/g, ' ').trim();
    return line.replace(attribute ? /[&<>"]/g : /[&<>]/g, entity);
}

/** A text slot's value: never empty once collapsed. */
function text(value: string, slot: string, attribute = false): string {
    const result = escaped(value, attribute);
    if (result === '') {
        throw new KitPageError(`the kit page's ${slot} is empty`);
    }
    return result;
}

interface Found {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/** The one match of `pattern` (global) in `page`; none or two throw. */
function unique(page: string, pattern: RegExp, slot: string, keep: (text: string) => boolean = () => true): Found {
    const matches = [...page.matchAll(pattern)].filter((match) => keep(match[0]));
    const [match, ...more] = matches;
    if (match === undefined || more.length > 0) {
        throw new KitPageError(`the kit page must hold one ${slot}, found ${String(matches.length)}`);
    }
    return { start: match.index, end: match.index + match[0].length, text: match[0] };
}

function splice(page: string, found: Found, replacement: string): string {
    return `${page.slice(0, found.start)}${replacement}${page.slice(found.end)}`;
}

/** The value of `name` in an opening tag, or undefined. */
function attributeOf(tag: string, name: string): string | undefined {
    return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/** An attribute slot: the attribute `name` of the one `<tag …>` whose text passes `keep`. */
interface AttributeSlot {
    readonly tag: string;
    readonly name: string;
    readonly keep?: (text: string) => boolean;
}

const named = (name: string) => (tag: string) => attributeOf(tag, 'name') === name;

const SLOTS = {
    htmlLang: { tag: 'html', name: 'lang' },
    viewerLang: { tag: 'hcm-map-viewer', name: 'lang' },
    viewerManifest: { tag: 'hcm-map-viewer', name: 'manifest-url' },
    description: { tag: 'meta', name: 'content', keep: named('description') },
    themeColor: { tag: 'meta', name: 'content', keep: named('theme-color') },
    icon: { tag: 'link', name: 'href', keep: (tag) => attributeOf(tag, 'rel') === 'icon' },
    policy: { tag: 'meta', name: 'content', keep: (tag) => attributeOf(tag, 'http-equiv') === 'Content-Security-Policy' },
} as const satisfies Record<string, AttributeSlot>;

/**
 * `page` with the slot's attribute set to `value` (already escaped); undefined leaves it as it is. A page without the
 * slot, with it twice, or whose tag lacks the attribute throws either way.
 */
function setAttribute(page: string, slot: AttributeSlot, value: string | undefined): string {
    const found = unique(page, new RegExp(`<${slot.tag}\\b[^>]*>`, 'g'), `<${slot.tag}>`, slot.keep);
    const pattern = new RegExp(`(\\s${slot.name}=")[^"]*(")`);
    if (!pattern.test(found.text)) {
        throw new KitPageError(`the kit page's <${slot.tag}> has no ${slot.name} attribute`);
    }
    return value === undefined
        ? page
        : splice(
              page,
              found,
              found.text.replace(pattern, (_, before: string, after: string) => `${before}${value}${after}`),
          );
}

/** `page` with the plain text of the one `<tag …>…</tag>` set to `value`; undefined leaves it (but the slot must exist). */
function setElementText(page: string, tag: string, value: string | undefined): string {
    const slot = `<${tag}>`;
    const open = unique(page, new RegExp(`<${tag}\\b[^>]*>`, 'g'), slot);
    const close = page.indexOf(`</${tag}>`, open.end);
    if (close === -1 || page.slice(open.end, close).includes('<')) {
        throw new KitPageError(`the kit page's ${slot} must hold plain text and close`);
    }
    return value === undefined ? page : `${page.slice(0, open.end)}${text(value, slot)}${page.slice(close)}`;
}

type Attribute = readonly [name: string, value: string | true];

function attributeText([name, value]: Attribute): string {
    return value === true ? name : `${name}="${escaped(value, true)}"`;
}

/** One element without content, as Prettier writes it: on one line, or one attribute per line past the print width. */
function elementLines(indent: string, tag: string, attributes: readonly Attribute[]): string[] {
    const close = tag === 'link' ? ' />' : `></${tag}>`;
    const line = `${indent}<${tag} ${attributes.map(attributeText).join(' ')}${close}`;
    if (line.length <= PRINT_WIDTH) {
        return [line];
    }
    const inner = `${indent}${INDENT}`;
    return [`${indent}<${tag}`, ...attributes.map((attribute) => `${inner}${attributeText(attribute)}`), `${indent}${close.trim()}`];
}

/** The integrity `release` gives a page file; a missing or malformed one throws. */
function pinnedIntegrity(release: KitRelease, path: string): string {
    const integrity = release.files.find((file) => file.path === path)?.integrity ?? '';
    if (!SRI_PATTERN.test(integrity)) {
        throw new KitPageError(`the release pins no sha384 integrity for ${path}`);
    }
    return integrity;
}

function checkedBase(release: KitRelease): string {
    if (!isHttpsUrl(release.base) || !release.base.endsWith('/')) {
        throw new KitPageError(`the release's folder must be an https address ending with "/": ${release.base}`);
    }
    return release.base;
}

/** The stylesheet and the script of the engine block, in that order (the script after Mapbox's, both deferred). */
function engineLines(engine: KitEngine, indent: string): string[] {
    if (engine.kind === 'local') {
        const base = KIT_LOCAL_ENGINE_FOLDER;
        return [
            ...elementLines(indent, 'link', [
                ['rel', 'stylesheet'],
                ['href', `${base}${ENGINE_PAGE_FILES.stylesheet}`],
            ]),
            ...elementLines(indent, 'script', [
                ['src', `${base}${ENGINE_PAGE_FILES.script}`],
                ['defer', true],
            ]),
        ];
    }
    const base = checkedBase(engine.release);
    const pinned = (path: string): Attribute[] => [
        ['integrity', pinnedIntegrity(engine.release, path)],
        ['crossorigin', 'anonymous'],
    ];
    return [
        ...elementLines(indent, 'link', [
            ['rel', 'stylesheet'],
            ['href', `${base}${ENGINE_PAGE_FILES.stylesheet}`],
            ...pinned(ENGINE_PAGE_FILES.stylesheet),
        ]),
        ...elementLines(indent, 'script', [
            ['src', `${base}${ENGINE_PAGE_FILES.script}`],
            ...pinned(ENGINE_PAGE_FILES.script),
            ['defer', true],
        ]),
    ];
}

interface EngineBlock {
    /** From the start of the open marker's line to the end of the close marker. */
    readonly start: number;
    readonly end: number;
    readonly indent: string;
    readonly body: string;
}

function markerAt(page: string, marker: string): number {
    const first = page.indexOf(marker);
    if (first === -1 || page.includes(marker, first + marker.length)) {
        throw new KitPageError(`the kit page must hold one ${marker} marker`);
    }
    return first;
}

function engineBlock(page: string): EngineBlock {
    const open = markerAt(page, ENGINE_OPEN);
    const close = markerAt(page, ENGINE_CLOSE);
    const lineStart = page.lastIndexOf('\n', open) + 1;
    const indent = page.slice(lineStart, open);
    if (close < open || indent.trim() !== '') {
        throw new KitPageError("the kit page's engine markers must each start a line, the open one first");
    }
    return { start: lineStart, end: close + ENGINE_CLOSE.length, indent, body: page.slice(open + ENGINE_OPEN.length, close) };
}

function setEngineBlock(page: string, engine: KitEngine): string {
    const block = engineBlock(page);
    const lines = [`${block.indent}${ENGINE_OPEN}`, ...engineLines(engine, block.indent), `${block.indent}${ENGINE_CLOSE}`];
    return `${page.slice(0, block.start)}${lines.join('\n')}${page.slice(block.end)}`;
}

/** The engine's source in the page's CSP: its own origin, or the release's pinned folder. */
function engineSource(engine: KitEngine): string {
    return engine.kind === 'local' ? SELF_SOURCE : checkedBase(engine.release);
}

/** The meta CSP of a kit page loading `engine` (`sources`: the origins its manifest names beyond its own). */
export function kitContentSecurityPolicy(engine: KitEngine, sources: ExtraSources = NO_EXTRA_SOURCES, analytics = true): string {
    return contentSecurityPolicy(sources, engineSource(engine), analytics);
}

/** The `content` of a kit page's meta CSP as written (`policyExtras` reads what the page added to the fixed one). */
export function readKitPolicy(page: string): string {
    return attributeOf(unique(page, /<meta\b[^>]*>/g, '<meta>', SLOTS.policy.keep).text, 'content') ?? '';
}

function checkedManifestUrl(url: string): string {
    if (!(isRelativeUrl(url) || isHttpsUrl(url))) {
        throw new KitPageError(`the manifest's address must be relative or https: ${url}`);
    }
    return url;
}

function checkedColor(color: string): string {
    if (!HEX_COLOR.test(color)) {
        throw new KitPageError(`the theme colour must be #rrggbb: ${color}`);
    }
    return color;
}

/** A PNG as a `data:` address, at most 100 000 characters (a 32 px icon is a few kilobytes). */
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]{4,100000}={0,2}$/;

function checkedIcon(icon: string): string {
    if (!PNG_DATA_URL.test(icon)) {
        throw new KitPageError('the tab icon must be a PNG as a data: address');
    }
    return icon;
}

function checkedLang(lang: string): string {
    if (lang !== 'ro' && lang !== 'en') {
        throw new KitPageError(`the kit page's language is ro or en: ${lang}`);
    }
    return lang;
}

/** `fn(value)`, or undefined for a slot left out. */
function given(value: string | undefined, fn: (value: string) => string): string | undefined {
    return value === undefined ? undefined : fn(value);
}

/** The text slots, in page order: each writes its value, or only checks the slot when `values` leaves it out. */
function textSteps(values: KitPageValues): readonly ((page: string) => string)[] {
    const lang = given(values.lang, checkedLang);
    return [
        (page) => setAttribute(page, SLOTS.htmlLang, lang),
        (page) =>
            setAttribute(
                page,
                SLOTS.description,
                given(values.description, (value) => text(value, 'description', true)),
            ),
        (page) => setAttribute(page, SLOTS.themeColor, given(values.themeColor, checkedColor)),
        (page) => setElementText(page, 'title', values.title),
        (page) => setElementText(page, 'h1', values.heading),
        (page) =>
            setAttribute(
                page,
                SLOTS.viewerManifest,
                given(values.manifestUrl, (url) => escaped(checkedManifestUrl(url), true)),
            ),
        (page) => setAttribute(page, SLOTS.viewerLang, lang),
        (page) => (values.icon === undefined ? page : setAttribute(page, SLOTS.icon, checkedIcon(values.icon))),
    ];
}

/** `template` with its slots set from `values`; the CSP and the engine block always follow `values.engine`. */
export function fillKitPage(template: string, values: KitPageValues): string {
    const policy = escaped(kitContentSecurityPolicy(values.engine, values.sources, values.analytics), true);
    const filled = textSteps(values).reduce((page, step) => step(page), template);
    return setEngineBlock(setAttribute(filled, SLOTS.policy, policy), values.engine);
}

function tagIn(body: string, tag: string): string {
    return unique(body, new RegExp(`<${tag}\\b[^>]*>`, 'g'), `<${tag}> in the engine block`).text;
}

function required(tag: string, name: string): string {
    const value = attributeOf(tag, name);
    if (value === undefined) {
        throw new KitPageError(`a tag of the engine block has no ${name}: ${tag}`);
    }
    return value;
}

/**
 * The engine a kit page loads, read back from its engine block: the local folder, or the pinned folder with the
 * integrity of its stylesheet and script (`doctor` compares it, `upgrade` carries a template's pins into a page).
 */
export function readKitEngine(page: string): KitEngine {
    const { body } = engineBlock(page);
    const link = tagIn(body, 'link');
    const script = tagIn(body, 'script');
    const href = required(link, 'href');
    const src = required(script, 'src');
    if (
        href === `${KIT_LOCAL_ENGINE_FOLDER}${ENGINE_PAGE_FILES.stylesheet}` &&
        src === `${KIT_LOCAL_ENGINE_FOLDER}${ENGINE_PAGE_FILES.script}`
    ) {
        return { kind: 'local' };
    }
    const base = href.slice(0, href.length - ENGINE_PAGE_FILES.stylesheet.length);
    if (href !== `${base}${ENGINE_PAGE_FILES.stylesheet}` || src !== `${base}${ENGINE_PAGE_FILES.script}`) {
        throw new KitPageError(`the engine block loads its stylesheet and script from two folders: ${href}, ${src}`);
    }
    const files = [
        { path: ENGINE_PAGE_FILES.stylesheet, integrity: required(link, 'integrity') },
        { path: ENGINE_PAGE_FILES.script, integrity: required(script, 'integrity') },
    ];
    const release: KitRelease = { base, files };
    checkedBase(release);
    return { kind: 'cdn', release };
}

/** What `kitResult` gives back: the work's value, or the page's error. */
export type KitResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: KitPageError };

/** `work()`'s value, or the `KitPageError` it threw (a page the owner can fix); any other error propagates. */
export function kitResult<T>(work: () => T): KitResult<T> {
    try {
        return { ok: true, value: work() };
    } catch (error: unknown) {
        if (error instanceof KitPageError) {
            return { ok: false, error };
        }
        throw error;
    }
}

/** Whether a page's engine is the template's placeholder, which no release has pinned yet. */
export function isUnpinned(engine: KitEngine): boolean {
    return engine.kind === 'cdn' && engine.release.files.some((file) => file.integrity === KIT_UNPINNED_INTEGRITY);
}
