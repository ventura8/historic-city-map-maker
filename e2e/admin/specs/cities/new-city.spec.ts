import { DEFAULT_NEW_CITY_LIMITS, NEW_CITY_SEEDS, cityAreaAround } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { hostingUrl } from '../../../support/hosting.js';
import { mapIdle } from '../../../support/map.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { apiText } from '../../support/i18n.js';
import { adminMapReady } from '../../support/map.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { addressWithMap, cityChoice, cityText, openCityMenu, seedCity } from './world.js';

// One admin test at a time: the project's owner and its cities (`setup/owner`, `admins/*`, `cities/*`) are singletons.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * New city (behaviour A50, docs/research/M5-interfaces.md §1.6): the project's owner creates a city in two inputs, the
 * Romanian name (the id follows it, and `cities.locate` finds the city on the mock Nominatim, its rectangle drawn and the
 * map flown to it) and Create the city, against the Functions emulator's `cities.create`; the city exists unpublished
 * with its rectangle's start view, the first seed's theme and the new-city limits, its creator its owner, and the city
 * menu lists it at once. A name OpenStreetMap does not know leaves the rectangle to a drag (three inputs; the map's zoom
 * buttons work). An id no city may take is said at its field, a taken id is refused with a free one, a rectangle that
 * cannot be a city keeps Create off with the reason beside the map, and edges typed in part keep the others.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NAME = 'Turda E2E';
const CITY_ID = 'turda-e2e';
/** A name the mock Nominatim finds (packages/test-support/src/fakes/nominatim.ts), its box and its name there. */
const FOUND = 'Cluj-Napoca';
const FOUND_ID = 'cluj-napoca';
const FOUND_PLACE = 'Cluj-Napoca, Cluj, România';
const FOUND_AREA = cityAreaAround({ west: 23.4846, south: 46.7181, east: 23.6919, north: 46.8167 });

function form(page: Page): Locator {
    return page.locator('hcm-new-city-page');
}

function createButton(page: Page): Locator {
    return form(page).locator('form > .actions hcm-button');
}

function edgeField(page: Page, lang: 'ro' | 'en', edge: 'west' | 'south' | 'east' | 'north'): Locator {
    return form(page).getByLabel(cityText(lang, `adminContent.settings.${edge}`), { exact: true });
}

/** The newest map's zoom, read from outside the page (the e2e build's instrumentation). */
function mapZoom(page: Page): Promise<number> {
    return page.evaluate(() => (window as unknown as { __hcmE2e: { maps: { getZoom(): number }[] } }).__hcmE2e.maps.at(-1)?.getZoom() ?? 0);
}

/** The newest map's centre latitude: the map flew to the city found. */
function mapCenterLat(page: Page): Promise<number> {
    return page.evaluate(
        () => (window as unknown as { __hcmE2e: { maps: { getCenter(): { lat: number } }[] } }).__hcmE2e.maps.at(-1)?.getCenter().lat ?? 0,
    );
}

/** Runs in the page before the admin: records every wizard funnel signal (`hcm-funnel`, §200) as `<kind> <wizard> [step]`. */
function recordFunnel(): void {
    const seen: string[] = [];
    const codes: string[] = [];
    Object.assign(window, { __hcmFunnel: seen, __hcmFunnelCodes: codes });
    window.addEventListener('hcm-funnel', (event) => {
        const signal = (event as CustomEvent<{ kind: string; wizard: string; step?: string; code?: string }>).detail;
        seen.push([signal.kind, signal.wizard, signal.step].filter((part) => part !== undefined).join(' '));
        if (signal.code !== undefined) {
            codes.push(signal.code);
        }
    });
}

function recordedFunnel(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { __hcmFunnel: string[] }).__hcmFunnel);
}

/** Types the rectangle's four edges, the keyboard's way (each field commits when the focus leaves it). */
async function typeEdges(
    page: Page,
    lang: 'ro' | 'en',
    edges: Readonly<Partial<Record<'west' | 'south' | 'east' | 'north', number>>>,
): Promise<void> {
    for (const [edge, value] of Object.entries(edges)) {
        const field = edgeField(page, lang, edge as 'west');
        await field.fill(String(value));
        await field.press('Tab');
    }
}

