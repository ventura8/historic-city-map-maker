import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCKER_BUILDER_IMAGE, installManifestSchema } from '@hcm/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import { buildInstallBundle, entryTime, expectedFunctionNames, NODE_STEP_IMAGE, type InstallBundleOptions } from '../src/install/bundle.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, runInstallCli } from '../src/install/cli.js';
import type { SiteFileSystem } from '../src/files.js';
import { cleanup, recordingLogger, repositoryWithTemporaryDist, ROOT, temporaryDir } from './support.js';

/**
 * The install bundle (docs/research/M6-interfaces.md §1.3) from the repository's real inputs, the functions' build and
 * the public Hosting tree faked in a temporary `dist/`: its three tarballs and its manifest, the same bytes twice.
 */

/** The image's own `tar`. */
const TAR = '/usr/bin/tar';
const STEPS = new Map([['steps/steps.mjs', new TextEncoder().encode('export {};\n')]]);
const ENV = { HCM_COMMIT: 'a'.repeat(40), SOURCE_DATE_EPOCH: '1700000000' };
const OPTIONS: InstallBundleOptions = {
    publicTree: 'dist/hosting-public',
    out: ['dist/hosting'],
    functionsDir: 'dist/functions',
    env: ENV,
};

function world() {
    const repository = repositoryWithTemporaryDist();
    repository.files.write('dist/functions/index.js', 'export const admin = {};\n');
    repository.files.write('dist/functions/.env.bucurestiul-disparut', 'HCM_RELEASE=1.0.0+aaaaaaa\n');
    repository.files.write('dist/hosting-public/index.html', '<!doctype html><title>map</title>');
    repository.files.write('dist/hosting-public/admin/index.html', '<!doctype html><title>admin</title>');
    repository.files.write('dist/hosting-public/admin/install/old/manifest.json', '{}');
    return repository;
}

function listing(distRoot: string, path: string): string[] {
    return execFileSync(TAR, ['-tzf', join(distRoot, path)], { encoding: 'utf8' })
        .trim()
        .split('\n');
}

afterEach(cleanup);

