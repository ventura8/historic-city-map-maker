import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, PLACEHOLDER_TOKEN, defaultSites, runCli } from '../src/cli.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { ROOT, cleanup, recordingLogger, temporaryDir } from './support.js';

const ENTRY = join(ROOT, 'scripts/site/build-site.ts');
const HOOK = join(ROOT, 'scripts/site/register-ts.mjs');

/** The sites of the synthetic repository, in build order. */
const SYNTHETIC_SITES = ['sites/bucharest', 'starter-kit'];

/** Both default sites in a temporary root: the starter kit's inputs twice, small media, a fake engine and Mapbox GL. */
function syntheticRepository(): { root: string; files: SiteFileSystem } {
    const root = temporaryDir();
    const files = nodeFileSystem(root);
    const repository = nodeFileSystem(ROOT);
    for (const site of SYNTHETIC_SITES) {
        for (const name of ['site.json', 'config.js', 'site.css']) {
            files.write(`${site}/${name}`, repository.readText(`starter-kit/${name}`));
        }
    }
    files.write('starter-kit/data/manifest.json', repository.readText('starter-kit/data/manifest.json'));
    for (const id of ['mihai-voda-1978', 'realitatea-ilustrata-1934-6-1']) {
        files.write(`seed/bucharest/derived/${id}/web.webp`, 'web');
        files.write(`seed/bucharest/derived/${id}/thumb.webp`, 'thumb');
    }
    for (const name of ['engine.mjs', 'engine.css']) {
        files.write(`packages/engine/dist/${name}`, name);
    }
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'js');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', 'css');
    return { root, files };
}

afterEach(cleanup);

describe('runCli', () => {
    it('happyPath_buildsEveryDefaultSiteWithTheTokenFromTheEnvironment', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli([], { env: { MAPBOX_PUBLIC_TOKEN: 'pk.from-env' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/site/bucharest/data/manifest.json')).toContain('"publicToken":"pk.from-env"');
        expect(files.isFile('dist/site/starter-kit/index.html')).toBe(true);
        expect(records.map((record) => `${record.level} ${record.message} ${String(record.data?.['outDir'])}`)).toEqual([
            'info HCM_PUBLIC_BUCKET is not set: every site bundles its manifest (the seed snapshot) undefined',
            'info site built dist/site/bucharest',
            'info site built dist/site/starter-kit',
        ]);
        expect(JSON.stringify(records)).not.toContain('pk.from-env');
    });

    it('happyPath_withoutATokenThePlaceholderIsUsedAndSaidSo', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--site', 'starter-kit', '--out', 'dist/e2e'], { env: { MAPBOX_PUBLIC_TOKEN: '' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/e2e/starter-kit/data/manifest.json')).toContain(`"publicToken":"${PLACEHOLDER_TOKEN}"`);
        expect(records[0]?.level).toBe('warn');
        expect(records[0]?.message).toContain('MAPBOX_PUBLIC_TOKEN is not set');
    });

    it('happyPath_theBucketFromTheEnvironmentReachesTheSitesThatReadIt', () => {
        const { files } = syntheticRepository();
        const spec = JSON.parse(files.readText('sites/bucharest/site.json')) as Record<string, unknown>;
        files.write('sites/bucharest/site.json', JSON.stringify({ ...spec, publicManifest: true }));
        files.write('infra/project.json', JSON.stringify({ projectId: 'exemplu-proiect', region: 'europe-west1' }));
        const { log, records } = recordingLogger();

        expect(runCli([], { env: { MAPBOX_PUBLIC_TOKEN: 'pk.x', HCM_PUBLIC_BUCKET: 'exemplu-proiect-public' }, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/site/bucharest/config.js')).toContain(
            '"manifestUrl":"https://storage.googleapis.com/exemplu-proiect-public/cities/exemplu/manifest.json"',
        );
        expect(files.isFile('dist/site/bucharest/data/manifest.json')).toBe(false);
        expect(files.isFile('dist/site/starter-kit/data/manifest.json')).toBe(true);
        expect(records[0]).toMatchObject({
            message: 'the sites that read the public bucket use its manifest',
            data: { bucket: 'exemplu-proiect-public' },
        });
    });

    it('badPath_anInputProblemExitsWithOne', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--site', 'sites/nowhere'], { env: {}, files, log })).toBe(EXIT_INVALID);
        expect(records.at(-1)?.level).toBe('error');
        expect(records.at(-1)?.message).toContain('sites/nowhere/site.json is missing');
    });

    it('badPath_anUnknownOptionExitsWithTwo', () => {
        const { files } = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runCli(['--token', 'pk.x'], { env: {}, files, log })).toBe(EXIT_USAGE);
        expect(records[0]?.level).toBe('error');
        expect(records[0]?.message).toContain('usage: build-site.ts');
    });

    it('badPath_aBugIsNotSwallowed', () => {
        const { files } = syntheticRepository();
        const broken: SiteFileSystem = {
            ...files,
            write: () => {
                throw new Error('disk full');
            },
        };

        expect(() => runCli([], { env: {}, files: broken, log: recordingLogger().log })).toThrow('disk full');
    });
});

