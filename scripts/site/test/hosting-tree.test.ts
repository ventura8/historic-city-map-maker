/**
 * The Firebase Hosting tree (`scripts/site/src/hosting/tree.ts`; docs/research/M6-interfaces.md §2.1, §2.5): the public
 * map at the root, the other cities at their paths, the generic city page, the admin under `/admin/` with its
 * `runtime.json` per variant, `release.json`, `404.html`; the start-up variant without the viewer. Built from synthetic
 * inputs in a temporary folder.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { ADMIN_REDIRECT_FILE, ADMIN_REDIRECT_SOURCE } from '../src/hosting/admin-redirect.js';
import type { CityPageFiles } from '../src/hosting/city-page.js';
import { HOSTING_STYLESHEET_SOURCE } from '../src/hosting/static-pages.js';
import { assembleHostingTree, type HostingSite, type HostingTreeInputs } from '../src/hosting/tree.js';
import { cleanup, temporaryDir } from './support.js';

const ADMIN = 'packages/admin/dist';
const ROOT_SITE: HostingSite = { outDir: 'dist/sites/bucharest', path: '' };
const CITY_PAGE: CityPageFiles = {
    page: { to: 'city/index.html', content: '<!DOCTYPE html>city page' },
    config: { to: 'city/config.js', content: 'window.HistoricCityMapConfig = {};' },
};

/** A built admin and two built city sites (the root with its redirect script, and Cluj). */
function world(runtime: unknown = { release: '1.0.0+abc1234', appCheckSiteKey: '6Le2e-site-key-0001' }): {
    files: SiteFileSystem;
    inputs: HostingTreeInputs;
} {
    const files = nodeFileSystem(temporaryDir());
    files.write(`${ADMIN}/index.html`, '<!DOCTYPE html>admin');
    files.write(`${ADMIN}/admin.mjs`, 'admin');
    files.write(`${ADMIN}/fonts/a.woff2`, 'font');
    files.write(`${ADMIN}/runtime.json`, typeof runtime === 'string' ? runtime : JSON.stringify(runtime));
    files.write(`${ADMIN}/install/1-0-0-old/manifest.json`, '{}');
    for (const [dir, extra] of [
        ['dist/sites/bucharest', ADMIN_REDIRECT_FILE],
        ['dist/sites/cluj', 'site.css'],
    ] as const) {
        for (const name of ['index.html', 'config.js', 'engine/engine.mjs', extra]) {
            files.write(`${dir}/${name}`, `${dir} ${name}`);
        }
    }
    const sites: HostingSite[] = [ROOT_SITE, { outDir: 'dist/sites/cluj', path: 'cluj/' }];
    return { files, inputs: { adminDir: ADMIN, sites, cityPage: CITY_PAGE } };
}

afterEach(cleanup);

describe('assembleHostingTree: the public variant', () => {
    it('happyPath_theViewerAtTheRootTheCitiesTheCityPageAndTheAdminUnderItsFolder', () => {
        const { files, inputs } = world();

        const report = assembleHostingTree(inputs, 'public', 'dist/hosting', files);

        expect(files.listFiles('dist/hosting')).toEqual([
            '404.html',
            ADMIN_REDIRECT_FILE,
            'admin/admin.mjs',
            'admin/fonts/a.woff2',
            'admin/index.html',
            'admin/runtime.json',
            'city/config.js',
            'city/index.html',
            'cluj/config.js',
            'cluj/engine/engine.mjs',
            'cluj/index.html',
            'cluj/site.css',
            'config.js',
            'engine/engine.mjs',
            'hosting.css',
            'index.html',
            'release.json',
        ]);
        expect(files.readText('dist/hosting/index.html')).toBe('dist/sites/bucharest index.html');
        expect(JSON.parse(files.readText('dist/hosting/release.json'))).toEqual({ release: '1.0.0+abc1234', variant: 'public' });
        // The admin build's runtime keeps what it says beside the release (the App Check key); no start-up flag.
        expect(JSON.parse(files.readText('dist/hosting/admin/runtime.json'))).toEqual({
            release: '1.0.0+abc1234',
            appCheckSiteKey: '6Le2e-site-key-0001',
        });
        expect(files.readText('dist/hosting/hosting.css')).toBe(HOSTING_STYLESHEET_SOURCE);
        expect(files.readText('dist/hosting/404.html')).toContain('Pagina nu există');
        expect(report).toEqual({
            outDir: 'dist/hosting',
            variant: 'public',
            release: '1.0.0+abc1234',
            paths: ['/', '/cluj/', '/city/', '/admin/'],
            files: 17,
        });
    });

    it('happyPath_theBuildTimeOfTheAdminsReleaseIsInReleaseJson', () => {
        // Finding 39 of 2026-11-01: the site's card orders two builds of one version by it.
        const { files, inputs } = world({ release: '1.0.0+abc1234', releaseTime: 1_761_955_200 });

        assembleHostingTree(inputs, 'public', 'dist/hosting', files);

        expect(JSON.parse(files.readText('dist/hosting/release.json'))).toEqual({
            release: '1.0.0+abc1234',
            releaseTime: 1_761_955_200,
            variant: 'public',
        });
    });

    it('happyPath_aRebuildReplacesTheTreeAndDropsAnOldStartUpFlag', () => {
        const { files, inputs } = world({ release: '1.0.1+def5678', startUp: true });
        files.write('dist/hosting/stale.txt', 'old');

        assembleHostingTree(inputs, 'public', 'dist/hosting', files);

        expect(files.isFile('dist/hosting/stale.txt')).toBe(false);
        expect(JSON.parse(files.readText('dist/hosting/admin/runtime.json'))).toEqual({ release: '1.0.1+def5678' });
    });
});