describe('buildInstallBundle', () => {
    it('happyPath_theBundleOfThisReleaseIsWrittenWithAManifestTheAdminAccepts', () => {
        const { files, distRoot } = world();

        const report = buildInstallBundle(OPTIONS, files, STEPS);

        const folder = `dist/hosting/admin/install/${report.slug}`;
        const manifest = installManifestSchema.parse(JSON.parse(files.readText(`${folder}/manifest.json`)));
        expect(report.release).toMatch(/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?\+aaaaaaa$/);
        expect(manifest).toMatchObject({
            format: 1,
            release: report.release,
            // Finding 39 of 2026-11-01: the build time, here SOURCE_DATE_EPOCH's.
            releaseTime: 1_700_000_000,
            // The live finding of 2026-11-12: an untagged build is a dev build.
            channel: 'dev',
            projectId: 'bucurestiul-disparut',
            // §67e: the pipeline's Docker builder by digest, so the admin offers Install the pipeline.
            tools: { node: NODE_STEP_IMAGE, docker: DOCKER_BUILDER_IMAGE },
        });
        expect(manifest.functions).toEqual(expectedFunctionNames());
        const server = readFileSync(join(distRoot, `dist/hosting/admin/install/${report.slug}/server.tgz`));
        expect(manifest.files.server).toEqual({
            name: 'server.tgz',
            bytes: server.length,
            sha256: createHash('sha256').update(server).digest('hex'),
        });
    });

    it('happyPath_withoutSourceDateEpochTheCommitsTimeIsTheBuildTime_badPath_noneReadableNamesNone', () => {
        const { files } = world();
        const env = { HCM_COMMIT: 'a'.repeat(40) };
        const manifestOf = (slug: string) =>
            installManifestSchema.parse(JSON.parse(files.readText(`dist/hosting/admin/install/${slug}/manifest.json`)));

        const timed = buildInstallBundle({ ...OPTIONS, env, commitTime: () => 1_761_955_200 }, files, STEPS);
        expect(manifestOf(timed.slug).releaseTime).toBe(1_761_955_200);
        const unknown = buildInstallBundle({ ...OPTIONS, env, commitTime: () => null }, files, STEPS);
        expect(manifestOf(unknown.slug).releaseTime).toBeNull();
    });

    it('happyPath_eachTarballHoldsItsTargetsParts', () => {
        const { files, distRoot } = world();
        const { slug } = buildInstallBundle(OPTIONS, files, STEPS);
        const at = (name: string) => listing(distRoot, `dist/hosting/admin/install/${slug}/${name}`);

        expect(at('server.tgz')).toEqual(
            expect.arrayContaining([
                'functions/dist/index.js',
                'functions/dist/.env.bucurestiul-disparut',
                'firebase.json',
                'firebase/firestore.rules',
                'firebase/storage.rules',
                '.firebaserc',
                'tools/package-lock.json',
                'tools/vendor/npm/minimatch/index.cjs',
                'tools/vendor/npm/minimatch/commonjs/index.js',
                'steps/steps.mjs',
            ]),
        );
        expect(at('pipeline.tgz')).toEqual(
            expect.arrayContaining(['Dockerfile', 'poetry.lock', 'src/hcm_pipeline/__init__.py', 'steps/steps.mjs']),
        );
        expect(at('pipeline.tgz').some((path) => path.includes('tests/') || path.includes('__pycache__'))).toBe(false);
        const hosting = at('hosting.tgz');
        expect(hosting).toEqual(
            expect.arrayContaining([
                'public/index.html',
                'public/admin/index.html',
                'firebase.json',
                'tools/vendor/npm/minimatch/package.json',
            ]),
        );
        expect(hosting.some((path) => path.startsWith('tools/vendor/npm/braces/'))).toBe(false);
        expect(hosting.some((path) => path.startsWith('public/admin/install/'))).toBe(false);
    });

    it('happyPath_theLegacyOriginalsTravelInATarballOfTheirOwn_badPath_aTreeWithoutThemHasNone', () => {
        const { files, distRoot } = world();
        files.write('dist/hosting-public/admin/legacy/bucharest/photos.json', '[]');
        files.write('dist/hosting-public/admin/legacy/bucharest/originals/p-1.jpg', 'jpeg bytes');
        const report = buildInstallBundle(OPTIONS, files, STEPS);
        const folder = `dist/hosting/admin/install/${report.slug}`;
        const manifest = installManifestSchema.parse(JSON.parse(files.readText(`${folder}/manifest.json`)));

        // §73k: the site build fetches them only while the legacy import is not complete; the list stays in hosting.tgz.
        expect(listing(distRoot, `${folder}/legacy.tgz`)).toEqual(['public/admin/legacy/bucharest/originals/p-1.jpg']);
        expect(listing(distRoot, `${folder}/hosting.tgz`)).toContain('public/admin/legacy/bucharest/photos.json');
        expect(listing(distRoot, `${folder}/hosting.tgz`).some((path) => path.includes('/originals/'))).toBe(false);
        expect(manifest.files.legacy).toMatchObject({ name: 'legacy.tgz', bytes: report.bytes.legacy });

        const bare = world();
        const without = buildInstallBundle(OPTIONS, bare.files, STEPS);
        const bareManifest = installManifestSchema.parse(
            JSON.parse(bare.files.readText(`dist/hosting/admin/install/${without.slug}/manifest.json`)),
        );
        expect([without.bytes.legacy, bareManifest.files.legacy]).toEqual([0, undefined]);
    });

    it('happyPath_theBundlesFirebaseConfigsHaveNoPredeployAndTheTreeUnderPublic', () => {
        const { files, distRoot } = world();
        const { slug } = buildInstallBundle(OPTIONS, files, STEPS);
        const dir = temporaryDir();
        execFileSync(TAR, ['-xzf', join(distRoot, `dist/hosting/admin/install/${slug}/hosting.tgz`), '-C', dir, 'firebase.json']);
        const hosting = JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8')) as { hosting: Record<string, unknown> };
        execFileSync(TAR, ['-xzf', join(distRoot, `dist/hosting/admin/install/${slug}/server.tgz`), '-C', dir, 'firebase.json']);
        const server = JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8')) as Record<string, unknown>;

        expect(hosting.hosting['public']).toBe('public');
        expect(hosting.hosting).not.toHaveProperty('predeploy');
        expect(Object.keys(server).toSorted((left, right) => left.localeCompare(right))).toEqual(['firestore', 'functions', 'storage']);
        expect(JSON.stringify(server)).not.toContain('predeploy');
    });
});

describe('buildInstallBundle: what the public server tarball may carry (finding 5 of the M6 security review)', () => {
    it('happyPath_theFunctionsBuildsAllowedFilesAndTheExportKitAreCarried', () => {
        const { files, distRoot } = world();
        files.write('dist/functions/package.json', '{}');
        files.write('dist/functions/package-lock.json', '{}');
        files.write('dist/functions/export-kit/kit.json', '{}');
        files.write('dist/functions/starter/hcm-worker.sh', '#!/bin/sh\n');
        files.write('dist/functions/starter/hcm-worker.bat', '@echo off\r\n');
        const { slug } = buildInstallBundle(OPTIONS, files, STEPS);

        expect(listing(distRoot, `dist/hosting/admin/install/${slug}/server.tgz`).filter((path) => path.startsWith('functions/'))).toEqual(
            expect.arrayContaining([
                'functions/dist/index.js',
                'functions/dist/package.json',
                'functions/dist/package-lock.json',
                'functions/dist/.env.bucurestiul-disparut',
                'functions/dist/export-kit/kit.json',
                'functions/dist/starter/hcm-worker.sh',
                'functions/dist/starter/hcm-worker.bat',
            ]),
        );
    });

    it.each(['.secret.local', '.env.local', 'notes.txt', 'index.js.map', 'starter/other.sh'])(
        'badPath_anyOtherFileFailsTheBuildInsteadOfBeingPublished (%s)',
        (name) => {
            const { files } = world();
            files.write(`dist/functions/${name}`, 'placeholder\n');

            expect(() => buildInstallBundle(OPTIONS, files, STEPS)).toThrow(SiteBuildError);
            expect(() => buildInstallBundle(OPTIONS, files, STEPS)).toThrow(name);
        },
    );
});

