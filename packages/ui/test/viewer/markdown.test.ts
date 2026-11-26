import { render } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { externalLink, renderMarkdown } from '../../src/viewer/markdown.js';

function rendered(source: string): HTMLElement {
    const host = document.createElement('div');
    document.body.append(host);
    render(renderMarkdown(source), host);
    return host;
}

describe('renderMarkdown', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_paragraphsBoldItalicLinksAndBreaks', () => {
        const host = rendered('**Despre** _hartă_ *veche*\na doua linie\n\n[Sursa](https://example.org/despre)');

        const paragraphs = host.querySelectorAll('p');
        expect(paragraphs).toHaveLength(2);
        expect(host.querySelector('strong')?.textContent).toBe('Despre');
        expect([...host.querySelectorAll('em')].map((node) => node.textContent)).toEqual(['hartă', 'veche']);
        expect(host.querySelectorAll('br')).toHaveLength(1);
        const link = host.querySelector('a');
        expect(link?.getAttribute('href')).toBe('https://example.org/despre');
        expect(link?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(link?.textContent).toBe('Sursa');
    });

    it('badPath_markupInTheTextStaysVisibleText', () => {
        const host = rendered('<img src=x onerror="alert(1)"> <b>bold</b> <script>x()</script>');

        expect(host.querySelector('img, b, script')).toBeNull();
        expect(host.textContent).toContain('<img src=x onerror="alert(1)">');
        expect(host.textContent).toContain('<b>bold</b>');
    });

    it('badPath_nonHttpsLinkIsNotAnAnchor', () => {
        const host = rendered('[click](javascript:alert(1)) and [plain](http://example.org)');

        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toContain('[click](javascript:alert(1))');
    });
});

describe('externalLink', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_httpsBecomesASafeAnchor', () => {
        const host = document.createElement('div');
        render(externalLink('https://www.flickr.com/photos/x/1/', 'Flickr'), host);

        expect(host.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer nofollow ugc');
    });

    it('badPath_anyOtherTargetShowsTheLabelOnly', () => {
        const host = document.createElement('div');
        render(externalLink('javascript:alert(1)', 'Flickr'), host);

        expect(host.querySelector('a')).toBeNull();
        expect(host.textContent).toBe('Flickr');
    });
});
