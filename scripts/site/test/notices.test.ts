import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem } from '../src/files.js';
import { STANDARD_LICENCE_TEXTS } from '../src/licence-texts.js';
import { NOTICES_FILE, NoticesError, thirdPartyNoticesPlugin, type NoticesOptions } from '../src/notices.js';
import { cleanup, temporaryDir } from './support.js';

type Plugin = ReturnType<typeof thirdPartyNoticesPlugin>;
type Bundle = Parameters<Plugin['generateBundle']>[1];

interface Emitted {
    readonly type: 'asset';
    readonly fileName: string;
    readonly source: string;
}

afterEach(cleanup);

/** A folder with packages under `node_modules`, each written from `files` (path relative to the root -> content). */
function tree(files: Readonly<Record<string, string>>): string {
    const root = temporaryDir();
    const fs = nodeFileSystem(root);
    for (const [path, content] of Object.entries(files)) {
        fs.write(path, content);
    }
    return root;
}

function manifest(name: string, version: string, extra: Readonly<Record<string, unknown>> = { license: 'MIT' }): string {
    return JSON.stringify({ name, version, ...extra });
}

/** One output chunk whose modules render `renderedLength` characters each. */
function chunk(modules: Readonly<Record<string, number>>): Bundle[string] {
    return {
        type: 'chunk',
        modules: Object.fromEntries(Object.entries(modules).map(([id, renderedLength]) => [id, { renderedLength }])),
    };
}

/** Runs the plugin over the bundles, one `generateBundle` each, and returns what it emitted. */
function run(options: NoticesOptions, ...bundles: Bundle[]): Emitted[] {
    const plugin = thirdPartyNoticesPlugin(options);
    const emitted: Emitted[] = [];
    const context = {
        emitFile(file: Emitted): string {
            emitted.push(file);
            return file.fileName;
        },
    };
    for (const bundle of bundles) {
        plugin.generateBundle.call(context, {}, bundle);
    }
    return emitted;
}

function lastText(emitted: readonly Emitted[]): string {
    return emitted.at(-1)?.source ?? '';
}

/** The header lines (`Package:` ... `Notice:`) of every entry, in order. */
function headers(text: string): string[] {
    return text.split('\n').filter((line) => /^(?:Package|Version|Licence|File|Licence text|Notice): /.test(line));
}

