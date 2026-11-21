/**
 * The engine's extras (scripts/site/src/engine-extras.ts; DECISIONS-for-review.md §186): each built on its own as a classic
 * script with its integrity, checked against the host, and the engine's `imports.ts` replaced by calls to the loader.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    buildExtras,
    engineExtrasPlugin,
    extraFileName,
    extraProblems,
    exportedNames,
    finishedCode,
    importedBindings,
    importedKeys,
    hostKeyOf,
    importsModuleCode,
    readyFooter,
    type BuiltExtra,
    type EngineExtrasOptions,
} from '../src/engine-extras.js';
import { nodeFileSystem } from '../src/files.js';
import { cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

const INTEGRITY = 'sha384-ab+/cdEFghij';
const FORBIDDEN = /[\\/]forbidden[\\/]/;

/** A tiny engine: one extra that imports a helper of its own and one binding of the host package `host-pkg`. */
function fixture(entry: string): EngineExtrasOptions {
    const root = temporaryDir();
    const fs = nodeFileSystem(root);
    fs.write('src/helper.ts', 'export const helper = (n: number): number => n * 2;\n');
    fs.write('src/entry.ts', entry);
    fs.write('src/host-pkg.ts', "export { shared } from 'host-pkg';\n");
    fs.write('src/forbidden/state.ts', 'export const state = { copies: 1 };\n');
    fs.write('src/imports.ts', "export const extraImports = {\n    theExtra: () => import('./entry.js'),\n};\n");
    return {
        root,
        importsModule: join(root, 'src/imports.ts'),
        runtimeModule: join(root, 'src/runtime.ts'),
        hostKey: 'v9_9_9',
        registry: 'testHost.extras',
        ready: 'testHost.ready',
        extras: [{ name: 'the-extra', global: 'theExtra', entry: join(root, 'src/entry.ts') }],
        host: [{ specifier: 'host-pkg', global: 'testHost.pkg', module: join(root, 'src/host-pkg.ts') }],
        forbidden: FORBIDDEN,
        plugins: () => [],
    };
}

describe('the extras: names, code and the generated module', () => {
    it('happyPath_theFileNameCarriesEightUrlSafeCharactersOfTheIntegrity', () => {
        expect(extraFileName('compare', INTEGRITY)).toBe('extra-compare-ab-_cdEF.js');
    });

    it('happyPath_theCodeEndsWithOneNewlineAsTheReleaseKeepsIt', () => {
        expect(finishedCode('a();')).toBe('a();\n');
        expect(finishedCode('a();\n')).toBe('a();\n');
    });

    it('happyPath_theGeneratedModuleLoadsEachExtraWithItsFileAndIntegrity', () => {
        const built = [
            { extra: { name: 'compare', global: 'compare', entry: '/e.ts' }, fileName: 'extra-compare-x.js', integrity: 'sha384-i' },
        ];

        expect(importsModuleCode('/engine/src/extras/runtime.ts', 'v1_0_0', built as unknown as BuiltExtra[])).toBe(
            [
                'import { loadExtra } from "/engine/src/extras/runtime.ts";',
                'export const extraImports = {',
                '    "compare": () => loadExtra({"host":"v1_0_0","global":"compare","file":"extra-compare-x.js","integrity":"sha384-i"}),',
                '};',
                '',
            ].join('\n'),
        );
    });

    it('happyPath_eachReleaseHasItsOwnEntryOnTheHostAndTheReadyMarkSetsTheExtrasKey', () => {
        expect(hostKeyOf('1.0.0')).toBe('v1_0_0');
        expect(hostKeyOf('1.2.0-beta.1')).toBe('v1_2_0_beta_1');
        expect(readyFooter('testHost.ready', 'the-extra')).toBe(
            '(function(r){r["the-extra"]=!0})(this.testHost.ready=this.testHost.ready||{});',
        );
    });

    it('happyPath_importsAndExportsAreReadFromTheCode', () => {
        const bindings = importedBindings(
            'import{a as b,c}from"lit";import*as n from"x";import"y";import{d,"e-f"as g}from"lit";import h from"z";b(c,n,d,g,h);',
        );

        expect([...bindings]).toEqual([
            ['lit', ['a', 'c', 'd', 'e-f']],
            ['x', ['*']],
            ['y', []],
            ['z', ['default']],
        ]);
        expect([...exportedNames('host.ts', "export { a, b as c, 'd' as e } from 'lit';\nexport const f = 1;\nconst g = 2;\n")]).toEqual([
            'a',
            'c',
            'e',
        ]);
    });
});

describe('the extras: the keys of imports.ts', () => {
    it('happyPath_theKeysAreReadInOrder', () => {
        const source = "export const extraImports = {\n    compare: () => import('a'),\n    'field-sdk': () => import('b'),\n};\n";

        expect(importedKeys('imports.ts', source)).toEqual(['compare', 'field-sdk']);
    });

    it('badPath_anythingButPlainKeysIsNamedSoItCannotMatch', () => {
        const source =
            "import x from 'y';\nexport { x };\nexport const extraImports = { ...x };\nexport const other = 1;\nexport function f() {}\n";

        expect(importedKeys('imports.ts', source)).toEqual(['...']);
    });
});

