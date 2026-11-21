import { usgsSceneDocSchema, type DatePlanRow, type Sensor } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import type { Bounds } from '../../support/imagery-geometry.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { adminPath, expect } from '../../support/test.js';
import { detail, imageryText, IMAGERY_AT, versionIdOf } from './world.js';

/**
 * The join's world (M8, `docs/research/M8-join-interfaces.md` §8): the frames of one date, as the harvest leaves them, that
 * the fake USGS's catalogue does not list. They are left alone by the page's own search, which writes the plan of whole-city
 * dates from them: the rows a spec sees are the server's. A frame's real import is the stand-in's (`scannedFrames`).
 */

/** A pass of KH-9 mapping the city in two frames, and a third of the same date. */
export const DATE = '1972-08-08';
export const F039 = 'D3C1202-200149F039';
export const F040 = 'D3C1202-200149F040';
export const F041 = 'D3C1202-200149F041';

/** The west and the east of the e2e city (25.9 to 26.3, 44.3 to 44.6), with a little in common: 55 % of it each. */
export const WEST: Bounds = { west: 25.8, south: 44.2, east: 26.12, north: 44.7 };
export const EAST: Bounds = { west: 26.08, south: 44.2, east: 26.4, north: 44.7 };

/** The scene's coverage of the city as the harvest stores it, 0 to 1. */
const HALF_THE_CITY = 0.55;
/** Past `HARVEST_EVERY_DAYS` whenever the test runs, so the page opens with its own search, which writes the plan. */
const HARVESTED_LONG_AGO = new Date('2020-01-01T00:00:00Z');
const SENSOR: Sensor = 'KH-9-pan';
const BROWSE = 'https://ims.cr.usgs.gov/browse/declass3/D3C1216-200467A021.jpg';

/**
 * A box as a footprint of five vertices: only a ring of four corners goes through the panoramic camera's bow tie, and these
 * frames' outlines must be what the spec says they are.
 */
function ringOf({ west, south, east, north }: Bounds): readonly { readonly lat: number; readonly lng: number }[] {
    return [
        { lat: south, lng: west },
        { lat: south, lng: east },
        { lat: north, lng: east },
        { lat: north, lng: (west + east) / 2 },
        { lat: north, lng: west },
    ];
}

/** One frame of a date. */
export interface Frame {
    readonly entityId: string;
    readonly bounds: Bounds;
    readonly date?: string;
    /** False: it must be ordered. */
    readonly free?: boolean;
    /** Another camera and dataset than the KH-9's, with USGS's corners: the real pipeline's synthetic frames. */
    readonly sensor?: Sensor;
    readonly dataset?: string;
    readonly corners?: Readonly<Record<'nw' | 'ne' | 'se' | 'sw', { readonly lat: number; readonly lng: number }>>;
    /** The share of the city its browse image shows clouded, as `imagery.browse` measured it (the owner's report of 2026-11-13). */
    readonly cloudPercent?: number;
}

/** The frame's `usgsScenes` document, as the harvest writes it. */
export async function seedFrame(imagery: ImageryWorld, frame: Frame): Promise<void> {
    const { entityId, bounds, date = DATE, free = true, sensor = SENSOR, dataset = 'declassiii', corners, cloudPercent } = frame;
    const document = {
        entityId,
        displayId: entityId,
        dataset,
        sensor,
        ...(corners === undefined ? {} : { corners }),
        ...(cloudPercent === undefined ? {} : { cloudEstimate: { percent: cloudPercent, version: 1 } }),
        acquisitionDate: date,
        status: 'candidate',
        downloadAvailable: free,
        footprint: ringOf(bounds),
        resolutionM: 2.75,
        coverage: HALF_THE_CITY,
        browse: { state: 'none', sourceUrl: BROWSE },
        rank: { score: 80, reasons: [], version: 3 },
        harvestedAt: HARVESTED_LONG_AGO,
        updatedBy: 'system:imagery',
        updatedAt: IMAGERY_AT,
    };
    const stamp = { seconds: 0, nanoseconds: 0 };
    usgsSceneDocSchema.parse({ ...document, harvestedAt: stamp, updatedAt: stamp });
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/usgsScenes/${entityId}`, document);
}

/** The two frames of {@link DATE}, free, scanned at the fake USGS. */
export async function seedTwoFrames(imagery: ImageryWorld): Promise<void> {
    await seedFrame(imagery, { entityId: F039, bounds: WEST });
    await seedFrame(imagery, { entityId: F040, bounds: EAST });
    await imagery.scannedFrames([F039, F040]);
}

/** The plan of whole-city dates as the server last wrote it. */
export async function planRows(imagery: ImageryWorld): Promise<readonly DatePlanRow[] | undefined> {
    const plan = await imagery.cityWorld.emulators.document(`cities/${imagery.city}/imageryPlans/dates`);
    return plan?.['rows'] as readonly DatePlanRow[] | undefined;
}

/** A date's row on Find. */
export function dateRow(page: Page, date: string = DATE): Locator {
    return page.locator(`[data-join-dates] [data-date="${date}"]`);
}

/** Opens Find; its own first search writes the plan, and the row of `date` appears. */
export async function openDates(page: Page, lang: 'ro' | 'en', date: string = DATE): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await expect(dateRow(page, date)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

/** A Join frames (or Add a frame) of the page. */
export function joinButton(scope: Locator | Page, lang: 'ro' | 'en'): Locator {
    return scope.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.join.button') });
}

/** Clicks a join's button and waits for the join's own page; the join's id. */
export async function joinWith(page: Page, click: () => Promise<void>): Promise<string> {
    await click();
    await expect.poll(() => page.url(), { timeout: FUNCTIONS_TIMEOUT_MS }).toMatch(/#\/imagery\/version\/jn/);
    return versionIdOf(page);
}

/** Joins the date's frames from its row, one click; the join's id. */
export async function joinFromRow(page: Page, lang: 'ro' | 'en', date: string = DATE): Promise<string> {
    return joinWith(page, () => joinButton(dateRow(page, date), lang).click());
}

/** One frame's row on its join's page. */
export function partRow(page: Page, entityId: string): Locator {
    return detail(page).locator(`[data-join-parts] [data-part="${entityId}"]`);
}

/** A join's frames as its document names them. */
export async function partsOf(imagery: ImageryWorld, joinId: string): Promise<readonly { versionId: string; entityId: string }[]> {
    const source = (await imagery.version(joinId))?.['source'] as { parts: { versionId: string; entityId: string }[] };
    return source.parts;
}

/** How long a tick, the join's run and the page's update take behind the lock late in a run. */
export const JOIN_TIMEOUT_MS = 180_000;

/** Runs the tick, as the scheduler does, until the join's version reaches `state` (its frames rendered, its job run). */
export async function tickUntil(imagery: ImageryWorld, joinId: string, state: string): Promise<void> {
    await expect
        .poll(
            async () => {
                await imagery.tick();
                return (await imagery.version(joinId))?.['state'];
            },
            { message: `join ${joinId} ${state}`, timeout: JOIN_TIMEOUT_MS },
        )
        .toBe(state);
}