test(
    'The project owner creates a city in two inputs',
    { tag: ['@S-A50-HAPPY', '@S-A150-HAPPY-FUNNEL-ORDER', '@S-A150-BAD-NO-EVENTS-BEFORE-CONSENT'] },
    async ({ page, lang, adminWorld, inputBudget, consoleErrors }) => {
        const { emulators, accounts } = adminWorld;
        await page.addInitScript(recordFunnel);
        await seedCity(emulators, PROJECT_CITY, 'București');
        await page.goto(addressWithMap(lang, 'cities/new'));
        await adminMapReady(page);
        await expect(createButton(page)).toHaveAttribute('disabled', '');
        await expectStateSound(page, adminVisit('cities.new', lang));

        // docs/LESSONS.md 252: the city is found by its name, wherever the map opened (here, on Bucharest).
        const flow = inputBudget.flow('newCity', contentFlowBudget('newCity'));
        await flow.fill(form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }), FOUND);
        await expect(form(page).getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true })).toHaveValue(FOUND_ID);
        await expect(form(page).locator('[data-area-located]')).toHaveText(
            cityText(lang, 'adminContent.cities.new.located', { place: FOUND_PLACE }),
        );
        await expect(edgeField(page, lang, 'west')).toHaveValue(String(FOUND_AREA.west));
        await expect(edgeField(page, lang, 'north')).toHaveValue(String(FOUND_AREA.north));
        await expect.poll(() => mapCenterLat(page)).toBeGreaterThan(46.5);
        await expect(createButton(page)).not.toHaveAttribute('disabled', '');
        await expectStateSound(page, adminVisit('cities.new-located', lang));
        await flow.click(createButton(page));

        await expect(form(page).locator(`[data-city-created="${FOUND_ID}"]`)).toHaveText(
            cityText(lang, 'adminContent.cities.created.title', { city: FOUND }),
        );
        // docs/LESSONS.md 255: the done screen's heading takes the focus, and the page's one live region says it.
        await expect(form(page).locator('h2[data-detail-heading]')).toBeFocused();
        await expect(form(page).locator('[data-live]')).toHaveText(cityText(lang, 'adminContent.cities.created.title', { city: FOUND }));
        // M6 (CR-M6-17): its public map will be on the admin's own Hosting site, at the city's path; no repository step.
        await expect(form(page).locator('a[data-public-address]')).toHaveAttribute('href', hostingUrl(`/${FOUND_ID}/`));
        await expectStateSound(page, adminVisit('cities.created', lang));
        expect(flow.used).toBe(2);
        const city = await emulators.document(`cities/${FOUND_ID}`);
        expect(city).toMatchObject({
            name: { ro: FOUND },
            bounds: FOUND_AREA,
            published: false,
            limits: DEFAULT_NEW_CITY_LIMITS,
            theme: { seedColor: NEW_CITY_SEEDS[0] },
        });
        expect(await emulators.document(`admins/${accounts.owner.uid}`)).toMatchObject({
            cities: { [PROJECT_CITY]: 'owner', [FOUND_ID]: 'owner' },
        });
        expect(await emulators.document(`ops/harvest-${FOUND_ID}`)).toMatchObject({ failures: 0 });
        // docs/LESSONS.md 251: the city menu lists it at once, not after its minute (the menu's own refresh is throttled).
        const menu = await openCityMenu(page, inputBudget.flow('switchCity', contentFlowBudget('switchCity')));
        await expect(cityChoice(menu, FOUND_ID)).toBeVisible();
        // The viewer's token, best effort after the create: this project has no Mapbox yet, so Setup's Mapbox card mints it.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400 .*setup-rotatePublicToken/).length).toBe(1);
        // §200: the wizard's funnel, in the order the owner walked it, as codes (this admin has no GA4, so nothing leaves).
        const funnel = await recordedFunnel(page);
        expect(funnel[0]).toBe('view new_city names');
        expect(funnel.filter((signal) => signal.startsWith('complete'))).toEqual([
            'complete new_city names',
            'complete new_city area',
            'complete new_city create',
        ]);
        expect(funnel.at(-1)).toBe('finish new_city');
        // Without the admin's consent (here: no GA4 at all) no Google script runs on the page.
        expect(await page.evaluate(() => Object.keys(window).filter((key) => key === 'dataLayer' || key === 'gtag'))).toEqual([]);
    },
);

