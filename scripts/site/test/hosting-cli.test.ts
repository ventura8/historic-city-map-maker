/**
 * `npm run build:hosting` (`scripts/site/src/hosting/cli.ts`; docs/research/M6-interfaces.md §2.1, §2.5): every committed
 * city site built for Hosting from the public bucket (the root one with `admin-redirect.js`), the generic city page and the
 * admin, assembled as the public tree and as the variant a deploy publishes. Run against a synthetic repository in a
 * temporary folder (the real one is the `hosting-build` gate's); the entry is checked once through Node.
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';

import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, projectIdOf, runHostingCli } from '../src/hosting/cli.js';
import { ROOT, cleanup, recordingLogger, temporaryDir } from './support.js';

const ENTRY = join(ROOT, 'scripts/site/build-hosting.ts');
const HOOK = join(ROOT, 'scripts/site/register-ts.mjs');

/** A site of the synthetic repository: it reads the public bucket only. */
function writeSite(files: SiteFileSystem, folder: string, cityId: string, pagesPath?: string): void {
    const repository = nodeFileSystem(ROOT);
    const spec = JSON.parse(repository.readText('starter-kit/site.json')) as Record<string, unknown>;
    const rest = Object.fromEntries(Object.entries(spec).filter(([key]) => key !== 'manifest' && key !== 'media'));
    const path = pagesPath === undefined ? {} : { pagesPath };
    files.write(`sites/${folder}/site.json`, JSON.stringify({ ...rest, publicManifest: true, ...path }));
    files.write(
        `sites/${folder}/config.js`,
        `window.HistoricCityMapConfig = { cityId: '${cityId}', manifestUrl: './data/manifest.json' };\n`,
    );
    files.write(`sites/${folder}/site.css`, repository.readText('starter-kit/site.css'));
}

/** Bucharest at the root and Cluj in its folder, a built admin, the engine and Mapbox GL. */
function syntheticRepository(): SiteFileSystem {
    const files = nodeFileSystem(temporaryDir());
    writeSite(files, 'bucharest', 'bucharest', '');
    writeSite(files, 'cluj', 'cluj');
    for (const name of ['site.json', 'config.js', 'site.css']) {
        files.write(`starter-kit/${name}`, nodeFileSystem(ROOT).readText(`starter-kit/${name}`));
    }
    files.write('infra/project.json', JSON.stringify({ projectId: 'exemplu-proiect', region: 'europe-west1' }));
    for (const name of ['engine.mjs', 'engine.css']) {
        files.write(`packages/engine/dist/${name}`, name);
    }
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.js', 'js');
    files.write('node_modules/mapbox-gl/dist/mapbox-gl.css', 'css');
    files.write('packages/admin/dist/index.html', '<!DOCTYPE html>admin');
    files.write('packages/admin/dist/admin.mjs', 'admin');
    files.write('packages/admin/dist/runtime.json', JSON.stringify({ release: '1.0.0+abc1234' }));
    return files;
}

afterEach(cleanup);

describe('runHostingCli', () => {
    it('happyPath_thePublicTreeAndTheDeployedOneFromTheProjectsBucket', () => {
        const files = syntheticRepository();
        const { log, records } = recordingLogger();

        expect(runHostingCli([], { env: {}, files, log })).toBe(EXIT_OK);

        for (const tree of ['dist/hosting-public', 'dist/hosting']) {
            expect(JSON.parse(files.readText(`${tree}/release.json`))).toEqual({ release: '1.0.0+abc1234', variant: 'public' });
            expect(files.isFile(`${tree}/cluj/index.html`)).toBe(true);
            expect(files.isFile(`${tree}/city/config.js`)).toBe(true);
            expect(files.isFile(`${tree}/admin/admin.mjs`)).toBe(true);
        }
        expect(files.readText('dist/hosting/config.js')).toContain(
            'https://storage.googleapis.com/exemplu-proiect-public/cities/bucharest/manifest.json',
        );
        expect(files.readText('dist/hosting/city/config.js')).toContain('"https://storage.googleapis.com/exemplu-proiect-public/cities/"');
        expect(files.readText('dist/hosting/index.html')).toContain('<script src="admin-redirect.js">');
        expect(files.readText('dist/hosting/cluj/index.html')).not.toContain('admin-redirect.js');
        expect(records.map((record) => record.message)).toEqual([
            'hosting site built',
            'hosting site built',
            'hosting public tree assembled',
            'hosting tree assembled',
        ]);
    });

    it('happyPath_aStartUpDeployPublishesTheStartUpTreeAndKeepsThePublicOneForTheInstaller', () => {
        const files = syntheticRepository();
        const { log } = recordingLogger();

        const env = { HCM_ADMIN_START_UP: '1', HCM_PUBLIC_BUCKET: 'alt-public', MAPBOX_PUBLIC_TOKEN: 'pk.from-env' };
        expect(runHostingCli(['--out', 'dist/h', '--public-out', 'dist/p'], { env, files, log })).toBe(EXIT_OK);

        expect(JSON.parse(files.readText('dist/h/release.json'))).toMatchObject({ variant: 'start-up' });
        expect(JSON.parse(files.readText('dist/h/admin/runtime.json'))).toEqual({ release: '1.0.0+abc1234', startUp: true });
        expect(files.isFile('dist/h/cluj/index.html')).toBe(false);
        expect(JSON.parse(files.readText('dist/p/release.json'))).toMatchObject({ variant: 'public' });
        expect(files.readText('dist/p/config.js')).toContain('/alt-public/cities/bucharest/manifest.json');
    });

    it('badPath_aMistypedOptionIsAUsageError', () => {
        const { log, records } = recordingLogger();

        expect(runHostingCli(['--outt', 'dist/h'], { env: {}, files: syntheticRepository(), log })).toBe(EXIT_USAGE);
        expect(records[0]?.message).toMatch(/^usage: build-hosting\.ts/);
    });

    it.each([
        ['no project file', 'infra', null, /infra\/project\.json is missing/],
        ['a project file that is no JSON', 'infra/project.json', '{', /not JSON/],
        ['a project without its id', 'infra/project.json', '{"region":"x"}', /invalid project file/],
        ['no Mapbox GL', 'node_modules/mapbox-gl/dist', null, /mapbox-gl\.js is missing/],
        ['no admin build', 'packages/admin/dist', null, /holds no built admin/],
    ])('badPath_%s_isAnInputProblem', (_name, path, content, message) => {
        const files = syntheticRepository();
        if (content === null) {
            files.remove(path);
        } else {
            files.write(path, content);
        }
        const { log, records } = recordingLogger();

        expect(runHostingCli([], { env: {}, files, log })).toBe(EXIT_INVALID);
        expect(records.at(-1)?.message).toMatch(message);
        expect(files.isFile('dist/hosting/index.html')).toBe(false);
    });

    it('badPath_aBugPropagatesWithItsStack', () => {
        const files = syntheticRepository();
        const broken: SiteFileSystem = {
            ...files,
            listFiles: () => {
                throw new TypeError('bug');
            },
        };

        expect(() => runHostingCli([], { env: {}, files: broken, log: recordingLogger().log })).toThrow('bug');
    });

    it('happyPath_theProjectIdIsTheCommittedOne', () => {
        expect(projectIdOf(nodeFileSystem(ROOT))).toBe('bucurestiul-disparut');
    });

    it('happyPath_theEntryRunsUnderNode', () => {
        const result = spawnSync(process.execPath, ['--import', HOOK, ENTRY, '--help'], { cwd: ROOT, encoding: 'utf8' });

        expect(result.status).toBe(EXIT_USAGE);
    });
});