describe('build-site.ts (the Node entry)', () => {
    it('happyPath_runsUnderNodeWithTheTypeScriptHook', () => {
        const { root, files } = syntheticRepository();

        const result = spawnSync(process.execPath, ['--import', HOOK, ENTRY, '--site', 'starter-kit'], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, MAPBOX_PUBLIC_TOKEN: 'pk.child' },
        });

        // On a failure the diff shows the whole result, stderr included.
        expect(result).toMatchObject({ status: EXIT_OK });
        expect(files.readText('dist/site/starter-kit/data/manifest.json')).toContain('"publicToken":"pk.child"');
    });

    it('badPath_usageErrorsExitWithTwo', () => {
        const result = spawnSync(process.execPath, ['--import', HOOK, ENTRY, '--bogus'], { cwd: temporaryDir(), encoding: 'utf8' });

        expect(result.status).toBe(EXIT_USAGE);
        expect(result.stderr).toContain('usage: build-site.ts');
    });
});

/** A second city's site as `npm run site:add` writes it: no seed manifest, the public bucket's only. */
function addBucketCity(files: SiteFileSystem, cityId: string, pagesPath?: string): void {
    const spec = JSON.parse(files.readText('sites/bucharest/site.json')) as Record<string, unknown>;
    const rest = Object.fromEntries(Object.entries(spec).filter(([key]) => !['manifest', 'media', 'pagesPath'].includes(key)));
    files.write(
        `sites/${cityId}/site.json`,
        JSON.stringify({ ...rest, publicManifest: true, ...(pagesPath === undefined ? {} : { pagesPath }) }),
    );
    files.write(
        `sites/${cityId}/config.js`,
        `window.HistoricCityMapConfig = { cityId: '${cityId}', manifestUrl: './data/manifest.json' };\n`,
    );
    files.write(`sites/${cityId}/site.css`, 'body {}\n');
}

/** The synthetic Bucharest at the root of the Pages tree, as the committed one is. */
function bucharestAtTheRoot(files: SiteFileSystem): void {
    const spec = JSON.parse(files.readText('sites/bucharest/site.json')) as Record<string, unknown>;
    files.write('sites/bucharest/site.json', JSON.stringify({ ...spec, pagesPath: '' }));
}