describe('buildInstallBundle: determinism and the step image', () => {
    it('happyPath_twoBuildsOfOneCommitGiveTheSameBytes', () => {
        const first = world();
        const second = world();
        const { slug } = buildInstallBundle(OPTIONS, first.files, STEPS);
        buildInstallBundle(OPTIONS, second.files, STEPS);
        const bytes = (root: string) => readFileSync(join(root, `dist/hosting/admin/install/${slug}/manifest.json`), 'utf8');

        expect(bytes(first.distRoot)).toBe(bytes(second.distRoot));
    });

    it.each([
        ['the functions build', 'dist/functions/index.js', '@hcm/functions'],
        ['the public tree', 'dist/hosting-public/index.html', 'build:hosting'],
    ])('badPath_withoutTheInput %s the bundle is not built', (_name, path, hint) => {
        const { files } = world();
        const missing = { ...files, isFile: (candidate: string) => candidate !== path && files.isFile(candidate) };

        expect(() => buildInstallBundle(OPTIONS, missing, STEPS)).toThrow(SiteBuildError);
        expect(() => buildInstallBundle(OPTIONS, missing, STEPS)).toThrow(hint);
    });

    it.each([
        [
            'a rule file',
            (files: SiteFileSystem): SiteFileSystem => ({
                ...files,
                isFile: (path) => path !== 'firebase/storage.rules' && files.isFile(path),
            }),
            'needs firebase/storage.rules',
        ],
        [
            'a project id',
            (files: SiteFileSystem): SiteFileSystem => ({
                ...files,
                readText: (path) => (path === 'infra/project.json' ? '{}' : files.readText(path)),
            }),
            'names no projectId',
        ],
        [
            'a valid project id',
            (files: SiteFileSystem): SiteFileSystem => ({
                ...files,
                readText: (path) => (path === 'infra/project.json' ? '{"projectId":"X"}' : files.readText(path)),
            }),
            'is not valid',
        ],
    ])('badPath_withoutValid %s the bundle is not built', (_name, change, message) => {
        const { files } = world();

        expect(() => buildInstallBundle(OPTIONS, change(files), STEPS)).toThrow(message);
    });

    it('happyPath_anEmptyPartOfTheConfigStaysEmpty', () => {
        const { files, distRoot } = world();
        const config = JSON.parse(files.readText('firebase.json')) as Record<string, unknown>;
        const changed: SiteFileSystem = {
            ...files,
            readText: (path) => (path === 'firebase.json' ? JSON.stringify({ ...config, firestore: null }) : files.readText(path)),
        };
        const { slug } = buildInstallBundle(OPTIONS, changed, STEPS);
        const dir = temporaryDir();
        execFileSync(TAR, ['-xzf', join(distRoot, `dist/hosting/admin/install/${slug}/server.tgz`), '-C', dir, 'firebase.json']);

        expect(JSON.parse(readFileSync(join(dir, 'firebase.json'), 'utf8'))).toMatchObject({ firestore: {} });
    });

    it('happyPath_theStepImageIsTheQualityImagesOwnPin', () => {
        const dockerfile = readFileSync(join(ROOT, 'docker/Dockerfile.quality'), 'utf8');

        expect(dockerfile).toContain(`FROM ${NODE_STEP_IMAGE} AS node`);
        expect([entryTime({}), entryTime({ SOURCE_DATE_EPOCH: 'yesterday' }), entryTime({ SOURCE_DATE_EPOCH: '12' })]).toEqual([0, 0, 12]);
    });
});

describe('runInstallCli', () => {
    it('happyPath_theBundleIsBuiltAndReported', async () => {
        const { files } = world();
        const { log, records } = recordingLogger();

        const status = await runInstallCli(['--functions', 'dist/functions'], {
            files,
            log,
            env: ENV,
            steps: () => Promise.resolve(STEPS),
        });

        expect(status).toBe(EXIT_OK);
        expect(records.find((record) => record.message === 'install bundle built')?.data?.['slug']).toMatch(
            /^\d+-\d+-\d+(?:-(?:beta|rc)-\d+)?-aaaaaaa$/,
        );
    });

    it('badPath_aWrongArgumentIsUsage_aMissingInputIsInvalid', async () => {
        const { files } = world();
        const { log } = recordingLogger();
        const context = { files, log, env: ENV, steps: () => Promise.resolve(STEPS) };

        await expect(runInstallCli(['--nope'], context)).resolves.toBe(EXIT_USAGE);
        await expect(runInstallCli(['--functions', 'dist/none'], context)).resolves.toBe(EXIT_INVALID);
        await expect(runInstallCli([], { ...context, steps: () => Promise.reject(new TypeError('a bug')) })).rejects.toThrow('a bug');
    });
});
