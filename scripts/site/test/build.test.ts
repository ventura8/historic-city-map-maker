import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseManifestJson } from '@hcm/shared';
import { DEFAULT_TAB_ICONS } from '@hcm/shared/tab-icon';

import { buildSite, type SiteBuildOptions } from '../src/build.js';
import { readConfigJs } from '../src/config-js.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { subresourceIntegrity } from '../src/sri.js';
import { readRepositoryJson } from './manifests.js';
import { ROOT, cleanup, htmlValidateMessages, repositoryWithTemporaryDist, temporaryDir } from './support.js';

const TOKEN = 'pk.e2e-fake-token';
const ENGINE_FILES = ['engine.css', 'engine.iife.js', 'engine.mjs', 'fonts/symbols.woff2'];
/** The installable app's files beside every page: app.webmanifest, its three icons, sw.js and app-build.json (`src/app.ts`). */
/** The installable app's files beside every page: app.webmanifest, its three icons and sw.js (`src/app.ts`). */
const APP_FILES = 6;

function fakeEngine(files: SiteFileSystem, dir: string): void {
    for (const name of ENGINE_FILES) {
        files.write(`${dir}/${name}`, `/* ${name} */\n`);
    }
}

/** A complete site in a temporary root: the starter kit's inputs, small media, a fake engine and Mapbox GL. */
function syntheticRoot(): { root: string; files: SiteFileSystem; options: SiteBuildOptions } {
    const root = temporaryDir();
    const files = nodeFileSystem(root);
    const repository = nodeFileSystem(ROOT);
    for (const name of ['site.json', 'config.js', 'site.css', 'data/manifest.json']) {
        files.write(`starter-kit/${name}`, repository.readText(`starter-kit/${name}`));
    }
    for (const id of ['mihai-voda-1978', 'realitatea-ilustrata-1934-6-1']) {
        files.write(`seed/bucharest/derived/${id}/web.webp`, `web ${id}`);
        files.write(`seed/bucharest/derived/${id}/thumb.webp`, `thumb ${id}`);
    }
    fakeEngine(files, 'packages/engine/dist');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'mapbox js');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', 'mapbox css');
    return { root, files, options: { siteDir: 'starter-kit', outDir: 'dist/site/starter-kit', token: TOKEN } };
}

afterEach(cleanup);

