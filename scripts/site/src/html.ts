/**
 * A tiny HTML writer for the static site pages (`index.html` of a city site and of the starter kit).
 *
 * Pages are built from elements and text only: every text and attribute value is escaped, there is no way
 * to insert a raw HTML string, and `<script>` / `<style>` cannot hold inline code (the meta CSP forbids it,
 * docs/research/design-review-security-cost.md §1.8). The output follows the repository's html-validate
 * rules (`.htmlvalidate.json`): an upper-case doctype, void elements without a closing slash.
 */

/** Attribute values; `true` writes a boolean attribute (`defer`). */
export type HtmlAttributes = Readonly<Record<string, string | true>>;

export interface HtmlElement {
    readonly tag: string;
    readonly attributes: HtmlAttributes;
    readonly children: readonly HtmlNode[];
}

/** An element, or text (escaped when written). */
export type HtmlNode = HtmlElement | string;

const VOID_ELEMENTS = new Set(['base', 'br', 'hr', 'img', 'input', 'link', 'meta', 'source']);
/** Elements whose content would be code: the pages load scripts and styles from files only. */
const CODE_ELEMENTS = new Set(['script', 'style']);
const TAG_NAME = /^[a-z][a-z0-9-]*$/;
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;
const INDENT = '    ';

const TEXT_ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Only called for the characters the escaping patterns match, which all have an entity. */
function entity(character: string): string {
    return String(TEXT_ENTITIES[character]);
}

/** Text content: `&`, `<` and `>` escaped. */
export function escapeText(text: string): string {
    return text.replace(/[&<>]/g, entity);
}

/** A double-quoted attribute value: `&`, `<`, `>` and `"` escaped. */
export function escapeAttribute(value: string): string {
    return value.replace(/[&<>"]/g, entity);
}

function checkAttributes(tag: string, attributes: HtmlAttributes): void {
    const invalid = Object.keys(attributes).find((name) => !ATTRIBUTE_NAME.test(name));
    if (invalid !== undefined) {
        throw new Error(`<${tag}>: invalid attribute name "${invalid}"`);
    }
}

function checkChildren(tag: string, children: readonly HtmlNode[]): void {
    if (children.length > 0 && VOID_ELEMENTS.has(tag)) {
        throw new Error(`<${tag}> is a void element and has no content`);
    }
    if (children.length > 0 && CODE_ELEMENTS.has(tag)) {
        throw new Error(`<${tag}> must not hold inline code: load a file instead (CSP)`);
    }
}

/** An element; throws on a malformed tag or attribute name, content in a void element, or inline code. */
export function element(tag: string, attributes: HtmlAttributes = {}, children: readonly HtmlNode[] = []): HtmlElement {
    if (!TAG_NAME.test(tag)) {
        throw new Error(`invalid tag name "${tag}"`);
    }
    checkAttributes(tag, attributes);
    checkChildren(tag, children);
    return { tag, attributes, children };
}

function attributeText([name, value]: readonly [string, string | true]): string {
    return value === true ? ` ${name}` : ` ${name}="${escapeAttribute(value)}"`;
}

function openingTag(node: HtmlElement): string {
    return `<${node.tag}${Object.entries(node.attributes).map(attributeText).join('')}>`;
}

/** The content of an element that fits on its own line (nothing, or a single text); null for anything else. */
function inlineText(node: HtmlElement): string | null {
    const [only, ...rest] = node.children;
    if (only === undefined) {
        return '';
    }
    return typeof only === 'string' && rest.length === 0 ? only : null;
}

function renderElement(node: HtmlElement, depth: number): string[] {
    const indent = INDENT.repeat(depth);
    if (VOID_ELEMENTS.has(node.tag)) {
        return [`${indent}${openingTag(node)}`];
    }
    const text = inlineText(node);
    if (text !== null) {
        return [`${indent}${openingTag(node)}${escapeText(text)}</${node.tag}>`];
    }
    return [`${indent}${openingTag(node)}`, ...node.children.flatMap((child) => renderNode(child, depth + 1)), `${indent}</${node.tag}>`];
}

function renderNode(node: HtmlNode, depth: number): string[] {
    return typeof node === 'string' ? [`${INDENT.repeat(depth)}${escapeText(node)}`] : renderElement(node, depth);
}

/** The whole document: the doctype, then `root` (the `<html>` element), one element per line, LF line ends. */
export function renderDocument(root: HtmlElement): string {
    return ['<!DOCTYPE html>', ...renderElement(root, 0), ''].join('\n');
}
