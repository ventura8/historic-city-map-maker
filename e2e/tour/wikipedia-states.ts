import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { siteManifestData, type Json } from '../fixtures/manifest.js';
import { mapIdle, screenPointOf, type LngLat } from '../support/map.js';
import { openLayers, openViewer, serveManifest, t, viewer, visibilitySwitch } from '../support/viewer.js';

/** The tour's states of M31's Wikipedia overlay (V90; docs/research/M31-wikipedia.md), from e2e/tour/states.ts. */

interface WikipediaState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
}

export const WIKIPEDIA_LABEL = 'Wikipedia';
const WIKIPEDIA_FILE_ROUTE = '**/bucharest/data/wikipedia.json';
const WIKIPEDIA_THUMB_ROUTE = '**/bucharest/data/wikipedia/ro-1.png';
/** Where the article lies (near the Romanian Athenaeum's fixture place, inside the city). */
const ARTICLE_AT: LngLat = [26.0973, 44.4413];

/** A 1×1 PNG: the article's free thumbnail, as the server copies it beside the manifest. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

/** The file the server writes: one article on both Wikipedias, with a thumbnail. */
function wikipediaFile(): Json {
    return {
        version: 1,
        generatedAt: '2026-11-22T08:00:00.000Z',
        attribution: 'Wikipedia (CC BY-SA 4.0)',
        articles: [
            {
                id: 'ro-1',
                lng: ARTICLE_AT[0],
                lat: ARTICLE_AT[1],
                versions: {
                    ro: {
                        title: 'Ateneul Român',
                        extract: 'Sală de concerte din centrul Bucureștiului.',
                        url: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n',
                    },
                    en: {
                        title: 'Romanian Athenaeum',
                        extract: 'A concert hall in the centre of Bucharest.',
                        url: 'https://en.wikipedia.org/wiki/Romanian_Athenaeum',
                    },
                },
                thumb: 'wikipedia/ro-1.png',
            },
        ],
    };
}

/** The fixture with the overlay's category (hidden at open) and the file's reference, as the manifest builder adds them. */
function wikipediaManifest(): Json {
    const manifest = siteManifestData();
    (manifest['poiCategories'] as Json[]).push({
        ...{ id: 'wikipedia', label: { ro: WIKIPEDIA_LABEL, en: WIKIPEDIA_LABEL }, icon: 'info', color: '#3c4043', defaultOpacity: 1 },
        ...{ defaultVisible: false, attribution: 'Wikipedia (CC BY-SA 4.0)' },
    });
    manifest['wikipedia'] = { file: 'wikipedia.json', count: 1, generatedAt: '2026-11-22T08:00:00.000Z' };
    return manifest;
}

/** Serves the manifest, the file and the thumbnail (`file`: false answers the file with a 404). */
export async function serveWikipedia(page: Page, file = true): Promise<void> {
    await serveManifest(page, wikipediaManifest());
    await page.route(WIKIPEDIA_FILE_ROUTE, (route) =>
        file ? route.fulfill({ json: wikipediaFile() }) : route.fulfill({ status: 404, body: '' }),
    );
    await page.route(WIKIPEDIA_THUMB_ROUTE, (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
}

/** Clicks the article's place on the map (a modal Layers sheet closed first). */
export async function openArticle(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
    await mapIdle(page);
    const point = await screenPointOf(page, ARTICLE_AT);
    await page.mouse.click(point.x, point.y);
    await expect(viewer(page).locator('hcm-poi-detail img.picture')).toBeVisible();
}

export const WIKIPEDIA_STATES = {
    'layers-wikipedia': {
        title: 'The Layers panel with the Wikipedia overlay switched on',
        enter: async ({ page, lang }) => {
            await openLayers(page, lang);
            const wikipedia = visibilitySwitch(page, lang, WIKIPEDIA_LABEL);
            await wikipedia.click();
            await expect(wikipedia).toHaveAttribute('aria-checked', 'true');
            await mapIdle(page);
        },
    },
    'wikipedia-article': {
        title: 'A Wikipedia article open in the sheet: its picture, extract, link and credit',
        enter: async ({ page, lang }) => {
            await openArticle(page, lang);
        },
    },
} as const satisfies Record<string, WikipediaState>;

export const WIKIPEDIA_JOURNEY = {
    title: 'Wikipedia: switched on in Layers, one article open',
    id: 'wikipedia',
    boot: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
        await serveWikipedia(page);
        await openViewer(page, { lang, hash: '16/44.44130/26.09730' });
    },
    states: ['layers-wikipedia', 'wikipedia-article'] as const,
};