describe('buildSite (the committed sites)', () => {
    it('happyPath_buildsBucharestFromItsCommittedInputs', async () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');

        const report = buildSite(
            { siteDir: 'sites/bucharest', outDir: 'dist/site/bucharest', token: TOKEN, engineDir: 'dist/engine' },
            files,
        );

        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');
        // The old site's 2023 additions join the 45 (site.json → additions): 57 photos.
        const additions = readRepositoryJson('seed/bucharest-2023/manifest.static.json');
        const photoCount = (seed['photos'] as unknown[]).length + (additions['photos'] as unknown[]).length;
        expect(photoCount).toBe(57);
        expect(report).toEqual({
            outDir: 'dist/site/bucharest',
            cityId: 'bucharest',
            photos: photoCount,
            // The page's five and the installable app's six (its manifest, three icons, sw.js and app-build.json).
            files: 5 + APP_FILES + photoCount * 2 + ENGINE_FILES.length,
        });
        const out = dist.listFiles('dist/site/bucharest');
        expect(out).toEqual(
            expect.arrayContaining(['index.html', 'config.js', 'site.css', 'data/manifest.json', 'engine/fonts/symbols.woff2']),
        );
        expect(await htmlValidateMessages(dist.readText('dist/site/bucharest/index.html'))).toEqual([]);
        expect(dist.readText('dist/site/bucharest/config.js')).toBe(readFileSync(join(ROOT, 'sites/bucharest/config.js'), 'utf8'));
        const served = parseManifestJson(dist.readText('dist/site/bucharest/data/manifest.json'));
        expect(served.ok).toBe(true);
        const photo = served.ok ? served.value.photos[0] : undefined;
        expect(served.ok && served.value.city.mapbox.publicToken).toBe(TOKEN);
        // The legacy manifest names `bucuresti`; the site serves it as the project's city (site.json → legacyCityId).
        expect((seed['city'] as Record<string, unknown>)['id']).toBe('bucuresti');
        expect(served.ok && served.value.city.id).toBe('bucharest');
        expect(dist.readBytes(`dist/site/bucharest/data/${String(photo?.image.web)}`)).toEqual(
            readFileSync(join(ROOT, 'seed/bucharest/derived', String(photo?.id), 'web.webp')),
        );
        const photos = served.ok ? served.value.photos : [];
        const added = photos.find((one) => one.id === 'strada-gradinarilor');
        expect(dist.readBytes(`dist/site/bucharest/data/${String(added?.image.thumb)}`)).toEqual(
            readFileSync(join(ROOT, 'seed/bucharest-2023/derived/strada-gradinarilor/thumb.webp')),
        );
        // The old site later moved Parc Ferdinand and gave it a cone (seed/bucharest-2023/corrections.json).
        expect(photos.find((one) => one.id === 'parcul-ferdinand-1930')).toMatchObject({
            location: { lat: 44.448183, lng: 26.139431 },
            bearing: 219.1,
            fov: 50,
        });
        expect(served.ok && served.value.city.credits[0]?.label.ro).toContain('Studiourile Buftea');
        expect(served.ok && served.value.city.credits[0]?.label.ro).toContain('Dan Perry');
    });

    it('happyPath_pinsTheIntegrityOfThePinnedMapboxRelease', () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');

        buildSite({ siteDir: 'starter-kit', outDir: 'dist/site/starter-kit', token: TOKEN, engineDir: 'dist/engine' }, files);

        const html = dist.readText('dist/site/starter-kit/index.html');
        expect(html).toContain(`integrity="${subresourceIntegrity(readFileSync(join(ROOT, 'node_modules/mapbox-gl/dist/mapbox-gl.js')))}"`);
        expect(html).not.toContain('mapbox-gl.css');
        expect(html).toContain('<title>Orașul meu</title>');
    });

    it('happyPath_aGivenManifestReplacesTheSiteOneAndShapesTheCsp', () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');
        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');
        const city = { ...(seed['city'] as Record<string, unknown>), analytics: { errorEndpoint: 'https://telemetry.e2e.test/report' } };

        buildSite(
            {
                siteDir: 'sites/bucharest',
                outDir: 'dist/e2e/bucharest',
                token: TOKEN,
                engineDir: 'dist/engine',
                manifest: { ...seed, city },
            },
            files,
        );

        expect(dist.readText('dist/e2e/bucharest/index.html')).toMatch(/connect-src [^;]* https:\/\/telemetry\.e2e\.test;/);
        expect(dist.readText('dist/e2e/bucharest/data/manifest.json')).toContain('"errorEndpoint":"https://telemetry.e2e.test/report"');
    });
});