describe('thirdPartyNoticesPlugin: the bundled packages', () => {
    it('happyPath_aBundledPackageWithItsOwnLicenceFileGetsItsNameVersionLicenceAndText', () => {
        const root = tree({
            'node_modules/lit-html/package.json': manifest('lit-html', '3.3.3', { license: 'BSD-3-Clause' }),
            'node_modules/lit-html/LICENSE': 'BSD 3-Clause License   \r\n\r\nCopyright (c) 2017 Google LLC\r\n\r\n',
            'node_modules/lit-html/lit-html.js': 'export const html = 1;',
        });

        const emitted = run(
            { product: 'the test build', from: root },
            { 'engine.mjs': chunk({ [join(root, 'node_modules/lit-html/lit-html.js')]: 20 }) },
        );

        expect(emitted.map(({ type, fileName }) => ({ type, fileName }))).toEqual([{ type: 'asset', fileName: NOTICES_FILE }]);
        expect(lastText(emitted)).toBe(
            [
                'Third-party notices for the test build',
                '',
                'Every npm package whose code these files carry, and every package a copied file (a font) comes from, is listed',
                'below with its exact version, its licence and the licence text. Generated at build time from the installed',
                'packages (scripts/site/src/notices.ts); Mapbox GL JS is not part of these files: pages load it from',
                'api.mapbox.com under its own terms.',
                '',
                'Packages: 1',
                '',
                '='.repeat(80),
                'Package: lit-html',
                'Version: 3.3.3',
                'Licence: BSD-3-Clause',
                'Licence text: LICENSE of the package',
                '-'.repeat(80),
                '',
                'BSD 3-Clause License\n\nCopyright (c) 2017 Google LLC',
                '',
            ].join('\n'),
        );
    });

    it('happyPath_onlyModulesThatRenderCodeUnderNodeModulesCountAndTheEntriesAreSorted', () => {
        const root = tree({
            'node_modules/zod/package.json': manifest('zod', '4.6.6'),
            'node_modules/zod/LICENSE': 'MIT zod',
            'node_modules/@lit/reactive-element/package.json': manifest('@lit/reactive-element', '2.1.2', { license: 'BSD-3-Clause' }),
            'node_modules/@lit/reactive-element/LICENSE': 'BSD lit',
            'node_modules/shaken/package.json': manifest('shaken', '1.0.0'),
        });
        const bundle: Bundle = {
            'engine.mjs': chunk({
                [join(root, 'node_modules/zod/index.js?commonjs-es-import')]: 5,
                [join(root, 'node_modules/@lit/reactive-element/css-tag.js')]: 5,
                [join(root, 'node_modules/shaken/index.js')]: 0,
                [join(root, 'packages/ui/src/index.ts')]: 50,
                '\0rolldown/runtime.js': 10,
            }),
            'engine.css': { type: 'asset' },
        };

        const text = lastText(run({ product: 'x', from: root }, bundle));

        expect(headers(text).filter((line) => line.startsWith('Package: '))).toEqual(['Package: @lit/reactive-element', 'Package: zod']);
        expect(text).toContain('Packages: 2\n');
    });

    it('happyPath_severalLicenceFilesAreEachPrintedUnderTheirNameAndTwoInstallsOfOneVersionAreOneEntry', () => {
        const root = tree({
            'node_modules/multi/package.json': manifest('multi', '1.0.0', { license: 'Apache-2.0' }),
            'node_modules/multi/NOTICE': 'Notice text',
            'node_modules/multi/LICENSE.txt': 'Licence text',
            'node_modules/multi/README.md': 'not a licence',
            'node_modules/a/node_modules/multi/package.json': manifest('multi', '1.0.0', { license: 'Apache-2.0' }),
            'node_modules/a/node_modules/multi/LICENSE.txt': 'Licence text',
        });

        const text = lastText(
            run(
                { product: 'x', from: root },
                {
                    'a.js': chunk({
                        [join(root, 'node_modules/multi/i.js')]: 1,
                        [join(root, 'node_modules/a/node_modules/multi/i.js')]: 1,
                    }),
                },
            ),
        );

        expect(headers(text)).toEqual([
            'Package: multi',
            'Version: 1.0.0',
            'Licence: Apache-2.0',
            'Licence text: LICENSE.txt, NOTICE of the package',
        ]);
        expect(text).toContain('LICENSE.txt:\n\nLicence text\n\nNOTICE:\n\nNotice text\n');
    });
});

describe('thirdPartyNoticesPlugin: the engine extras', () => {
    it('happyPath_modulesBuiltApartAreListedAsTheBundlesAre', () => {
        const root = tree({
            'node_modules/web-vitals/package.json': manifest('web-vitals', '6.2.3', { license: 'Apache-2.0' }),
            'node_modules/web-vitals/LICENSE': 'Apache text',
        });
        const extraModules = [join(root, 'node_modules/web-vitals/dist/web-vitals.attribution.js'), join(root, 'src/own.ts')];

        const text = lastText(run({ product: 'x', from: root, moreModules: () => extraModules }, {}));

        expect(headers(text).slice(0, 3)).toEqual(['Package: web-vitals', 'Version: 6.2.3', 'Licence: Apache-2.0']);
    });
});

