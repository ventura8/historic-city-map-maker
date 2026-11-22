import type { Page } from '@playwright/test';
import { validateManifest, type Locale, type MessageKey } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, MOCK_API_ORIGIN, type Rgb } from '../../fixtures/world.js';
import {
    blend,
    colourDistance,
    expectColourAt,
    mapFacts,
    pixelsOfColour,
    probeArea,
    renderedFeatureIds,
    screenPointOf,
    styleFacts,
    type LngLat,
} from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, manifestIssues, openLayers, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * Points of interest (behaviour V24, PLAN Addendum 3) from the fixture set scripts/seed/e2e-pois.json
 * (docs/research/M1-interfaces.md §10): drawn as icons, lines and filled blocks in their category colours, filtered by
 * every stop of the timeline, and opened in the same detail sheet as photos, where their Markdown description stays text.
 */

const POI_VIEW = '16/44.42680/26.08720';
const ALL_POIS_VIEW = '15/44.42780/26.08780';
const CLADIRE: LngLat = [26.0872, 44.4285];
const CVARTAL_INSIDE: LngLat = [26.0863, 44.42695];
const STRADA_ON_LINE: LngLat = [26.0882, 44.42598];
const EVENIMENT: LngLat = [26.0905, 44.43];

const COLOURS = { cladiri: '#8B5E3C', strazi: '#B3261E', evenimente: '#386A20' } as const;
const TITLES = {
    cladire: { ro: 'Clădire demolată (fixture)', en: 'Demolished building (fixture)' },
    category: { ro: 'Clădiri dispărute', en: 'Vanished buildings' },
} as const;
const LINKED_PHOTO = { id: 'uranus-colt-mihai-voda', title: 'Uranus - Mihai Vodă' } as const;

const WHITE: Rgb = [255, 255, 255];

/** The streets' default opacity (scripts/seed/e2e-pois.json) and the casing's own share of it (packages/ui/src/map/pois.ts). */
const STREETS_OPACITY = 0.8;
const CASING_OPACITY = 0.9;

/** The street line at the probe over `ground`: its colour over the white casing, both at the category's opacity. */
function streetLineOver(ground: Rgb): Rgb {
    return blend(rgb(COLOURS.strazi), casingOver(ground), STREETS_OPACITY);
}

/** The casing beside the line over `ground`. */
function casingOver(ground: Rgb): Rgb {
    return blend(WHITE, ground, STREETS_OPACITY * CASING_OPACITY);
}

function rgb(hex: string): Rgb {
    const value = Number.parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** How far the pixels of the label line under an icon stand out from the basemap (a word gap may sit at its centre). */
async function labelContrast(page: Page, icon: { x: number; y: number }): Promise<number> {
    let contrast = 0;
    for (const dx of [-30, -18, -6, 6, 18, 30]) {
        contrast = Math.max(contrast, colourDistance(await probeArea(page, { x: icon.x + dx, y: icon.y + 28 }, 1), BASEMAP_BACKGROUND));
    }
    return contrast;
}

async function openPoi(page: Page, lngLat: LngLat): Promise<void> {
    const point = await screenPointOf(page, lngLat);
    await page.mouse.click(point.x, point.y);
}

/** Closes the Layers sheet where it is modal; a docked Layers pane has no visible close button and stays open. */
async function closeLayersSheet(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

function poiSheet(page: Page) {
    return viewer(page).locator('hcm-poi-detail');
}

test(
    'POIs are drawn in their category colours and open their details, whose photo thumbnails open the photo',
    { tag: '@S-V24-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: POI_VIEW });
        const icon = await screenPointOf(page, CLADIRE);
        await expectColourAt(page, { x: icon.x, y: icon.y + 10 }, rgb(COLOURS.cladiri), 'the building icon disc', { radius: 1 });
        await expectColourAt(
            page,
            await screenPointOf(page, STRADA_ON_LINE),
            streetLineOver(BASEMAP_BACKGROUND),
            'the street line at 80 %',
            {
                radius: 0,
            },
        );
        await expectColourAt(
            page,
            await screenPointOf(page, CVARTAL_INSIDE),
            blend(rgb(COLOURS.cladiri), BASEMAP_BACKGROUND, 0.35),
            'the block fill',
            { tolerance: 4 },
        );

        await openPoi(page, CLADIRE);
        await expect(page.getByRole('heading', { name: TITLES.cladire[lang] })).toBeVisible();
        const details = poiSheet(page);
        await expect(details).toContainText(t(lang, 'poi.category', { category: TITLES.category[lang] }));
        await expect(details).toContainText(t(lang, 'poi.yearEnd', { yearEnd: '1984' }));
        await expect(details.locator('strong')).toHaveText(lang === 'ro' ? 'Demolată' : 'Demolished');
        await expect(details.getByRole('link', { name: lang === 'ro' ? 'Fișa locului' : 'Place record' }).first()).toHaveAttribute(
            'href',
            'https://example.org/poi/cladire',
        );
        await expect(details.getByRole('heading', { name: t(lang, 'poi.photos') })).toBeVisible();
        expect(await engineEvents(page, 'hcm-poi-open')).toEqual([{ poiId: 'fixture-cladire' }]);

        await details.getByRole('button', { name: t(lang, 'poi.openPhoto', { title: LINKED_PHOTO.title }) }).click();
        await expect(page.getByRole('heading', { name: LINKED_PHOTO.title, exact: true })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: LINKED_PHOTO.id }]);
    },
);