describe('buildSite (bad inputs)', () => {
    it('happyPath_aSyntheticSiteBuilds', () => {
        const { files, options } = syntheticRoot();

        expect(buildSite(options, files).files).toBe(5 + APP_FILES + 4 + ENGINE_FILES.length);
        expect(files.readText('dist/site/starter-kit/data/media/mihai-voda-1978/thumb.webp')).toBe('thumb mihai-voda-1978');
    });

    it.each(['.', 'dist', 'dist/', 'dist/.', 'dist/../outside', 'dist/a/../..', 'build/site', '/srv/site', 'dist/a b'])(
        'badPath_refusesTheOutputFolder %s',
        (outDir) => {
            const { files, options } = syntheticRoot();
            files.write('keep.txt', 'kept');

            expect(() => buildSite({ ...options, outDir }, files)).toThrow('the output folder must be below dist/');
            expect(files.readText('keep.txt')).toBe('kept');
        },
    );

    it('badPath_withoutTheEngineBuildThePreviousOutputStays', () => {
        const { files, options } = syntheticRoot();
        files.write('dist/site/starter-kit/previous.txt', 'previous');
        files.remove('packages/engine/dist');
        files.write('packages/engine/dist/engine.css', '');

        expect(() => buildSite(options, files)).toThrow('packages/engine/dist/engine.mjs is missing: build the engine first');
        expect(files.readText('dist/site/starter-kit/previous.txt')).toBe('previous');
    });

    it('badPath_aMissingPhotoFileIsNamed', () => {
        const { files, options } = syntheticRoot();
        files.remove('seed/bucharest/derived/realitatea-ilustrata-1934-6-1');

        expect(() => buildSite(options, files)).toThrow(
            'seed/bucharest/derived/realitatea-ilustrata-1934-6-1/web.webp is missing: a photo derivative of starter-kit/data/manifest.json',
        );
    });

    it('badPath_aConfigForAnotherCityIsRefused', () => {
        const { files, options } = syntheticRoot();
        files.write(
            'starter-kit/config.js',
            "globalThis.HistoricCityMapConfig = { cityId: 'bucuresti', manifestUrl: './data/manifest.json' };",
        );

        expect(() => buildSite(options, files)).toThrow(
            'starter-kit/config.js: cityId "bucuresti" does not match the manifest\'s city "exemplu"',
        );
    });

    it('happyPath_aManifestNamingTheLegacyCityIsServedAsTheConfigsCity', () => {
        const { files, options } = syntheticRoot();
        const spec = JSON.parse(files.readText('starter-kit/site.json')) as Record<string, unknown>;
        files.write('starter-kit/site.json', JSON.stringify({ ...spec, legacyCityId: 'exemplu' }));
        files.write(
            'starter-kit/config.js',
            "globalThis.HistoricCityMapConfig = { cityId: 'orasul-meu', manifestUrl: './data/manifest.json' };",
        );

        expect(buildSite(options, files).cityId).toBe('orasul-meu');
        expect(files.readText('dist/site/starter-kit/data/manifest.json')).toContain('"id":"orasul-meu"');
    });

    it('badPath_aLegacyCityIdDoesNotExcuseAnotherCity', () => {
        const { files, options } = syntheticRoot();
        const spec = JSON.parse(files.readText('starter-kit/site.json')) as Record<string, unknown>;
        files.write('starter-kit/site.json', JSON.stringify({ ...spec, legacyCityId: 'bucuresti' }));
        files.write(
            'starter-kit/config.js',
            "globalThis.HistoricCityMapConfig = { cityId: 'orasul-meu', manifestUrl: './data/manifest.json' };",
        );

        expect(() => buildSite(options, files)).toThrow(
            'starter-kit/config.js: cityId "orasul-meu" does not match the manifest\'s city "exemplu"',
        );
    });

    it('badPath_aLegacyCityIdWithoutAConfigCityChangesNothing', () => {
        const { files, options } = syntheticRoot();
        const spec = JSON.parse(files.readText('starter-kit/site.json')) as Record<string, unknown>;
        files.write('starter-kit/site.json', JSON.stringify({ ...spec, legacyCityId: 'exemplu' }));
        files.write('starter-kit/config.js', "globalThis.HistoricCityMapConfig = { manifestUrl: './data/manifest.json' };");

        expect(buildSite(options, files).cityId).toBe('exemplu');
    });

    it('badPath_anUnreadableManifestIsReported', () => {
        const { files, options } = syntheticRoot();
        files.write('starter-kit/data/manifest.json', '{ not json');

        expect(() => buildSite(options, files)).toThrow(/^starter-kit\/data\/manifest\.json: cannot read the manifest/);
    });

    it('badPath_aMissingStylesheetIsReported', () => {
        const { files, options } = syntheticRoot();
        files.remove('starter-kit');
        const repository = nodeFileSystem(ROOT);
        for (const name of ['site.json', 'config.js', 'data/manifest.json']) {
            files.write(`starter-kit/${name}`, repository.readText(`starter-kit/${name}`));
        }

        expect(() => buildSite(options, files)).toThrow('starter-kit/site.css is missing');
    });

    it('badPath_withoutMapboxGlThereIsNoIntegrity', () => {
        const { files, options } = syntheticRoot();

        expect(() => buildSite({ ...options, mapboxGlDir: 'vendor/none' }, files)).toThrow(
            'vendor/none/mapbox-gl.js is missing: install the dependencies',
        );
    });
});

