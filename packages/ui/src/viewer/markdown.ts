/**
 * Renders the Markdown subset of city texts (About, privacy, POI descriptions) and external links as Lit templates.
 * `parseMarkdown` (`@hcm/shared`) has already turned the source into a node tree; this walks it into DOM nodes, so
 * markup in the data stays visible text (security review §1.7, scenarios S-V13-BAD-MARKUP-IS-TEXT and
 * S-V24-BAD-MARKUP-IS-TEXT). Nothing here produces or parses HTML.
 */
import { isHttpsUrl, parseMarkdown, type InlineNode, type MarkdownParagraph } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

/**
 * An external link that opens in a new tab and passes no referrer, opener or endorsement. Only https targets become
 * anchors (the schemas already refuse anything else; this is the second line); any other target shows its label only.
 */
export function externalLink(url: string, label: string): TemplateResult {
    return isHttpsUrl(url) ? html`<a href=${url} target="_blank" rel="noopener noreferrer nofollow ugc">${label}</a>` : html`${label}`;
}

function renderNode(node: InlineNode): TemplateResult {
    if (node.type === 'text') {
        return html`${node.text}`;
    }
    if (node.type === 'break') {
        return html`<br />`;
    }
    if (node.type === 'link') {
        return externalLink(node.href, node.text);
    }
    const children = node.children.map(renderNode);
    return node.type === 'strong' ? html`<strong>${children}</strong>` : html`<em>${children}</em>`;
}

/** One `<p>` of inline nodes (M17: a story's paragraph). */
export function renderParagraph(paragraph: MarkdownParagraph): TemplateResult {
    return html`<p>${paragraph.children.map(renderNode)}</p>`;
}

/** One `<p>` per paragraph of `source`. */
export function renderMarkdown(source: string): TemplateResult {
    return html`${parseMarkdown(source).paragraphs.map(renderParagraph)}`;
}
