import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { FIREBASE_TOOLS_VERSION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import { resolvePackage, toolsFolder, type Lockfile, type RootManifest } from '../src/install/tools-lock.js';
import { ROOT } from './support.js';

/** The bundle's `tools/` (docs/research/M6-interfaces.md §1.3): firebase-tools' tree, cut offline from the repository's lockfile. */

const TOOL = 'node_modules/firebase-tools';

function lock(packages: Lockfile['packages']): Lockfile {
    return { lockfileVersion: 3, packages: { '': { name: 'root' }, [TOOL]: { version: FIREBASE_TOOLS_VERSION, dev: true }, ...packages } };
}

const NO_OVERRIDES: RootManifest = {};

/** A tree where firebase-tools needs `matcher`, which the root installs from a vendored copy through an override. */
function vendoredLock(target: string, held = true): Lockfile {
    return lock({
        [TOOL]: { version: FIREBASE_TOOLS_VERSION, dev: true, dependencies: { matcher: '^3.0.0' } },
        'node_modules/matcher': { resolved: target, link: true },
        ...(held ? { [target]: { version: '11.0.3-callable.1', dev: true, dependencies: { expand: '^5.0.0' } } } : {}),
        'node_modules/expand': { version: '5.0.12', devOptional: true },
    });
}

describe('resolvePackage', () => {
    it('happyPath_aPackagesOwnCopyWinsThenEachParentsThenTheRoot', () => {
        const packages = lock({
            'node_modules/a': {},
            'node_modules/b/node_modules/a': {},
            'node_modules/b/node_modules/c/node_modules/d': {},
        }).packages;

        expect(resolvePackage(packages, 'node_modules/b', 'a')).toBe('node_modules/b/node_modules/a');
        expect(resolvePackage(packages, 'node_modules/b/node_modules/c', 'a')).toBe('node_modules/b/node_modules/a');
        expect(resolvePackage(packages, 'node_modules/x', 'a')).toBe('node_modules/a');
        expect(resolvePackage(packages, '', 'missing')).toBeNull();
    });
});

describe('toolsFolder', () => {
    it('happyPath_theToolsTreeHoldsItsDependenciesOptionalOnesAndRequiredPeers', () => {
        const folder = toolsFolder(
            lock({
                [TOOL]: {
                    version: FIREBASE_TOOLS_VERSION,
                    dev: true,
                    dependencies: { dep: '1' },
                    optionalDependencies: { native: '1', gone: '1' },
                    peerDependencies: { peer: '1', loose: '1' },
                    peerDependenciesMeta: { loose: { optional: true } },
                },
                'node_modules/dep': { version: '1.0.0', dev: true, dependencies: { nested: '1' } },
                'node_modules/dep/node_modules/nested': { version: '2.0.0', devOptional: true },
                'node_modules/native': { version: '1.0.0', optional: true },
                'node_modules/peer': { version: '1.0.0' },
                'node_modules/loose': { version: '1.0.0' },
                'node_modules/unrelated': { version: '9.9.9' },
            }),
            NO_OVERRIDES,
        );
        const packageLock = JSON.parse(folder.packageLock) as { packages: Record<string, Record<string, unknown>> };

        expect(Object.keys(packageLock.packages)).toEqual([
            '',
            'node_modules/dep',
            'node_modules/dep/node_modules/nested',
            TOOL,
            'node_modules/native',
            'node_modules/peer',
        ]);
        expect(packageLock.packages['node_modules/dep/node_modules/nested']).toEqual({ version: '2.0.0', optional: true });
        expect(Object.values(packageLock.packages).some((entry) => 'dev' in entry || 'devOptional' in entry)).toBe(false);
        expect(JSON.parse(folder.packageJson)).toEqual({
            name: 'hcm-install-tools',
            version: '1.0.0',
            private: true,
            dependencies: { 'firebase-tools': FIREBASE_TOOLS_VERSION },
            overrides: {},
        });
        expect(folder.vendored).toEqual([]);
    });

    it('happyPath_theRootsOverridesComeAlongSoNpmCiAcceptsTheLock', () => {
        const root: RootManifest = { overrides: { glob: '14.0.3', 'gaxios@6.7.1': { uuid: '11.1.1' }, braces: '$braces' } };

        const packageJson = JSON.parse(toolsFolder(lock({}), root).packageJson) as { overrides: Record<string, unknown> };

        expect(packageJson.overrides).toEqual({ glob: '14.0.3', 'gaxios@6.7.1': { uuid: '11.1.1' } });
    });

    it('happyPath_aVendoredCopyIsLinkedAndCarriedAsTheRootLinksIt', () => {
        const root: RootManifest = { overrides: { matcher: '$matcher', braces: '$braces' } };

        const folder = toolsFolder(vendoredLock('vendor/npm/matcher'), root);
        const packageLock = JSON.parse(folder.packageLock) as { packages: Record<string, Record<string, unknown>> };

        expect(folder.vendored).toEqual(['vendor/npm/matcher']);
        expect(Object.keys(packageLock.packages)).toEqual(['', 'node_modules/expand', TOOL, 'node_modules/matcher', 'vendor/npm/matcher']);
        expect(packageLock.packages['node_modules/matcher']).toEqual({ resolved: 'vendor/npm/matcher', link: true });
        expect(packageLock.packages['vendor/npm/matcher']).toEqual({ version: '11.0.3-callable.1', dependencies: { expand: '^5.0.0' } });
        const dependencies = { 'firebase-tools': FIREBASE_TOOLS_VERSION, matcher: 'file:vendor/npm/matcher' };
        expect(packageLock.packages['']).toEqual({ name: 'hcm-install-tools', version: '1.0.0', dependencies });
        expect(JSON.parse(folder.packageJson)).toMatchObject({ dependencies, overrides: { matcher: '$matcher' } });
    });

    it.each([
        ['a workspace', 'packages/shared', true],
        ['a vendored folder the lockfile lacks', 'vendor/npm/matcher', false],
    ])('badPath_aLinkTheBundleCannotCarryStopsTheBuild (%s)', (_label, target, held) => {
        expect(() => toolsFolder(vendoredLock(target, held), NO_OVERRIDES)).toThrow(
            `node_modules/matcher links to '${target}', which the install bundle cannot carry`,
        );
    });

    it('badPath_aLinkWithoutATargetStopsTheBuild', () => {
        const linked = lock({
            [TOOL]: { version: FIREBASE_TOOLS_VERSION, dependencies: { matcher: '1' } },
            'node_modules/matcher': { link: true },
        });

        expect(() => toolsFolder(linked, NO_OVERRIDES)).toThrow(SiteBuildError);
    });

    it('badPath_aRequiredPackageTheLockfileLacksStopsTheBuild', () => {
        expect(() =>
            toolsFolder(lock({ [TOOL]: { version: FIREBASE_TOOLS_VERSION, dependencies: { missing: '1' } } }), NO_OVERRIDES),
        ).toThrow(SiteBuildError);
    });

    it('badPath_anotherFirebaseToolsIsRefused', () => {
        expect(() => toolsFolder(lock({ [TOOL]: { version: '1.0.0' } }), NO_OVERRIDES)).toThrow(
            `does not hold firebase-tools ${FIREBASE_TOOLS_VERSION}`,
        );
    });

    it('happyPath_theRepositorysOwnLockfileHoldsTheWholeTree', () => {
        const repository = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as Lockfile;
        const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as RootManifest;

        const folder = toolsFolder(repository, rootManifest);
        const packageLock = JSON.parse(folder.packageLock) as { packages: Record<string, { version?: string }> };

        expect(packageLock.packages[TOOL]?.version).toBe(FIREBASE_TOOLS_VERSION);
        expect(Object.keys(packageLock.packages).length).toBeGreaterThan(100);
        expect(Object.keys(packageLock.packages).every((path) => path === '' || /^(node_modules|vendor\/npm)\//.test(path))).toBe(true);
        // GHSA-g3hv-75wg-m249: firebase-tools' minimatch is the vendored 11 (vendor/npm/minimatch/README.md), linked as the root links it.
        expect(folder.vendored).toEqual(['vendor/npm/minimatch']);
        expect(JSON.parse(folder.packageJson)).toMatchObject({
            dependencies: { minimatch: 'file:vendor/npm/minimatch' },
            overrides: { minimatch: '$minimatch' },
        });
        expect(JSON.parse(folder.packageJson)).not.toHaveProperty('overrides.braces');
    });
});