describe('buildSite (the manifest the admin publishes, DECISIONS-for-review.md §51e)', () => {
    const BUCKET = 'bucurestiul-disparut-public';

    /** The synthetic starter kit, reading the public bucket (`publicManifest`), in a project of the given file. */
    function readingTheBucket(
        project: string | null = '{"projectId":"exemplu-proiect","region":"europe-west1"}',
    ): ReturnType<typeof syntheticRoot> {
        const root = syntheticRoot();
        const spec = JSON.parse(root.files.readText('starter-kit/site.json')) as Record<string, unknown>;
        root.files.write('starter-kit/site.json', JSON.stringify({ ...spec, publicManifest: true }));
        if (project !== null) {
            root.files.write('infra/project.json', project);
        }
        return root;
    }

    it('happyPath_bucharestReadsTheBucketsManifestAndBundlesNoSnapshot', () => {
        const { files, dist } = repositoryWithTemporaryDist();
        fakeEngine(files, 'dist/engine');

        const report = buildSite(
            { siteDir: 'sites/bucharest', outDir: 'dist/site/bucharest', token: TOKEN, engineDir: 'dist/engine', publicBucket: BUCKET },
            files,
        );

        const config = readConfigJs(dist.readText('dist/site/bucharest/config.js'));
        expect(config).toEqual({
            cityId: 'bucharest',
            manifestUrl: `https://storage.googleapis.com/${BUCKET}/cities/bucharest/manifest.json`,
        });
        expect(dist.listFiles('dist/site/bucharest').filter((name) => name.startsWith('data/'))).toEqual([]);
        expect(report).toMatchObject({ cityId: 'bucharest', photos: 0, files: 4 + APP_FILES + ENGINE_FILES.length });
        const html = dist.readText('dist/site/bucharest/index.html');
        expect(html).toMatch(
            /connect-src [^;]*https:\/\/storage\.googleapis\.com[^;]*https:\/\/us-central1-bucurestiul-disparut\.cloudfunctions\.net/,
        );
        expect(html).toMatch(/img-src [^;]*https:\/\/storage\.googleapis\.com/);
        // The tab icon: the default in both schemes first (S-V55-HAPPY), then the script that paints the visitor's theme and
        // shows the city's own from the bucket (S-V54-HAPPY): an icon an editor uploads shows without a deploy.
        expect(html).toContain(
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="${DEFAULT_TAB_ICONS.light}">`,
        );
        expect(html).toContain(
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="${DEFAULT_TAB_ICONS.dark}">`,
        );
        expect(html).toContain('<script src="config.js" defer></script>\n        <script src="tab-icon.js" defer></script>');
        const script = dist.readText('dist/site/bucharest/tab-icon.js');
        expect(script).toContain('hcm-map-viewer');
        expect(script).toContain(`(window, "https://storage.googleapis.com/${BUCKET}/cities/");`);
        // The installable app (docs/ENGINE_API.md → Installable app): the manifest the page links, its icons, the worker the
        // page script registers for the page's folder, which keeps no data and nothing of another origin.
        expect(html).toContain('<link rel="manifest" href="app.webmanifest">');
        expect(script).toContain('(window, {"worker":"sw.js","scope":"./"});');
        expect(JSON.parse(dist.readText('dist/site/bucharest/app.webmanifest'))).toMatchObject({ name: 'București dispărut', scope: './' });
        expect(dist.listFiles('dist/site/bucharest')).toEqual(
            expect.arrayContaining(['app-icon-192.png', 'app-icon-512.png', 'app-icon-maskable-512.png', 'sw.js']),
        );
        expect(dist.readText('dist/site/bucharest/sw.js')).toContain('"offline":true');
        // The build the page compares with the one Hosting serves, to reload into a new deploy (app-update.ts).
        const { build } = JSON.parse(dist.readText('dist/site/bucharest/app-build.json')) as { build: string };
        expect(build).toMatch(/^[0-9a-f]{16}$/);
        expect(script).toContain(`(window, {"build":"${build}","version":"app-build.json"}, { mark: `);
        expect(dist.readText('dist/site/bucharest/sw.js')).toContain(`"release":"${build}"`);
    });

    it('badPath_withoutABucketOrWithoutTheSitesConsentTheSnapshotIsBundled', () => {
        const plain = syntheticRoot();
        const optedIn = readingTheBucket();

        buildSite({ ...plain.options, publicBucket: BUCKET }, plain.files);
        buildSite(optedIn.options, optedIn.files);

        for (const { files } of [plain, optedIn]) {
            expect(readConfigJs(files.readText('dist/site/starter-kit/config.js')).manifestUrl).toBe('./data/manifest.json');
            expect(files.isFile('dist/site/starter-kit/data/manifest.json')).toBe(true);
            // Without the bucket the page inlines the default tab icon: the Layers panel's map glyph.
            const html = files.readText('dist/site/starter-kit/index.html');
            expect(html).toContain(
                `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="${DEFAULT_TAB_ICONS.light}">`,
            );
            expect(files.readText('dist/site/starter-kit/tab-icon.js')).toContain('hcm-map-viewer');
            expect(files.readText('dist/site/starter-kit/tab-icon.js')).not.toContain('icon-32.png');
        }
    });

    it('happyPath_anotherProjectsBucketAndEndpoint', () => {
        const { files, options } = readingTheBucket();

        buildSite({ ...options, publicBucket: 'exemplu-proiect-public' }, files);

        expect(files.readText('dist/site/starter-kit/config.js')).toContain('/exemplu-proiect-public/cities/exemplu/manifest.json');
        expect(files.readText('dist/site/starter-kit/index.html')).toContain('https://europe-west1-exemplu-proiect.cloudfunctions.net');
    });

    it.each([
        [
            'an invalid bucket',
            'Not_A.Bucket!',
            '{"projectId":"exemplu-proiect","region":"europe-west1"}',
            'HCM_PUBLIC_BUCKET "Not_A.Bucket!"',
        ],
        ['no project file', BUCKET, null, 'infra/project.json is missing'],
        ['a project file that is not JSON', BUCKET, '{', 'infra/project.json: not JSON'],
        ['a project file without a region', BUCKET, '{"projectId":"exemplu-proiect"}', 'infra/project.json: invalid project file'],
    ])('badPath_%s_failsTheBuildAndKeepsThePreviousOne', (_case, bucket, project, message) => {
        const { files, options } = readingTheBucket(project);
        files.write('dist/site/starter-kit/previous.txt', 'previous');

        expect(() => buildSite({ ...options, publicBucket: bucket }, files)).toThrow(message);
        expect(files.readText('dist/site/starter-kit/previous.txt')).toBe('previous');
    });

    it('badPath_aConfigWithoutACityNamesNoObject', () => {
        const { files, options } = readingTheBucket();
        files.write('starter-kit/config.js', "window.HistoricCityMapConfig = { manifestUrl: './data/manifest.json' };");

        expect(() => buildSite({ ...options, publicBucket: BUCKET }, files)).toThrow('starter-kit/config.js names no cityId');
    });
});