describe('thirdPartyNoticesPlugin: packages without a licence file', () => {
    it('happyPath_aPackageWithoutALicenceFileGetsItsCopyrightLinesAndTheStandardText', () => {
        const root = tree({
            'node_modules/@firebase/app/package.json': manifest('@firebase/app', '0.16.3', { license: 'Apache-2.0' }),
            'node_modules/@firebase/app/dist/a.js':
                '/**\n * @license\n * Copyright 2019 Google LLC.\n */\nconst c = "Copyright inside code";\n//   Copyright (c) 2021 M. Someone */\n',
            'node_modules/@firebase/app/dist/b.js': '/*! Copyright 2019 Google LLC */\n# Copyright The Closure Library Authors.\n',
        });
        const modules = {
            [join(root, 'node_modules/@firebase/app/dist/a.js')]: 9,
            [join(root, 'node_modules/@firebase/app/dist/b.js')]: 9,
        };

        const text = lastText(run({ product: 'x', from: root }, { 'a.js': chunk(modules) }));

        expect(headers(text)).toEqual([
            'Package: @firebase/app',
            'Version: 0.16.3',
            'Licence: Apache-2.0',
            'Licence text: the standard Apache-2.0 text (the package ships no licence file)',
            'Notice: Copyright (c) 2021 M. Someone',
            'Notice: Copyright 2019 Google LLC',
            'Notice: Copyright The Closure Library Authors',
        ]);
        expect(text).toContain(`${'-'.repeat(80)}\n\n${STANDARD_LICENCE_TEXTS['Apache-2.0'] ?? 'missing'}\n`);
        expect(text).toContain('END OF TERMS AND CONDITIONS');
    });

    it('happyPath_withoutACopyrightLineTheAuthorIsNamedElseItsAuthors', () => {
        const root = tree({
            'node_modules/terra-draw/package.json': manifest('terra-draw', '1.38.0', {
                license: 'MIT',
                author: 'James Milner <j@example.org> (https://example.org)',
            }),
            'node_modules/terra-draw/dist/t.js': 'export {};',
            'node_modules/by-object/package.json': manifest('by-object', '1.0.0', { license: 'MIT', author: { name: 'Jane Doe' } }),
            'node_modules/nobody/package.json': manifest('nobody', '1.0.0', { license: 'MIT', author: '  ' }),
        });
        const modules = {
            [join(root, 'node_modules/terra-draw/dist/t.js')]: 3,
            // A module whose file is gone (a virtual module of a package) adds no line and no error.
            [join(root, 'node_modules/by-object/virtual.js')]: 3,
            [join(root, 'node_modules/nobody/index.js')]: 3,
        };

        const text = lastText(run({ product: 'x', from: root }, { 'a.js': chunk(modules) }));

        expect(headers(text).filter((line) => line.startsWith('Notice: '))).toEqual([
            'Notice: Jane Doe (its author; it ships no copyright notice)',
            "Notice: the package's authors (it ships no copyright notice)",
            'Notice: James Milner (its author; it ships no copyright notice)',
        ]);
        expect(text).toContain(`\n${STANDARD_LICENCE_TEXTS['MIT'] ?? 'missing'}\n`);
    });

    it('happyPath_aPackageWithoutALicenceIdIsListedAsUnknownForTheGateToRefuse', () => {
        const root = tree({
            'node_modules/odd/package.json': manifest('odd', '1.0.0', {}),
            'node_modules/odd/COPYING': 'Some terms',
        });

        const text = lastText(run({ product: 'x', from: root }, { 'a.js': chunk({ [join(root, 'node_modules/odd/i.js')]: 1 }) }));

        expect(headers(text)).toContain('Licence: UNKNOWN');
    });
});

