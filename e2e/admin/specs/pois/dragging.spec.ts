import type { LngLat } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../../../support/live-regions.js';
import type { ScreenPoint } from '../../../support/map.js';
import { capture } from '../../support/capture.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { adminMapReady, mapPointOf } from '../../support/map.js';
import { AT, coordinate, saveButton } from './drawing.js';
import { poisText, seedCategories, seedPlace } from './places.js';

/**
 * Dragging a place on the admin map with Terra Draw (DECISIONS-for-review.md §34g, docs/research/M2c-interfaces.md §4.4;
 * behaviour A32): the open place is selected for editing, so a press and a move on a vertex moves it, on a midpoint
 * inserts a vertex there, and anywhere inside the area moves the whole shape; the list of positions follows each drag
 * and Save writes it. The click tools and the list stay the single-pointer and keyboard ways (`drawing.spec.ts`). The
 * area is wide enough (0.02 degrees, 115 to 230 px at the zooms the projects open it at) that the southern edge's
 * midpoint is farther than Terra Draw's 40 px from every vertex, as a person would grab it.
 */

/** Four corners around the city's centre, on screen on a phone too (about 230 by 160 px at its zoom there). */
const RING: readonly LngLat[] = [
    [26.09, 44.425],
    [26.11, 44.425],
    [26.11, 44.435],
    [26.09, 44.435],
];

function points(ring: readonly LngLat[]): { lat: number; lng: number }[] {
    return [...ring, ring[0] ?? [0, 0]].map(([lng, lat]) => ({ lat, lng }));
}

async function openArea(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await page.context().addInitScript(recordLiveRegions);
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    const geometry = { type: 'Polygon', rings: [{ points: points(RING) }] };
    await seedPlace(content, { id: 'piata', title: 'Piața Universității', at: [26.1, 44.43], extra: { geometry } }, AT);
    await page.goto(content.address(lang, 'pois/piata'));
    await adminMapReady(page);
    // The place is open in Select: Terra Draw holds it selected, its vertices and midpoints ready to grab.
    await expect(
        page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.select'), exact: true, pressed: true }),
    ).toBeVisible();
    await expect(coordinate(page, 'v3-lng')).toHaveValue('26.09');
}

/**
 * A press at `from`, a move in steps to `to` and a release, as a mouse drags. With `shot`, the review screenshots
 * (`HCM_SCREENSHOTS`, e2e/admin/support/capture.ts; nothing without it) are taken half way, the button still down.
 */
async function drag(page: Page, from: ScreenPoint, to: ScreenPoint, shot?: string): Promise<void> {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    if (shot !== undefined) {
        await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 10 });
        await capture(page, shot);
    }
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await page.mouse.up();
}

function offset(point: ScreenPoint, dx: number, dy: number): ScreenPoint {
    return { x: point.x + dx, y: point.y + dy };
}

async function savedRing(content: ContentWorld): Promise<{ lat: number; lng: number }[]> {
    const geometry = (await content.document('pois/piata'))?.['geometry'] as { rings: { points: { lat: number; lng: number }[] }[] };
    return geometry.rings[0]?.points ?? [];
}

test(
    'A vertex and a midpoint are dragged, a vertex removed from the list, and Save writes the new area',
    { tag: ['@S-A32-HAPPY-VERTEX-EDIT'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openArea(page, content, lang);

        // The north-east corner, 30 px further east and south (released on the map: a release over one of the map's own
        // buttons, as the phone's zoom buttons in its north-east corner, would not end the drag on the map).
        const corner = await mapPointOf(page, RING[2] ?? [0, 0]);
        await drag(page, corner, offset(corner, 30, 30));
        await expect.poll(async () => Number(await coordinate(page, 'v2-lng').inputValue())).toBeGreaterThan(26.111);
        expect(Number(await coordinate(page, 'v2-lat').inputValue())).toBeLessThan(44.435);

        // The southern edge's midpoint, 30 px further south: a fifth position between the first two.
        const midpoint = await mapPointOf(page, [26.1, 44.425]);
        await drag(page, midpoint, offset(midpoint, 0, 30));
        await expect(coordinate(page, 'v4-lng')).toBeAttached();
        await expect.poll(async () => Number(await coordinate(page, 'v1-lat').inputValue())).toBeLessThan(44.4245);

        // The list removes the inserted position again.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.removeVertex', { number: '2' }) }).click();
        await expect(coordinate(page, 'v4-lng')).toHaveCount(0);
        await saveButton(page, lang).click();

        // The seeded area has five positions too: wait for the saved corner.
        await expect.poll(async () => (await savedRing(content))[2]?.lng ?? 0).toBeGreaterThan(26.111);
        const ring = await savedRing(content);
        expect(ring).toHaveLength(5);
        expect(ring[1]).toEqual({ lat: 44.425, lng: 26.11 });
    },
);

test(
    'The whole area is dragged by its inside and saved where it was dropped',
    { tag: ['@S-A32-HAPPY-DRAG-SHAPE'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openArea(page, content, lang);

        const inside = await mapPointOf(page, [26.1, 44.43]);
        await drag(page, inside, offset(inside, 40, 0), `pois-dragging-${lang}`);

        await expect.poll(async () => Number(await coordinate(page, 'v0-lng').inputValue())).toBeGreaterThan(26.091);
        await saveButton(page, lang).click();
        await expect.poll(async () => (await savedRing(content))[0]?.lng ?? 0).toBeGreaterThan(26.091);
        const ring = await savedRing(content);
        // Moved east as a whole: every position by the same amount, nothing north or south.
        const east = (ring[0]?.lng ?? 0) - 26.09;
        expect(ring.map((point, index) => Math.round((point.lng - (RING[index % 4]?.[0] ?? 0) - east) * 1e6))).toEqual([0, 0, 0, 0, 0]);
        expect(ring.map((point) => point.lat)).toEqual(points(RING).map((point) => point.lat));
    },
);

test(
    'A vertex dragged across the opposite edge stops before the area crosses itself',
    { tag: ['@S-A32-BAD-DRAG-CROSSING'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openArea(page, content, lang);

        // The south-west corner pulled north past the northern edge: Terra Draw keeps it where the edges do not cross.
        const corner = await mapPointOf(page, RING[0] ?? [0, 0]);
        const beyond = await mapPointOf(page, [26.09, 44.44]);
        await drag(page, corner, offset(beyond, 60, 0));

        await expect(saveButton(page, lang)).toBeVisible();
        expect(Number(await coordinate(page, 'v0-lat').inputValue())).toBeLessThan(44.435);
        expect(await savedRing(content)).toEqual(points(RING));
    },
);
