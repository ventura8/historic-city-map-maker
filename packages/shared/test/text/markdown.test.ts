import { describe, expect, it } from 'vitest';

import { linkTargets, markdownToPlainText, parseMarkdown } from '../../src/text/markdown.js';

describe('parseMarkdown', () => {
    it('happyPath_paragraphsEmphasisAndLinks', () => {
        const document = parseMarkdown(
            '**București** _dispărut_ și *altele*\nrândul doi\r\n\r\n  \nVezi [GitHub](https://github.com/x/y).',
        );

        expect(document).toEqual({
            rejectedLinks: [],
            paragraphs: [
                {
                    type: 'paragraph',
                    children: [
                        { type: 'strong', children: [{ type: 'text', text: 'București' }] },
                        { type: 'text', text: ' ' },
                        { type: 'em', children: [{ type: 'text', text: 'dispărut' }] },
                        { type: 'text', text: ' și ' },
                        { type: 'em', children: [{ type: 'text', text: 'altele' }] },
                        { type: 'break' },
                        { type: 'text', text: 'rândul doi' },
                    ],
                },
                {
                    type: 'paragraph',
                    children: [
                        { type: 'text', text: 'Vezi ' },
                        { type: 'link', href: 'https://github.com/x/y', text: 'GitHub' },
                        { type: 'text', text: '.' },
                    ],
                },
            ],
        });
    });

    it('happyPath_nestedEmphasis', () => {
        expect(parseMarkdown('**a _b_ c**').paragraphs[0]?.children).toEqual([
            {
                type: 'strong',
                children: [
                    { type: 'text', text: 'a ' },
                    { type: 'em', children: [{ type: 'text', text: 'b' }] },
                    { type: 'text', text: ' c' },
                ],
            },
        ]);
    });

    it('happyPath_escapesMakeMarkersLiteral', () => {
        expect(markdownToPlainText('\\*\\*nu\\*\\* \\[x\\](https://a.example) \\_y\\_ c:\\')).toBe(
            '**nu** [x](https://a.example) _y_ c:\\',
        );
    });

    it('badPath_unclosedMarkersStayLiteral', () => {
        expect(parseMarkdown('**a _b c').paragraphs[0]?.children).toEqual([{ type: 'text', text: '**a _b c' }]);
    });

    it('badPath_unclosedOuterMarkerKeepsItsClosedInnerOne', () => {
        expect(parseMarkdown('**a _b_ c').paragraphs[0]?.children).toEqual([
            { type: 'text', text: '**a ' },
            { type: 'em', children: [{ type: 'text', text: 'b' }] },
            { type: 'text', text: ' c' },
        ]);
    });

    it('badPath_markerOpenAtTheEndUnwindsIntoText', () => {
        expect(parseMarkdown('_a **b_ c**').paragraphs[0]?.children).toEqual([
            { type: 'text', text: '_a ' },
            { type: 'strong', children: [{ type: 'text', text: 'b_ c' }] },
        ]);
    });

    it.each([['[x](http://example.org)'], ['[x](javascript:alert(1))'], ['[x](/relative)']])(
        'badPath_nonHttpsLink_%s_isRejectedText',
        (source) => {
            const document = parseMarkdown(source);

            expect(document.paragraphs[0]?.children[0]?.type).toBe('text');
            expect(document.rejectedLinks).toHaveLength(1);
        },
    );

    it('badPath_htmlIsJustText', () => {
        expect(parseMarkdown('<img src=x onerror=alert(1)> <b>bold</b>').paragraphs[0]?.children).toEqual([
            { type: 'text', text: '<img src=x onerror=alert(1)> <b>bold</b>' },
        ]);
    });

    it('badPath_bracketsWithoutATargetAreText', () => {
        expect(markdownToPlainText('[not a link] and [x](no close')).toBe('[not a link] and [x](no close');
    });

    it('badPath_blankSourceHasNoParagraphs', () => {
        expect(parseMarkdown(' \n\n \n').paragraphs).toEqual([]);
    });
});

describe('markdownToPlainText', () => {
    it('happyPath_dropsMarkersKeepsLabelsAndBreaks', () => {
        expect(markdownToPlainText('**A** _b_ [c](https://c.example)\nd\n\ne')).toBe('A b c\nd\n\ne');
    });
});

describe('linkTargets', () => {
    it('happyPath_everyAddressInOrderNestedOrKeptAsText', () => {
        expect(linkTargets('[a](https://a.example/) and **_[b](https://b.example/)_**\n\n[c](javascript:void)')).toEqual([
            'https://a.example/',
            'https://b.example/',
            'javascript:void',
        ]);
        expect(linkTargets('See [old](http://old.example/) and [new](https://new.example/).')).toEqual([
            'https://new.example/',
            'http://old.example/',
        ]);
    });

    it('badPath_plainTextHasNone', () => {
        expect(linkTargets('Ateneul Român, 1888')).toEqual([]);
    });
});
