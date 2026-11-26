import { translateAdminContent, type LngLat } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { mapPointOf } from '../../support/map.js';
import { imageryText, importFromList, publishedLayer } from './world.js';

/**
 * A published raster layer for the layer editor's specs (docs/research/M3-interfaces.md §6.4, §10.5): the 1966 frame
 * imported through the page and published by the policy (6.2 m under the city's 15 m), and the editor's Crop tool: its
 * phase, its buttons, its refusal, and a ring of corners clicked on the editor's map as a person clicks them.
 */

const SCENE = 'DS1035-1057DA023';

/** A publish waits for the fake MTS's job (fn-imagery's first poll is a minute later), then the manifest build. */
export const PUBLISH_TIMEOUT_MS = 240_000;

/** The 1966 frame imported and published without a click past Import: its version and its layer. */
export async function publishedFrame(
    page: Page,
    lang: 'ro' | 'en',
    imagery: ImageryWorld,
): Promise<{ readonly versionId: string; readonly layer: { readonly id: string; readonly tilesetId: string } }> {
    const versionId = await importFromList(page, lang, SCENE);
    return { versionId, layer: await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS) };
}

/** The editor's Crop button (its Image and geometry group). */
export function cropButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.layer.crop'), exact: true });
}

/** The open Crop tool (`data-phase`: loading, drawing, drawn, saving, no-map). */
export function cropTool(page: Page): Locator {
    return page.locator('hcm-layer-crop .crop');
}

/** One of the tool's buttons. */
export function cropAction(page: Page, lang: 'ro' | 'en', action: 'cropSave' | 'cropRedraw' | 'cropCorner'): Locator {
    return cropTool(page).getByRole('button', { name: imageryText(lang, `adminContent.imagery.layer.${action}`) });
}

/** The tool's Cancel, which closes it. */
export function cropCancel(page: Page, lang: 'ro' | 'en'): Locator {
    return cropTool(page).getByRole('button', { name: translateAdminContent(lang, 'adminContent.common.cancel') });
}

/** Where each corner is drawn on the editor's map now, in order. */
export async function cornerPoints(page: Page, ring: readonly LngLat[]): Promise<{ readonly x: number; readonly y: number }[]> {
    const points: { readonly x: number; readonly y: number }[] = [];
    for (const corner of ring) {
        points.push(await mapPointOf(page, corner));
    }
    return points;
}

type PanKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown';

/** The arrow that pans the map towards each side the places overflow. */
const PAN_KEYS: Readonly<Record<'left' | 'right' | 'top' | 'bottom', PanKey>> = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    top: 'ArrowUp',
    bottom: 'ArrowDown',
};

/** How far an arrow key pans the map (Mapbox's keyboard handler). */
const PAN_STEP = 100;
/** Keeps the corners this far inside the map box (Mapbox's logo and attribution at the bottom). */
const EDGE = 40;
/** The kit's zoom buttons at the top right of the box, which a corner must not fall on. */
const CONTROLS = { width: 64, height: 112 } as const;

