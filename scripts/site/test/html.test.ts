import { describe, expect, it } from 'vitest';

import { element, escapeAttribute, escapeText, renderDocument } from '../src/html.js';

describe('escaping', () => {
    it('happyPath_textAndAttributesAreEscaped', () => {
        expect(escapeText('<b>Tom & "Jerry"</b>')).toBe('&lt;b&gt;Tom &amp; "Jerry"&lt;/b&gt;');
        expect(escapeAttribute(`a"b<c>&d'e`)).toBe(`a&quot;b&lt;c&gt;&amp;d'e`);
    });

    it('badPath_markupInDataStaysText', () => {
        const html = renderDocument(element('html', { lang: 'ro' }, [element('body', {}, ['<script>alert(1)</script>'])]));

        expect(html).toContain('<body>&lt;script&gt;alert(1)&lt;/script&gt;</body>');
        expect(html).not.toContain('<script>');
    });
});

describe('element', () => {
    it('happyPath_buildsANestedDocument', () => {
        const html = renderDocument(
            element('html', { lang: 'ro' }, [
                element('head', {}, [element('meta', { charset: 'utf-8' }), element('title', {}, ['București'])]),
                element('body', {}, [element('div', { id: 'map' }), element('p', {}, ['a', element('b', {}, ['b'])])]),
                element('script', { src: 'x.js', defer: true }),
            ]),
        );

        expect(html).toBe(
            [
                '<!DOCTYPE html>',
                '<html lang="ro">',
                '    <head>',
                '        <meta charset="utf-8">',
                '        <title>București</title>',
                '    </head>',
                '    <body>',
                '        <div id="map"></div>',
                '        <p>',
                '            a',
                '            <b>b</b>',
                '        </p>',
                '    </body>',
                '    <script src="x.js" defer></script>',
                '</html>',
                '',
            ].join('\n'),
        );
    });

    it('badPath_rejectsMalformedNames', () => {
        expect(() => element('Div')).toThrow('invalid tag name "Div"');
        expect(() => element('img onerror', {})).toThrow('invalid tag name');
        expect(() => element('a', { 'on click': 'x' })).toThrow('<a>: invalid attribute name "on click"');
    });

    it('badPath_voidElementsHaveNoContent', () => {
        expect(() => element('meta', {}, ['x'])).toThrow('<meta> is a void element');
    });

    it('badPath_scriptsAndStylesCannotHoldInlineCode', () => {
        expect(() => element('script', {}, ['alert(1)'])).toThrow('<script> must not hold inline code');
        expect(() => element('style', {}, ['body{}'])).toThrow('<style> must not hold inline code');
    });
});