test('POI labels show from zoom 16 and not below', { tag: '@S-V24-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: POI_VIEW });
    // The photos are switched off: below zoom 16 their clusters would sit next to the building.
    await openLayers(page, lang);
    await page.getByRole('switch', { name: t(lang, 'layers.photos'), exact: true }).click();
    await closeLayersSheet(page, lang);
    await expect
        .poll(async () => labelContrast(page, await screenPointOf(page, CLADIRE)), { message: 'a label under the icon at zoom 16' })
        .toBeGreaterThan(20);

    await page.evaluate(() => {
        location.hash = location.hash.replace(/^#16\//, '#15/');
    });
    await expect.poll(async () => (await mapFacts(page)).zoom).toBeLessThan(15.5);
    await expect
        .poll(async () => labelContrast(page, await screenPointOf(page, CLADIRE)), { message: 'no label below zoom 16' })
        .toBeLessThanOrEqual(6);
});

/** The dark ground of a satellite photo (Mapbox Standard Satellite in the live test of 2026-11-01), for the basemap. */
const SATELLITE_GROUND: Rgb = [52, 64, 44];

/** The basemap's style with the satellite's dark ground for its background: the mock's own style, its colour changed. */
async function serveSatelliteGround(page: Page): Promise<void> {
    await page.route(/^https:\/\/api\.mapbox\.com\/styles\/v1\/[\w.-]+\/[\w.-]+\?/, async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${MOCK_API_ORIGIN}/h/${url.hostname}${url.pathname}${url.search}` });
        const style = (await response.json()) as { readonly layers: readonly Json[] };
        const ground = { 'background-color': `rgb(${SATELLITE_GROUND.join(', ')})` };
        const layers = style.layers.map((layer) => (layer['id'] === 'background' ? { ...layer, paint: ground } : layer));
        await route.fulfill({ response, json: { ...style, layers } });
    });
}

/** Points three pixels to either side of the street line (it runs nearly east to west there), on its white casing. */
async function besideTheStreet(page: Page): Promise<readonly { x: number; y: number }[]> {
    const line = await screenPointOf(page, STRADA_ON_LINE);
    return [
        { x: line.x, y: line.y - 3 },
        { x: line.x, y: line.y + 3 },
    ];
}

test(
    'On the dark ground of a satellite photo a street line stands out on its white casing',
    { tag: '@S-V24-HAPPY-LINE-CASING' },
    async ({ page, lang }) => {
        await serveSatelliteGround(page);
        await openViewer(page, { lang, hash: POI_VIEW });
        // Finding 36 of 2026-11-01: the line in its dark category colour almost disappeared on the photo; its casing
        // keeps a light band on both sides, and the line's own colour on it.
        await expectColourAt(page, await screenPointOf(page, STRADA_ON_LINE), streetLineOver(SATELLITE_GROUND), 'the street line', {
            radius: 0,
        });
        for (const beside of await besideTheStreet(page)) {
            await expectColourAt(page, beside, casingOver(SATELLITE_GROUND), 'the casing beside the line', { radius: 0, tolerance: 24 });
            expect(colourDistance(await probeArea(page, beside, 0), SATELLITE_GROUND)).toBeGreaterThan(100);
        }
    },
);

test(
    'At 0 % opacity a street line and its casing are both gone from the satellite ground',
    { tag: '@S-V24-BAD-CASING-AT-ZERO-OPACITY' },
    async ({ page, lang }) => {
        await serveSatelliteGround(page);
        await openViewer(page, { lang, hash: `${POI_VIEW}&op=strazi:0` });
        await expectColourAt(page, await screenPointOf(page, STRADA_ON_LINE), SATELLITE_GROUND, 'no line at 0 %', { radius: 0 });
        for (const beside of await besideTheStreet(page)) {
            await expectColourAt(page, beside, SATELLITE_GROUND, 'no casing at 0 %', { radius: 0 });
        }
    },
);

/** The fixture with its two layers moved to 1890 and 1990, so the timeline has stops around the POI years. */
function withStops1890And1990(): Json {
    const manifest = siteManifestData();
    const [early, late] = manifest['layers'] as [Json, Json];
    early['year'] = 1890;
    late['year'] = 1990;
    return manifest;
}

test('Every POI stays on the map at every stop of the timeline', { tag: '@S-V24-HAPPY-EVERY-STOP' }, async ({ page, lang }) => {
    await serveManifest(page, withStops1890And1990());
    await openViewer(page, { lang, hash: ALL_POIS_VIEW });
    const slider = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
    const all = ['fixture-cladire', 'fixture-cvartal', 'fixture-eveniment', 'fixture-strada'];
    await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toEqual(all);

    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1890' }));
    await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toEqual(all);

    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1990' }));
    await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toEqual(all);
    await expectColourAt(
        page,
        await screenPointOf(page, EVENIMENT).then((at) => ({ x: at.x, y: at.y + 10 })),
        rgb(COLOURS.evenimente),
        'the event is still drawn',
        {
            radius: 1,
        },
    );
});

test(
    'Markup in a POI description stays text; only https links become links',
    { tag: '@S-V24-BAD-MARKUP-IS-TEXT' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: POI_VIEW });
        await openPoi(page, CLADIRE);

        const description = poiSheet(page).locator('.description');
        await expect(description).toContainText(lang === 'ro' ? '<b>Acesta nu este HTML</b>' : '<b>This is not HTML</b>');
        await expect(description.locator('b')).toHaveCount(0);
        const links = description.getByRole('link');
        await expect(links).toHaveCount(1);
        await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect(links.first()).toHaveAttribute('href', /^https:\/\//);
    },
);

interface Breakage {
    readonly name: string;
    readonly code: MessageKey;
    readonly breakIt: (pois: Json[]) => void;
}

const BREAKAGES: readonly Breakage[] = [
    {
        name: 'an unclosed polygon ring',
        code: 'validation.ringClosed',
        breakIt: (pois) => {
            const block = pois.find((poi) => poi['id'] === 'fixture-cvartal');
            const [ring] = (block?.['geometry'] as { coordinates: [number[][]] }).coordinates;
            ring.pop();
        },
    },
    {
        name: 'a POI in an unknown category',
        code: 'validation.reference',
        breakIt: (pois) => {
            const event = pois.find((poi) => poi['id'] === 'fixture-eveniment');
            Object.assign(event ?? {}, { category: 'nu-exista' });
        },
    },
];

for (const breakage of BREAKAGES) {
    test(`A manifest with ${breakage.name} is refused, naming the issue`, { tag: '@S-V24-BAD-INVALID-POI' }, async ({ page, lang }) => {
        const manifest = siteManifestData();
        breakage.breakIt(manifest['pois'] as Json[]);
        const issues = manifestIssues(validateManifest(manifest));
        const issue = issues.find((candidate) => candidate.code === breakage.code);
        expect(issue, `validateManifest reports ${breakage.code}`).toBeDefined();
        await serveManifest(page, manifest);
        await page.goto(`/bucharest/?lang=${lang}`);

        const card = page.getByRole('alert');
        await expect(card).toContainText(t(lang, 'error.manifest.invalid', { count: String(issues.length) }));
        await expect(card).toContainText(`${issue?.path ?? ''}: ${t(lang, breakage.code)}`);
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
    });
}

test('A city without POIs has no Places group and no POI map layers', { tag: '@S-V24-BAD-NO-POIS' }, async ({ page, lang }) => {
    await serveManifest(page, siteManifestData({ pois: false }));
    await openViewer(page, { lang, hash: POI_VIEW });

    expect((await mapFacts(page)).layers.filter((id) => id.startsWith('hcm-poi-'))).toEqual([]);
    await openLayers(page, lang);
    await expect(viewer(page).getByRole('heading', { name: t(lang, 'layers.group.historical') })).toBeVisible();
    await expect(viewer(page).getByRole('heading', { name: t(lang, 'layers.group.places') })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: t(lang, 'layers.opacity', { name: TITLES.category[lang] }) })).toHaveCount(0);
});

test(
    'A category icon the engine does not bundle is drawn with the default pin',
    { tag: '@S-V24-BAD-UNBUNDLED-ICON' },
    async ({ page, lang }) => {
        const warnings: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'warning') {
                warnings.push(message.text());
            }
        });
        await openViewer(page, { lang, hash: '16/44.42950/26.09000' });

        const facts = await styleFacts(page, 'hcm-poi-evenimente-symbol', 'icon-image', 'hcm-poi-icon-location_on');
        expect(facts.layout).toBe('hcm-poi-icon-location_on');
        expect(facts.hasImage).toBe(true);
        const event = await screenPointOf(page, EVENIMENT);
        await expectColourAt(page, { x: event.x, y: event.y + 10 }, rgb(COLOURS.evenimente), 'the event disc', { radius: 1 });
        expect(warnings.filter((warning) => /image|celebration/i.test(warning))).toEqual([]);
    },
);

test(
    'A place with no years says its years are unknown, research ongoing; a dated place never does',
    { tag: ['@S-V24-HAPPY-NO-YEARS', '@S-V24-BAD-NO-YEARS'] },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '16/44.42950/26.09000' });

        await openPoi(page, EVENIMENT);
        await expect(poiSheet(page)).toContainText(t(lang, 'poi.yearsUnknown'));

        await openViewer(page, { lang, hash: POI_VIEW });
        await openPoi(page, CLADIRE);
        await expect(page.getByRole('heading', { name: TITLES.cladire[lang] })).toBeVisible();
        await expect(poiSheet(page)).not.toContainText(t(lang, 'poi.yearsUnknown'));
    },
);

const ICON_FONT = '**/engine/fonts/material-symbols-rounded.woff2';
const ICON_FONT_FACE = '24px "HCM Material Symbols Rounded"';

/**
 * Playwright's screenshots wait for the page's fonts, so nothing is probed while the font is held: the held state is
 * read from `document.fonts`, the map's from its own idle event (`openViewer`).
 */
test(
    'An icon font that arrives after the map settled still draws the POI glyphs, without moving the map',
    { tag: '@S-V24-BAD-ICON-FONT-LATE' },
    async ({ page, lang }) => {
        let release = (): void => undefined;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        await page.route(ICON_FONT, async (route) => {
            await held;
            await route.fallback();
        });
        await openViewer(page, { lang, hash: POI_VIEW });
        expect(await page.evaluate((face) => document.fonts.check(face), ICON_FONT_FACE), 'the icon font is still held').toBe(false);
        const icon = await screenPointOf(page, CLADIRE);

        release();
        await expect
            .poll(() => pixelsOfColour(page, icon, WHITE), { message: 'the white glyph appears on the idle map' })
            .toBeGreaterThan(0);
        await expectColourAt(page, { x: icon.x, y: icon.y + 10 }, rgb(COLOURS.cladiri), 'the building disc around it', { radius: 1 });
    },
);
