import {
    translateAdminContent,
    translateAdminShell,
    translateApiError,
    type AdminContentKey,
    type ApiErrorCode,
    type CityImagery,
} from '@hcm/shared';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { publishedTileColour } from '@hcm/test-support/fakes';
import { expect } from '@playwright/test';

import { BASEMAP_BACKGROUND } from '../../../fixtures/world.js';
import { blend, expectColourAt, mapFraction, mapIdle } from '../../../support/map.js';
import { closeModalSheet, openLayers, opacitySlider } from '../../../support/viewer.js';
import { projectCity } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS, type EmulatorWorld } from '../../support/emulators.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { ImageryWorld } from '../../support/imagery.js';
import { overlayFeatureIds } from '../../support/map.js';
import { seedCity } from '../../support/ops.js';
import { adminPath } from '../../support/test.js';
import type { UpstreamControl } from '../../support/upstream.js';

/**
 * The Imagery specs' world (docs/research/M3-interfaces.md §10.2, §13): the project's city made ready for imagery (a
 * locked spec: `setup/status`, `ops/guard` and the server's upstream world are singletons), the area's texts from the
 * catalogues, and where the page lists scenes and draws their footprints. Scenes come from the fake USGS through the real
 * harvest (`imagery.search` in the Functions emulator) unless a spec seeds them.
 */

/** When the world was seeded: a fixed time, never the wall clock. */
export const IMAGERY_AT = new Date('2026-10-20T09:00:00Z');

/**
 * A harvest the page must not repeat on its own: `HARVEST_EVERY_DAYS` is measured from the newest `harvestedAt` with the
 * browser's clock, so a seeded harvest in the far future encodes "recent" whatever the date of the run.
 */
export const FRESH_HARVEST = new Date('2100-01-01T00:00:00Z');

/** The five frames M3 targets over Bucharest (1966, 1976, 1977, 1978, 1980), all free in the fake USGS. */
export const TARGET_FRAMES = [
    'DS1035-1057DA023',
    'DZB1211-500043L007001',
    'DZB1213-500159L010001',
    'DZB1214-500094L005001',
    'D3C1216-200467A021',
] as const;

/** The free 1968 Corona frame (a year the target list does not want). */
export const FREE_1968 = 'DS1105-1071DF075';

/** The two frames that must be ordered (paid scans, M4). */
export const PAID_FRAMES = ['DS1105-1071DF076', 'D3C1209-100055F012'] as const;

/** An editor text of the Imagery area. */
export function imageryText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** A server error's message, as the page shows it. */
export function errorText(lang: 'ro' | 'en', code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return translateApiError(lang, code, params);
}

interface Fixtures {
    readonly emulators: EmulatorWorld;
    readonly api: APIRequestContext;
    readonly upstream: UpstreamControl;
}

/**
 * The project's city with its bounds, ready for imagery (`ImageryWorld.ready`); `published`, the city as Setup leaves it
 * once Mapbox is connected (About, the privacy text, the theme, the viewer's token: what a manifest build needs).
 */
export async function readyImagery(
    fixtures: Fixtures,
    uid: string,
    settings: CityImagery = {},
    options: { readonly published?: boolean } = {},
): Promise<ImageryWorld> {
    const city = projectCity(fixtures.emulators, uid);
    await (options.published === true ? seedPublicCity(city, IMAGERY_AT) : seedCity(city, IMAGERY_AT));
    const imagery = new ImageryWorld(fixtures.api, city, fixtures.upstream);
    await imagery.ready(IMAGERY_AT, settings);
    await imagery.resetRunner();
    return imagery;
}

/** The list of scenes (best first). */
export function sceneList(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('list', { name: imageryText(lang, 'adminContent.imagery.scenesLabel') });
}

/** The scenes' links in list order, as the ids of their addresses (`#/imagery/scene/<id>`). */
export async function listedScenes(page: Page, lang: 'ro' | 'en'): Promise<string[]> {
    const hrefs = await sceneList(page, lang)
        .getByRole('link')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    return hrefs.map((href) => href.slice(href.lastIndexOf('/') + 1));
}

