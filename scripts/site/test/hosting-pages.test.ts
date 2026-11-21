/**
 * The Hosting site's small pages and scripts (`scripts/site/src/hosting/`; docs/research/M6-interfaces.md §2.4, §2.5, §2.7):
 * the 404, start-up and Pages redirect pages (the repository's html-validate rules, bilingual, their own meta policy
 * first), the root's `admin-redirect.js` (an old admin address goes to `/admin/`, a viewer hash stays), the generic city
 * page's configuration (the city id of the address, the public bucket's manifest), and the GitHub Pages redirect tree.
 */
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import { CITY_ID_PATTERN } from '@hcm/shared';
import { DEFAULT_TAB_ICONS } from '@hcm/shared/tab-icon';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

import { nodeFileSystem } from '../src/files.js';
import { ADMIN_PATH, ADMIN_REDIRECT_SOURCE, forwardOldAdminAddress, type RedirectScope } from '../src/hosting/admin-redirect.js';
import {
    CITY_PATH_REGEX,
    configureCityPage,
    planCityPage,
    showCityIcon,
    type CityConfigScope,
    type CityIconScope,
} from '../src/hosting/city-page.js';
import {
    PAGES_REDIRECT_FILE,
    PAGES_REDIRECT_SOURCE,
    buildPagesRedirect,
    followTheMap,
    pagesBase,
    pagesRedirectTarget,
    type FollowScope,
} from '../src/hosting/pages-redirect.js';
import { renderNotFoundPage, renderRedirectPage, renderStartUpPage, staticPagePolicy } from '../src/hosting/static-pages.js';
import { ROOT, cleanup, htmlValidateMessages, temporaryDir } from './support.js';

afterEach(cleanup);

/** A page's `location` that records where it was sent. */
function locationOf(
    hash: string,
    search = '',
): RedirectScope & { readonly sent: string[]; readonly location: { hash: string }; hashChanged(next: string): void } {
    const sent: string[] = [];
    const listeners: (() => void)[] = [];
    const location = {
        hash,
        search,
        replace: (url: string) => {
            sent.push(url);
        },
    };
    return {
        sent,
        location,
        addEventListener: (_type, listener) => {
            listeners.push(listener);
        },
        hashChanged: (next) => {
            location.hash = next;
            listeners.forEach((listener) => {
                listener();
            });
        },
    };
}

/** A script's source as the site build's loader (Node's type stripping) writes it: plain JavaScript. */
function strippedSource(module: string, name: string): { status: number | null; stdout: string; diagnostics: readonly unknown[] } {
    const script = `const m = await import('./scripts/site/src/hosting/${module}'); process.stdout.write(m.${name});`;
    const result = spawnSync(process.execPath, ['--import', './scripts/site/register-ts.mjs', '--input-type=module', '-e', script], {
        cwd: ROOT,
        encoding: 'utf8',
    });
    const output = ts.transpileModule(result.stdout, { reportDiagnostics: true, fileName: 'page.js' });
    return { status: result.status, stdout: result.stdout, diagnostics: output.diagnostics ?? [] };
}

