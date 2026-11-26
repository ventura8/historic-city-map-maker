import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAdminSite, DEFAULT_ADMIN_DIR, FONTS_FOLDER, STARTER_FOLDER } from '../src/admin/build.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, runAdminCli } from '../src/admin/cli.js';
import { LEGACY_FOLDER } from '../src/admin/legacy.js';
import { ADMIN_SCRIPT_FILE, ADMIN_STYLESHEET_FILE, renderAdminPage } from '../src/admin/page.js';
import { DEFAULT_PROJECT_FILE, PROJECT_FILE } from '../src/admin/project.js';
import { RUNTIME_FILE } from '../src/admin/runtime.js';
import { SiteBuildError } from '../src/errors.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { subresourceIntegrity } from '../src/sri.js';
import { ROOT, cleanup, recordingLogger, repositoryWithTemporaryDist, temporaryDir } from './support.js';

afterEach(cleanup);

const OUT = 'dist/admin';

/** The repository with `dist/` in a temporary folder, plus a stand-in Vite build of the admin in `OUT`. */
function repositoryWithAdminBundle(): { files: SiteFileSystem; dist: SiteFileSystem } {
    const { files, dist } = repositoryWithTemporaryDist();
    files.write(`${OUT}/${ADMIN_SCRIPT_FILE}`, 'bundle');
    files.write(`${OUT}/${ADMIN_STYLESHEET_FILE}`, 'styles');
    return { files, dist };
}

