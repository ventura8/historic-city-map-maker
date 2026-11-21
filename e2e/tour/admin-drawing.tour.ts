import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { clickMapAt } from '../admin/support/map.js';
import { poisText } from '../admin/specs/pois/places.js';
import {
    AREA,
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
} from '../admin/specs/pois/drawing.js';

/**
 * The places editor's drawing states in the layout and accessibility tour (docs/research/M2c-interfaces.md §4.4–§4.6;
 * behaviours A32, A31; DECISIONS-for-review.md §34c): an area drawn click by click, a position outside the city refused,
 * and the editor's Tab round through the map, the tools, the positions and the form, at every tour project's viewport,
 * scheme and language, in a city of the admin's own (no lock).
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });

test(
    'An area drawn click by click previews live, its positions listed, and saves published',
    { tag: ['@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        // The map is drawn by SwiftShader: a 3840 × 2160 frame is slow (the tour project's 240 s are for the checks alone).
        test.setTimeout(360_000);
        await openPlaces(page, content, lang);

        // Add place, Area: the map draws each click; the area exists from its third.
        await addPlace(page, lang).click();
        await shape(page, lang, 'polygon').click();
        await readyToDraw(page, lang);
        for (const corner of AREA) {
            await clickMapAt(page, corner);
        }
        await expect(coordinate(page, 'v3-lng')).toHaveValue(/^26\.09/);
        await expect(coordinate(page, 'v4-lng')).toHaveCount(0);
        await expectStateSound(page, adminVisit('pois.drawing', lang));

        // The title, the year, Save: one closed ring of five positions, published (the viewer's part is drawing.spec.ts's).
        await titleField(page, lang).fill('Piața Universității');
        await yearField(page, lang).fill('1968');
        await saveButton(page, lang).click();
        const [, place] = await savedPlace(content);
        expect(place).toMatchObject({ published: true, geometry: { type: 'Polygon' } });
    },
);

test(
    'A position outside the city is refused with the limit named, and nothing outside is written',
    { tag: ['@S-A32-BAD-OUTSIDE-CITY', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        test.setTimeout(360_000);
        await openPlaces(page, content, lang);
        await addPlace(page, lang).click();
        await shape(page, lang, 'linestring').click();
        await readyToDraw(page, lang);
        for (const position of AREA.slice(0, 2)) {
            await clickMapAt(page, position);
        }

        // Constanța typed for the second position: refused, said at once, and the line keeps its position.
        await coordinate(page, 'v1-lng').fill('28.6625');
        await coordinate(page, 'v1-lng').press('Tab');
        await expect(refusal(page, lang, 'outside')).toBeVisible();
        await expect(coordinate(page, 'v1-lng')).toHaveValue(/^26\.10/);
        await expectStateSound(page, adminVisit('pois.draw-refused', lang));

        await titleField(page, lang).fill('Bulevardul Elisabeta');
        await yearField(page, lang).fill('1890');
        await saveButton(page, lang).click();
        const [, place] = await savedPlace(content);
        const points = (place['geometry'] as { points: { lng: number }[] }).points;
        expect(points.every((point) => point.lng < 26.8)).toBe(true);
    },
);

/** Runs in the page: a short name of the element that has the focus, through shadow roots. */
function focusedInPage(): string {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
    }
    if (active === null) {
        return '';
    }
    const host = (active.getRootNode() as ShadowRoot).host as Element | undefined;
    const name = active.getAttribute('aria-label') ?? host?.getAttribute('aria-label') ?? (host as { label?: string } | undefined)?.label;
    return [active.tagName.toLowerCase(), active.id, active.className, name ?? ''].join('|');
}

test(
    "The place editor's Tab round goes through the map, its tools, the positions and the form in the order they are seen",
    { tag: ['@S-A31-BAD-MAP-EDITOR-FOCUS', '@S-A31-HAPPY-EDITORS', '@S-A21-BAD-LEAK-CHECK'] },
    async ({ page, lang, content }) => {
        test.setTimeout(360_000);
        await openPlaces(page, content, lang);
        await addPlace(page, lang).click();
        await shape(page, lang, 'linestring').click();
        await readyToDraw(page, lang);
        for (const position of AREA.slice(0, 2)) {
            await clickMapAt(page, position);
        }
        await expectStateSound(page, adminVisit('pois.vertex-list', lang));

        // From the map: every following stop, in order.
        await page.locator('hcm-admin-map canvas.mapboxgl-canvas').focus();
        const stops: string[] = [await page.evaluate(focusedInPage)];
        for (let press = 0; press < 40; press += 1) {
            await page.keyboard.press('Tab');
            stops.push(await page.evaluate(focusedInPage));
        }
        const first = (match: RegExp): number => stops.findIndex((stop) => match.test(stop));
        const drawTool = new RegExp(`\\|${poisText(lang, 'adminContent.map.tool.draw')}$`);
        const order = [
            first(/^canvas\|/),
            first(drawTool),
            first(/^input\|v0-lat\|/),
            first(/^input\|v1-lng\|/),
            first(/^input\|title-ro\|/),
        ];
        expect(
            order.every((index) => index >= 0),
            stops.join('\n'),
        ).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    },
);