describe('the extras: what the host must give', () => {
    const extra = { name: 'compare', global: 'compare', entry: '/e.ts' };
    const host = new Map([['lit', new Set(['html', 'css'])]]);

    it('happyPath_anExtraThatTakesOnlyWhatTheHostExportsHasNoProblem', () => {
        const found = { modules: ['/repo/src/compare.ts'], bindings: new Map([['lit', ['html']]]) };

        expect(extraProblems(extra, found, host, FORBIDDEN)).toEqual([]);
    });

    it('badPath_aCopyOfAHostModuleAnUnknownBindingAndAnUnknownPackageAreEachNamed', () => {
        const found = {
            modules: ['/repo/forbidden/lit.js', '/repo/src/compare.ts'],
            bindings: new Map([
                ['lit', ['html', 'svg']],
                ['other', ['x']],
            ]),
        };

        expect(extraProblems(extra, found, host, FORBIDDEN)).toEqual([
            'compare carries /repo/forbidden/lit.js: it must take it from the host',
            'compare imports svg from lit: the host does not export it',
            'compare imports other, which is no host module: bundle it or add it to the host',
        ]);
    });
});

describe('the extras: built', () => {
    it('happyPath_anExtraIsAClassicScriptThatTakesTheHostsBindingAndRegistersItsExports', async () => {
        const options = fixture(
            "import { shared } from 'host-pkg';\nimport { helper } from './helper.js';\nexport const value = helper(shared);\n",
        );

        const [built] = await buildExtras(options);

        expect(built?.fileName).toMatch(/^extra-the-extra-[\w-]{8}\.js$/);
        expect(built?.integrity).toMatch(/^sha384-[\w+/]{64}$/);
        expect(built?.code.endsWith('\n')).toBe(true);
        expect(built?.code).toContain('testHost.extras.theExtra');
        expect(built?.code).toContain('testHost.pkg');
        expect(built?.code).not.toContain('sourceMappingURL');
        expect(built?.map).toContain('helper.ts');
        expect(built?.modules.some((id) => id.endsWith('helper.ts'))).toBe(true);
        expect(built?.code).toMatch(/\.value=/);
        // The ready mark is the script's last statement, after the IIFE that registers the exports.
        expect(built?.code.trimEnd()).toMatch(
            /\.theExtra\|\|\{\}.*\(function\((\w)\)\{\1\.theExtra=!0\}\)\(this\.testHost\.ready=this\.testHost\.ready\|\|\{\}\);$/s,
        );
    }, 60_000);

    it('badPath_anExtraThatImportsWhatTheHostDoesNotExportOrCarriesAHostModuleStopsTheBuild', async () => {
        const missing = fixture("import { other } from 'host-pkg';\nexport const value = other;\n");
        await expect(buildExtras(missing)).rejects.toThrow('the-extra imports other from host-pkg: the host does not export it');

        const renamed = fixture('export const value = 1;\n');
        const other = { name: 'the-extra', global: 'other', entry: join(renamed.root, 'src/entry.ts') };
        await expect(buildExtras({ ...renamed, extras: [other] })).rejects.toThrow(
            'names theExtra; the build makes other: the same keys, in order',
        );

        const copied = fixture("import { state } from './forbidden/state.js';\nexport const value = state;\n");
        await expect(buildExtras(copied)).rejects.toThrow(/the-extra carries .*forbidden[\\/]state\.ts: it must take it from the host/);
    }, 60_000);
});

describe('engineExtrasPlugin', () => {
    it('happyPath_replacesImportsOnlyAndEmitsEachExtraWithItsMap', async () => {
        const options = fixture("import { helper } from './helper.js';\nexport const value = helper(2);\n");
        const plugin = engineExtrasPlugin(options);
        const emitted: string[] = [];

        expect(plugin.load(options.importsModule)).toContain('export const extraImports = {\n};');
        await plugin.buildStart();
        await plugin.buildStart();

        expect(plugin.name).toBe('hcm-engine-extras');
        expect(plugin.load(`${options.importsModule}?v=1`)).toContain('"theExtra": () => loadExtra(');
        expect(plugin.load(join(options.root, 'src/helper.ts'))).toBeNull();
        plugin.generateBundle.call({
            emitFile: (file) => {
                emitted.push(file.fileName);
                return file.fileName;
            },
        });
        expect(emitted).toHaveLength(2);
        expect(emitted[1]).toBe(`${emitted[0] ?? ''}.map`);
        expect(plugin.modules().some((id) => id.endsWith('helper.ts'))).toBe(true);
    }, 60_000);
});
