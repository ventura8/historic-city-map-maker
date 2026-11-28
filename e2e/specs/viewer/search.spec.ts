import type { Locator, Page, Request } from '@playwright/test';
import type { Locale } from '@hcm/shared';

import { mapFacts, type LngLat } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';
import { STORY_ID, storyManifest } from '../../tour/story-states.js';

/**
 * Static manifest search (behaviour V78, docs/ENGINE_API.md → Search): `<hcm-search>` matches places, disappeared
 * streets, photos and stories diacritics-insensitively across Romanian and English without extra network calls, flies
 * the map to the picked result and opens its sheet, supports Up/Down/Enter/Escape, and shows a plain empty state with
 * a Clear button when nothing matches.
 */

const STREET_ID = 'fixture-strada';
const STREET_TITLE = 'Stradă dispărută (fixture)';
const STREET_CENTER: LngLat = [26.087, 44.42585];
const STREET_CATEGORY: Readonly<Record<Locale, string>> = { ro: 'Străzi dispărute', en: 'Vanished streets' };

const BUILDING_CENTER: LngLat = [26.0872, 44.4285];
const BUILDING_TITLE: Readonly<Record<Locale, string>> = {
    ro: 'Clădire demolată (fixture)',
    en: 'Demolished building (fixture)',
};
const BLOCK_TITLE: Readonly<Record<Locale, string>> = {
    ro: 'Cvartal demolat (fixture)',
    en: 'Demolished block (fixture)',
};

const STREET_PHOTO_TITLE = 'Strada Fonteriei';
const URANUS_PHOTO_ID = 'uranus-colt-mihai-voda';
const URANUS_PHOTO_TITLE = 'Uranus - Mihai Vodă';
const URANUS_PHOTO_CENTER: LngLat = [26.089407, 44.43106];

const STORY_TITLE: Readonly<Record<Locale, string>> = {
    ro: 'Teatrul Național',
    en: 'The National Theatre',
};

const ARIA_EXPANDED = 'aria-expanded';
const ARIA_SELECTED = 'aria-selected';
const ARROW_DOWN = 'ArrowDown';

function searchBox(page: Page): Locator {
    return viewer(page).locator('hcm-search');
}

function searchInput(page: Page, lang: Locale): Locator {
    return searchBox(page).getByRole('combobox', { name: t(lang, 'search.label'), exact: true });
}

function searchListbox(page: Page, lang: Locale): Locator {
    return searchBox(page).getByRole('listbox', { name: t(lang, 'search.results'), exact: true });
}

function searchClear(page: Page, lang: Locale): Locator {
    return searchBox(page).getByRole('button', { name: t(lang, 'search.clear'), exact: true });
}

/**
 * Records every network request started while `action` runs (a manifest search must send none). Fonts are left out:
 * typing a diacritic can pull the latin-ext subset of the engine's own font, which is not a search request.
 */
async function requestsDuring(page: Page, action: () => Promise<void>): Promise<string[]> {
    const urls: string[] = [];
    const record = (request: Request): void => {
        if (request.resourceType() !== 'font') {
            urls.push(request.url());
        }
    };
    page.on('request', record);
    try {
        await action();
    } finally {
        page.off('request', record);
    }
    return urls;
}

/** Waits until the map finishes flying to `target` at search zoom. */
async function expectCameraAt(page: Page, target: LngLat): Promise<void> {
    await expect
        .poll(async () => (await mapFacts(page)).center[1], { message: 'the camera flies to the target latitude' })
        .toBeCloseTo(target[1], 3);
    await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the camera flight settles' }).toBe(false);
    const facts = await mapFacts(page);
    // Narrow layouts pad the camera for the open sheet, which shifts the centre's longitude by up to ~0.002 degrees.
    expect(facts.center[0]).toBeCloseTo(target[0], 2);
    expect(facts.zoom).toBeGreaterThanOrEqual(15.5);
}

test(
    'Searching Bucharest finds places and photos by kind without network calls, and picking one flies and opens it',
    { tag: '@S-V78-HAPPY-SEARCH' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const input = searchInput(page, lang);
        const listbox = searchListbox(page, lang);

        const requests = await requestsDuring(page, async () => {
            await input.fill('strada');
            await expect(listbox).toBeVisible();
        });
        expect(requests, 'searching the manifest makes no network requests').toEqual([]);
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'true');

        const options = listbox.getByRole('option');
        await expect(options).toHaveCount(2);
        const streetOption = options.filter({ hasText: STREET_TITLE });
        await expect(streetOption).toHaveCount(1);
        await expect(streetOption).toContainText(STREET_CATEGORY[lang]);
        const photoOption = options.filter({ hasText: STREET_PHOTO_TITLE });
        await expect(photoOption).toHaveCount(1);
        await expect(photoOption).toContainText(t(lang, 'search.kind.photo'));

        await streetOption.getByRole('button').click();
        await expect(listbox).toBeHidden();
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'false');
        await expectCameraAt(page, STREET_CENTER);
        await expect(viewer(page).locator('hcm-poi-detail')).toBeVisible();
        await expect(page.getByRole('heading', { name: STREET_TITLE, exact: true })).toBeVisible();
        expect(await engineEvents(page, 'hcm-poi-open')).toEqual([{ poiId: STREET_ID }]);
    },
);

