/** The starter kit's page: `fillKitPage`, `readKitEngine` (M5 kit-cli; docs/research/M5-interfaces.md §3.2). */
import { readFileSync } from 'node:fs';

import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';

import {
    fillKitPage,
    isUnpinned,
    KIT_UNPINNED_INTEGRITY,
    kitContentSecurityPolicy,
    KitPageError,
    kitResult,
    readKitEngine,
    readKitPolicy,
    type KitEngine,
    type KitRelease,
} from '../../src/kit/page.js';
import { engineCdnBase } from '../../src/schemas/engine-release.js';

const ROOT = new URL('../../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, ROOT), 'utf8');

/** Generated test digests (64 base64 characters each), never a real file's. */
const sri = (letter: string): string => `sha384-${letter.repeat(64)}`;

const RELEASE: KitRelease = {
    base: engineCdnBase('1.2.3'),
    files: [
        { path: 'engine.css', integrity: sri('c') },
        { path: 'engine.iife.js', integrity: sri('j') },
        { path: 'engine.mjs', integrity: sri('m') },
    ],
};
const CDN: KitEngine = { kind: 'cdn', release: RELEASE };
const LOCAL: KitEngine = { kind: 'local' };

/** The shape of the committed template, every slot once. */
const TEMPLATE = [
    '<!doctype html>',
    '<html lang="ro">',
    '    <head>',
    '        <meta charset="utf-8" />',
    '        <meta',
    '            http-equiv="Content-Security-Policy"',
    '            content="default-src \'none\'"',
    '        />',
    '        <meta name="description" content="Descriere" />',
    '        <meta name="theme-color" content="#8B5E3C" />',
    '        <title>Orașul meu</title>',
    '        <!-- hcm:engine -->',
    '        <!-- /hcm:engine -->',
    '    </head>',
    '    <body class="hcm-fullpage">',
    '        <main>',
    '            <h1 class="hcm-visually-hidden">Orașul meu</h1>',
    '            <hcm-map-viewer manifest-url="city.json" lang="ro">',
    '                <p class="hcm-note" lang="ro">Harta se încarcă.</p>',
    '            </hcm-map-viewer>',
    '        </main>',
    '    </body>',
    '</html>',
    '',
].join('\n');

async function prettierFormatted(html: string): Promise<string> {
    const config = JSON.parse(read('.prettierrc.json')) as prettier.Options;
    return prettier.format(html, { ...config, parser: 'html' });
}

describe('fillKitPage', () => {
    it('happyPath_theCommittedTemplateIsItsOwnFill', () => {
        const template = read('templates/starter-kit/index.html');

        expect(fillKitPage(template, { engine: readKitEngine(template) })).toBe(template);
    });

    it('happyPath_everySlotIsSetAndEscaped', () => {
        const page = fillKitPage(TEMPLATE, {
            engine: LOCAL,
            lang: 'en',
            title: 'Cluj & "Napoca" <old>',
            description: 'Old\nphotos & places',
            themeColor: '#3D6B8C',
            heading: 'Cluj <1900>',
            manifestUrl: 'data/city.json',
        });

        expect(page).toContain('<html lang="en">');
        expect(page).toContain('<hcm-map-viewer manifest-url="data/city.json" lang="en">');
        expect(page).toContain('<title>Cluj &amp; "Napoca" &lt;old&gt;</title>');
        expect(page).toContain('<meta name="description" content="Old photos &amp; places" />');
        expect(page).toContain('<meta name="theme-color" content="#3D6B8C" />');
        expect(page).toContain('<h1 class="hcm-visually-hidden">Cluj &lt;1900&gt;</h1>');
        expect(page).toContain(`content="${kitContentSecurityPolicy(LOCAL)}"`);
        expect(page).toContain(
            [
                '        <!-- hcm:engine -->',
                '        <link rel="stylesheet" href="engine/engine.css" />',
                '        <script src="engine/engine.iife.js" defer></script>',
                '        <!-- /hcm:engine -->',
            ].join('\n'),
        );
        // Everything outside the slots is untouched.
        expect(page.split('\n').filter((line) => !TEMPLATE.includes(line))).toHaveLength(9);
        expect(page).toContain('<p class="hcm-note" lang="ro">Harta se încarcă.</p>');
    });

    it('happyPath_aSlotLeftOutKeepsTheTemplatesValue', () => {
        const page = fillKitPage(TEMPLATE, { engine: LOCAL, title: 'Bacău' });

        expect(page).toContain('<html lang="ro">');
        expect(page).toContain('<title>Bacău</title>');
        expect(page).toContain('<h1 class="hcm-visually-hidden">Orașul meu</h1>');
        expect(page).toContain('<meta name="description" content="Descriere" />');
    });

    it('happyPath_aReleasePinsBothFilesWithIntegrity', async () => {
        const page = fillKitPage(TEMPLATE, { engine: CDN });

        expect(page).toContain(
            `            href="${RELEASE.base}engine.css"\n            integrity="${sri('c')}"\n            crossorigin="anonymous"`,
        );
        expect(page).toContain(
            `            src="${RELEASE.base}engine.iife.js"\n            integrity="${sri('j')}"\n            crossorigin="anonymous"\n            defer\n        ></script>`,
        );
        expect(page).not.toContain('engine.mjs');
        expect(page).toContain(`script-src ${RELEASE.base} `);
        expect(page).toContain(`font-src ${RELEASE.base};`);
        expect(readKitEngine(page)).toEqual({
            kind: 'cdn',
            release: {
                base: RELEASE.base,
                files: [
                    { path: 'engine.css', integrity: sri('c') },
                    { path: 'engine.iife.js', integrity: sri('j') },
                ],
            },
        });
        expect(await prettierFormatted(page)).toBe(page);
        expect(await prettierFormatted(fillKitPage(page, { engine: LOCAL }))).toBe(fillKitPage(page, { engine: LOCAL }));
    });

    it('happyPath_aPageGoesFromOneEngineToTheOtherAndBack', () => {
        const local = fillKitPage(TEMPLATE, { engine: LOCAL });

        expect(readKitEngine(local)).toEqual(LOCAL);
        expect(fillKitPage(fillKitPage(local, { engine: CDN }), { engine: LOCAL })).toBe(local);
    });

    it('happyPath_aManifestsOwnOriginsJoinThePolicy', () => {
        const page = fillKitPage(TEMPLATE, { engine: LOCAL, sources: { connect: ['https://tiles.example.org'], images: [] } });

        expect(page).toContain('https://tiles.example.org');
        expect(readKitPolicy(page)).toBe(kitContentSecurityPolicy(LOCAL, { connect: ['https://tiles.example.org'], images: [] }));
    });

    it('badPath_aTemplateWithoutASlotOrWithTwoThrows', () => {
        const cases = [
            TEMPLATE.replace('<title>Orașul meu</title>', ''),
            TEMPLATE.replace('<title>Orașul meu</title>', '<title>Orașul <b>meu</b></title>'),
            TEMPLATE.replace('<h1 class="hcm-visually-hidden">Orașul meu</h1>', '<h1 class="hcm-visually-hidden">Orașul meu'),
            TEMPLATE.replace('<!-- /hcm:engine -->', ''),
            TEMPLATE.replace('        <!-- /hcm:engine -->', '        <!-- /hcm:engine -->\n        <!-- /hcm:engine -->'),
            TEMPLATE.replace('http-equiv="Content-Security-Policy"', ''),
            TEMPLATE.replace('<meta name="theme-color" content="#8B5E3C" />', '<meta name="theme-color" />'),
            TEMPLATE.replace('manifest-url="city.json" ', ''),
        ];

        for (const broken of cases) {
            expect(() => fillKitPage(broken, { engine: LOCAL, manifestUrl: 'city.json' })).toThrow(KitPageError);
        }
    });

    it('badPath_engineMarkersOutOfOrderOrMidLineThrow', () => {
        const swapped = TEMPLATE.replace('<!-- hcm:engine -->', '<!-- tmp -->')
            .replace('<!-- /hcm:engine -->', '<!-- hcm:engine -->')
            .replace('<!-- tmp -->', '<!-- /hcm:engine -->');
        const midLine = TEMPLATE.replace('        <!-- hcm:engine -->', '        <title>x</title><!-- hcm:engine -->').replace(
            '<title>Orașul meu</title>',
            '',
        );

        expect(() => fillKitPage(swapped, { engine: LOCAL })).toThrow(/open one first/);
        expect(() => fillKitPage(midLine, { engine: LOCAL })).toThrow(KitPageError);
    });

    it('badPath_valuesThePageMustNotCarryAreRefused', () => {
        const refused: Parameters<typeof fillKitPage>[1][] = [
            { engine: LOCAL, themeColor: 'red' },
            { engine: LOCAL, manifestUrl: 'javascript:alert(1)' },
            { engine: LOCAL, manifestUrl: '../city.json' },
            { engine: LOCAL, title: ' \n ' },
            { engine: LOCAL, lang: 'fr' as 'ro' },
            { engine: { kind: 'cdn', release: { ...RELEASE, base: 'http://cdn.example.org/engine/' } } },
            { engine: { kind: 'cdn', release: { ...RELEASE, base: 'https://cdn.example.org/engine' } } },
            { engine: { kind: 'cdn', release: { ...RELEASE, files: RELEASE.files.slice(1) } } },
            { engine: { kind: 'cdn', release: { ...RELEASE, files: [{ path: 'engine.css', integrity: 'sha256-x' }, ...RELEASE.files] } } },
        ];

        for (const values of refused) {
            expect(() => fillKitPage(TEMPLATE, values)).toThrow(KitPageError);
        }
    });
});

describe('fillKitPage: the tab icon', () => {
    it('happyPath_theTabIconIsSetOnlyWhenGiven', () => {
        const withIcon = TEMPLATE.replace('        <title>', '        <link rel="icon" href="data:," />\n        <title>');
        const icon = 'data:image/png;base64,iVBORw0KGgo=';

        expect(fillKitPage(withIcon, { engine: LOCAL, icon })).toContain(`<link rel="icon" href="${icon}" />`);
        expect(fillKitPage(withIcon, { engine: LOCAL })).toContain('<link rel="icon" href="data:," />');
        // A page without the icon link fills as before when no icon is given.
        expect(() => fillKitPage(TEMPLATE, { engine: LOCAL })).not.toThrow();
    });

    it('badPath_aTabIconThatIsNoPngDataAddressIsRefused', () => {
        const withIcon = TEMPLATE.replace('        <title>', '        <link rel="icon" href="data:," />\n        <title>');

        for (const icon of ['https://example.org/icon.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,"><script>']) {
            expect(() => fillKitPage(withIcon, { engine: LOCAL, icon })).toThrow(KitPageError);
        }
        expect(() => fillKitPage(TEMPLATE, { engine: LOCAL, icon: 'data:image/png;base64,iVBORw0KGgo=' })).toThrow(KitPageError);
    });
});

describe('readKitEngine', () => {
    it('badPath_anEngineBlockItCannotReadThrows', () => {
        const pinned = fillKitPage(TEMPLATE, { engine: CDN });
        const cases = [
            pinned.replace(`${RELEASE.base}engine.iife.js`, 'https://cdn.example.org/other/engine.iife.js'),
            pinned.replace(`integrity="${sri('j')}"`, ''),
            pinned.replace(`href="${RELEASE.base}engine.css"`, ''),
            pinned
                .replace(`${RELEASE.base}engine.css`, 'http://cdn.example.org/engine.css')
                .replace(`${RELEASE.base}engine.iife.js`, 'http://cdn.example.org/engine.iife.js'),
            TEMPLATE,
        ];

        for (const page of cases) {
            expect(() => readKitEngine(page)).toThrow(KitPageError);
        }
    });
});

describe('kitResult', () => {
    it('happyPath_aPageErrorIsReturnedAndAnyOtherErrorThrown', () => {
        expect(kitResult(() => readKitEngine(fillKitPage(TEMPLATE, { engine: LOCAL })))).toEqual({ ok: true, value: LOCAL });
        const refused = kitResult(() => readKitEngine(TEMPLATE));
        expect(refused.ok).toBe(false);
        expect(refused.ok ? null : refused.error).toBeInstanceOf(KitPageError);
        expect(() =>
            kitResult(() => {
                throw new TypeError('a bug');
            }),
        ).toThrow(TypeError);
    });
});

describe('isUnpinned', () => {
    it('happyPath_onlyTheTemplatesPlaceholderIsUnpinned', () => {
        const placeholder: KitEngine = {
            kind: 'cdn',
            release: { base: RELEASE.base, files: RELEASE.files.map((file) => ({ ...file, integrity: KIT_UNPINNED_INTEGRITY })) },
        };

        expect(isUnpinned(placeholder)).toBe(true);
        expect(isUnpinned(CDN)).toBe(false);
        expect(isUnpinned(LOCAL)).toBe(false);
    });
});

describe('readKitPolicy', () => {
    it('happyPath_anExportsPageNamesNoTelemetryHost', () => {
        const page = fillKitPage(TEMPLATE, { engine: LOCAL, analytics: false });

        expect(readKitPolicy(page)).toBe(kitContentSecurityPolicy(LOCAL, undefined, false));
        expect(readKitPolicy(page)).not.toContain('googletagmanager');
    });

    it('badPath_aPolicyMetaWithoutContentReadsAsNone', () => {
        const page = TEMPLATE.replace(/(http-equiv="Content-Security-Policy")\s+content="[^"]*"/, '$1');

        expect(readKitPolicy(page)).toBe('');
    });
});