describe('the static pages', () => {
    it.each([
        ['404.html', renderNotFoundPage(), 'Pagina nu există', 'Page not found'],
        ['the start-up root', renderStartUpPage(), 'Harta este în pregătire', 'This map is being set up'],
        [
            'the Pages redirect page',
            renderRedirectPage({ target: 'https://demo-hcm.web.app/', base: '/repo/', script: PAGES_REDIRECT_FILE }),
            'Harta s-a mutat',
            'The map has moved',
        ],
    ])('happyPath_%s_isValidBilingualAndPolicedFirst', async (_name, html, romanian, english) => {
        expect(await htmlValidateMessages(html, 'dist/hosting/index.html')).toEqual([]);
        expect(html).toContain('<html lang="ro"');
        expect(html).toContain(`<h1>${romanian}</h1>`);
        expect(html).toMatch(new RegExp(`<section lang="en" aria-labelledby="hosting-en">\\s+<h2 id="hosting-en">${english}</h2>`));
        expect(html.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(html.indexOf('<link'));
        expect(html).toContain('<meta name="robots" content="noindex">');
    });

    it('happyPath_404LinksTheMapAndTheAdminAndRunsNoScript', () => {
        const html = renderNotFoundPage();

        expect(html).toContain(`content="${staticPagePolicy(false)}"`);
        expect(html).toContain("script-src 'none'");
        expect(html).not.toContain('<script');
        expect(html).toContain('<a class="hosting-link" href="/">Deschide harta</a>');
        expect(html).toContain(`<a class="hosting-link" href="${ADMIN_PATH}">The map's admin</a>`);
        // Served for any missing path: its stylesheet is absolute.
        expect(html).toContain('<link rel="stylesheet" href="/hosting.css">');
    });

    it('happyPath_theStartUpRootLoadsTheRedirectFirstAndNoEngine', () => {
        const html = renderStartUpPage();

        expect([...html.matchAll(/<script [^>]*>/g)].map(([tag]) => tag)).toEqual(['<script src="admin-redirect.js">']);
        expect(html).not.toContain('engine');
        expect(html).not.toContain('mapbox');
        expect(html).toContain(`href="${ADMIN_PATH}"`);
    });

    it('badPath_theRedirectPageNamesItsTargetOnlyFromTheBuild', () => {
        const html = renderRedirectPage({ target: 'https://demo-hcm.web.app/cluj/', base: '/', script: PAGES_REDIRECT_FILE });

        expect(html).toContain('<html lang="ro" data-target="https://demo-hcm.web.app/cluj/">');
        expect(html).toContain('<script src="/pages-redirect.js">');
        expect(html).toContain('<a class="hosting-link" href="https://demo-hcm.web.app/cluj/">https://demo-hcm.web.app/cluj/</a>');
    });
});

describe('admin-redirect.js', () => {
    it.each([
        ['#/setup', '', '/admin/#/setup'],
        ['#/c/bacau/photos', '?lang=en', '/admin/?lang=en#/c/bacau/photos'],
    ])('happyPath_anOldAdminAddress_%s_goesToTheAdmin', (hash, search, expected) => {
        const scope = locationOf(hash, search);

        expect(forwardOldAdminAddress(scope, ADMIN_PATH)).toBe(true);
        expect(scope.sent).toEqual([expected]);
    });

    it.each(['#15.5/44.4271/26.0853/90/!a3!p2', '#17/44.42955/26.09560&photo=strandul-opereta-1976', '#photo=x', '#', ''])(
        'badPath_theViewerHash_%s_isLeftAlone',
        (hash) => {
            const scope = locationOf(hash);

            expect(forwardOldAdminAddress(scope, ADMIN_PATH)).toBe(false);
            expect(scope.sent).toEqual([]);
        },
    );

    it('happyPath_anOldAddressTypedWhileTheRootIsOpenGoesToTheAdminOnTheHashChange @S-A58-HAPPY-OLD-LINK-HASH-CHANGE', () => {
        // Finding 25 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31): only the hash changes, the page does not load again.
        const scope = locationOf('');

        expect(forwardOldAdminAddress(scope, ADMIN_PATH)).toBe(false);
        scope.hashChanged('#17/44.42955/26.09560');
        expect(scope.sent).toEqual([]);
        scope.hashChanged('#/setup');
        expect(scope.sent).toEqual(['/admin/#/setup']);
    });

    it('happyPath_underTheSiteBuildsLoaderItIsPlainJavaScriptCalledOnWindow', () => {
        const result = strippedSource('admin-redirect.ts', 'ADMIN_REDIRECT_SOURCE');

        expect(result.status).toBe(0);
        expect(result.diagnostics).toEqual([]);
        expect(result.stdout.trimEnd().endsWith(`})(window, "${ADMIN_PATH}");`)).toBe(true);
        expect(result.stdout).not.toContain('RedirectScope');
        expect(ADMIN_REDIRECT_SOURCE).toMatch(/^\/\/ Historic City Map Maker: an old admin address/);
    });
});

interface IconLink {
    href: string;
    media: string | null;
    removed: boolean;
    removeAttribute(name: string): void;
    remove(): void;
}

function iconLink(href: string, media: string): IconLink {
    return {
        href,
        media,
        removed: false,
        removeAttribute(name) {
            this.media = name === 'media' ? null : this.media;
        },
        remove() {
            this.removed = true;
        },
    };
}

const before = 'https://storage.googleapis.com/demo-hcm-public/cities/';

/** Lets the icon script's manifest read settle (a few promise turns, no timer). */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 6; turn += 1) {
        await Promise.resolve();
    }
}

