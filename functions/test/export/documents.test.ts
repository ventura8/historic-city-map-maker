/**
 * The export's own texts and page (`functions/src/export/documents.ts`, `page.ts`; M5 §5.1, §5.2): the owner's names
 * stay plain text in Markdown, and the page's policy names exactly the outside origins the exported manifest uses.
 */
import { describe, expect, it } from 'vitest';

import { exportReadme, markdownLine, rightsDocument } from '../../src/export/documents.js';
import { exportPage, exportSources } from '../../src/export/page.js';
import { KIT_PAGE, publishedManifest } from './world.js';

describe('markdownLine', () => {
    it('happyPath_aNameStaysOneLineOfPlainText', () => {
        expect(markdownLine('  Piața\n  Romană  ')).toBe('Piața Romană');
    });

    it('badPath_markupAndTableCharactersAreEscaped', () => {
        expect(markdownLine('# <b>a|b</b> *x* [l](u) `c` _d_ \\')).toBe('\\# \\<b\\>a\\|b\\</b\\> \\*x\\* \\[l\\](u) \\`c\\` \\_d\\_ \\\\');
    });
});

describe('rightsDocument', () => {
    it('happyPath_aPhotoWithoutRightsHolderNamesItsAuthorOrADash', () => {
        const [photo] = publishedManifest().photos;
        if (photo === undefined) {
            throw new Error('the world has photos');
        }
        const text = rightsDocument({ ro: 'Oraș', en: 'City' }, [
            { ...photo, license: 'permission', author: 'Ion Pop' },
            { ...photo, id: 'fara-autor', license: 'permission-legacy' },
        ]);

        expect(text).toContain('| `strand-1976` | Fotografia strand-1976 | Ion Pop | permission |');
        expect(text).toContain('| `fara-autor` | Fotografia strand-1976 | — | permission-legacy |');
    });
});

describe('exportReadme', () => {
    const MADE_AT = new Date('2026-11-12T10:00:00Z');

    it('happyPath_thePrefaceIsEnglishOnlyAndTheKitReadmeFollows @S-A53-HAPPY-ENGLISH-DOCS', () => {
        const text = exportReadme({ manifest: publishedManifest(), rasters: 0, kitReadme: '# Kit\n\nThe kit.\n', madeAt: MADE_AT });

        expect(text.split('\n')[0]).toBe('# The exported city: static export (2026-11-12)');
        expect(text).toContain('This archive holds everything the map The exported city needs');
        expect(text).not.toMatch(/Română|Această|export static/);
        expect(text.trimEnd().endsWith('# Kit\n\nThe kit.')).toBe(true);
        expect(rightsDocument({ ro: 'Oraș', en: 'City' }, [])).toBe(
            '# Rights\n\nThe photos below are published with their rights holders’ permission for the map City only.\n' +
                'Do not republish them elsewhere without their consent.\n\nNo photo has this restriction.\n',
        );
        const [photo] = publishedManifest().photos;
        if (photo === undefined) {
            throw new Error('the world has photos');
        }
        const rights = rightsDocument({ ro: 'Oraș', en: 'City' }, [
            { ...photo, license: 'permission', author: 'Ion Pop', title: { ro: 'Ștrandul', en: 'The lido' } },
        ]).split('\n');
        expect(rights).toContain('| Photo | Title | Rights holder | Licence |');
        expect(rights).toContain('| `strand-1976` | The lido | Ion Pop | permission |');
    });

    it('badPath_aNameWithMarkdownCharactersStaysOneEscapedHeading @S-A53-BAD-NAME-MARKUP', () => {
        const manifest = publishedManifest();
        const text = exportReadme({
            manifest: { ...manifest, city: { ...manifest.city, name: { ro: 'Oraș', en: '# A | *b*' } } },
            rasters: 1,
            kitReadme: '',
            madeAt: MADE_AT,
        });

        expect(text.split('\n')[0]).toBe('# \\# A \\| \\*b\\*: static export (2026-11-12)');
    });
});

describe('exportSources', () => {
    it('happyPath_tilesPmtilesPhotosAndAnHttpsStyleAreNamed_relativeAndMapboxOnesAreNot', () => {
        const manifest = publishedManifest();
        const sources = exportSources({
            ...manifest,
            city: { ...manifest.city, basemap: { style: 'https://styles.example.test/style.json' } },
            layers: [
                ...manifest.layers,
                {
                    ...manifest.layers[0],
                    id: 'pm',
                    source: { type: 'pmtiles', url: 'https://pm.example.test/a.pmtiles' },
                } as (typeof manifest.layers)[number],
                {
                    ...manifest.layers[0],
                    id: 'local',
                    source: { type: 'pmtiles', url: 'tiles/a.pmtiles' },
                } as (typeof manifest.layers)[number],
            ],
        });

        expect(sources).toEqual({
            connect: ['https://pm.example.test', 'https://styles.example.test', 'https://tiles.example.test'],
            images: [
                'https://images.example.test',
                'https://pm.example.test',
                'https://storage.googleapis.com',
                'https://tiles.example.test',
            ],
        });
    });

    it('badPath_aStyleWhoseHostWouldEndTheDirectiveIsLeftOut @S-A53-BAD-STYLE-HOST', () => {
        // A WHATWG URL allows `;` and `'` in a host: this origin is `https://a.example.test;connect-src` (docs/LESSONS.md 241).
        const manifest = publishedManifest();
        const sources = exportSources({
            ...manifest,
            city: { ...manifest.city, basemap: { style: "https://a.example.test;connect-src/x;font-src/'unsafe-inline'" } },
        });

        expect(sources.connect).toEqual(['https://tiles.example.test']);
        expect(new URL(`https://a.example.test;connect-src/x`).origin).toBe('https://a.example.test;connect-src');
    });
});

describe('exportPage', () => {
    it('happyPath_thePolicyNamesNoTelemetryHostAndNoInjectedDirective', () => {
        const manifest = publishedManifest();
        const page = exportPage(KIT_PAGE, {
            ...manifest,
            city: { ...manifest.city, basemap: { style: 'https://a.example.test;base-uri/x' } },
        });
        const policy = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(page)?.[1] ?? '';

        for (const host of ['google-analytics.com', 'googletagmanager.com', 'firebase.googleapis.com', 'a.example.test']) {
            expect(policy).not.toContain(host);
        }
        expect(policy).toContain("connect-src 'self' https://api.mapbox.com");
        expect(policy.split('; ').filter((directive) => directive.startsWith('base-uri'))).toEqual(["base-uri 'none'"]);
    });

    it('happyPath_theKitPageCarriesTheCitysNameAndColourInRomanian', () => {
        const page = exportPage(KIT_PAGE, publishedManifest());

        expect(page).toContain('<html lang="ro">');
        expect(page).toContain('<h1 class="hcm-visually-hidden">Orașul | exportat</h1>');
        expect(page).toContain(`<meta name="theme-color" content="${publishedManifest().city.theme.seedColor}" />`);
        expect(page).toContain('content="Orașul | exportat: hartă istorică, fotografii vechi și locuri dispărute pe harta de azi."');
    });
});