describe('runCli: every city (M5)', () => {
    it('happyPath_theDefaultSitesAreEveryCityFolderSortedThenTheStarterKit', () => {
        const { files } = syntheticRepository();
        addBucketCity(files, 'cluj');
        files.write('sites/README.md', 'not a site');

        expect(defaultSites(files)).toEqual(['sites/bucharest', 'sites/cluj', 'starter-kit']);
    });

    it('happyPath_aCityWithoutASeedManifestWaitsForTheBucketAndSaysSo', () => {
        const { files } = syntheticRepository();
        addBucketCity(files, 'cluj');
        const { log, records } = recordingLogger();

        expect(runCli([], { env: { MAPBOX_PUBLIC_TOKEN: 'pk.x' }, files, log })).toBe(EXIT_OK);

        expect(files.isFile('dist/site/cluj/index.html')).toBe(false);
        expect(records.map((record) => record.message)).toContain(
            'site not built: it reads the public bucket and HCM_PUBLIC_BUCKET is not set',
        );
    });

    it('happyPath_thePagesTreeHoldsBucharestAtTheRootAndEachCityInItsFolder', () => {
        const { files } = syntheticRepository();
        bucharestAtTheRoot(files);
        addBucketCity(files, 'cluj');
        files.write('infra/project.json', JSON.stringify({ projectId: 'exemplu-proiect', region: 'europe-west1' }));
        const env = { MAPBOX_PUBLIC_TOKEN: 'pk.x', HCM_PUBLIC_BUCKET: 'exemplu-proiect-public' };
        const { log, records } = recordingLogger();

        const status = runCli(['--pages', 'dist/pages'], { env, files, log });

        expect(records.filter((record) => record.level === 'error')).toEqual([]);
        expect(status).toBe(EXIT_OK);
        expect(files.isFile('dist/pages/index.html')).toBe(true);
        expect(files.isFile('dist/pages/engine/engine.mjs')).toBe(true);
        expect(files.readText('dist/pages/cluj/config.js')).toContain('cities/cluj/manifest.json');
        expect(files.readText('dist/pages/cluj/index.html')).toContain('https://storage.googleapis.com');
        expect(files.listFiles('dist/pages').some((path) => path.startsWith('starter-kit/'))).toBe(false);
        expect(records.at(-1)).toMatchObject({ message: 'pages assembled', data: { pagesDir: 'dist/pages', paths: ['/', '/cluj/'] } });
    });

    it('happyPath_thePagesRedirectTreeSendsEveryCitysPagesToHosting', () => {
        // M6 (docs/research/M6-interfaces.md §2.7): the old Pages site's replacement, every page to Firebase Hosting.
        const { files } = syntheticRepository();
        bucharestAtTheRoot(files);
        addBucketCity(files, 'cluj');
        const project = { projectId: 'exemplu-proiect', region: 'europe-west1', github: { owner: 'exemplu', repo: 'harta' } };
        files.write('infra/project.json', JSON.stringify(project));
        const env = { MAPBOX_PUBLIC_TOKEN: 'pk.x', HCM_PUBLIC_BUCKET: 'exemplu-proiect-public' };
        const { log, records } = recordingLogger();

        expect(runCli(['--pages-redirect', 'dist/pages-redirect'], { env, files, log })).toBe(EXIT_OK);

        expect(files.readText('dist/pages-redirect/cluj/index.html')).toContain('data-target="https://exemplu-proiect.web.app/cluj/"');
        expect(files.readText('dist/pages-redirect/index.html')).toContain('<script src="/harta/pages-redirect.js">');
        expect(records.at(-1)).toMatchObject({ message: 'pages redirect written', data: { target: 'https://exemplu-proiect.web.app/' } });
    });

    it('badPath_twoSitesOnOnePathRefuseTheTree', () => {
        const { files } = syntheticRepository();
        addBucketCity(files, 'cluj', 'bucharest/');
        files.write('infra/project.json', JSON.stringify({ projectId: 'exemplu-proiect', region: 'europe-west1' }));
        const { log, records } = recordingLogger();

        expect(runCli(['--pages', 'dist/pages'], { env: { HCM_PUBLIC_BUCKET: 'exemplu-proiect-public' }, files, log })).toBe(EXIT_INVALID);

        expect(records.at(-1)?.message).toContain('two sites ask for the Pages path "/bucharest/"');
        expect(files.isFile('dist/pages/index.html')).toBe(false);
    });
});