describe('buildSite (a city without a seed manifest, M5-interfaces §1.10)', () => {
    const BUCKET = 'exemplu-proiect-public';

    /** The synthetic starter kit as `npm run site:add` leaves a city: no seed manifest, the public bucket's only. */
    function bucketOnly(): ReturnType<typeof syntheticRoot> {
        const root = syntheticRoot();
        const spec = JSON.parse(root.files.readText('starter-kit/site.json')) as Record<string, unknown>;
        const rest = Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'manifest' && key !== 'media'));
        root.files.write('starter-kit/site.json', JSON.stringify({ ...rest, publicManifest: true }));
        root.files.write('infra/project.json', '{"projectId":"exemplu-proiect","region":"europe-west1"}');
        return root;
    }

    it('happyPath_thePageReadsTheBucketAndItsPolicyNamesOnlyTheBucketAndTheCrashEndpoint', async () => {
        const { files, options } = bucketOnly();

        const report = buildSite({ ...options, publicBucket: BUCKET }, files);

        expect(report).toMatchObject({ cityId: 'exemplu', photos: 0, files: 4 + APP_FILES + ENGINE_FILES.length });
        expect(readConfigJs(files.readText('dist/site/starter-kit/config.js')).manifestUrl).toBe(
            `https://storage.googleapis.com/${BUCKET}/cities/exemplu/manifest.json`,
        );
        const html = files.readText('dist/site/starter-kit/index.html');
        expect(html).toMatch(
            /connect-src [^;]*https:\/\/europe-west1-exemplu-proiect\.cloudfunctions\.net[^;]*https:\/\/storage\.googleapis\.com;/,
        );
        expect(html).toMatch(/img-src [^;]*https:\/\/storage\.googleapis\.com;/);
        expect(files.listFiles('dist/site/starter-kit').filter((name) => name.startsWith('data/'))).toEqual([]);
        expect(await htmlValidateMessages(html)).toEqual([]);
    });

    it('badPath_withoutABucketThereIsNothingToServe', () => {
        const { files, options } = bucketOnly();

        expect(() => buildSite(options, files)).toThrow('names no seed manifest and the build names no public bucket');
        expect(files.isFile('dist/site/starter-kit/index.html')).toBe(false);
    });

    it('happyPath_theBuildsOwnManifestStillServesIt_asTheE2eFixtureSiteDoes', () => {
        const { files, options } = bucketOnly();
        const spec = JSON.parse(files.readText('starter-kit/site.json')) as Record<string, unknown>;
        files.write('starter-kit/site.json', JSON.stringify({ ...spec, media: 'seed/bucharest/derived' }));
        const manifest = JSON.parse(files.readText('starter-kit/data/manifest.json')) as unknown;

        expect(buildSite({ ...options, manifest }, files)).toMatchObject({ cityId: 'exemplu', photos: 2 });
        expect(files.isFile('dist/site/starter-kit/data/media/mihai-voda-1978/web.webp')).toBe(true);
    });
});
