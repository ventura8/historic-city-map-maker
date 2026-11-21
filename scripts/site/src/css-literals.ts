import ts from 'typescript';

/**
 * Minifies the text of Lit's `css` and `html` tagged templates in a module's source before the bundler sees it (the admin's
 * and the engine's Vite builds; `DECISIONS-for-review.md` §36). The bundler's own minifier shortens the JavaScript, but
 * leaves a template literal's text as written: the stylesheets' indentation and comments were about 77 KB of the admin
 * bundle (2026-10-18), and the line breaks and indentation left after that about 6 KB gzip (M8, 2026-11-06).
 *
 * `css`: outside quoted strings, comments go, runs of whitespace become one space, and the whitespace around `{`, `}`, `;`,
 * `,`, `>`, `/` and `!`, after `:` and `(` and before `)` goes, and so does the `;` before a block's `}`; a number's leading
 * zero after a colon, a parenthesis, a comma, a slash or a space goes (`0.5` is `.5`), and an attribute selector's value
 * that is an identifier loses its quotes (`[a='b']` is `[a=b]`: the engine's IIFE was 81 bytes gzip over its budget on
 * 2026-11-08, and these saved 50); any other quoted string and an escaped character are kept as they are. A whitespace at
 * a template's interpolation (`${...}`) stays, as the value there is not known.
 *
 * `html`: a run of whitespace with a line break becomes one space, which reads the same in a text and between attributes,
 * and goes before a `>` (the end of a tag Prettier broke over two lines). A template with a `<pre>` or a `<textarea>`, whose
 * whitespace is its content, stays as written.
 *
 * Every line of the module stays where it was, so the source map needs no change (the transform returns no map: the
 * mappings of the lines hold): the line breaks a part lost move out of the text, into the next `${` or after the closing
 * backtick, where they are whitespace between tokens that had a valid program without them, so no semicolon is inserted.
 */

/**
 * Characters around which whitespace has no meaning in a stylesheet: a block's and a declaration's edges, a list's comma,
 * the child combinator (`a > b`, and a media range's `>=`), the slash of a shorthand or a colour's alpha (`1 / 2`,
 * `rgb(0 0 0 / 30%)`) and `!important`. Not `+`, `-` or `~`: `calc()` needs the spaces around its `+` and `-`.
 */
const TIGHT = new Set(['{', '}', ';', ',', '>', '/', '!']);

/** Whitespace and comments, from where the expression is set to look (`lastIndex`). */
const BLANK = /(?:\s|\/\*[\s\S]*?(?:\*\/|$))+/y;

/** Whether the template's start or end is the literal part's own (not an interpolation's). */
interface Edge {
    readonly start: boolean;
    readonly end: boolean;
}

/** One piece of a stylesheet's text: kept as it is (a string, an escape, a character), or blank (whitespace, comments). */
interface Piece {
    readonly blank: boolean;
    readonly text: string;
    /** An escaped character (`\\:`): the whitespace after it is not after a colon of the stylesheet. */
    readonly escape: boolean;
}

/**
 * Whether whitespace next to these characters has no meaning: around a brace, a semicolon, a comma, after a colon, inside
 * parentheses (not after a `)`: `:host(.a) .b` is a descendant).
 */
function isTight(before: string, after: string): boolean {
    return TIGHT.has(before) || TIGHT.has(after) || before === ':' || before === '(' || after === ')';
}

/** Whether whitespace between `before` and `after` can go (`before` or `after` is '' at the part's edge). */
function droppable(before: string, after: string, edge: Edge): boolean {
    if (isTight(before, after)) {
        return true;
    }
    return before === '' ? edge.start : after === '' && edge.end;
}

function isQuote(char: string): boolean {
    return char === '"' || char === "'";
}

/** The quoted string that starts at `from` (its closing quote included; to the end when it is not closed). */
function stringAt(raw: string, from: number): string {
    const quote = raw.charAt(from);
    let end = from + 1;
    while (end < raw.length && raw.charAt(end) !== quote) {
        end += raw.charAt(end) === '\\' ? 2 : 1;
    }
    return raw.slice(from, end + 1);
}