interface Box {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

interface Point {
    readonly x: number;
    readonly y: number;
}

/** The box's right limit at a point's height (further in beside the zoom buttons). */
function rightLimit(point: Point, box: Box): number {
    return box.x + box.width - (point.y < box.y + CONTROLS.height ? CONTROLS.width : EDGE);
}

/** How far the points lie past each side of the box's inner area (a side with none is negative). */
function overflow(points: readonly Point[], box: Box): Record<keyof typeof PAN_KEYS, number> {
    const ys = points.map((point) => point.y);
    return {
        left: box.x + EDGE - Math.min(...points.map((point) => point.x)),
        right: Math.max(...points.map((point) => point.x - rightLimit(point, box))),
        top: box.y + EDGE - Math.min(...ys),
        bottom: Math.max(...ys) - (box.y + box.height - EDGE),
    };
}

type Move = PanKey | 'zoom-out' | null;

/** Whether the places' extent leaves less room in the box than one pan step (the arrows could then jump over it). */
function tooLarge(points: readonly Point[], box: Box): boolean {
    const span = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
    const room = (size: number): number => size - 2 * EDGE - CONTROLS.width / 2 - PAN_STEP;
    return span(points.map((point) => point.x)) > room(box.width) || span(points.map((point) => point.y)) > room(box.height);
}

/** Zoom out while the places are too large for the box and Zoom out still works, then pan towards their worst side. */
function moveFor(points: readonly Point[], box: Box, zoomable: boolean): Move {
    if (zoomable && tooLarge(points, box)) {
        return 'zoom-out';
    }
    const [side, past] = Object.entries(overflow(points, box)).sort(([, a], [, b]) => b - a)[0] ?? ['left', 0];
    return past > 0 ? PAN_KEYS[side as keyof typeof PAN_KEYS] : null;
}

/** What brings the places into view next, or null when every place is in view. */
async function nextMove(page: Page, places: readonly LngLat[], zoomable: boolean): Promise<Move> {
    // Measured after the points: finding a point scrolls the map into view first.
    const points = await cornerPoints(page, places);
    const box = await page.locator('hcm-admin-map').boundingBox();
    return box === null ? null : moveFor(points, box, zoomable);
}

/**
 * Brings every place into the editor's map, away from its edges and its zoom buttons, as a person does: Zoom out while
 * they are too large for it (the map opens at the city's zoom 13; the city's window stops it), then the arrow keys on the
 * focused map; false if they never are.
 */
export async function bringIntoView(page: Page, lang: 'ro' | 'en', places: readonly LngLat[]): Promise<boolean> {
    const map = page.locator('hcm-admin-map');
    const zoomOut = map.getByRole('button', { name: translateAdminContent(lang, 'adminContent.map.zoomOut'), exact: true });
    let zoomable = true;
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const move = await nextMove(page, places, zoomable);
        if (move === null) {
            return true;
        }
        const before = await viewOf(page);
        await (move === 'zoom-out' ? zoomOut.click() : pan(page, move));
        await settled(page, before);
        // At the city's widest view Zoom out changes nothing: from then on only the arrows move the map.
        zoomable = move !== 'zoom-out' || zoomOf(await viewOf(page)) < zoomOf(before);
    }
    return (await nextMove(page, places, false)) === null;
}

/** One arrow key on the focused map. */
async function pan(page: Page, key: PanKey): Promise<void> {
    await page.locator('hcm-admin-map canvas.mapboxgl-canvas').focus();
    await page.keyboard.press(key);
}

/** Runs in the page: the newest map's view as text (its centre and zoom), or '' without a map. */
function viewInPage(): string {
    interface ViewMap {
        getCenter(): { lng: number; lat: number };
        getZoom(): number;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: ViewMap[] } }).__hcmE2e?.maps.at(-1);
    return map === undefined ? '' : `${String(map.getCenter().lng)},${String(map.getCenter().lat)},${String(map.getZoom())}`;
}

function viewOf(page: Page): Promise<string> {
    return page.evaluate(viewInPage);
}

/** The zoom of a view text, to a hundredth. */
function zoomOf(view: string): number {
    return Math.round(Number(view.split(',')[2]) * 100) / 100;
}

/** Runs in the page: whether the newest map's view differs from `before` (`viewInPage`'s text). */
function movedInPage(before: string): boolean {
    interface ViewMap {
        getCenter(): { lng: number; lat: number };
        getZoom(): number;
    }
    const map = (window as unknown as { __hcmE2e?: { maps: ViewMap[] } }).__hcmE2e?.maps.at(-1);
    const view = map === undefined ? '' : `${String(map.getCenter().lng)},${String(map.getCenter().lat)},${String(map.getZoom())}`;
    return view !== before;
}

/**
 * Waits until a move has happened and the map stands still: Zoom out and the arrow keys animate, and the map only
 * starts moving a frame later (a move the city's window clamps changes nothing: after a while it counts as done).
 */
async function settled(page: Page, before: string): Promise<void> {
    await page.waitForFunction(movedInPage, before, { timeout: 3_000 }).catch(() => undefined);
    await expect.poll(async () => [await viewOf(page), await viewOf(page)].every((view, _, views) => view === views[0])).toBe(true);
}

/** The city's jobs' types, sorted. */
export async function jobTypes(imagery: ImageryWorld): Promise<string[]> {
    const jobs = await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/jobs`);
    return Object.values(jobs)
        .map((job) => String(job['type']))
        .sort((a, b) => a.localeCompare(b));
}

/** The version a crop made (the one carrying the polygon), once `imagery.crop` created it. */
export async function croppedVersion(imagery: ImageryWorld): Promise<string> {
    const cropped = async (): Promise<string> => {
        const versions = await imagery.cityWorld.emulators.collection(`cities/${imagery.city}/layerVersions`);
        return Object.entries(versions).find(([, version]) => version['crop'] !== undefined)?.[0] ?? '';
    };
    await expect.poll(cropped, { message: 'the crop made a version', timeout: FUNCTIONS_TIMEOUT_MS }).not.toBe('');
    return cropped();
}
