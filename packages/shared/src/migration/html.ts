/**
 * Legacy HTML (the `source` and `description` properties of the 2015–2022 photo data) to plain text
 * plus structured links (security review §1.7). Nothing of the markup survives: tags are dropped,
 * entities decoded, `<script>`/`<style>` content discarded, and every anchor becomes a `{url, label}`
 * link whose URL passed `toHttpsUrl` (https kept, http upgraded for known hosts, anything else dropped).
 *
 * Anchor text stays in the text where it reads as part of a sentence. A paragraph that ends in a
 * list of links introduced by a colon ("Alte legături: <a>thenow</a>") loses that lead-in clause and
 * the link texts, because the links are listed separately.
 */
import type { PhotoLink } from '../schemas/manifest.js';
import { toHttpsUrl } from '../text/urls.js';

/** Hosts whose `http://` links are upgraded to `https://` (they serve the same page over https). */
export const KNOWN_HTTPS_HOSTS: readonly string[] = ['facebook.com', 'flickr.com', 'costingheorghe.ro'];

export interface LegacyText {
    readonly text: string;
    readonly links: readonly PhotoLink[];
    /** Anchor targets that were not safe https links and were dropped. */
    readonly dropped: readonly string[];
    /** True when the fragment is nothing but usable links (and separators): its text only repeats their labels. */
    readonly linkOnly: boolean;
}

interface TagToken {
    readonly kind: 'tag';
    readonly name: string;
    readonly closing: boolean;
    readonly href: string | null;
}

export type HtmlToken = { readonly kind: 'text'; readonly text: string } | TagToken;

/** What a paragraph holds: text, link labels and line breaks. */
type InlinePart =
    { readonly kind: 'text'; readonly text: string } | { readonly kind: 'link'; readonly label: string } | { readonly kind: 'break' };

type Part = InlinePart | { readonly kind: 'paragraph' };

interface AnchorTarget {
    readonly href: string | null;
    readonly label: string;
}

const TAG_NAME = /^[A-Za-z][A-Za-z0-9]*/;
const ENTITY = /&(#[xX][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z]{2,8});/g;
const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
    ['nbsp', ' '],
]);
const PARAGRAPH: Part = { kind: 'paragraph' };
/** Tags that structure the text; every other tag is dropped and its text kept. */
const STRUCTURE: ReadonlyMap<string, Part> = new Map([
    ...['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr'].map((name): [string, Part] => [
        name,
        PARAGRAPH,
    ]),
    ['br', { kind: 'break' }],
]);
const SKIPPED_TAGS = new Set(['script', 'style']);
const MAX_LABEL = 200;

function decodeNumeric(entity: string, body: string): string {
    const hex = /^#x/i.test(body);
    const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
}

function decodeEntity(entity: string, body: string): string {
    return body.startsWith('#') ? decodeNumeric(entity, body) : (NAMED_ENTITIES.get(body.toLowerCase()) ?? entity);
}

/** `&amp;`, `&nbsp;`, `&#259;`, `&#x103;` decoded; an unknown entity stays as written. */
export function decodeEntities(text: string): string {
    return text.replace(ENTITY, decodeEntity);
}

function skipSpaces(text: string, index: number): number {
    let position = index;
    while (text.charAt(position) === ' ') {
        position += 1;
    }
    return position;
}

function readUntil(text: string, start: number, terminator: string): string {
    const end = text.indexOf(terminator, start);
    return text.slice(start, end < 0 ? text.length : end);
}

/** A double-quoted, single-quoted or bare attribute value starting at `index`. */
function readValue(text: string, index: number): string {
    const quote = text.charAt(index);
    return quote === '"' || quote === "'" ? readUntil(text, index + 1, quote) : readUntil(text, index, ' ');
}

/** The value after `name=` when the attribute name ends at `index`, or null (`hreflang=...`). */
function valueAt(text: string, index: number): string | null {
    const equals = skipSpaces(text, index);
    return text.charAt(equals) === '=' ? decodeEntities(readValue(text, skipSpaces(text, equals + 1))) : null;
}

/** The `href` of a tag's content (`a href="x" target=_blank`), scanned without a backtracking regex. */
export function hrefOf(content: string): string | null {
    const flat = content.replace(/\s/g, ' ');
    const lower = flat.toLowerCase();
    for (let name = lower.indexOf(' href'); name >= 0; name = lower.indexOf(' href', name + 1)) {
        const value = valueAt(flat, name + ' href'.length);
        if (value !== null) {
            return value;
        }
    }
    return null;
}

/** `content` is what stands between `<` and `>`; as in HTML, the tag name must follow `<` or `</` directly. */
function parseTag(content: string): HtmlToken {
    const closing = content.startsWith('/');
    const name = TAG_NAME.exec(closing ? content.slice(1) : content);
    if (name === null) {
        return { kind: 'text', text: `<${content}>` };
    }
    return { kind: 'tag', name: name[0].toLowerCase(), closing, href: hrefOf(content) };
}

/** Text and tags in document order; an unterminated `<` is text. */
export function tokenizeHtml(html: string): HtmlToken[] {
    const tokens: HtmlToken[] = [];
    let index = 0;
    while (index < html.length) {
        const open = html.indexOf('<', index);
        const close = open < 0 ? -1 : html.indexOf('>', open);
        if (close < 0) {
            tokens.push({ kind: 'text', text: html.slice(index) });
            return tokens;
        }
        tokens.push({ kind: 'text', text: html.slice(index, open) }, parseTag(html.slice(open + 1, close)));
        index = close + 1;
    }
    return tokens;
}

