import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readConfigJs } from '../src/config-js.js';
import { ROOT } from './support.js';

function committed(path: string): string {
    return readFileSync(join(ROOT, path), 'utf8');
}

function config(value: string, target = 'globalThis'): string {
    return `// comment\n${target}.HistoricCityMapConfig = ${value};\n`;
}

describe('readConfigJs', () => {
    it('happyPath_theCommittedSitesAreValid', () => {
        expect(readConfigJs(committed('sites/bucharest/config.js'))).toEqual({ cityId: 'bucharest', manifestUrl: './data/manifest.json' });
        expect(readConfigJs(committed('starter-kit/config.js'))).toEqual({ cityId: 'exemplu', manifestUrl: './data/manifest.json' });
    });

    it('happyPath_windowAndGlobalThisNameTheSameObject', () => {
        expect(readConfigJs(config("{ manifestUrl: 'https://storage.example/m.json', 'lang': `en` }", 'window'))).toEqual({
            manifestUrl: 'https://storage.example/m.json',
            lang: 'en',
        });
    });

    it('happyPath_everyLiteralKindIsData', () => {
        expect(readConfigJs(config("({ manifestUrl: './m.json' })"))).toEqual({ manifestUrl: './m.json' });
        expect(readConfigJs(config("{ manifest: { a: [1, -2.5, 'x', true, false, null, { b: [] }] } }")).manifest).toEqual({
            a: [1, -2.5, 'x', true, false, null, { b: [] }],
        });
    });

    it.each([
        ['a call', '{ manifestUrl: fetchUrl() }', 'CallExpression'],
        ['a variable', '{ manifestUrl: url }', 'Identifier'],
        ['a template with a substitution', '{ manifestUrl: `${base}/m.json` }', 'TemplateExpression'],
        ['a spread', '{ ...defaults }', 'SpreadAssignment'],
        ['a shorthand property', '{ manifestUrl }', 'ShorthandPropertyAssignment'],
        ['a computed key', "{ ['manifest' + 'Url']: './m.json' }", 'ComputedPropertyName'],
        ['a method', '{ manifestUrl() { return 1; } }', 'MethodDeclaration'],
        ['a negated string', "{ zoom: -'1' }", 'PrefixUnaryExpression'],
        ['a logical not', '{ lang: !0 }', 'PrefixUnaryExpression'],
        ['a function', 'function config() {}', 'FunctionExpression'],
    ])('badPath_refuses %s', (_name, value, kind) => {
        expect(() => readConfigJs(config(value))).toThrow(new RegExp(`only literal data is allowed in config\\.js, found ${kind}$`));
    });

    it.each([
        ['nothing', '// only a comment\n'],
        ['another global', "window.OtherConfig = { manifestUrl: './m.json' };"],
        ['another object', "document.HistoricCityMapConfig = { manifestUrl: './m.json' };"],
        ['a compound assignment', "window.HistoricCityMapConfig += { manifestUrl: './m.json' };"],
        ['a declaration', "const HistoricCityMapConfig = { manifestUrl: './m.json' };"],
        ['a call statement', 'alert(1);'],
        ['a bare name', "HistoricCityMapConfig = { manifestUrl: './m.json' };"],
        ['a nested target', "window.top.HistoricCityMapConfig = { manifestUrl: './m.json' };"],
        ['two statements', `${config("{ manifestUrl: './m.json' }")}alert(1);`],
    ])('badPath_refusesAFileWith %s', (_name, source) => {
        expect(() => readConfigJs(source, 'sites/x/config.js')).toThrow('sites/x/config.js: must hold exactly one statement');
    });

    it('badPath_aSyntaxErrorIsReported', () => {
        expect(() => readConfigJs("globalThis.HistoricCityMapConfig = { manifestUrl: './m.json' ")).toThrow(
            /^config\.js: not valid JavaScript: /,
        );
    });

    it('badPath_anInvalidConfigurationListsItsIssues', () => {
        expect(() => readConfigJs(config("{ manifestUrl: 'http://insecure.example/m.json', extra: 1, __proto__: 1 }"))).toThrow(
            /invalid configuration\nmanifestUrl: .*\(validation\.assetUrl\)\nextra: .*\(validation\.unknownKey\)\n__proto__: .*\(validation\.unknownKey\)/,
        );
    });

    it('badPath_bothOrNeitherManifestSourceIsRefused', () => {
        expect(() => readConfigJs(config("{ cityId: 'x' }"))).toThrow('validation.manifestSource');
    });

    it('badPath_aValueThatIsNotAnObjectIsATypeError', () => {
        expect(() => readConfigJs(config("'./m.json'"))).toThrow('(validation.type)');
    });
});