/**
 * A page whose icon probes load (the names in `loads`: the city has those files) or never do (a 404); its manifest
 * says `ownIcon` when `icon-own-32.png` is among them, and answers `manifest` (`ok`, a 404 or a network failure).
 */
function iconPage(
    loads: readonly string[],
    manifest: 'ok' | '404' | 'offline' = 'ok',
): CityIconScope & {
    readonly icons: IconLink[];
    readonly appended: { rel: string; href: string }[];
    readonly probed: string[];
    readonly fetched: string[];
} {
    const icons = [iconLink('data:image/png;base64,light', 'light'), iconLink('data:image/png;base64,dark', 'dark')];
    const appended: { rel: string; href: string }[] = [];
    const probed: string[] = [];
    const fetched: string[] = [];
    const ownIcon = loads.includes('icon-own-32.png') ? true : undefined;
    class Probe {
        onload: (() => void) | null = null;
        set src(value: string) {
            probed.push(value);
            if (loads.some((name) => value.endsWith(name))) {
                this.onload?.();
            }
        }
    }
    return {
        icons,
        appended,
        probed,
        fetched,
        fetch: (address: string) => {
            fetched.push(address);
            if (manifest === 'offline') {
                return Promise.reject(new TypeError('Failed to fetch'));
            }
            return Promise.resolve({ ok: manifest === 'ok', json: () => Promise.resolve({ city: { id: 'bacau', ownIcon } }) });
        },
        HistoricCityMapConfig: { cityId: 'bacau', manifestUrl: `${before}bacau/manifest.json` },
        Image: Probe,
        document: {
            querySelectorAll: (selector) => (selector === 'link[rel="icon"]' ? icons : []),
            createElement: () => ({ rel: '', href: '' }),
            head: {
                append: (node) => {
                    appended.push(node);
                },
            },
        },
    };
}

