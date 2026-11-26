import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cssLiteralsPlugin, minifyCss, minifyCssLiterals, minifyHtml } from '../src/css-literals.js';
import { ROOT } from './support.js';

describe('minifyCss', () => {
    it('happyPath_indentationCommentsLineBreaksAndTheSpaceAroundPunctuationGo', () => {
        const raw = '\n    :host {\n        display: block; /* the box */\n        font: 400 1rem/1.5 a, b;\n    }\n';

        expect(minifyCss(raw)).toBe(':host{display:block;font:400 1rem/1.5 a,b}');
    });

    it('happyPath_aLineBreakThatMeansASpaceBecomesOne', () => {
        expect(minifyCss('.a\n    .b { margin: 1px\n  2px }')).toBe('.a .b{margin:1px 2px}');
    });

    it('happyPath_aSelectorsDescendantSpaceAndAValuesSpacesStay', () => {
        expect(minifyCss(':host  :focus-visible { margin: calc(100% - 8px)  0 }')).toBe(':host :focus-visible{margin:calc(100% - 8px) 0}');
        expect(minifyCss('@media (min-width: 600px) and (forced-colors: active) { a { color: red !important; } }')).toBe(
            '@media (min-width:600px) and (forced-colors:active){a{color:red!important}}',
        );
    });

    it('happyPath_theSpaceAroundAChildCombinatorASlashAndImportantGoes', () => {
        expect(minifyCss('.a > * { grid-area: 1 / 1 / 2 / 2; box-shadow: 0 1px rgb(0 0 0 / 30%) !important }')).toBe(
            '.a>*{grid-area:1/1/2/2;box-shadow:0 1px rgb(0 0 0/30%)!important}',
        );
        expect(minifyCss('@container v (width >= 600px) { a { b: c } }')).toBe('@container v (width>= 600px){a{b:c}}');
    });

    it('badPath_aSemicolonBeforeAnotherDeclarationAnEmptyValueOrAnInterpolationStays', () => {
        expect(minifyCss('a { --x: ; b: c ; /* last */ }')).toBe('a{--x:;b:c}');
        expect(minifyCss('a { b: c; ', { start: true, end: false })).toBe('a{b:c;');
        expect(minifyCss("a { content: ';}' }")).toBe("a{content:';}'}");
    });

    it('happyPath_theSpaceInsideParenthesesAnIdentifiersQuotesInAnAttributeSelectorAndALeadingZeroGo', () => {
        // The engine's IIFE was 81 bytes gzip over its budget with the timeline's scrolling (2026-11-08): these are 50.
        expect(minifyCss(":host([orientation='vertical']) a { b: calc(\n 100% - 8px\n ) }")).toBe(
            ':host([orientation=vertical]) a{b:calc(100% - 8px)}',
        );
        expect(minifyCss('a { opacity: 0.4; transform: scale(0.9) translate(1px, 0.5px); font: 0.75rem/1.5 x; margin: 1px 0.5px }')).toBe(
            'a{opacity:.4;transform:scale(.9) translate(1px,.5px);font:.75rem/1.5 x;margin:1px .5px}',
        );
    });

    it('badPath_aStringThatIsNoIdentifierOrNoAttributesValueKeepsItsQuotesAndOtherZerosStay', () => {
        expect(minifyCss("[a='b c'] [d='1x'] [e='f' i] { content: 'g'; font-family: 'h' }")).toBe(
            "[a='b c'] [d='1x'] [e='f' i]{content:'g';font-family:'h'}",
        );
        expect(minifyCss('a { b: 10.5px 0 0.x; c: -0.5px; d: x0.5 }')).toBe('a{b:10.5px 0 0.x;c:-0.5px;d:x0.5}');
        expect(minifyCss('0.5px', { start: false, end: true })).toBe('0.5px');
    });

    it('badPath_theSpacesAroundCalcsPlusAndMinusStay', () => {
        expect(minifyCss('a { inline-size: calc(100% - 2 * 8px + 4px) ; }')).toBe('a{inline-size:calc(100% - 2 * 8px + 4px)}');
    });

    it('badPath_stringsEscapesAndAQuoteInACommentAreKept', () => {
        expect(minifyCss('content: \'  two  spaces  \' ; --x: "a ; b";')).toBe('content:\'  two  spaces  \';--x:"a ; b";');
        expect(minifyCss(".sm\\: block { content: '\\201C' }")).toBe(".sm\\: block{content:'\\201C'}");
        expect(minifyCss("a { /* the container's ring */ color: red }")).toBe('a{color:red}');
        expect(minifyCss("a { content: 'not closed")).toBe("a{content:'not closed");
        expect(minifyCss('a { color: red } /* not closed')).toBe('a{color:red}');
        expect(minifyCss('a/b { x: y }')).toBe('a/b{x:y}');
    });

    it('badPath_whitespaceAtAnInterpolationStays', () => {
        expect(minifyCss('  .b { color: ', { start: false, end: false })).toBe(' .b{color:');
        expect(minifyCss(' ;\n', { start: false, end: true })).toBe(';');
        expect(minifyCss(' a ', { start: false, end: false })).toBe(' a ');
        expect(minifyCss(' a ', { start: true, end: true })).toBe('a');
    });
});