/** The whitespace and comments that start at `from` ('' when none does). */
function blankAt(raw: string, from: number): string {
    BLANK.lastIndex = from;
    return BLANK.exec(raw)?.[0] ?? '';
}

/** The piece of `raw` at `at`. */
function pieceAt(raw: string, at: number): Piece {
    const char = raw.charAt(at);
    if (isQuote(char)) {
        return { blank: false, text: stringAt(raw, at), escape: false };
    }
    if (char === '\\') {
        return { blank: false, text: raw.slice(at, at + 2), escape: true };
    }
    const blank = blankAt(raw, at);
    return { blank: blank !== '', text: blank === '' ? char : blank, escape: false };
}

/**
 * Whether the piece at `at` is the `;` of a block's last declaration (only whitespace or comments before the block's `}`
 * in this part), which can go; not after a colon (`--x:;`, an empty custom property, keeps it).
 */
function isLastSemicolon(raw: string, at: number, last: string): boolean {
    return raw.charAt(at) === ';' && last !== ':' && raw.charAt(at + 1 + blankAt(raw, at + 1).length) === '}';
}

/** What a blank piece becomes: one space where whitespace means something, else nothing. */
function blankText(before: string, after: string, edge: Edge): string {
    return droppable(before, after, edge) ? '' : ' ';
}

/** A CSS identifier: what an attribute selector's value may be without quotes. */
const IDENTIFIER = /^[A-Za-z_][\w-]*$/;