test(
    'Keyboard arrows, Enter and Escape navigate, pick and dismiss search results',
    { tag: '@S-V78-HAPPY-SEARCH' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const input = searchInput(page, lang);
        const listbox = searchListbox(page, lang);
        const options = listbox.getByRole('option');

        await input.fill('cladire');
        await expect(listbox).toBeVisible();
        await input.press('Escape');
        await expect(listbox).toBeHidden();
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'false');

        await input.fill('uranus');
        await expect(options).toHaveCount(3);
        await expect(options.first()).toHaveAttribute(ARIA_SELECTED, 'false');

        await input.press(ARROW_DOWN);
        await expect(options.first()).toHaveAttribute(ARIA_SELECTED, 'true');
        await input.press(ARROW_DOWN);
        await expect(options.nth(1)).toHaveAttribute(ARIA_SELECTED, 'true');
        await input.press(ARROW_DOWN);
        await expect(options.nth(2)).toHaveAttribute(ARIA_SELECTED, 'true');
        await input.press('ArrowUp');
        await expect(options.nth(1)).toHaveAttribute(ARIA_SELECTED, 'true');
        await expect(options.nth(1)).toContainText(URANUS_PHOTO_TITLE);

        await input.press('Enter');
        await expect(listbox).toBeHidden();
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'false');
        await expectCameraAt(page, URANUS_PHOTO_CENTER);
        await expect(page.getByRole('heading', { name: URANUS_PHOTO_TITLE, exact: true })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: URANUS_PHOTO_ID }]);
    },
);

test(
    'Searching matches across Romanian and English titles and opens a story at its place',
    { tag: '@S-V78-HAPPY-SEARCH' },
    async ({ page, lang }) => {
        await serveManifest(page, storyManifest());
        await openViewer(page, { lang });
        const input = searchInput(page, lang);
        const listbox = searchListbox(page, lang);
        const options = listbox.getByRole('option');

        await input.fill('demolished');
        // The building's place media shares its title, so it is found beside the place itself.
        await expect(options).toHaveCount(3);
        await expect(options.filter({ hasText: BUILDING_TITLE[lang] })).toHaveCount(2);
        await expect(options.filter({ hasText: BLOCK_TITLE[lang] })).toHaveCount(1);

        const requests = await requestsDuring(page, async () => {
            await input.fill('national');
            await expect(options).toHaveCount(1);
        });
        expect(requests, 'filtering to a story makes no network requests').toEqual([]);
        await expect(options.first()).toContainText(STORY_TITLE[lang]);
        await expect(options.first()).toContainText(t(lang, 'search.kind.story'));

        await options.first().getByRole('button').click();
        await expect(listbox).toBeHidden();
        await expectCameraAt(page, BUILDING_CENTER);
        await expect(viewer(page).locator('hcm-stories')).toBeVisible();
        await expect(viewer(page).getByRole('heading', { name: STORY_TITLE[lang], exact: true })).toBeVisible();
        await expect.poll(() => new URL(page.url()).hash).toContain(`story=${STORY_ID}`);
    },
);

test(
    'An unmatched search shows the localized empty message without network requests, and Clear resets the box',
    { tag: '@S-V78-BAD-NO-RESULTS' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const input = searchInput(page, lang);
        const status = searchBox(page).getByRole('status');
        const clear = searchClear(page, lang);

        const requests = await requestsDuring(page, async () => {
            await input.fill('zzzz-nu-exista');
            await expect(status).toBeVisible();
        });
        expect(requests, 'an unmatched search makes no network requests').toEqual([]);
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'true');
        await expect(status).toContainText(t(lang, 'search.empty'));
        await expect(searchListbox(page, lang)).toHaveCount(0);
        await expect(clear).toBeVisible();

        await clear.click();
        await expect(input).toHaveValue('');
        await expect(input).toHaveAttribute(ARIA_EXPANDED, 'false');
        await expect(status).toHaveCount(0);
        await expect(clear).toHaveCount(0);
        await expect(input).toBeFocused();
    },
);
