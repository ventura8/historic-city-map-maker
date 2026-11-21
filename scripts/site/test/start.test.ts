import { GENERIC_INSTALL_PROJECT, startConfigSchema, startReleaseSchema } from '@hcm/shared';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import { SiteBuildError } from '../src/errors.js';
import type { SiteFileSystem } from '../src/files.js';
import { buildStartSite, EXIT_INVALID, EXIT_OK, EXIT_USAGE, runStartCli } from '../src/start/build.js';
import { renderFirstCityPage } from '../src/hosting/static-pages.js';
import { servingConfigOf } from '../src/start/hosting-config.js';
import { renderStartPage, startPagePolicy, takenByStartTree } from '../src/start/tree.js';
import { cleanup, recordingLogger, repositoryWithTemporaryDist } from './support.js';

/**
 * The start site (docs/research/M14-start-your-map.md §5, §6) from the repository's real inputs and a public Hosting tree faked
 * in a temporary `dist/`: the tree names no project, Bucharest stays out, the manifest lists every file with its digest.
 */
const STEPS = new Map([['steps/steps.mjs', new TextEncoder().encode('export {};\n')]]);
const ENV = { HCM_COMMIT: 'a'.repeat(40), SOURCE_DATE_EPOCH: '1700000000', HCM_START_OAUTH_CLIENT_ID: 'client.apps.googleusercontent.com' };
const PROJECT = { projectId: 'bucurestiul-disparut', publicBucket: 'bucurestiul-disparut-public' };
const OPTIONS = {
    publicTree: 'dist/hosting-public',
    appDir: 'dist/start-app',
    outDir: 'dist/start',
    functionsDir: 'dist/functions',
    project: PROJECT,
};

function world(): { readonly files: SiteFileSystem } {
    const { files } = repositoryWithTemporaryDist();
    for (const [path, content] of Object.entries({
        'dist/hosting-public/index.html': '<!doctype html>bucharest',
        'dist/hosting-public/config.js': 'bucharest',
        'dist/hosting-public/data/manifest.json': '{}',
        'dist/hosting-public/city/index.html': '<!doctype html>city',
        'dist/hosting-public/city/config.js': 'https://storage.googleapis.com/bucurestiul-disparut-public/cities/',
        'dist/hosting-public/engine/engine.mjs': 'export {};',
        'dist/hosting-public/404.html': '<!doctype html>404',
        'dist/hosting-public/hosting.css': 'body{}',
        'dist/hosting-public/admin/index.html': '<!doctype html>admin bucurestiul-disparut',
        'dist/hosting-public/admin/admin.mjs': 'export {};',
        'dist/hosting-public/admin/admin.mjs.map': '{}',
        'dist/hosting-public/admin/project.json': '{}',
        'dist/hosting-public/admin/runtime.json': '{}',
        'dist/hosting-public/admin/legacy/bucharest/city.json': '{}',
        'dist/start-app/start.mjs': 'export {};',
        'dist/start-app/i18n/fr.json': '{"locale":"fr","messages":{}}',
        'dist/functions/index.js': 'exports.a = 1;',
        'dist/functions/package.json': '{}',
        'dist/functions/package-lock.json': '{}',
        'dist/functions/.env.bucurestiul-disparut': 'HCM_VIEWER_ORIGINS=https://a.b\nHCM_APP_CHECK=monitor\nHCM_RELEASE=1.0.0+aaaaaaa\n',
    })) {
        files.write(path, content);
    }
    return { files };
}

afterEach(cleanup);

