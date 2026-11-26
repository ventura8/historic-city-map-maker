/** One version everywhere (docs/research/M5-interfaces.md §2.2): the bump and the release scripts' file helpers. */
import { afterEach, describe, expect, it } from 'vitest';

import { ReleaseError, isJsonObject, jsonText, nodeReleaseFiles, readJsonObject } from '../src/files.js';
import { repositoryVersion } from '../src/cdn.js';
import {
    DEPLOY_LOCKFILE,
    DEPLOY_MANIFEST,
    ENGINE_INDEX,
    LOCKFILE,
    PINNED_DOCS,
    bumpDocPins,
    bumpEngineSource,
    bumpLockfile,
    bumpManifest,
    isReleaseVersion,
    planBump,
    workspaceFolders,
} from '../src/versions.js';
import { ROOT, cleanup, fakeRepository, temporaryDir } from './support.js';

afterEach(cleanup);

const WORKSPACES = new Set(['@hcm/shared', '@hcm/ui']);

describe('the release scripts’ files', () => {
    it('happyPath_listsTheSubfoldersOfAFolderSorted', () => {
        const files = nodeReleaseFiles(temporaryDir());
        files.write('packages/ui/package.json', '{}');
        files.write('packages/admin/src/a.ts', '');
        files.write('packages/file.txt', '');

        expect(files.listDirs('packages')).toEqual(['admin', 'ui']);
    });

    it('badPath_aMissingFolderOrAFileHasNoSubfolders', () => {
        const files = nodeReleaseFiles(temporaryDir());
        files.write('a.txt', '');

        expect(files.listDirs('missing')).toEqual([]);
        expect(files.listDirs('a.txt')).toEqual([]);
    });

    it('happyPath_readsAJsonObjectAndWritesItTheWayNpmDoes', () => {
        const files = nodeReleaseFiles(temporaryDir());
        files.write('x.json', jsonText({ name: 'x', list: [1, 2], nested: { a: true } }));

        expect(readJsonObject(files, 'x.json')).toEqual({ name: 'x', list: [1, 2], nested: { a: true } });
        expect(jsonText({ a: [1] })).toBe('{\n    "a": [\n        1\n    ]\n}\n');
        expect(isJsonObject([])).toBe(false);
        expect(isJsonObject(null)).toBe(false);
    });

    it.each([
        ['missing.json', null, 'missing.json is missing'],
        ['broken.json', '{"a":', 'broken.json is not valid JSON'],
        ['array.json', '[]', 'array.json must hold a JSON object'],
    ])('badPath_%s_isRefusedWithItsReason', (path, text, reason) => {
        const files = nodeReleaseFiles(temporaryDir());
        if (text !== null) {
            files.write(path, text);
        }

        expect(() => readJsonObject(files, path)).toThrow(new RegExp(reason));
        expect(() => readJsonObject(files, path)).toThrow(ReleaseError);
    });
});