describe('the generic city page', () => {
    it.each([
        ['/bacau/', 'bacau'],
        ['/cluj-napoca', 'cluj-napoca'],
        ['/', 'city'],
        ['/Not_A_City/', 'city'],
        ['/x/', 'city'],
        ['', 'city'],
    ])('happyPath_theAddress_%s_namesTheCity_%s', (pathname, cityId) => {
        const scope: CityConfigScope = { location: { pathname } };

        configureCityPage(scope, before, '/manifest.json', 'city');

        expect(scope.HistoricCityMapConfig).toEqual({ cityId, manifestUrl: `${before}${cityId}/manifest.json` });
    });

    it('happyPath_theCitysOwnIconReplacesTheDefaultWhenItsManifestSaysSo @S-V54-HAPPY', async () => {
        const page = iconPage(['icon-own-32.png', 'icon-180.png']);

        showCityIcon(page, before);
        await settle();

        // The city's own icon in every theme: one link, without a scheme.
        expect(page.icons.map((icon) => [icon.href, icon.media, icon.removed])).toEqual([
            [`${before}bacau/icon-own-32.png`, null, false],
            ['data:image/png;base64,dark', 'dark', true],
        ]);
        expect(page.appended).toEqual([{ rel: 'apple-touch-icon', href: `${before}bacau/icon-180.png` }]);
    });

    it('badPath_aCityWithoutAnIconKeepsTheDefault @S-V54-BAD-MISSING', async () => {
        const page = iconPage([]);

        showCityIcon(page, before);
        await settle();

        expect(page.icons.map((icon) => [icon.href, icon.media, icon.removed])).toEqual([
            ['data:image/png;base64,light', 'light', false],
            ['data:image/png;base64,dark', 'dark', false],
        ]);
        expect(page.appended).toEqual([]);
    });

    it.each(['ok', '404', 'offline'] as const)(
        'badPath_aCityOnTheDefaultNeverAsksForTheMissingOwnIcon_manifest_%s @S-V54-BAD-NOREQUEST',
        async (manifest) => {
            const page = iconPage(['icon-180.png'], manifest);

            showCityIcon(page, before);
            await settle();

            // A request for a file the bucket lacks is blocked by the browser (ORB) and logged as an error.
            expect(page.fetched).toEqual([`${before}bacau/manifest.json`]);
            expect(page.probed).toEqual([`${before}bacau/icon-180.png`]);
            expect(page.icons.map((icon) => [icon.href, icon.removed])).toEqual([
                ['data:image/png;base64,light', false],
                ['data:image/png;base64,dark', false],
            ]);
        },
    );

    it('happyPath_aCityOnTheDefaultKeepsTheThemedTabIconAndGivesThePhoneItsOwnColour @S-V55-HAPPY', async () => {
        const page = iconPage(['icon-180.png']);

        showCityIcon(page, before);
        await settle();

        expect(page.icons.map((icon) => [icon.href, icon.removed])).toEqual([
            ['data:image/png;base64,light', false],
            ['data:image/png;base64,dark', false],
        ]);
        expect(page.appended).toEqual([{ rel: 'apple-touch-icon', href: `${before}bacau/icon-180.png` }]);
    });

    it('badPath_aPageWithoutAnIconLinkOrConfigurationStillGetsTheHomeScreenIcon', () => {
        const page = { ...iconPage(['icon-own-32.png', 'icon-180.png']), HistoricCityMapConfig: undefined };
        const bare = { ...page, document: { ...page.document, querySelectorAll: () => [] } };

        showCityIcon(bare, before);

        expect(page.appended).toEqual([{ rel: 'apple-touch-icon', href: `${before}/icon-180.png` }]);
        expect(page.fetched).toEqual([]);
    });

    it('happyPath_itChecksTheSharedCityIdPatternAndHostingRewritesExactlyThoseIds', () => {
        expect(configureCityPage.toString()).toContain(CITY_ID_PATTERN.source);
        expect(CITY_PATH_REGEX).toBe(`^/${CITY_ID_PATTERN.source.slice(1, -1)}/?$`);
    });

    it('happyPath_thePageLoadsItsFilesFromTheRootAndPolicesTheBucket', async () => {
        const files = nodeFileSystem(temporaryDir());
        files.write('infra/project.json', JSON.stringify({ projectId: 'demo-hcm', region: 'us-central1' }));

        const planned = planCityPage(
            { bucket: 'demo-hcm-public', mapboxGlIntegrity: { script: 'sha384-s' }, themeColor: '#8B5E3C' },
            files,
        );

        expect(planned.page.to).toBe('city/index.html');
        expect(await htmlValidateMessages(planned.page.content, 'dist/hosting/city/index.html')).toEqual([]);
        for (const asset of ['/engine/engine.css', '/site.css', '/city/config.js', '/engine/engine.mjs']) {
            expect(planned.page.content).toContain(`"${asset}"`);
        }
        expect(planned.page.content).toContain('https://storage.googleapis.com');
        expect(planned.page.content).toContain('https://us-central1-demo-hcm.cloudfunctions.net');
        expect(planned.page.content).toContain('<title>Hartă istorică</title>');
        expect(planned.config.to).toBe('city/config.js');
        expect(planned.config.content).toContain(`(window, "${before}", "/manifest.json", "city");`);
        expect(planned.config.content).toContain(`(window, "${before}");`);
        expect(planned.config.content).toContain('hcm-map-viewer');
        expect(planned.page.content).toContain(
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="${DEFAULT_TAB_ICONS.light}">`,
        );
        expect(planned.page.content).toContain(
            `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)" href="${DEFAULT_TAB_ICONS.dark}">`,
        );
        expect(planned.page.content).not.toContain('tab-icon.js');
    });

    it('badPath_aBucketNameThatIsNoBucketsFailsTheBuild', () => {
        const files = nodeFileSystem(temporaryDir());
        files.write('infra/project.json', JSON.stringify({ projectId: 'demo-hcm', region: 'us-central1' }));

        expect(() => planCityPage({ bucket: 'Not A Bucket', mapboxGlIntegrity: { script: 's' }, themeColor: '#8B5E3C' }, files)).toThrow(
            /names no public object/,
        );
    });
});