function normalizeInline(text: string): string {
    return text.replaceAll(' ', ' ').replace(/\s+/g, ' ').trim();
}

/** Walks the tokens once, collecting text parts and the anchors' targets. */
class Walker {
    readonly parts: Part[] = [];
    readonly targets: AnchorTarget[] = [];
    #anchor: { href: string | null; label: string } | null = null;
    #skipping: string | null = null;

    take(token: HtmlToken): void {
        if (this.#skipping !== null) {
            this.#skip(token, this.#skipping);
        } else if (token.kind === 'text') {
            this.#text(decodeEntities(token.text));
        } else {
            this.#tag(token);
        }
    }

    /** Inside `<script>` or `<style>`: everything up to the matching closing tag is discarded. */
    #skip(token: HtmlToken, name: string): void {
        if (token.kind === 'tag' && token.closing && token.name === name) {
            this.#skipping = null;
        }
    }

    #text(text: string): void {
        if (this.#anchor === null) {
            this.parts.push({ kind: 'text', text });
            return;
        }
        this.#anchor.label += text;
    }

    #tag(tag: TagToken): void {
        if (tag.name === 'a') {
            this.#link(tag);
            return;
        }
        const part = STRUCTURE.get(tag.name);
        if (part !== undefined) {
            this.parts.push(part);
        }
        if (SKIPPED_TAGS.has(tag.name) && !tag.closing) {
            this.#skipping = tag.name;
        }
    }

    /** `<a>` closes the open anchor (anchors do not nest) and opens a new one; `</a>` only closes. */
    #link(tag: TagToken): void {
        this.finish();
        if (!tag.closing) {
            this.#anchor = { href: tag.href, label: '' };
        }
    }

    /** Closes an open anchor (also an unterminated one at the end of the input). */
    finish(): void {
        if (this.#anchor === null) {
            return;
        }
        const label = normalizeInline(this.#anchor.label);
        this.parts.push({ kind: 'link', label });
        this.targets.push({ href: this.#anchor.href, label });
        this.#anchor = null;
    }
}

function partText(part: InlinePart): string {
    switch (part.kind) {
        case 'break':
            return '\n';
        case 'link':
            return part.label;
        case 'text':
            return part.text;
    }
}

function endsWithColon(part: InlinePart | undefined): boolean {
    return part?.kind === 'text' && part.text.trimEnd().endsWith(':');
}

function isLinkOrSeparator(part: Part): boolean {
    return part.kind !== 'text' || /^[\s,;|·/-]*$/.test(part.text.replaceAll(' ', ' '));
}

/** The text before a links lead-in: everything up to the end of the previous sentence. */
function dropClause(text: string): string {
    const end = Math.max(text.lastIndexOf('.'), text.lastIndexOf('!'), text.lastIndexOf('?'));
    return text.slice(0, end + 1);
}

/** Index of the text part that introduces a trailing list of links (`...: <a>…</a>, <a>…</a>`), or -1. */
function linkListLeadIn(parts: readonly InlinePart[]): number {
    const firstLink = parts.findIndex((part, index) => part.kind === 'link' && endsWithColon(parts[index - 1]));
    return firstLink > 0 && parts.slice(firstLink).every(isLinkOrSeparator) ? firstLink - 1 : -1;
}

function paragraphText(parts: readonly InlinePart[]): string {
    const leadIn = linkListLeadIn(parts);
    const kept =
        leadIn < 0
            ? parts
            : [
                  ...parts.slice(0, leadIn),
                  ...parts.slice(leadIn, leadIn + 1).map((part): InlinePart => ({ kind: 'text', text: dropClause(partText(part)) })),
              ];
    return kept
        .map(partText)
        .join('')
        .split('\n')
        .map(normalizeInline)
        .filter((line) => line !== '')
        .join('\n');
}

function paragraphs(parts: readonly Part[]): InlinePart[][] {
    let current: InlinePart[] = [];
    const groups: InlinePart[][] = [current];
    for (const part of parts) {
        if (part.kind === 'paragraph') {
            current = [];
            groups.push(current);
        } else {
            current.push(part);
        }
    }
    return groups;
}

function linkLabel(label: string, url: string): string {
    const text = label === '' ? new URL(url).hostname.replace(/^www\./, '') : label;
    return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

function collectLinks(targets: readonly AnchorTarget[], upgradeHosts: readonly string[]): Pick<LegacyText, 'links' | 'dropped'> {
    const links: PhotoLink[] = [];
    const dropped: string[] = [];
    for (const { href, label } of targets.filter((target): target is AnchorTarget & { href: string } => target.href !== null)) {
        const url = toHttpsUrl(href, upgradeHosts);
        if (url === null) {
            dropped.push(href);
        } else if (!links.some((link) => link.url === url)) {
            links.push({ url, label: linkLabel(label, url) });
        }
    }
    return { links, dropped };
}

/** Converts one legacy HTML fragment; `upgradeHosts` defaults to `KNOWN_HTTPS_HOSTS`. */
export function legacyHtmlToText(html: string, upgradeHosts: readonly string[] = KNOWN_HTTPS_HOSTS): LegacyText {
    const walker = new Walker();
    tokenizeHtml(html).forEach((token) => {
        walker.take(token);
    });
    walker.finish();
    const text = paragraphs(walker.parts)
        .map(paragraphText)
        .filter((paragraph) => paragraph !== '')
        .join('\n\n');
    const collected = collectLinks(walker.targets, upgradeHosts);
    return { text, linkOnly: collected.links.length > 0 && walker.parts.every(isLinkOrSeparator), ...collected };
}
