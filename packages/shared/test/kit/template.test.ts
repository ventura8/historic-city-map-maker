/**
 * The committed starter kit (`templates/starter-kit/`, M5 kit-cli; docs/research/M5-interfaces.md §3.1–§3.3): its
 * `city.json` is a valid City Manifest v1 that ships nothing whose rights would not travel, and its page pins Mapbox
 * GL JS with the digests of the exact release the repository pins.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DEFAULT_FAVICON_DATA_URL } from '../../src/kit/map-icon.js';
import { KIT_PLACEHOLDER_TOKEN, readKitEngine } from '../../src/kit/page.js';
import { NEW_CITY_SEEDS } from '../../src/schemas/cities.js';
import { photoSchema } from '../../src/schemas/manifest.js';
import { validateManifest } from '../../src/schemas/validation.js';

const ROOT = new URL('../../../../', import.meta.url);
const KIT = 'templates/starter-kit/';

function sri(path: string): string {
    return `sha384-${createHash('sha384')
        .update(readFileSync(new URL(path, ROOT)))
        .digest('base64')}`;
}

describe('the template city.json', () => {
    it('happyPath_anExampleCityWithPlacesAndNoPhotos', () => {
        const result = validateManifest(JSON.parse(readFileSync(new URL(`${KIT}city.json`, ROOT), 'utf8')));
        const manifest = result.ok ? result.value : null;

        expect(result.ok).toBe(true);
        expect(manifest?.city.id).toBe('orasul-meu');
        expect(manifest?.city.name).toEqual({ ro: 'Orașul meu', en: 'My city' });
        expect(manifest?.city.theme.seedColor).toBe(NEW_CITY_SEEDS[0]);
        expect(manifest?.city.basemap.style).toBe('mapbox://styles/mapbox/standard');
        expect(manifest?.city.analytics).toEqual({});
        expect(manifest?.photos).toEqual([]);
        expect(manifest?.layers).toEqual([]);
        expect(manifest?.poiCategories).toHaveLength(1);
        expect(manifest?.pois?.map((poi) => poi.geometry.type)).toEqual(['Point', 'LineString', 'Polygon']);
    });

    it('badPath_thePlaceholderTokenIsNoRealToken', () => {
        const text = readFileSync(new URL(`${KIT}city.json`, ROOT), 'utf8');

        expect(text).toContain(`"publicToken": "${KIT_PLACEHOLDER_TOKEN}"`);
        expect(text).not.toMatch(/"(?:sk|pk)\.ey/);
        expect(text).not.toMatch(/București|Bucharest|seed\/bucharest/);
    });
});

describe('the template README', () => {
    it('happyPath_itsPhotoExampleIsAValidPhoto', () => {
        // The UX review of M5 (#13): a photo needs `image` and `links`, which the README's step did not show. The README is in
        // English only since DECISIONS-for-review.md §157, so it shows the example once.
        const readme = readFileSync(new URL(`${KIT}README.md`, ROOT), 'utf8');
        const examples = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => JSON.parse(match[1] ?? '') as unknown);

        expect(examples).toHaveLength(1);
        for (const example of examples) {
            expect(photoSchema.safeParse(example).success).toBe(true);
        }
        expect(readme).not.toMatch(/create-historic-city@1 /);
    });
});

describe('the template index.html', () => {
    const page = readFileSync(new URL(`${KIT}index.html`, ROOT), 'utf8');

    it('happyPath_mapboxGlIsPinnedWithTheDigestsOfThePinnedRelease', () => {
        expect(page).toContain(
            `href="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.css"\n            integrity="${sri('node_modules/mapbox-gl/dist/mapbox-gl.css')}"`,
        );
        expect(page).toContain(
            `src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js"\n            integrity="${sri('node_modules/mapbox-gl/dist/mapbox-gl.js')}"`,
        );
    });

    it('happyPath_theEngineComesFromAPinnedJsDelivrFolder', () => {
        const engine = readKitEngine(page);

        expect(engine.kind).toBe('cdn');
        expect(engine.kind === 'cdn' ? engine.release.base : '').toMatch(
            /^https:\/\/cdn\.jsdelivr\.net\/gh\/ventura8\/historic-city-map-maker@v\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?\/cdn\/engine\/$/,
        );
    });

    it('badPath_noInlineScriptOrStyleAndANoteWhileTheEngineIsMissing', () => {
        expect(page).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
        expect(page).not.toMatch(/<style\b|\sstyle="/);
        expect(page).toMatch(/<hcm-map-viewer manifest-url="city\.json" lang="ro">\s*<p class="hcm-note" lang="ro">/);
        expect(page).toContain('<p class="hcm-note" lang="en">');
    });
});

describe('the template page’s tab icon', () => {
    it('happyPath_isTheDefaultMapIconInlined', () => {
        const page = readFileSync(new URL(`${KIT}index.html`, ROOT), 'utf8');

        expect(page).toContain(`href="${DEFAULT_FAVICON_DATA_URL}"`);
        expect(page).not.toContain('href="data:,"');
    });
});