/** The scenes the default filter (free only) lists once the page's own first search is in: the targets and 1968. */
const LISTED_FREE = TARGET_FRAMES.length + 1;

function sorted(ids: readonly string[]): string[] {
    return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Waits until the page's own first search is listed and ranked: every free scene, the five targets on top. Until then the
 * list grows and reorders, and the list's links are reused in place: a link found earlier may by then open another scene.
 */
export async function awaitHarvest(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await expect(sceneList(page, lang).getByRole('link')).toHaveCount(LISTED_FREE, { timeout: FUNCTIONS_TIMEOUT_MS });
    await expect.poll(async () => sorted((await listedScenes(page, lang)).slice(0, TARGET_FRAMES.length))).toEqual(sorted(TARGET_FRAMES));
}

/** The Import of one scene's card in the list (named after the scene, so every card's is its own). */
export function cardImport(page: Page, lang: 'ro' | 'en', entityId: string): Locator {
    return sceneList(page, lang)
        .locator(`li[data-scene="${entityId}"]`)
        .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') });
}

/**
 * Closes the snackbar that says the import started: the states that follow are about the version, and the snackbar's
 * own timer could end in the middle of their checks (the Tab round then lost its Close button).
 */
export async function closeImportNotice(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const notice = page.locator('hcm-snackbar').filter({ hasText: imageryText(lang, 'adminContent.imagery.notice.imported') });
    const close = notice.getByRole('button', { name: translateAdminShell(lang, 'adminShell.notice.close') });
    await close.click();
    await expect(notice).toBeHidden();
}

/**
 * Imports `scene` as an admin does after opening the area: Import on its card in the list (one click, through `click`,
 * a counted flow's when the spec counts them; docs/research/M3-interfaces.md §1, §10.2), then closes the notice that
 * says so. The version's id.
 */
export async function importFromList(
    page: Page,
    lang: 'ro' | 'en',
    scene: string,
    click: (target: Locator) => Promise<void> = (target) => target.click(),
): Promise<string> {
    await page.goto(adminPath(lang, 'imagery'));
    await awaitHarvest(page, lang);
    await click(cardImport(page, lang, scene));
    await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
    await closeImportNotice(page, lang);
    return versionIdOf(page);
}

/** The link of one scene in the list. */
export function sceneLink(page: Page, lang: 'ro' | 'en', entityId: string): Locator {
    return sceneList(page, lang).locator(`a[href$="/imagery/scene/${entityId}"]`);
}

/** The scores the list shows, in list order (`Score <n> of 100` of each link's name). */
export async function listedScores(page: Page, lang: 'ro' | 'en'): Promise<number[]> {
    const names = await sceneList(page, lang).getByRole('link').allInnerTexts();
    const pattern = new RegExp(imageryText(lang, 'adminContent.imagery.score', { score: '(\\d+)' }));
    return names.map((name) => Number(pattern.exec(name)?.[1] ?? Number.NaN));
}

/**
 * Opens a scene by its address, as a link from elsewhere does (the one-pane layouts hide the list while a scene is open,
 * and a phone's full-screen detail hides the navigation).
 */
export async function openScene(page: Page, entityId: string): Promise<void> {
    await page.evaluate((hash) => {
        window.location.hash = hash;
    }, `#/imagery/scene/${entityId}`);
}

/** The scene ids whose footprints the map draws: the open scene's alone, none without one (finding 51 of 2026-11-01). */
export function mapFootprints(page: Page): Promise<string[]> {
    return overlayFeatureIds(page, 'imagery-selected');
}

/**
 * The open scene or version: the page's detail pane. Its content is slotted into the kit's list and detail layout (light
 * DOM), not a descendant of the pane's region in the shadow root, so the slot is the scope (lesson 138's pitfall).
 */
export function detail(page: Page): Locator {
    return page.locator('hcm-imagery-page [slot="detail"]');
}

/** A version's state as its page shows it, next to its title (before the steps, whose states may use the same word). */
export function versionState(page: Page, lang: 'ro' | 'en', key: AdminContentKey): Locator {
    return detail(page).getByText(imageryText(lang, key), { exact: true }).first();
}

/** A step of the open version's job, as its list shows it (`<name> <state>`). */
export function stepRow(page: Page, lang: 'ro' | 'en', step: string): Locator {
    const name = translateAdminContent(lang, `adminContent.jobs.stepName.${step}` as AdminContentKey);
    return detail(page)
        .getByRole('list', { name: translateAdminContent(lang, 'adminContent.jobs.steps') })
        .getByRole('listitem')
        .filter({ hasText: name });
}

/** A step's state text (`Done`, `Pending`, …). */
export function stepStateText(lang: 'ro' | 'en', state: 'pending' | 'running' | 'done' | 'failed' | 'skipped'): string {
    return translateAdminContent(lang, `adminContent.jobs.step.${state}`);
}

/** A published layer as the specs follow it: its id, its tileset and its names. */
export interface PublishedLayer {
    readonly id: string;
    readonly tilesetId: string;
    readonly label: Readonly<Record<string, string>>;
}

/** The layer a version published, once its finalize created it (the layer's id, tileset and names). */
export async function publishedLayer(imagery: ImageryWorld, versionId: string, timeout: number): Promise<PublishedLayer> {
    await expect
        .poll(async () => (await imagery.version(versionId))?.['state'], { message: `version ${versionId} published`, timeout })
        .toBe('published');
    const version = await imagery.version(versionId);
    const mapbox = (version?.['mapbox'] ?? {}) as { tilesetId?: string };
    const label = (version?.['label'] ?? {}) as Readonly<Record<string, string>>;
    return { id: String(version?.['layerId']), tilesetId: String(mapbox.tilesetId), label };
}

/** An empty corner of the city (no photo, no place): only the basemap and the layers draw there. */
const EMPTY_CORNER = { lat: 44.37, lng: 25.97 } as const;

/** Sets the viewer's opacity slider of `name` with the keyboard: Home, then PageUp (+10) to `percent` (a multiple of 10). */
async function setOpacity(page: Page, lang: 'ro' | 'en', name: string, percent: number): Promise<void> {
    const slider = opacitySlider(page, lang, name);
    await slider.focus();
    await slider.press('Home');
    for (let step = 0; step < percent / 10; step += 1) {
        await slider.press('PageUp');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(percent));
}

/**
 * The viewer shows a published layer: the manifest the emulators built lists it, and the built site, served that manifest
 * with the layer on (`&layers=`), paints its tiles in the tileset's own colour (the fake MTS's tiles, from the server's
 * world) at `at` (an empty corner of the city by default); its Layers panel lists it with an opacity slider, and at 50 %
 * the map shows the blend of the tiles and the basemap.
 */
export async function expectLayerInViewer(
    page: Page,
    lang: 'ro' | 'en',
    imagery: ImageryWorld,
    layer: PublishedLayer,
    at: { readonly lat: number; readonly lng: number } = EMPTY_CORNER,
): Promise<void> {
    const world = imagery.cityWorld;
    const manifest = await awaitManifest(world, `lists layer ${layer.id}`, (built) => entry(built, 'layers', layer.id) !== undefined);
    await openPublicViewer(page, manifest, { lang, hash: `15/${at.lat.toFixed(5)}/${at.lng.toFixed(5)}&layers=${layer.id}` });
    const colour = publishedTileColour(layer.tilesetId);
    await expectColourAt(page, await mapFraction(page, 0.5, 0.5), colour, 'the published layer', { tolerance: 10 });

    await openLayers(page, lang);
    await setOpacity(page, lang, layer.label[lang] ?? String(layer.label['ro']), 50);
    await closeModalSheet(page);
    await mapIdle(page);
    await expectColourAt(page, await mapFraction(page, 0.5, 0.5), blend(colour, BASEMAP_BACKGROUND, 0.5), 'the layer at 50 %', {
        tolerance: 12,
    });
}

/** The version id of the page's address (`#/imagery/version/<id>`). */
export function versionIdOf(page: Page): string {
    const match = /#\/imagery\/version\/([\w-]+)/.exec(page.url());
    return match?.[1] ?? '';
}
