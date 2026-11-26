/**
 * The text format of a story (M17, `docs/research/M17-stories.md` §3): the Markdown subset of the city's texts
 * (`markdown.ts`) plus one block, a paragraph that is exactly `![caption](photo:<id>)`, which is a figure of one of the city's
 * photos. Anything else that looks like an image stays text, so no address outside the city's photos is ever loaded. The
 * parser returns a tree; nothing here produces HTML.
 */
import { parseMarkdown, type MarkdownParagraph } from './markdown.js';

/** A figure of the city's photo `photoId`; `caption` may be empty. */
export interface StoryFigure {
    readonly type: 'figure';
    readonly photoId: string;
    readonly caption: string;
}

export type StoryBlock = MarkdownParagraph | StoryFigure;

/** A whole paragraph that is one photo figure; the id is `ID_PATTERN`'s, the caption at most 300 characters. */
const FIGURE = /^!\[([^\]\n]{0,300})\]\(photo:([A-Za-z0-9_-]{1,40})\)$/;

/** The text's blocks as written: separated by a blank line, trimmed, none empty. */
function paragraphsOf(source: string): readonly string[] {
    return source
        .replaceAll('\r\n', '\n')
        .split(/\n[ \t]*\n/)
        .map((block) => block.trim())
        .filter((block) => block !== '');
}

function blockOf(block: string): readonly StoryBlock[] {
    const figure = FIGURE.exec(block);
    if (figure !== null) {
        // Both groups are in FIGURE, so they are strings whenever it matches.
        return [{ type: 'figure', photoId: String(figure[2]), caption: String(figure[1]).trim() }];
    }
    return parseMarkdown(block).paragraphs;
}

/** The blocks of a story's text, in order: paragraphs of inline nodes and photo figures. */
export function parseStory(source: string): readonly StoryBlock[] {
    return paragraphsOf(source).flatMap(blockOf);
}

/** Link targets of the text that are not https (kept as literal text): the schema refuses a story with any. */
export function storyRejectedLinks(source: string): readonly string[] {
    return paragraphsOf(source).flatMap((block) => (FIGURE.test(block) ? [] : parseMarkdown(block).rejectedLinks));
}

/** The photo ids of a story's figures, in order and once each. */
export function storyFigureIds(source: string): readonly string[] {
    return [...new Set(parseStory(source).flatMap((block) => (block.type === 'figure' ? [block.photoId] : [])))];
}