describe('release versions and workspaces', () => {
    it.each(['1.0.0', '0.0.0', '10.20.30', '1.0.0-beta.1', '1.0.0-rc.0', '2.0.0-rc.10'])('happyPath_%s_isAReleaseVersion', (version) => {
        expect(isReleaseVersion(version)).toBe(true);
    });

    it.each(['v1.0.0', '1.0', '01.0.0', '1.0.0+build', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-beta.01', '1.0.0-rc.1+build', ''])(
        'badPath_%s_isNoReleaseVersion',
        (version) => {
            expect(isReleaseVersion(version)).toBe(false);
        },
    );

    it('happyPath_expandsFoldersAndOneLevelGlobsToTheFoldersWithAManifest', () => {
        const { files } = fakeRepository();

        expect(workspaceFolders(files, ['packages/*', 'functions', 'e2e'])).toEqual(['functions', 'packages/engine', 'packages/shared']);
    });

    it.each([
        [{ packages: ['packages/*'] }, 'must be an array of folder globs'],
        [['packages/*', 3], 'must be an array of folder globs'],
        [['packages/**'], 'is not a folder or <folder>/\\*'],
        [['pack*/x'], 'is not a folder or <folder>/\\*'],
    ])('badPath_workspaces_%j_areRefused', (patterns, reason) => {
        const { files } = fakeRepository();

        expect(() => workspaceFolders(files, patterns)).toThrow(new RegExp(reason));
    });
});

describe('bumping one manifest, a lockfile and the engine', () => {
    it('happyPath_aManifestKeepsItsKeyOrderAndPinsEveryWorkspaceDependency', () => {
        const manifest = {
            name: '@hcm/admin',
            version: '0.0.0',
            private: true,
            dependencies: { '@hcm/shared': '0.0.0', lit: '3.3.3' },
            devDependencies: { '@hcm/ui': '0.0.0' },
            peerDependencies: { '@hcm/shared': '0.0.0' },
            optionalDependencies: 'not an object',
        };

        const bumped = bumpManifest(manifest, '1.0.0', WORKSPACES);

        expect(Object.keys(bumped)).toEqual(Object.keys(manifest));
        expect(bumped).toEqual({
            ...manifest,
            version: '1.0.0',
            dependencies: { '@hcm/shared': '1.0.0', lit: '3.3.3' },
            devDependencies: { '@hcm/ui': '1.0.0' },
            peerDependencies: { '@hcm/shared': '1.0.0' },
        });
        expect(manifest.version).toBe('0.0.0');
    });

    it('happyPath_aLockfileBumpsItsRootAndTheWorkspaceEntriesOnly', () => {
        const lock = {
            version: '0.0.0',
            lockfileVersion: 3,
            packages: {
                '': { name: 'root', version: '0.0.0' },
                'packages/ui': { name: '@hcm/ui', version: '0.0.0', dependencies: { '@hcm/shared': '0.0.0' } },
                'packages/odd': 'not an entry',
                'node_modules/lit': { version: '3.3.3', dependencies: { '@hcm/shared': '0.0.0' } },
            },
        };

        expect(bumpLockfile(lock, '2.1.0', ['packages/ui', 'packages/odd'], WORKSPACES)).toEqual({
            version: '2.1.0',
            lockfileVersion: 3,
            packages: {
                '': { name: 'root', version: '2.1.0' },
                'packages/ui': { name: '@hcm/ui', version: '2.1.0', dependencies: { '@hcm/shared': '2.1.0' } },
                'packages/odd': 'not an entry',
                'node_modules/lit': { version: '3.3.3', dependencies: { '@hcm/shared': '0.0.0' } },
            },
        });
    });

    it('badPath_aLockfileWithoutPackagesIsRefused', () => {
        expect(() => bumpLockfile({ lockfileVersion: 1 }, '1.0.0', [], WORKSPACES)).toThrow(/no `packages` object/);
    });

    it('happyPath_theEngineConstantFollowsTheVersion', () => {
        const source = "/** Engine release. */\nexport const ENGINE_VERSION = '0.0.0';\nexport const OTHER = '0.0.0';\n";

        expect(bumpEngineSource(source, '1.0.0')).toBe(
            "/** Engine release. */\nexport const ENGINE_VERSION = '1.0.0';\nexport const OTHER = '0.0.0';\n",
        );
    });

    it.each([
        ['none', 'export const OTHER = 1;\n', 'found 0'],
        ['two', "export const ENGINE_VERSION = '1';\nexport const ENGINE_VERSION = '2';\n", 'found 2'],
    ])('badPath_%s_engineVersionLinesAreRefused', (_name, source, reason) => {
        expect(() => bumpEngineSource(source, '1.0.0')).toThrow(new RegExp(reason));
    });
});

describe('planBump', () => {
    it('happyPath_rewritesEveryVersionAndNothingElse', () => {
        const { files } = fakeRepository('0.0.0');

        const changes = planBump(files, '1.0.0');
        for (const change of changes) {
            files.write(change.path, change.text);
        }

        const byName = (a: string, b: string): number => a.localeCompare(b);
        expect(changes.map((change) => change.path).sort(byName)).toEqual(
            [
                'package.json',
                'packages/engine/package.json',
                'packages/shared/package.json',
                'functions/package.json',
                LOCKFILE,
                DEPLOY_MANIFEST,
                DEPLOY_LOCKFILE,
                ENGINE_INDEX,
            ].sort(byName),
        );
        expect(readJsonObject(files, 'packages/engine/package.json')).toEqual({
            name: '@hcm/engine',
            version: '1.0.0',
            dependencies: { '@hcm/shared': '1.0.0', firebase: '13.0.0' },
        });
        expect(readJsonObject(files, 'functions/package.json')['devDependencies']).toEqual({ '@hcm/shared': '1.0.0' });
        const lockPackages = readJsonObject(files, LOCKFILE)['packages'] as Record<string, Record<string, unknown>>;
        expect(lockPackages['packages/engine']?.['dependencies']).toEqual({ '@hcm/shared': '1.0.0', firebase: '13.0.0' });
        expect(lockPackages['node_modules/zod']).toEqual({ version: '4.6.6' });
        expect(readJsonObject(files, DEPLOY_MANIFEST)).toEqual({
            name: 'hcm-functions',
            version: '1.0.0',
            dependencies: { sharp: '0.35.5' },
        });
        expect(readJsonObject(files, DEPLOY_LOCKFILE)['version']).toBe('1.0.0');
        expect(files.readText(ENGINE_INDEX)).toContain("export const ENGINE_VERSION = '1.0.0';");
        expect(repositoryVersion(files)).toBe('1.0.0');
        expect(planBump(files, '1.0.0')).toEqual([]);
    });

    it('happyPath_theGuidesNameTheNewReleaseOfTheCli', () => {
        // docs/LESSONS.md 238: a guide names the CLI's exact release, never a major line.
        const { files } = fakeRepository('0.0.0');
        const guide = PINNED_DOCS[0];
        files.write(guide, '`npx create-historic-city@0.0.0 x`, `npm create historic-city@0.0.0`, `create-historic-city@<version>`\n');

        const change = planBump(files, '1.2.3').find((planned) => planned.path === guide);

        expect(change?.text).toBe(
            '`npx create-historic-city@1.2.3 x`, `npm create historic-city@1.2.3`, `create-historic-city@<version>`\n',
        );
        expect(bumpDocPins('my-historic-city@1.0.0 and create-historic-city@1', '2.0.0')).toBe(
            'my-historic-city@1.0.0 and create-historic-city@1',
        );
    });

    it('happyPath_aPreReleaseIsBumpedEverywhereAndItsGuidesNameIt', () => {
        const { files } = fakeRepository('1.0.0');
        const guide = PINNED_DOCS[0];
        files.write(guide, '`npx create-historic-city@1.0.0 x`\n');

        const planned = planBump(files, '1.0.0-beta.1');

        expect(planned.find((change) => change.path === guide)?.text).toBe('`npx create-historic-city@1.0.0-beta.1 x`\n');
        expect(planned.find((change) => change.path === ENGINE_INDEX)?.text).toContain("ENGINE_VERSION = '1.0.0-beta.1';");
        expect(bumpDocPins('`npx create-historic-city@1.0.0-beta.1 x`', '1.0.0-rc.1')).toBe('`npx create-historic-city@1.0.0-rc.1 x`');
    });

    it.each(['v1.0.0', '1.0', 'next', '1.0.0-alpha.1', '1.0.0-beta'])('badPath_%s_isRefusedBeforeAnythingIsRead', (version) => {
        const { files } = fakeRepository();

        expect(() => planBump(files, version)).toThrow(/is not a release version/);
    });

    it('badPath_withoutTheEngineSourceNothingIsPlanned', () => {
        const { files, root } = fakeRepository();
        nodeReleaseFiles(root).remove('packages/engine/src');

        expect(() => planBump(files, '1.0.0')).toThrow(`${ENGINE_INDEX} is missing`);
    });

    it('happyPath_theRepositoryIsAlignedAndItsFilesRoundTripUnchanged', () => {
        // Read only: every version of §2.2 already equals the root's, and the rewrite is byte for byte what npm and Prettier
        // wrote, so the real bump changes versions and nothing else.
        const repository = nodeReleaseFiles(ROOT);

        expect(planBump(repository, repositoryVersion(repository))).toEqual([]);
    });
});