describe('thirdPartyNoticesPlugin: copied files and builds', () => {
    it('happyPath_copiedFilesAreListedUnderTheirPackageFoundUpwardsLikeNode', () => {
        const root = tree({
            'node_modules/material-symbols/package.json': manifest('material-symbols', '0.48.0', { license: 'Apache-2.0' }),
            'node_modules/material-symbols/LICENSE': 'Apache text',
            'node_modules/@fontsource-variable/roboto-flex/package.json': manifest('@fontsource-variable/roboto-flex', '5.3.0', {
                license: 'OFL-1.1',
            }),
            'node_modules/@fontsource-variable/roboto-flex/LICENSE': 'OFL text',
            'packages/engine/package.json': '{}',
        });
        const assets = [
            { package: '@fontsource-variable/roboto-flex', file: 'fonts/roboto-flex-latin-wght.woff2' },
            { package: 'material-symbols', file: 'fonts/material-symbols-rounded.woff2' },
            { package: '@fontsource-variable/roboto-flex', file: 'fonts/roboto-flex-latin-ext-wght.woff2' },
        ];

        const text = lastText(run({ product: 'x', from: join(root, 'packages/engine'), assets }, {}));

        expect(headers(text)).toEqual([
            'Package: @fontsource-variable/roboto-flex',
            'Version: 5.3.0',
            'Licence: OFL-1.1',
            'File: fonts/roboto-flex-latin-ext-wght.woff2',
            'File: fonts/roboto-flex-latin-wght.woff2',
            'Licence text: LICENSE of the package',
            'Package: material-symbols',
            'Version: 0.48.0',
            'Licence: Apache-2.0',
            'File: fonts/material-symbols-rounded.woff2',
            'Licence text: LICENSE of the package',
        ]);
    });

    it('happyPath_withoutAFolderTheCopiedFilesPackagesAreFoundFromTheWorkingDirectory', () => {
        // Vitest runs from the repository root, where the kit's font packages are installed.
        const text = lastText(run({ product: 'x', assets: [{ package: 'material-symbols', file: 'fonts/m.woff2' }] }, {}));

        expect(headers(text).slice(0, 3)).toEqual(['Package: material-symbols', 'Version: 0.49.0', 'Licence: Apache-2.0']);
    });

    it('happyPath_twoOutputsOfOneBuildMakeOneCompleteFileAndANewBuildsPluginStartsAfresh', () => {
        const root = tree({
            'node_modules/a/package.json': manifest('a', '1.0.0'),
            'node_modules/a/LICENSE': 'A',
            'node_modules/b/package.json': manifest('b', '2.0.0'),
            'node_modules/b/LICENSE': 'B',
            'node_modules/b/node_modules/a/package.json': manifest('a', '0.9.0'),
            'node_modules/b/node_modules/a/LICENSE': 'old A',
        });
        const first = { 'engine.iife.js': chunk({ [join(root, 'node_modules/a/i.js')]: 1 }) };
        const second = {
            'engine.mjs': chunk({ [join(root, 'node_modules/b/i.js')]: 1, [join(root, 'node_modules/b/node_modules/a/i.js')]: 1 }),
        };

        const emitted = run({ product: 'x', from: root }, first, second);
        const fresh = run({ product: 'x', from: root }, second);

        expect(emitted).toHaveLength(2);
        expect(headers(lastText(emitted)).filter((line) => /^(?:Package|Version): /.test(line))).toEqual([
            'Package: a',
            'Version: 0.9.0',
            'Package: a',
            'Version: 1.0.0',
            'Package: b',
            'Version: 2.0.0',
        ]);
        expect(lastText(fresh)).toContain('Packages: 2\n');
    });
});

describe('thirdPartyNoticesPlugin: what stops the build', () => {
    it('badPath_aPackageWithoutALicenceFileAndWithoutAStandardTextStopsTheBuild', () => {
        const root = tree({ 'node_modules/rare/package.json': manifest('rare', '1.0.0', { license: 'WTFPL' }) });

        expect(() => run({ product: 'x', from: root }, { 'a.js': chunk({ [join(root, 'node_modules/rare/i.js')]: 1 }) })).toThrow(
            new NoticesError(
                'rare@1.0.0 ships no licence file and declares "WTFPL", which has no standard text in scripts/site/src/licence-texts.ts',
            ),
        );
    });

    it('badPath_aPackageJsonWithoutANameOrVersionStopsTheBuild', () => {
        const root = tree({ 'node_modules/nameless/package.json': JSON.stringify({ version: '1.0.0', license: 'MIT' }) });

        expect(() => run({ product: 'x', from: root }, { 'a.js': chunk({ [join(root, 'node_modules/nameless/i.js')]: 1 }) })).toThrow(
            NoticesError,
        );
    });

    it('badPath_aCopiedFilesPackageThatIsNotInstalledStopsTheBuild', () => {
        const root = tree({ 'packages/engine/package.json': '{}' });

        expect(() => run({ product: 'x', from: root, assets: [{ package: 'nowhere-font-9f2c', file: 'fonts/n.woff2' }] }, {})).toThrow(
            /^the package nowhere-font-9f2c of a copied file is not installed/,
        );
    });
});
