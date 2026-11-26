import { describe, expect, it } from 'vitest';

import { decodeEntities, hrefOf, KNOWN_HTTPS_HOSTS, legacyHtmlToText, tokenizeHtml } from '../../src/migration/html.js';

describe('legacyHtmlToText: the legacy data', () => {
    it('happyPath_sourceAnchorBecomesALink', () => {
        const html =
            '<a href="https://www.facebook.com/uranusdisparut/photos/a.915/915711591783871/?type=3&amp;theater" target="_blank">Cartierul Uranus</a>';

        expect(legacyHtmlToText(html)).toEqual({
            text: 'Cartierul Uranus',
            linkOnly: true,
            links: [
                { url: 'https://www.facebook.com/uranusdisparut/photos/a.915/915711591783871/?type=3&theater', label: 'Cartierul Uranus' },
            ],
            dropped: [],
        });
    });

    it('happyPath_linkListLeadInIsDroppedAndHttpUpgradedForAKnownHost', () => {
        const html = '<p>Alte legături:&nbsp;<a href="http://www.costingheorghe.ro/thenow/intersectia/" target="_blank">thenow</a></p>';

        expect(legacyHtmlToText(html)).toEqual({
            text: '',
            linkOnly: false,
            links: [{ url: 'https://www.costingheorghe.ro/thenow/intersectia/', label: 'thenow' }],
            dropped: [],
        });
    });

    it('happyPath_knownHostsAreTheLegacyOnes', () => {
        expect(KNOWN_HTTPS_HOSTS).toEqual(['facebook.com', 'flickr.com', 'costingheorghe.ro']);
    });
});

describe('legacyHtmlToText: text', () => {
    it('happyPath_inlineLinkTextStaysInTheSentence', () => {
        const result = legacyHtmlToText('Vezi <a href=https://example.org/a>articolul</a> despre stradă.');

        expect(result.text).toBe('Vezi articolul despre stradă.');
        expect(result.linkOnly).toBe(false);
    });

    it('happyPath_onlyTheLeadInClauseIsDropped', () => {
        expect(
            legacyHtmlToText('Vedere spre sud. Vezi și: <a href="https://a.example">A</a>, <a href=\'https://b.example\'>B</a>').text,
        ).toBe('Vedere spre sud.');
    });

    it('happyPath_paragraphsAndBreaks', () => {
        expect(legacyHtmlToText('<p>Unu  doi</p><div>trei<br/>patru</div><ul><li>cinci</li></ul>').text).toBe(
            'Unu doi\n\ntrei\npatru\n\ncinci',
        );
    });

    it('badPath_scriptAndStyleContentIsDiscarded', () => {
        expect(legacyHtmlToText('a<script>alert("x")</script>b<STYLE>p{}</STYLE>c<img src=x onerror=alert(1)>d').text).toBe('abcd');
    });

    it('badPath_unterminatedMarkupIsText', () => {
        expect(legacyHtmlToText('a < b and 3 <> 4 <').text).toBe('a < b and 3 <> 4 <');
    });

    it('badPath_noHtmlNoText', () => {
        expect(legacyHtmlToText('')).toEqual({ text: '', linkOnly: false, links: [], dropped: [] });
    });
});

describe('legacyHtmlToText: links', () => {
    it.each([
        ['<a href="http://unknown.example/x">x</a>', 'http://unknown.example/x'],
        ['<a href="javascript:alert(1)">x</a>', 'javascript:alert(1)'],
        ['<a href="data:text/html,x">x</a>', 'data:text/html,x'],
        ['<a href="https://user:pw@flickr.com/">x</a>', 'https://user:pw@flickr.com/'],
    ])('badPath_unsafeTarget_%s_isDropped', (html, target) => {
        const result = legacyHtmlToText(html);

        expect(result.links).toEqual([]);
        expect(result.dropped).toEqual([target]);
    });

    it('happyPath_duplicatesMergeAndAnEmptyLabelBecomesTheHost', () => {
        const result = legacyHtmlToText('<a href="https://www.flickr.com/a"></a> <a href="https://www.flickr.com/a">again</a>');

        expect(result.links).toEqual([{ url: 'https://www.flickr.com/a', label: 'flickr.com' }]);
    });

    it('happyPath_longLabelsAreShortened', () => {
        const [link] = legacyHtmlToText(`<a href="https://example.org/">${'x'.repeat(300)}</a>`).links;

        expect(link?.label).toHaveLength(200);
        expect(link?.label.endsWith('…')).toBe(true);
    });

    it('badPath_anchorsWithoutHrefAreNotLinks', () => {
        expect(legacyHtmlToText('<a name="top">Sus</a>')).toEqual({ text: 'Sus', linkOnly: false, links: [], dropped: [] });
    });

    it('happyPath_unterminatedAnchorStillCloses', () => {
        expect(legacyHtmlToText('<a href="https://example.org/">open').links).toEqual([{ url: 'https://example.org/', label: 'open' }]);
    });

    it('happyPath_aNewAnchorClosesTheOpenOne', () => {
        expect(
            legacyHtmlToText('<a href="https://a.example/">A<a href="https://b.example/">B</a>').links.map((link) => link.label),
        ).toEqual(['A', 'B']);
    });

    it('happyPath_upgradeHostsCanBeChosen', () => {
        expect(legacyHtmlToText('<a href="http://example.org/x">x</a>', ['example.org']).links[0]?.url).toBe('https://example.org/x');
    });
});

describe('hrefOf', () => {
    it.each([
        ['a href="x y"', 'x y'],
        ["a href='single'", 'single'],
        ['a href=bare target=_blank', 'bare'],
        ['a\nhref\t =  "spaced"', 'spaced'],
        ['a hreflang="ro" href="second"', 'second'],
        ['a href="unclosed', 'unclosed'],
        ['a href="&amp;"', '&'],
        ['a HREF="upper"', 'upper'],
    ])('happyPath_%s', (content, expected) => {
        expect(hrefOf(content)).toBe(expected);
    });

    it.each([['a name="x"'], ['ahref="x"'], ['a hreflang="ro"']])('badPath_%s_hasNoHref', (content) => {
        expect(hrefOf(content)).toBeNull();
    });
});

describe('decodeEntities and tokenizeHtml', () => {
    it.each([
        ['&amp;&lt;&gt;&quot;&apos;', '&<>"\''],
        ['a&nbsp;b', 'a b'],
        ['&#259;&#x103;&#X219;', 'ăăș'],
        ['&unknown; &#0; &#x110000;', '&unknown; &#0; &#x110000;'],
        ['& plain', '& plain'],
    ])('happyPath_%s', (text, expected) => {
        expect(decodeEntities(text)).toBe(expected);
    });

    it('happyPath_tokensInOrder', () => {
        expect(tokenizeHtml('a<P class=x>b</p>')).toEqual([
            { kind: 'text', text: 'a' },
            { kind: 'tag', name: 'p', closing: false, href: null },
            { kind: 'text', text: 'b' },
            { kind: 'tag', name: 'p', closing: true, href: null },
        ]);
    });
});