describe('minifyHtml', () => {
    it('happyPath_aRunWithALineBreakBecomesOneSpaceAndGoesBeforeATagsEnd', () => {
        expect(minifyHtml('<a\n    href="x"\n    id="y"\n    >text</a\n>\n    <b>')).toBe('<a href="x" id="y">text</a> <b>');
    });

    it('badPath_whitespaceWithoutALineBreakIsContentAndStays', () => {
        expect(minifyHtml('<p>  two  spaces  </p> <b> x</b>')).toBe('<p>  two  spaces  </p> <b> x</b>');
    });
});

describe('minifyCssLiterals', () => {
    it('happyPath_everyCssTemplateWithItsInterpolations', () => {
        const code = [
            "import { css } from 'lit';",
            'const ring = css`',
            '    :focus-visible {',
            '        outline: 3px solid ${unsafeCSS(colour)};',
            '    }',
            '`;',
            'const plain = css`a { color: red }`;',
            'const other = html`<p>  two  spaces  </p>`;',
        ].join('\n');

        const out = minifyCssLiterals(code, 'ring.ts');

        expect(out).toBe(
            [
                "import { css } from 'lit';",
                'const ring = css`:focus-visible{outline:3px solid ${',
                '',
                'unsafeCSS(colour)}}`',
                '',
                ';',
                'const plain = css`a{color:red}`;',
                'const other = html`<p>  two  spaces  </p>`;',
            ].join('\n'),
        );
    });

    it('happyPath_aTemplateWithSeveralInterpolationsKeepsTheSpaceAtEach', () => {
        const code = 'const a = css`${host} .b { margin: ${x}  ${y}; }`;';

        expect(minifyCssLiterals(code, 'a.ts')).toBe('const a = css`${host} .b{margin:${x} ${y}}`;');
    });

    it('happyPath_anHtmlTemplateAndTheOneInsideItKeepEveryLineOfTheModule', () => {
        const code = [
            'const a = html`<ul',
            '    class="x"',
            '>',
            '    ${items.map((item) => html`<li>',
            '        ${item}',
            '    </li>`)}',
            '</ul>`;',
            'after();',
        ].join('\n');

        const out = minifyCssLiterals(code, 'a.ts') ?? '';

        expect(out.split('\n')).toHaveLength(code.split('\n').length);
        expect(out.split('\n').at(-1)).toBe('after();');
        expect(out.replaceAll('\n', '')).toBe(
            'const a = html`<ul class="x"> ${items.map((item) => html`<li> ${item} </li>`)} </ul>`;after();',
        );
        expect(out).toContain('item}');
    });

    it('badPath_anHtmlTemplateWithAPreOrATextareaStaysAsWritten', () => {
        expect(minifyCssLiterals('const a = html`<pre>\n  x\n</pre>`;', 'a.ts')).toBeNull();
        expect(minifyCssLiterals('const a = html`<textarea\n  rows="2"\n></textarea>`;', 'a.ts')).toBeNull();
    });

    it('badPath_aModuleWithoutCssOrAlreadyMinifiedIsLeftAlone', () => {
        expect(minifyCssLiterals('const x = 1;', 'x.ts')).toBeNull();
        expect(minifyCssLiterals('const a = css`a{color:red}`;', 'a.ts')).toBeNull();
        expect(minifyCssLiterals('const a = mycss`a { color: red }`; // css` in a comment', 'a.ts')).toBeNull();
        expect(minifyCssLiterals('const a = other.html`a\n  b`; // html` in a comment', 'a.ts')).toBeNull();
    });

    it('happyPath_aKitElementKeepsItsLinesAndParses', () => {
        const code = readFileSync(join(ROOT, 'packages/ui/src/components/dialog.ts'), 'utf8');

        const out = minifyCssLiterals(code, 'dialog.ts') ?? '';

        expect(out.split('\n')).toHaveLength(code.split('\n').length);
        expect(out.length).toBeLessThan(code.length);
        expect(out).toContain('.actions{display:flex;');
        expect(out).not.toContain('4 px above the actions');
    });
});

describe('cssLiteralsPlugin', () => {
    it('happyPath_transformsTheRepositorysTypeScriptModulesOnly', () => {
        const plugin = cssLiteralsPlugin();
        const code = 'const a = css`a { color: red }`;';

        expect([plugin.name, plugin.enforce]).toEqual(['hcm-css-literals', 'pre']);
        expect(plugin.transform(code, '/repo/packages/ui/src/a.ts?v=1')).toEqual({ code: 'const a = css`a{color:red}`;', map: null });
        expect(plugin.transform(code, '/repo/node_modules/lit/a.ts')).toBeNull();
        expect(plugin.transform(code, '/repo/packages/ui/src/a.css')).toBeNull();
        expect(plugin.transform('const a = 1;', '/repo/packages/ui/src/a.ts')).toBeNull();
    });
});