test(
    'A name OpenStreetMap does not know: the owner drags the rectangle',
    { tag: '@S-A50-HAPPY-DRAWN' },
    async ({ page, lang, adminWorld, inputBudget, consoleErrors }) => {
        await seedCity(adminWorld.emulators, PROJECT_CITY, 'București');
        await page.goto(addressWithMap(lang, 'cities/new'));
        await adminMapReady(page);
        // The UX review of M5: the map's zoom buttons move the New city map too.
        const map = form(page).locator('hcm-admin-map');
        const before = await mapZoom(page);
        await map.getByRole('button', { name: cityText(lang, 'adminContent.map.zoomOut'), exact: true }).click();
        await expect.poll(() => mapZoom(page)).toBeCloseTo(before - 1, 1);
        await mapIdle(page);
        await map.getByRole('button', { name: cityText(lang, 'adminContent.map.zoomIn'), exact: true }).click();
        await expect.poll(() => mapZoom(page)).toBeCloseTo(before, 1);
        await mapIdle(page);

        const flow = inputBudget.flow('newCityDrawn', contentFlowBudget('newCityDrawn'));
        await flow.fill(form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }), NAME);
        await expect(form(page).getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true })).toHaveValue(CITY_ID);
        // About 240 px a side at the city's zoom (13, Mapbox's 512 px tiles): two hundredths of a degree, a district's size.
        await map.scrollIntoViewIfNeeded();
        const box = await map.boundingBox();
        const middle = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
        await flow.drag(page, { x: middle.x - 120, y: middle.y - 120 }, { x: middle.x + 120, y: middle.y + 120 });
        await expect(edgeField(page, lang, 'west')).not.toHaveValue('');
        await expect(createButton(page)).not.toHaveAttribute('disabled', '');
        await expectStateSound(page, adminVisit('cities.new-drawing', lang));
        await flow.click(createButton(page));

        await expect(form(page).locator(`[data-city-created="${CITY_ID}"]`)).toHaveText(
            cityText(lang, 'adminContent.cities.created.title', { city: NAME }),
        );
        expect(flow.used).toBe(3);
        await expect(form(page).locator('[data-area-located]')).toHaveCount(0);
        expect(await adminWorld.emulators.document(`cities/${CITY_ID}`)).toMatchObject({ name: { ro: NAME }, published: false });
        await expect.poll(() => consoleErrors.takeMatching(/status of 400 .*setup-rotatePublicToken/).length).toBe(1);
    },
);

test('An id no city may take is said at its field', { tag: '@S-A50-BAD-ID-INVALID' }, async ({ page, lang, adminWorld }) => {
    // The UX review of M5: Create stayed on, and the request was refused with "problems found: {count}".
    await seedCity(adminWorld.emulators, PROJECT_CITY, 'București');
    await page.goto(addressWithMap(lang, 'cities/new'));
    await form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }).fill(NAME);
    await typeEdges(page, lang, { west: 23.7, south: 46.5, east: 23.9, north: 46.6 });
    const id = form(page).getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true });

    await id.fill('engine');
    await id.press('Tab');

    await expect(form(page).locator('[data-id-problem]')).toHaveText(cityText(lang, 'adminContent.cities.new.idInvalid'));
    await expect(id).toHaveAttribute('aria-invalid', 'true');
    await expect(createButton(page)).toHaveAttribute('disabled', '');
    await expectStateSound(page, adminVisit('cities.new-id-invalid', lang));
    await id.fill('');
    await id.press('Tab');
    await expect(id).toHaveValue(CITY_ID);
    await expect(form(page).locator('[data-id-problem]')).toHaveCount(0);
    await expect(createButton(page)).not.toHaveAttribute('disabled', '');
});

