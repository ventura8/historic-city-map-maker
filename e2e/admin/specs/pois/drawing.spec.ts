import { MAX_GEOMETRY_VERTICES, type LngLat } from '@hcm/shared';
import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { recordLiveRegions } from '../../../support/live-regions.js';
import { mapFacts, mapIdle, renderedFeatureIds } from '../../../support/map.js';
import { expect, test } from '../../support/content-test.js';
import { awaitManifest, entry, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { adminMapReady, clickMapAt, mapPointOf } from '../../support/map.js';
import { poisText, seedCategories, seedPlace } from './places.js';
import {
    AREA,
    AT,
    addPlace,
    coordinate,
    openPlaces,
    readyToDraw,
    refusal,
    saveButton,
    savedPlace,
    shape,
    titleField,
    yearField,
} from './drawing.js';

/**
 * Drawing places on the admin map (docs/research/M2c-interfaces.md §4.4–§4.6, §7.2; behaviours A32, A31) in a city of the
 * admin's own, with the click tools (`createClickDrawPort`: a point is one click, a line and an area grow with every
 * click; Terra Draw's drags wait for CR-M2c-20): an area of four clicks, a line of three and a point are saved, published
 * and drawn by the viewer; the same shape is made from the keyboard alone; a position outside the city, an area whose
 * edges cross and the 501st position are refused, each with its reason said; and the editor's Tab round goes through the
 * map, the tools, the positions and the form in the order they are seen.
 */

test(
    'An area of four clicks is saved published, and the viewer draws it',
    { tag: ['@S-A32-HAPPY', '@S-A30-HAPPY-CONTENT'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(180_000);
        await openPlaces(page, content, lang);
        const flow = inputBudget.flow('polygonPlace', contentFlowBudget('polygonPlace', AREA.length));

        // Add place, Area, four clicks (the click tools close the ring), the title, the year, Save.
        await flow.click(addPlace(page, lang));
        await flow.click(shape(page, lang, 'polygon'));
        await readyToDraw(page, lang);
        for (const corner of AREA) {
            await flow.clickAt(page, await mapPointOf(page, corner));
        }
        await expect(coordinate(page, 'v3-lng')).toHaveValue(/^26\.09/);
        await flow.fill(titleField(page, lang), 'Piața Universității');
        await flow.fill(yearField(page, lang), '1968');
        await flow.click(saveButton(page, lang));
        const [id, place] = await savedPlace(content);
        const geometry = place['geometry'] as { type: string; rings: { points: { lat: number; lng: number }[] }[] };
        expect(geometry.type).toBe('Polygon');
        expect(geometry.rings).toHaveLength(1);
        expect(geometry.rings[0]?.points).toHaveLength(5);
        expect(place).toMatchObject({ category: 'monuments', published: true, title: { ro: 'Piața Universității' } });

        // The manifest's places carry it; the viewer draws it.
        const manifest = await awaitManifest(content, 'lists the area', (built) => entry(built, 'pois', id) !== undefined);
        await openPublicViewer(page, manifest, { lang, hash: '16/44.43000/26.10000' });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain(id);
    },
);

test(
    'A line of three clicks and a point of one are saved and drawn by the viewer as a line and an icon',
    { tag: ['@S-A32-HAPPY-LINE-AND-POINT', '@S-A30-HAPPY-CONTENT'] },
    async ({ page, lang, content, inputBudget }) => {
        test.setTimeout(180_000);
        await openPlaces(page, content, lang);

        // A line: three clicks, the title, Save.
        await addPlace(page, lang).click();
        await shape(page, lang, 'linestring').click();
        await readyToDraw(page, lang);
        for (const position of AREA.slice(0, 3)) {
            await clickMapAt(page, position);
        }
        await titleField(page, lang).fill('Bulevardul Elisabeta');
        await yearField(page, lang).fill('1890');
        await saveButton(page, lang).click();
        const [lineId, line] = await savedPlace(content);
        expect((line['geometry'] as { type: string; points: unknown[] }).points).toHaveLength(3);
        expect(line['geometry']).toMatchObject({ type: 'LineString' });

        // A point in six inputs: Add place, Point, a click, the title, the year, Save (from the list: on a one-pane window the
        // saved line's editor covers it).
        await page.goto(content.address(lang, 'pois'));
        const flow = inputBudget.flow('pointPlace', contentFlowBudget('pointPlace'));
        await flow.click(addPlace(page, lang));
        await flow.click(shape(page, lang, 'point'));
        await flow.clickAt(page, await mapPointOf(page, [26.1, 44.43]));
        await flow.fill(titleField(page, lang), 'Statuia lui Mihai Viteazul');
        await flow.fill(yearField(page, lang), '1874');
        await flow.click(saveButton(page, lang));
        await expect.poll(async () => Object.keys(await content.collection('pois')).length).toBe(2);
        const [pointId = ''] = Object.keys(await content.collection('pois')).filter((id) => id !== lineId);
        expect((await content.document(`pois/${pointId}`))?.['geometry']).toMatchObject({ type: 'Point' });

        const manifest = await awaitManifest(content, 'lists the line and the point', (built) =>
            [lineId, pointId].every((id) => entry(built, 'pois', id) !== undefined),
        );
        await openPublicViewer(page, manifest, { lang, hash: '16/44.43000/26.10000' });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toEqual([lineId, pointId].sort((a, b) => a.localeCompare(b)));
    },
);

test(
    'A place is drawn from the keyboard alone: the map moved with its arrows, a position added at its centre, the rest typed',
    {
        tag: ['@S-A32-HAPPY-KEYBOARD'],
    },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openPlaces(page, content, lang);
        await addPlace(page, lang).press('Enter');
        await shape(page, lang, 'linestring').press('Enter');
        await readyToDraw(page, lang);

        // The arrow keys move the map; Add at centre puts a position at the crosshair.
        const canvas = page.locator('hcm-admin-map canvas.mapboxgl-canvas');
        await canvas.focus();
        for (let step = 0; step < 3; step += 1) {
            await canvas.press('ArrowLeft');
        }
        await mapIdle(page);
        const centre = (await mapFacts(page)).center;
        const addAtCentre = page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') });
        await addAtCentre.press('Enter');
        await expect(coordinate(page, 'v0-lng')).toHaveValue(String(Math.round(centre[0] * 1e7) / 1e7));

        // A second position at the centre, then typed; a third added and removed again.
        await addAtCentre.press('Enter');
        await coordinate(page, 'v1-lat').fill('44.4331');
        await coordinate(page, 'v1-lng').fill('26.1043');
        await coordinate(page, 'v1-lng').press('Tab');
        await addAtCentre.press('Enter');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.removeVertex', { number: '3' }) }).press('Enter');
        await expect(coordinate(page, 'v2-lat')).toHaveCount(0);

        await titleField(page, lang).fill('Strada Academiei');
        await yearField(page, lang).fill('1890');
        await saveButton(page, lang).press('Enter');
        const [, place] = await savedPlace(content);
        expect(place['geometry']).toEqual({
            type: 'LineString',
            points: [
                { lat: Math.round(centre[1] * 1e7) / 1e7, lng: Math.round(centre[0] * 1e7) / 1e7 },
                { lat: 44.4331, lng: 26.1043 },
            ],
        });
    },
);

test(
    'The click that would make an area cross itself is refused and the last good area stays',
    { tag: ['@S-A32-BAD-SELF-INTERSECTION'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await openPlaces(page, content, lang);
        await addPlace(page, lang).click();
        await shape(page, lang, 'polygon').click();
        await readyToDraw(page, lang);

        // Two uneven lobes (a symmetric bow-tie has no area, which another rule refuses first).
        const [a, b, c] = [AREA[0], AREA[2], AREA[1]] as [LngLat, LngLat, LngLat];
        for (const corner of [a, b, c]) {
            await clickMapAt(page, corner);
        }
        await clickMapAt(page, [26.095, 44.431]);

        await expect(refusal(page, lang, 'self-intersection')).toBeVisible();
        await expect(coordinate(page, 'v2-lng')).toHaveValue(/^26\.10/);
        await expect(coordinate(page, 'v3-lng')).toHaveCount(0);
    },
);

/** A zigzag line of `count` positions across the city's centre. */
function zigzag(count: number): { lat: number; lng: number }[] {
    return Array.from({ length: count }, (_, index) => ({ lat: 44.425 + (index % 2) * 0.004, lng: 26.08 + index * 0.0001 }));
}

test(
    'A shape at the position limit refuses the next position with the limit named',
    { tag: ['@S-A32-BAD-TOO-MANY-VERTICES'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await page.context().addInitScript(recordLiveRegions);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPlace(
            content,
            {
                id: 'zigzag',
                title: 'Linia de tramvai',
                at: [26.08, 44.425],
                extra: { geometry: { type: 'LineString', points: zigzag(MAX_GEOMETRY_VERTICES) } },
            },
            AT,
        );
        await page.goto(content.address(lang, 'pois/zigzag'));
        await adminMapReady(page);
        await expect(coordinate(page, `v${String(MAX_GEOMETRY_VERTICES - 1)}-lat`)).toBeAttached();

        // Draw goes on from the line's end: the 501st position is refused.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.draw'), exact: true }).click();
        await clickMapAt(page, [26.1, 44.43]);

        await expect(refusal(page, lang, 'too-many-vertices')).toBeVisible();
        await expect(coordinate(page, `v${String(MAX_GEOMETRY_VERTICES)}-lat`)).toHaveCount(0);
        expect(((await content.document('pois/zigzag'))?.['geometry'] as { points: unknown[] }).points).toHaveLength(MAX_GEOMETRY_VERTICES);
    },
);