/** What may stand before a number whose leading zero can go: a colon, a parenthesis, a comma, a slash or a space. */
const BEFORE_NUMBER = /^[:(,/ ]$/;

/** A quoted string: without its quotes as an attribute selector's identifier value (`[a='b']`), else as it is. */
function stringText(raw: string, at: number, text: string, last: string): string {
    const inner = text.slice(1, -1);
    return last === '=' && raw.charAt(at + text.length) === ']' && IDENTIFIER.test(inner) ? inner : text;
}

/** A character, or nothing for a number's leading zero (`0.5` is `.5`) after what may stand before a number. */
function charText(raw: string, at: number, text: string, last: string): string {
    return text === '0' && BEFORE_NUMBER.test(last) && /^\.\d/.test(raw.slice(at + 1, at + 3)) ? '' : text;
}

/** What the piece at `at` writes, after `last` (the character written before it): see `minified`. */
function pieceText(raw: string, at: number, piece: Piece, context: { readonly last: string; readonly edge: Edge }): string {
    if (isLastSemicolon(raw, at, context.last)) {
        return '';
    }
    if (piece.blank) {
        return blankText(context.last, raw.charAt(at + piece.text.length), context.edge);
    }
    const kept = isQuote(piece.text.charAt(0)) ? stringText : charText;
    return kept(raw, at, piece.text, context.last);
}

/**
 * One literal part of a `css` template, as its source spells it (`rawText`), minified (see the module's comment);
 * `edge` says whether its start and its end are the template's own (not an interpolation's).
 */
export function minifyCss(raw: string, edge: Edge = { start: true, end: true }): string {
    return minified(raw, edge);
}

/** `minifyCss` without its default. */
function minified(raw: string, edge: Edge): string {
    let out = '';
    // What a blank sees before it: the last character written, or a backslash after an escape (`\\:` is no colon).
    let last = '';
    for (let at = 0; at < raw.length;) {
        const piece = pieceAt(raw, at);
        out += pieceText(raw, at, piece, { last, edge });
        last = piece.escape ? '\\' : (out.at(-1) ?? '');
        at += piece.text.length;
    }
    return out;
}

/** One literal part of an `html` template, as its source spells it, minified (see the module's comment). */
export function minifyHtml(raw: string): string {
    const [first = '', ...rest] = raw.split('\n');
    return rest.reduce((out, line) => {
        const text = line.trimStart();
        return `${out.trimEnd()}${text.startsWith('>') ? '' : ' '}${text}`;
    }, first);
}

/** What minifies a template's literal parts, by the tag's name. */
const MINIFIERS: Readonly<Partial<Record<string, (raw: string, edge: Edge) => string>>> = { css: minifyCss, html: minifyHtml };

/** An `html` template whose whitespace is content. */
const VERBATIM = /<(?:pre|textarea)\b/;

/** A literal part of a template in the module: where its text is, the delimiter after it, and whether its ends are the template's. */
interface LiteralPart {
    readonly from: number;
    readonly to: number;
    /** The length of the `${` or the backtick after the text: the line breaks the text lost go after it. */
    readonly close: number;
    readonly edge: Edge;
    readonly minify: (raw: string, edge: Edge) => string;
}

type Minify = LiteralPart['minify'];

/** The literal parts of a template (one without interpolations, or the head, middles and tail of one with). */
function partsOf(template: ts.TemplateLiteral, source: ts.SourceFile, minify: Minify): LiteralPart[] {
    if (ts.isNoSubstitutionTemplateLiteral(template)) {
        return [{ from: template.getStart(source) + 1, to: template.end - 1, close: 1, edge: { start: true, end: true }, minify }];
    }
    const head = {
        from: template.head.getStart(source) + 1,
        to: template.head.end - 2,
        close: 2,
        edge: { start: true, end: false },
        minify,
    };
    const spans = template.templateSpans.map((span) => {
        const tail = ts.isTemplateTail(span.literal);
        const close = tail ? 1 : 2;
        return { from: span.literal.getStart(source) + 1, to: span.literal.end - close, close, edge: { start: false, end: tail }, minify };
    });
    return [head, ...spans];
}

/** What minifies this tagged template, or undefined: another tag, or an `html` template whose whitespace is content. */
function minifierOf(node: ts.TaggedTemplateExpression, source: ts.SourceFile): Minify | undefined {
    const tag = ts.isIdentifier(node.tag) ? node.tag.text : '';
    return tag === 'html' && VERBATIM.test(node.template.getText(source)) ? undefined : MINIFIERS[tag];
}

/** Every literal part of every `css` and `html` tagged template in the module, the last in the module first. */
function literalParts(source: ts.SourceFile): LiteralPart[] {
    const parts: LiteralPart[] = [];
    const visit = (node: ts.Node): void => {
        const minify = ts.isTaggedTemplateExpression(node) ? minifierOf(node, source) : undefined;
        if (ts.isTaggedTemplateExpression(node) && minify !== undefined) {
            parts.push(...partsOf(node.template, source, minify));
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return parts.toSorted((a, b) => b.from - a.from);
}

function lineCount(text: string): number {
    return text.split('\n').length;
}

/** `code` with one part's text minified and the line breaks it lost after its delimiter. */
function withPart(code: string, part: LiteralPart): string {
    const raw = code.slice(part.from, part.to);
    const text = part.minify(raw, part.edge);
    const after = part.to + part.close;
    const breaks = '\n'.repeat(lineCount(raw) - lineCount(text));
    return code.slice(0, part.from) + text + code.slice(part.to, after) + breaks + code.slice(after);
}

/** The module with the text of its `css` and `html` templates minified, or null when it has none (or none changes). */
export function minifyCssLiterals(code: string, fileName: string): string | null {
    if (!code.includes('css`') && !code.includes('html`')) {
        return null;
    }
    const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const out = literalParts(source).reduce(withPart, code);
    return out === code ? null : out;
}

/** The Vite plugin: TypeScript modules outside `node_modules`, before the TypeScript transform. */
export function cssLiteralsPlugin(): {
    readonly name: string;
    readonly enforce: 'pre';
    transform(code: string, id: string): { readonly code: string; readonly map: null } | null;
} {
    return {
        name: 'hcm-css-literals',
        enforce: 'pre',
        transform(code, id) {
            const file = id.split('?')[0] ?? id;
            if (!file.endsWith('.ts') || file.includes('/node_modules/')) {
                return null;
            }
            const minified = minifyCssLiterals(code, file);
            return minified === null ? null : { code: minified, map: null };
        },
    };
}