test(
    'Edges typed in part wait for the others, and keep them',
    { tag: ['@S-A50-BAD-EDGES-PARTIAL', '@S-A150-BAD-STEP-ERROR-CODE-NOT-TEXT'] },
    async ({ page, lang, adminWorld }) => {
        // The UX review of M5: each edge before the fourth made an impossible rectangle and an alert about dragging.
        await page.addInitScript(recordFunnel);
        await seedCity(adminWorld.emulators, PROJECT_CITY, 'București');
        await page.goto(addressWithMap(lang, 'cities/new'));
        await form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }).fill(NAME);

        await typeEdges(page, lang, { west: 23.7, south: 46.5 });
        await expect(form(page).locator('[data-edges-incomplete]')).toHaveText(cityText(lang, 'adminContent.cities.new.edgesIncomplete'));
        await expect(form(page).locator('[data-area-problem]')).toHaveCount(0);
        await typeEdges(page, lang, { east: 23.9, north: 46.6 });
        await expect(form(page).locator('[data-edges-incomplete]')).toHaveCount(0);
        await expect(createButton(page)).not.toHaveAttribute('disabled', '');

        await edgeField(page, lang, 'east').fill('');
        await edgeField(page, lang, 'east').press('Tab');
        await expect(edgeField(page, lang, 'west')).toHaveValue('23.7');
        await expect(edgeField(page, lang, 'north')).toHaveValue('46.6');
        await expect(createButton(page)).toHaveAttribute('disabled', '');
        await typeEdges(page, lang, { east: 23.6 });
        await expect(form(page).locator('[data-area-problem]')).toHaveText(cityText(lang, 'adminContent.cities.new.areaBounds'));
        // §200: the funnel names the area's problem by its code, never by the words on screen.
        const funnel = await recordedFunnel(page);
        expect(funnel).toContain('error new_city area');
        expect((await page.evaluate(() => (window as unknown as { __hcmFunnelCodes: string[] }).__hcmFunnelCodes)).at(-1)).toBe(
            'validation.bounds',
        );
    },
);

test('A taken id is refused with a suggestion', { tag: '@S-A50-BAD-ID-TAKEN' }, async ({ page, lang, adminWorld, consoleErrors }) => {
    const { emulators } = adminWorld;
    await seedCity(emulators, PROJECT_CITY, 'București');
    await seedCity(emulators, CITY_ID, 'Turda');
    await page.goto(addressWithMap(lang, 'cities/new'));

    await form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }).fill(NAME);
    await typeEdges(page, lang, { west: 23.7, south: 46.5, east: 23.9, north: 46.6 });
    await createButton(page).click();

    await expect(form(page).locator('form [role="alert"]')).toHaveText(
        apiText(lang, 'apiError.city.idTaken', { cityId: CITY_ID, suggestion: `${CITY_ID}-2` }),
    );
    await expect(form(page).getByLabel(cityText(lang, 'adminContent.cities.new.id'), { exact: true })).toHaveValue(`${CITY_ID}-2`);
    await expectStateSound(page, adminVisit('cities.new-id-taken', lang));
    expect(await emulators.document(`cities/${CITY_ID}`)).toMatchObject({ name: { ro: 'Turda' } });
    expect(consoleErrors.takeMatching(/status of 409 .*cities-create/)).toHaveLength(1);
});

test('A rectangle too large or too small cannot be created', { tag: '@S-A50-BAD-AREA' }, async ({ page, lang, adminWorld }) => {
    await seedCity(adminWorld.emulators, PROJECT_CITY, 'București');
    await page.goto(addressWithMap(lang, 'cities/new'));
    await form(page).getByLabel(cityText(lang, 'adminContent.cities.new.nameRo'), { exact: true }).fill(NAME);

    await typeEdges(page, lang, { west: 22, south: 46, east: 25, north: 46.5 });

    const problem = form(page).locator('[data-area-problem]');
    await expect(problem).toHaveText(cityText(lang, 'adminContent.cities.new.areaTooBig'));
    await expect(createButton(page)).toHaveAttribute('disabled', '');
    await expectStateSound(page, adminVisit('cities.new-area-invalid', lang));

    await typeEdges(page, lang, { west: 23.7, south: 46.5, east: 23.705, north: 46.505 });
    await expect(problem).toHaveText(cityText(lang, 'adminContent.cities.new.areaTooSmall'));
    await expect(createButton(page)).toHaveAttribute('disabled', '');
    expect(await adminWorld.emulators.document(`cities/${CITY_ID}`)).toBeUndefined();
});
