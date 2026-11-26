/**
 * The Markdown subset of city texts (About, privacy notice; security review §1.7), parsed into a tree
 * that a renderer turns into DOM nodes with Lit templates or `textContent`. Nothing here produces HTML.
 *
 * - Paragraphs are separated by a blank line; a single line break stays a line break.
 * - `**bold**`, `_italic_` or `*italic*`; a marker without a closing partner stays literal text.
 * - `[label](https://example.org/page)` is a link; any other target (http, `javascript:`, relative)
 *   stays literal text and is reported in `rejectedLinks`, which the schemas turn into an error.
 * - `\` makes the next character literal (`\*`, `\_`, `\[`). Anything else, HTML included, is text.
 */
import { isHttpsUrl } from './urls.js';

export type InlineNode =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'strong'; readonly children: readonly InlineNode[] }
    | { readonly type: 'em'; readonly children: readonly InlineNode[] }
    | { readonly type: 'link'; readonly href: string; readonly text: string }
    | { readonly type: 'break' };

export interface MarkdownParagraph {
    readonly type: 'paragraph';
    readonly children: readonly InlineNode[];
}

export interface MarkdownDocument {
    readonly paragraphs: readonly MarkdownParagraph[];
    /** Link targets that were not https (kept as literal text). */
    readonly rejectedLinks: readonly string[];
}

type Marker = '**' | '_' | '*';

interface RootFrame {
    readonly marker: null;
    readonly parent: null;
    readonly children: InlineNode[];
}

interface MarkerFrame {
    readonly marker: Marker;
    readonly parent: Frame;
    readonly children: InlineNode[];
}

type Frame = RootFrame | MarkerFrame;

type Token =
    | { readonly kind: 'text'; readonly text: string; readonly length: number }
    | { readonly kind: 'break'; readonly length: number }
    | { readonly kind: 'marker'; readonly marker: Marker; readonly length: number }
    | { readonly kind: 'link'; readonly label: string; readonly href: string; readonly length: number };

/** `[label](target)` at the start of the input; bounded, so a long line cannot make it slow. */
const LINK = /^\[([^\]\n]{1,500})\]\(([^)\s]{1,2048})\)/;

type Reader = (source: string, index: number) => Token | null;

const READERS: readonly Reader[] = [
    (source, index) =>
        source.charAt(index) === '\\' && index + 1 < source.length ? { kind: 'text', text: source.charAt(index + 1), length: 2 } : null,
    (source, index) => (source.charAt(index) === '\n' ? { kind: 'break', length: 1 } : null),
    (source, index) => (source.startsWith('**', index) ? { kind: 'marker', marker: '**', length: 2 } : null),
    (source, index) => {
        const char = source.charAt(index);
        return char === '_' || char === '*' ? { kind: 'marker', marker: char, length: 1 } : null;
    },
    (source, index) => {
        const match = source.charAt(index) === '[' ? LINK.exec(source.slice(index, index + 2600)) : null;
        // Both groups are mandatory in LINK, so they are strings whenever it matches.
        return match === null ? null : { kind: 'link', label: String(match[1]), href: String(match[2]), length: match[0].length };
    },
];

function readToken(source: string, index: number): Token {
    for (const reader of READERS) {
        const token = reader(source, index);
        if (token !== null) {
            return token;
        }
    }
    return { kind: 'text', text: source.charAt(index), length: 1 };
}

function appendText(frame: Frame, text: string): void {
    const last = frame.children.at(-1);
    if (last?.type === 'text') {
        frame.children[frame.children.length - 1] = { type: 'text', text: last.text + text };
        return;
    }
    frame.children.push({ type: 'text', text });
}

function appendNode(frame: Frame, node: InlineNode): void {
    if (node.type === 'text') {
        appendText(frame, node.text);
        return;
    }
    frame.children.push(node);
}

class InlineParser {
    #frame: Frame = { marker: null, parent: null, children: [] };
    readonly #rejected: string[];

    constructor(rejected: string[]) {
        this.#rejected = rejected;
    }

    parse(source: string): InlineNode[] {
        let index = 0;
        while (index < source.length) {
            const token = readToken(source, index);
            index += token.length;
            this.#apply(token, source.slice(index));
        }
        return this.#unwind();
    }

    #apply(token: Token, rest: string): void {
        switch (token.kind) {
            case 'text':
                appendText(this.#frame, token.text);
                break;
            case 'break':
                this.#frame.children.push({ type: 'break' });
                break;
            case 'link':
                this.#link(token.label, token.href);
                break;
            case 'marker':
                this.#marker(token.marker, rest);
                break;
        }
    }

    #link(label: string, href: string): void {
        if (isHttpsUrl(href)) {
            this.#frame.children.push({ type: 'link', href, text: label });
            return;
        }
        this.#rejected.push(href);
        appendText(this.#frame, `[${label}](${href})`);
    }

    #marker(marker: Marker, rest: string): void {
        const frame = this.#frame;
        if (frame.marker === marker) {
            appendNode(frame.parent, { type: marker === '**' ? 'strong' : 'em', children: frame.children });
            this.#frame = frame.parent;
            return;
        }
        if (rest.includes(marker)) {
            this.#frame = { marker, parent: frame, children: [] };
            return;
        }
        appendText(frame, marker);
    }

    /** Markers still open at the end were never closed: they and their content become plain text. */
    #unwind(): InlineNode[] {
        let frame = this.#frame;
        while (frame.marker !== null) {
            const parent = frame.parent;
            appendText(parent, frame.marker);
            frame.children.forEach((child) => {
                appendNode(parent, child);
            });
            frame = parent;
        }
        return frame.children;
    }
}

/** Parses `source` (Markdown subset) into paragraphs of inline nodes. */
export function parseMarkdown(source: string): MarkdownDocument {
    const rejectedLinks: string[] = [];
    const paragraphs = source
        .replaceAll('\r\n', '\n')
        .split(/\n[ \t]*\n/)
        .map((block) => block.trim())
        .filter((block) => block !== '')
        .map((block): MarkdownParagraph => ({ type: 'paragraph', children: new InlineParser(rejectedLinks).parse(block) }));
    return { paragraphs, rejectedLinks };
}

function nodeLinks(node: InlineNode): string[] {
    if (node.type === 'link') {
        return [node.href];
    }
    return node.type === 'strong' || node.type === 'em' ? node.children.flatMap(nodeLinks) : [];
}

/**
 * Every link address of a Markdown-subset string, the https ones it renders as links and the others it keeps as text (a
 * translation draft may neither add nor change one: `draftKeepsLinks`).
 */
export function linkTargets(source: string): readonly string[] {
    const document = parseMarkdown(source);
    return [...document.paragraphs.flatMap((paragraph) => paragraph.children.flatMap(nodeLinks)), ...document.rejectedLinks];
}

/** The plain text of a Markdown-subset string (markers removed, link labels kept). */
export function markdownToPlainText(source: string): string {
    const text = (nodes: readonly InlineNode[]): string => nodes.map((node) => nodeText(node, text)).join('');
    return parseMarkdown(source)
        .paragraphs.map((paragraph) => text(paragraph.children))
        .join('\n\n');
}

function nodeText(node: InlineNode, text: (nodes: readonly InlineNode[]) => string): string {
    if (node.type === 'break') {
        return '\n';
    }
    if (node.type === 'strong' || node.type === 'em') {
        return text(node.children);
    }
    return node.text;
}