describe('the start site', () => {
    it('happyPath_aReleaseThatNamesNoProject', () => {
        const { files } = world();
        const report = buildStartSite(OPTIONS, { files, env: ENV }, STEPS);
        const config = startConfigSchema.parse(JSON.parse(files.readText('dist/start/start-config.json')));
        expect(config.oauthClientId).toBe(ENV.HCM_START_OAUTH_CLIENT_ID);
        const manifest = startReleaseSchema.parse(JSON.parse(files.readText(`dist/start/release/${config.release}/start-release.json`)));
        expect(report).toEqual({ release: manifest.release, files: manifest.files.length });
        const paths = manifest.files.map((file) => file.path);
        expect(paths).toEqual(
            expect.arrayContaining([
                'index.html',
                'city/index.html',
                'engine/engine.mjs',
                'admin/index.html',
                'admin/runtime.json',
                'release.json',
            ]),
        );
        expect(paths).not.toContain('config.js');
        expect(paths).not.toContain('admin/project.json');
        expect(paths.filter((path) => /(?:legacy|data\/|\.map$)/.test(path))).toEqual([]);
        expect(manifest.files.find((file) => file.path === 'city/config.js')?.template).toBe(true);
        expect(manifest.files.find((file) => file.path === 'hosting.css')?.template).toBeUndefined();
        const tree = (path: string): string => files.readText(`dist/start/release/${config.release}/tree/${path}`);
        expect(tree('city/config.js')).toContain('__HCM_PROJECT_ID__-public');
        expect(tree('admin/runtime.json')).toContain('"startUp": true');
        expect(tree('release.json')).toContain('"variant": "start-up"');
        expect(JSON.stringify(manifest.hosting)).toContain('__HCM_PROJECT_ID__');
        expect(JSON.stringify(manifest.hosting)).not.toContain(PROJECT.projectId);
        const bundle = JSON.parse(tree(`admin/install/${config.release}/manifest.json`)) as { readonly projectId: string };
        expect(bundle.projectId).toBe(GENERIC_INSTALL_PROJECT);
        expect(files.readText('dist/start/start.mjs')).toBe('export {};');
        // The languages fetched when chosen sit beside the module (docs/I18N.md → Loading).
        expect(files.readText('dist/start/i18n/fr.json')).toBe('{"locale":"fr","messages":{}}');
        // What a site build adopts is the public tree's own marks, the city page's policy included when it names the project.
        const site = files.readBytes(`dist/start/release/${config.release}/tree/admin/install/${config.release}/hosting.tgz`);
        const listed = execFileSync('/usr/bin/tar', ['-xzO', 'templates.json'], { input: site }).toString('utf8');
        expect(JSON.parse(listed)).toEqual(expect.arrayContaining(['city/config.js', 'admin/index.html']));
    });

    it('happyPath_withoutAClientThePageIsClosed', () => {
        const { files } = world();
        buildStartSite(OPTIONS, { files, env: { ...ENV, HCM_START_OAUTH_CLIENT_ID: '' } }, STEPS);
        expect(JSON.parse(files.readText('dist/start/start-config.json'))).not.toHaveProperty('oauthClientId');
    });

    it('badPath_aMissingPageBuildIsNamed', () => {
        const { files } = world();
        files.remove('dist/start-app');
        expect(() => buildStartSite(OPTIONS, { files, env: ENV }, STEPS)).toThrow(SiteBuildError);
    });

    it('happyPath_thePageAllowsOnlyItsOwnFilesAndGooglesFiveHosts', () => {
        const policy = startPagePolicy();
        expect(policy).toContain('https://upload-firebasehosting.googleapis.com');
        expect(policy).not.toContain('accounts.google.com');
        expect(renderStartPage()).toContain('<hcm-start-page>');
    });

    it.each([
        ['admin/admin.mjs', true],
        ['admin/legacy/x', false],
        ['admin/install/x', false],
        ['admin/project.json', false],
        ['engine/engine.mjs', true],
        ['data/manifest.json', false],
        ['config.js', false],
        ['hosting.css', true],
        ['admin/a.map', false],
    ])('the tree takes %s: %s', (path, taken) => {
        expect(takenByStartTree(path)).toBe(taken);
    });

    it('happyPath_hostingsRulesBecomeAServingConfig', () => {
        expect(
            servingConfigOf(
                {
                    cleanUrls: true,
                    trailingSlash: false,
                    rewrites: [{ regex: '^/a$', destination: '/b' }],
                    redirects: [{ source: '/c', destination: '/d', type: 302 }, { regex: '^/e$' }],
                    headers: [{ source: '**', headers: [{ key: 'X-Site', value: 'my-project' }] }, { source: '/f' }],
                },
                'my-project',
            ),
        ).toEqual({
            cleanUrls: true,
            trailingSlashBehavior: 'REMOVE',
            rewrites: [{ regex: '^/a$', path: '/b' }],
            redirects: [
                { glob: '/c', location: '/d', statusCode: 302 },
                { regex: '^/e$', location: '', statusCode: 301 },
            ],
            headers: [
                { glob: '**', headers: { 'X-Site': '__HCM_PROJECT_ID__' } },
                { glob: '/f', headers: {} },
            ],
        });
        expect(servingConfigOf({ trailingSlash: true }, 'x')).toMatchObject({ trailingSlashBehavior: 'ADD', rewrites: [] });
        expect(servingConfigOf(undefined, 'x')).toEqual({ rewrites: [], redirects: [], headers: [] });
        expect(() => servingConfigOf({ redirects: [{ source: '/c', type: 200 }] }, 'x')).toThrow(SiteBuildError);
    });

    it('cli_exitStatuses', async () => {
        const { files } = world();
        const { log } = recordingLogger();
        const context = { files, log, env: ENV, steps: () => Promise.resolve(STEPS) };
        expect(await runStartCli(['--bad'], context)).toBe(EXIT_USAGE);
        expect(
            await runStartCli(['--public-tree', OPTIONS.publicTree, '--app', 'dist/none', '--functions', OPTIONS.functionsDir], context),
        ).toBe(EXIT_INVALID);
        expect(
            await runStartCli(['--public-tree', OPTIONS.publicTree, '--app', OPTIONS.appDir, '--functions', OPTIONS.functionsDir], context),
        ).toBe(EXIT_OK);
    });

    it('badPath_anErrorThatIsNoBuildErrorIsThrownOn', async () => {
        const { files } = world();
        const { log } = recordingLogger();
        const broken = new Error('steps unreadable');
        const steps = (): Promise<never> => Promise.reject(broken);
        const args = ['--public-tree', OPTIONS.publicTree, '--app', OPTIONS.appDir, '--functions', OPTIONS.functionsDir];
        await expect(runStartCli(args, { files, log, env: ENV, steps })).rejects.toBe(broken);
    });
});