describe('assembleHostingTree: the start-up variant', () => {
    it('happyPath_theBeingSetUpPageTheRedirectAndTheAdminInStartUpModeWithoutAnyViewer', () => {
        const { files, inputs } = world();

        const report = assembleHostingTree(inputs, 'start-up', 'dist/hosting', files);

        expect(files.listFiles('dist/hosting')).toEqual([
            '404.html',
            ADMIN_REDIRECT_FILE,
            'admin/admin.mjs',
            'admin/fonts/a.woff2',
            'admin/index.html',
            'admin/runtime.json',
            'hosting.css',
            'index.html',
            'release.json',
        ]);
        expect(files.readText('dist/hosting/index.html')).toContain('Harta este în pregătire');
        expect(files.readText(`dist/hosting/${ADMIN_REDIRECT_FILE}`)).toBe(ADMIN_REDIRECT_SOURCE);
        expect(JSON.parse(files.readText('dist/hosting/admin/runtime.json'))).toMatchObject({ startUp: true });
        expect(JSON.parse(files.readText('dist/hosting/release.json'))).toEqual({ release: '1.0.0+abc1234', variant: 'start-up' });
        expect(report.paths).toEqual(['/', '/admin/']);
    });

    it('happyPath_noCitySiteIsNeeded', () => {
        const { files, inputs } = world();

        expect(assembleHostingTree({ ...inputs, sites: [] }, 'start-up', 'dist/hosting', files).files).toBe(9);
    });
});

describe('assembleHostingTree: refusals (nothing written)', () => {
    it.each([
        ['an output outside dist/', (inputs: HostingTreeInputs) => inputs, 'public/x', /below dist\//],
        ['no root site', (inputs: HostingTreeInputs) => ({ ...inputs, sites: inputs.sites.slice(1) }), 'dist/hosting', /got 0/],
        [
            'two root sites',
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [...inputs.sites, { outDir: 'dist/sites/cluj', path: '' }] }),
            'dist/hosting',
            /got 2/,
        ],
        [
            'a root built without the redirect',
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [{ outDir: 'dist/sites/cluj', path: '' }] }),
            'dist/hosting',
            /has no admin-redirect\.js/,
        ],
        [
            "a city on the root site's engine folder",
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [ROOT_SITE, { outDir: 'dist/sites/cluj', path: 'engine/' }] }),
            'dist/hosting',
            /"\/engine\/" of dist\/sites\/cluj is taken/,
        ],
        [
            "a city on the admin's folder",
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [ROOT_SITE, { outDir: 'dist/sites/cluj', path: 'admin/' }] }),
            'dist/hosting',
            /"\/admin\/" .* is taken/,
        ],
        [
            "a city on the city page's folder",
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [ROOT_SITE, { outDir: 'dist/sites/cluj', path: 'city/' }] }),
            'dist/hosting',
            /"\/city\/" .* is taken/,
        ],
        [
            'two cities on one path',
            (inputs: HostingTreeInputs) => ({ ...inputs, sites: [...inputs.sites, { outDir: 'dist/sites/cluj', path: 'cluj/' }] }),
            'dist/hosting',
            /"\/cluj\/" .* is taken/,
        ],
    ])('badPath_%s', (_name, change, outDir, message) => {
        const { files, inputs } = world();

        expect(() => assembleHostingTree(change(inputs), 'public', outDir, files)).toThrow(message);
        expect(files.isFile('dist/hosting/index.html')).toBe(false);
    });

    it.each([
        ['no runtime.json', null, /holds no built admin/],
        ['a runtime.json that is no JSON', '{', /runtime\.json: not JSON/],
        ['a runtime.json without a release', { startUp: true }, /no release/],
    ])('badPath_anAdminWith_%s', (_name, runtime, message) => {
        const { files, inputs } = world(runtime ?? {});
        if (runtime === null) {
            files.remove(ADMIN);
            files.write(`${ADMIN}/index.html`, 'admin');
        }

        expect(() => assembleHostingTree(inputs, 'start-up', 'dist/hosting', files)).toThrow(message);
    });
});