describe('buildAdminSite', () => {
    it('happyPath_addsThePageTheFontsAndTheLegacyBundleNextToTheViteBuild', () => {
        const { files } = repositoryWithAdminBundle();

        const report = buildAdminSite({ outDir: OUT }, files);

        expect(report).toEqual({
            outDir: OUT,
            projectId: 'bucurestiul-disparut',
            release: expect.stringMatching(/^\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?(?:\+[0-9a-f]{7})?$/) as unknown,
            photos: 57,
            originals: 56,
            warnings: 1,
            fonts: 4,
            // The legacy bundle's corrections.json (the old site's later directions) included.
            // The installable app's manifest, three icons and page script (`src/admin/app.ts`) included.
            files: 74,
        });
        const integrity = subresourceIntegrity(files.readBytes('node_modules/mapbox-gl/dist/mapbox-gl.js'));
        expect(files.readText(`${OUT}/index.html`)).toBe(renderAdminPage(undefined, { mapboxGlIntegrity: integrity }));
        expect(files.readText(`${OUT}/index.html`)).toContain(`<html lang="ro" data-mapbox-integrity="${integrity}">`);
        // The checkout's own commit: its build time from git (finding 39 of 2026-11-01), whatever commit is checked out.
        const runtime = JSON.parse(files.readText(`${OUT}/${RUNTIME_FILE}`)) as Record<string, unknown>;
        expect(runtime).toEqual({
            release: report.release,
            channel: expect.stringMatching(/^(release|prerelease|dev)$/) as unknown,
            releaseTime: expect.any(Number) as unknown,
        });
        expect(JSON.parse(files.readText(`${OUT}/${PROJECT_FILE}`))).toEqual(JSON.parse(files.readText(DEFAULT_PROJECT_FILE)));
        expect(files.readText(`${OUT}/${ADMIN_SCRIPT_FILE}`)).toBe('bundle');
        expect(files.isFile(`${OUT}/${LEGACY_FOLDER}/originals/Ferdinand.png`)).toBe(true);
        expect([...files.readBytes(`${OUT}/${LEGACY_FOLDER}/originals/Ferdinand.png`)].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(files.listFiles(`${OUT}/${FONTS_FOLDER}`)).toEqual([
            'LICENSES.md',
            'material-symbols-rounded.woff2',
            'roboto-flex-cyrillic-wght.woff2',
            'roboto-flex-latin-ext-wght.woff2',
            'roboto-flex-latin-wght.woff2',
        ]);
    });

    it('happyPath_theStarterFolderAnEarlierBuildLeftIsRemoved', () => {
        // Finding 73 of 2026-11-03: the server's worker.starter serves the starter files; the admin's folder has none.
        const { files } = repositoryWithAdminBundle();
        files.write(`${OUT}/${STARTER_FOLDER}/hcm-worker.sh`, '#!/bin/sh\n');

        buildAdminSite({ outDir: OUT }, files);

        expect(files.isFile(`${OUT}/${STARTER_FOLDER}/hcm-worker.sh`)).toBe(false);
    });

    it('badPath_withoutTheKitsFontsNothingIsWritten', () => {
        const { files } = repositoryWithAdminBundle();
        files.write('dist/fonts/LICENSES.md', 'licences only');

        expect(() => buildAdminSite({ outDir: OUT, fontsDir: 'dist/fonts' }, files)).toThrow(/^dist\/fonts holds no font and licence/);
        expect(() => buildAdminSite({ outDir: OUT, fontsDir: 'dist/nowhere' }, files)).toThrow(/^dist\/nowhere holds no font/);
        expect(files.isFile(`${OUT}/index.html`)).toBe(false);
    });

    it('happyPath_aRebuildReplacesTheFontsAndTheLegacyBundleOnly', () => {
        const { files } = repositoryWithAdminBundle();
        files.write(`${OUT}/${LEGACY_FOLDER}/originals/stale.jpg`, 'stale');
        files.write(`${OUT}/${FONTS_FOLDER}/stale.woff2`, 'stale');
        files.write(`${OUT}/other.txt`, 'kept');

        buildAdminSite({ outDir: OUT }, files);

        expect(files.isFile(`${OUT}/${LEGACY_FOLDER}/originals/stale.jpg`)).toBe(false);
        expect(files.isFile(`${OUT}/${FONTS_FOLDER}/stale.woff2`)).toBe(false);
        expect(files.readText(`${OUT}/other.txt`)).toBe('kept');
    });

    it('badPath_withoutTheViteBuildNothingIsWritten', () => {
        const { files } = repositoryWithTemporaryDist();
        files.write(`${OUT}/${ADMIN_SCRIPT_FILE}`, 'bundle');

        expect(() => buildAdminSite({ outDir: OUT }, files)).toThrow(
            new SiteBuildError(`${OUT}/${ADMIN_STYLESHEET_FILE} is missing: build the admin first (npm run build --workspace @hcm/admin)`),
        );
        expect(files.isFile(`${OUT}/index.html`)).toBe(false);
    });

    it.each(['packages/admin', 'dist', 'dist/../x', 'site/admin', `${DEFAULT_ADMIN_DIR}/sub`])(
        'badPath_refusesTheOutputFolder_%s',
        (outDir) => {
            const { files } = repositoryWithTemporaryDist();

            expect(() => buildAdminSite({ outDir }, files)).toThrow(
                /^the admin's output folder is packages\/admin\/dist or a folder below dist\//,
            );
        },
    );

    it.each([
        ['dist/project-missing.json', null, /^dist\/project-missing\.json is missing: the admin's Setup Assistant needs the project/],
        ['dist/project-text.json', 'not json', /^dist\/project-text\.json: not JSON/],
        ['dist/project-bad.json', '{"projectId": "X", "cities": []}', /^dist\/project-bad\.json: invalid project file\nprojectId: /],
    ])('badPath_aMissingOrInvalidProjectFileWritesNothing_%s', (projectFile, content, message) => {
        const { files } = repositoryWithAdminBundle();
        if (content !== null) {
            files.write(projectFile, content);
        }

        expect(() => buildAdminSite({ outDir: OUT, projectFile }, files)).toThrow(message);
        expect(files.isFile(`${OUT}/index.html`)).toBe(false);
    });

    it('happyPath_aStartUpDeployWithItsCommitSaysSoInTheRuntimeFile', () => {
        const { files } = repositoryWithAdminBundle();
        const commit = 'ab'.repeat(20);

        const report = buildAdminSite({ outDir: OUT, env: { HCM_ADMIN_START_UP: '1', HCM_COMMIT: commit } }, files);

        expect(report.release).toMatch(/\+abababa$/);
        expect(JSON.parse(files.readText(`${OUT}/${RUNTIME_FILE}`))).toEqual({ release: report.release, channel: 'dev', startUp: true });
    });

    it('badPath_withoutMapboxGlThePageHasNoDigestAndNothingIsWritten', () => {
        const { files } = repositoryWithAdminBundle();

        expect(() => buildAdminSite({ outDir: OUT, mapboxGlDir: 'vendor/none' }, files)).toThrow(
            new SiteBuildError(
                'vendor/none/mapbox-gl.js is missing: install the dependencies (mapbox-gl is a pinned devDependency of @hcm/e2e)',
            ),
        );
        expect(files.isFile(`${OUT}/index.html`)).toBe(false);
    });

    it('badPath_aBrokenSeedLeavesThePreviousBuildAlone', () => {
        const { files } = repositoryWithAdminBundle();
        buildAdminSite({ outDir: OUT }, files);

        expect(() => buildAdminSite({ outDir: OUT, seedDir: 'seed/missing' }, files)).toThrow(SiteBuildError);
        expect(files.isFile(`${OUT}/${LEGACY_FOLDER}/photos.json`)).toBe(true);
    });
});

describe('runAdminCli', () => {
    it('happyPath_buildsIntoTheGivenFolderAndLogsTheReport', () => {
        const { files } = repositoryWithAdminBundle();
        const { log, records } = recordingLogger();

        expect(runAdminCli(['--out', OUT], { files, log, env: { GITHUB_SHA: 'c0ffee'.repeat(6) + 'c0ff' } })).toBe(EXIT_OK);

        expect(records.map((record) => `${record.level} ${record.message} ${String(record.data?.['photos'])}`)).toEqual([
            'info admin site built 57',
        ]);
        expect(records[0]?.data?.['release']).toMatch(/\+c0ffeec$/);
    });

    it('badPath_aMissingBundleIsAnInputError', () => {
        const files = nodeFileSystem(temporaryDir());
        const { log, records } = recordingLogger();

        expect(runAdminCli(['--out', OUT], { files, log })).toBe(EXIT_INVALID);
        expect(records[0]?.message).toMatch(/admin\.mjs is missing/);
    });

    it('badPath_anUnknownOptionIsAUsageError', () => {
        const { log, records } = recordingLogger();

        expect(runAdminCli(['--site', 'x'], { files: nodeFileSystem(temporaryDir()), log })).toBe(EXIT_USAGE);
        expect(records[0]?.message).toBe('usage: build-admin.ts [--out packages/admin/dist] [--seed seed/bucharest]');
    });

    it('badPath_aBugPropagatesWithItsStack', () => {
        const files: SiteFileSystem = {
            ...nodeFileSystem(temporaryDir()),
            isFile: () => {
                throw new TypeError('disk on fire');
            },
        };

        expect(() => runAdminCli([], { files, log: recordingLogger().log })).toThrow(new TypeError('disk on fire'));
    });

    it('happyPath_theEntryRunsUnderNodeTypeStripping', () => {
        const root = temporaryDir();
        const files = nodeFileSystem(root);
        const result = spawnSync(
            process.execPath,
            ['--import', join(ROOT, 'scripts/site/register-ts.mjs'), join(ROOT, 'scripts/site/build-admin.ts'), '--out', OUT],
            { cwd: root, encoding: 'utf8' },
        );

        // An empty folder has no admin build: the entry reports it with exit status 1.
        expect(result.status).toBe(EXIT_INVALID);
        expect(result.stderr + result.stdout).toContain('admin.mjs is missing');
        expect(files.isFile(`${OUT}/index.html`)).toBe(false);
    });
});
