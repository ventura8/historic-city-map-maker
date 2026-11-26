import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy } from '../src/csp.js';
import { MAPBOX_GL_SCRIPT, MAPBOX_GL_VERSION, RELATIVE_ASSETS, renderSitePage } from '../src/page.js';
import { parseSiteSpec } from '../src/site-spec.js';
import { subresourceIntegrity } from '../src/sri.js';
import { ROOT, htmlValidateMessages } from './support.js';

function bucharestPage(): string {
    return renderSitePage({
        spec: parseSiteSpec(readFileSync(join(ROOT, 'sites/bucharest/site.json'), 'utf8')),
        csp: contentSecurityPolicy({ connect: ['https://telemetry.example'], images: [] }),
        mapboxGlIntegrity: { script: 'sha384-script' },
    });
}

describe('renderSitePage', () => {
    it('happyPath_passesTheRepositoryHtmlValidateRules', async () => {
        expect(await htmlValidateMessages(bucharestPage())).toEqual([]);
    });

    it('happyPath_theCspComesBeforeEveryResource', () => {
        const html = bucharestPage();
        const csp = html.indexOf('http-equiv="Content-Security-Policy"');

        expect(csp).toBeGreaterThan(html.indexOf('<meta charset="utf-8">'));
        expect(csp).toBeLessThan(html.indexOf('<link'));
        expect(csp).toBeLessThan(html.indexOf('<script'));
        expect(html).toContain("connect-src 'self' https://api.mapbox.com");
        expect(html).toContain('https://telemetry.example;');
    });

    it('happyPath_loadsPinnedMapboxWithIntegrityThenConfigThenTheEngineModule', () => {
        const html = bucharestPage();
        const scripts = [...html.matchAll(/<script [^>]*>/g)].map(([tag]) => tag);

        expect(scripts).toEqual([
            `<script src="${MAPBOX_GL_SCRIPT}" async integrity="sha384-script" crossorigin="anonymous">`,
            '<script src="config.js" defer>',
            // The tab icon in the visitor's theme (`tabIconSource`), after the configuration it reads.
            '<script src="tab-icon.js" defer>',
            '<script type="module" src="engine/engine.mjs">',
        ]);
        // No stylesheet from another origin holds back the first paint (the viewer links mapbox-gl.css in its shadow root).
        expect([...html.matchAll(/<link rel="stylesheet" href="([^"]*)"/g)].map(([, href]) => href)).toEqual([
            'engine/engine.css',
            'site.css',
        ]);
        expect(html).toContain('<link rel="stylesheet" href="engine/engine.css">');
        expect(html).toContain('<meta name="referrer" content="strict-origin-when-cross-origin">');
    });

    it('happyPath_aPageWithAnAppLinksItsManifestAndItsIconForIos', () => {
        const html = renderSitePage({
            spec: parseSiteSpec(readFileSync(join(ROOT, 'sites/bucharest/site.json'), 'utf8')),
            csp: "default-src 'none'",
            mapboxGlIntegrity: { script: 'sha384-script' },
            assets: { ...RELATIVE_ASSETS, manifest: 'app.webmanifest' },
        });

        expect(html).toContain('<link rel="manifest" href="app.webmanifest">');
        expect(html).toContain('<link rel="apple-touch-icon" href="app-icon-192.png">');
        expect(bucharestPage()).not.toContain('rel="manifest"');
    });

    it('happyPath_hasTheMountPointAndABilingualNoScriptNote', () => {
        const html = bucharestPage();

        expect(html).toContain('<html lang="ro">');
        expect(html).toContain('<title>București dispărut</title>');
        expect(html).toContain('<div id="historic-city-map"></div>');
        expect(html).toMatch(/<noscript>\n\s+<p lang="ro" class="site-noscript">Harta are nevoie de JavaScript\./);
        expect(html).toMatch(/<p lang="en" class="site-noscript">The map needs JavaScript\./);
    });

    it('happyPath_theMapIsTheMainLandmarkUnderTheSiteTitle', () => {
        // The tour's axe check: no main landmark, no level-one heading, and the viewer's chrome outside every landmark.
        const html = bucharestPage();
        const main = /<main>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';

        expect(main).toMatch(/^\s*<h1 class="hcm-visually-hidden" lang="ro">București dispărut<\/h1>/);
        expect(main).toContain('<div id="historic-city-map"></div>');
        expect(main).toContain('<noscript>');
        expect(html.match(/<main>/g)).toHaveLength(1);
    });

    it('badPath_noInlineScriptOrStyleCanAppear', () => {
        const html = bucharestPage();

        expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
        expect(html).not.toMatch(/<style|\sstyle=|\son[a-z]+=/);
    });

    it('happyPath_theHostingRootRunsItsRedirectFirstAndTheCityPageLoadsItsFilesFromTheRoot', () => {
        // M6 (docs/research/M6-interfaces.md §2.4, §2.7): the root's admin-redirect.js before anything loads; the generic
        // city page served at /<city>/ with absolute addresses.
        const spec = parseSiteSpec(readFileSync(join(ROOT, 'sites/bucharest/site.json'), 'utf8'));
        const integrity = { script: 'sha384-script' };
        const assets = { engineFolder: '/engine/', config: '/city/config.js', stylesheet: '/site.css', redirect: 'admin-redirect.js' };

        const html = renderSitePage({
            spec,
            csp: contentSecurityPolicy({ connect: [], images: [] }),
            mapboxGlIntegrity: integrity,
            assets,
        });

        expect([...html.matchAll(/<script [^>]*>/g)].map(([tag]) => tag)).toEqual([
            '<script src="admin-redirect.js">',
            `<script src="${MAPBOX_GL_SCRIPT}" async integrity="sha384-script" crossorigin="anonymous">`,
            '<script src="/city/config.js" defer>',
            '<script type="module" src="/engine/engine.mjs">',
        ]);
        expect(html).toContain('<link rel="stylesheet" href="/engine/engine.css">');
        expect(html).toContain('<link rel="stylesheet" href="/site.css">');
    });

    it('happyPath_theMapboxVersionIsThePinnedPackage', () => {
        const pinned = JSON.parse(readFileSync(join(ROOT, 'node_modules/mapbox-gl/package.json'), 'utf8')) as { version: string };

        expect(MAPBOX_GL_VERSION).toBe(pinned.version);
        expect(MAPBOX_GL_SCRIPT).toBe(`https://api.mapbox.com/mapbox-gl-js/v${pinned.version}/mapbox-gl.js`);
    });
});

describe('subresourceIntegrity', () => {
    it('happyPath_isTheBase64Sha384', () => {
        expect(subresourceIntegrity(new TextEncoder().encode('abc'))).toBe(
            'sha384-ywB1P0WjXou1oD1pmsZQBycsMqsO3tFjGotgWkP/W+2AhgcroefMI1i67KE0yCWn',
        );
    });
});