describe('the start site for Google verification', () => {
    it('happyPath_theLegalPagesAndTheVerificationFileJoinTheSite', () => {
        const { files } = world();
        buildStartSite(OPTIONS, { files, env: { ...ENV, HCM_START_SITE_VERIFICATION: 'google0123abcd.html' } }, STEPS);
        expect(files.readText('dist/start/google0123abcd.html')).toBe('google-site-verification: google0123abcd.html');
        expect(files.readText('dist/start/privacy.html')).toContain('Limited Use');
        expect(files.isFile('dist/start/terms.html')).toBe(true);
        expect(files.readText('dist/start/index.html')).toContain('href="privacy.html"');
    });

    it('badPath_anInvalidVerificationNameStopsTheBuild', async () => {
        const { files } = world();
        const { log } = recordingLogger();
        const env = { ...ENV, HCM_START_SITE_VERIFICATION: 'evil.html' };
        let stepsRead = false;
        const steps = (): Promise<typeof STEPS> => {
            stepsRead = true;
            return Promise.resolve(STEPS);
        };
        const args = ['--public-tree', OPTIONS.publicTree, '--app', OPTIONS.appDir, '--functions', OPTIONS.functionsDir];
        expect(await runStartCli(args, { files, log, env, steps })).toBe(EXIT_INVALID);
        expect(stepsRead).toBe(false);
        expect(files.isFile('dist/start/evil.html')).toBe(false);
    });
});

describe('the root of a map made from the start page', () => {
    it('happyPath_itLoadsItsScriptAndKeepsALinkForNoScript', () => {
        const page = renderFirstCityPage();
        expect(page).toContain('src="/first-city.js"');
        expect(page).toContain('href="/admin/"');
        expect(page).toContain("connect-src 'self'");
    });
});