describe('the GitHub Pages redirect tree', () => {
    function follow(target: string | null, hash = '#15.5/44.4271/26.0853/90/!a3!p2'): string[] {
        const sent: string[] = [];
        const scope: FollowScope = {
            document: { documentElement: { getAttribute: () => target } },
            location: { search: '?lang=en', hash, replace: (url: string) => sent.push(url) },
        };
        followTheMap(scope);
        return sent;
    }

    it('happyPath_eachPageSendsTheVisitorToTheSamePageOnHostingWithTheQueryAndHash', () => {
        expect(follow('https://demo-hcm.web.app/')).toEqual(['https://demo-hcm.web.app/?lang=en#15.5/44.4271/26.0853/90/!a3!p2']);
        expect(follow('http://127.0.0.1:4312/cluj/', '')).toEqual(['http://127.0.0.1:4312/cluj/?lang=en']);
    });

    it.each([null, '', 'javascript:alert(1)', 'https://demo-hcm.web.app', 'https://demo-hcm.web.app/?x=1', '//demo-hcm.web.app/'])(
        'badPath_theTarget_%s_isNeverFollowed',
        (target) => {
            expect(follow(target)).toEqual([]);
        },
    );

    it('happyPath_theTreeHoldsAPageForEveryCityThe404TheScriptAndTheStyles', () => {
        const files = nodeFileSystem(temporaryDir());

        const report = buildPagesRedirect(
            'dist/pages-redirect',
            { origin: 'https://demo-hcm.web.app', base: '/repo/' },
            ['', 'cluj/'],
            files,
        );

        expect(files.listFiles('dist/pages-redirect')).toEqual([
            '404.html',
            'cluj/index.html',
            'hosting.css',
            'index.html',
            'pages-redirect.js',
        ]);
        expect(files.readText('dist/pages-redirect/cluj/index.html')).toContain('data-target="https://demo-hcm.web.app/cluj/"');
        expect(files.readText('dist/pages-redirect/404.html')).toContain('data-target="https://demo-hcm.web.app/"');
        expect(files.readText('dist/pages-redirect/404.html')).toContain('<script src="/repo/pages-redirect.js">');
        expect(files.readText('dist/pages-redirect/pages-redirect.js')).toBe(PAGES_REDIRECT_SOURCE);
        expect(report).toEqual({
            dir: 'dist/pages-redirect',
            target: 'https://demo-hcm.web.app/',
            pages: ['index.html', 'cluj/index.html'],
        });
    });

    it.each([
        ['a folder outside dist/', 'pages', { origin: 'https://demo-hcm.web.app', base: '/' }, /below dist\//],
        ['an address with a path', 'dist/r', { origin: 'https://demo-hcm.web.app/x', base: '/' }, /origin without a path/],
        ['a relative Pages root', 'dist/r', { origin: 'https://demo-hcm.web.app', base: 'repo/' }, /absolute folder/],
    ])('badPath_%s_isRefused', (_name, dir, target, message) => {
        expect(() => buildPagesRedirect(dir, target, [], nodeFileSystem(temporaryDir()))).toThrow(message);
    });

    it('happyPath_theTargetComesFromTheCommittedProjectFile', () => {
        expect(pagesRedirectTarget(nodeFileSystem(ROOT))).toEqual({
            origin: 'https://bucurestiul-disparut.web.app',
            base: '/historic-city-map-maker/',
        });
        expect(pagesBase({ owner: 'Ventura8', repo: 'ventura8.github.io' })).toBe('/');
    });

    it.each([
        ['no project file', null, /cannot read the project file/],
        ['a project without its repository', '{"projectId":"demo-hcm"}', /needs the project and its repository/],
    ])('badPath_%s', (_name, project, message) => {
        const files = nodeFileSystem(temporaryDir());
        if (project !== null) {
            files.write('infra/project.json', project);
        }

        expect(() => pagesRedirectTarget(files)).toThrow(message);
    });

    it('happyPath_underTheSiteBuildsLoaderTheScriptIsPlainJavaScript', () => {
        const result = strippedSource('pages-redirect.ts', 'PAGES_REDIRECT_SOURCE');

        expect(result.status).toBe(0);
        expect(result.diagnostics).toEqual([]);
        expect(result.stdout.trimEnd().endsWith('})(window);')).toBe(true);
        expect(result.stdout).not.toContain('FollowScope');
    });
});
