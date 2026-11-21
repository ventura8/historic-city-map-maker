import type { LngLat } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import type { CityWorld } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { seedPublicCity } from '../../support/flows.js';
import { apiText } from '../../support/i18n.js';
import { jpegBytes, photoFile } from '../../support/images.js';
import { adminMapReady, clickMapAt } from '../../support/map.js';
import { awaitProcessed, photoInput, photosText, rememberPhotoChoices, servePhotoImages } from '../../support/photos.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import type { UpstreamCall, UpstreamControl } from '../../support/upstream.js';
import { assistSlot, assistText, AT, ATHENAEUM, cityAddress, NEAR_ATHENAEUM, ownerCity, slotButton } from './world.js';

// One admin test at a time: the geocoding queue's cool-down and cache, and the server's fake Nominatim, are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Title suggestions in the photo editor (behaviour A09, docs/research/M4-interfaces.md §4.1, §4.2): a photo uploaded as
 * `IMG_0412.jpg` starts titled after its file (a camera's naming, which says nothing of the place), and the pin set on
 * the map asks `assist.suggestTitle` by itself, since nobody chose that title; the Functions emulator queues the cell, the
 * Cloud Tasks emulator runs `assist.geocode` at once, and the fake Nominatim of the server's world answers. The
 * suggestions come as buttons with OpenStreetMap's attribution and its licence link; one fills the draft's titles, and
 * only Save writes. A refusal (429) is said under the title, the title stays the admin's to type, and the cool-down keeps
 * every other request from Nominatim.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The file a camera named, and the title the upload gives it (underscores read as spaces). */
const FILE = 'IMG_0412.jpg';
const UPLOADED_TITLE = 'IMG 0412';

/** Another cell, between the photo's place and the Athenaeum (asked during the cool-down). */
const ELSEWHERE: LngLat = [26.0988, 44.4393];

function field(page: Page, lang: 'ro' | 'en', key: Parameters<typeof photosText>[1]): Locator {
    return page.locator('hcm-admin-photo-editor').getByLabel(photosText(lang, key), { exact: true });
}

/**
 * The server's Nominatim requests for the cell at `place` (its centre as the request names it). The server's world is the
 * project's: a content spec running beside this locked one (a point drawn at the city's centre asks by itself) adds
 * requests for other cells, so a count is always of one cell (`docs/LESSONS.md` 201).
 */
async function cellCalls(upstream: UpstreamControl, place: LngLat): Promise<UpstreamCall[]> {
    const cell = `lat=${String(place[1])}&lon=${String(place[0])}&`;
    return (await upstream.calls('server', 'nominatim.reverse')).filter((call) => call.url.includes(cell));
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true });
}

/**
 * A real upload: `IMG_0412.jpg`, with no place in its file, lands at the last pin (near the Athenaeum) titled after its
 * file; its editor opens with the map ready and the title as the upload left it. Returns the photo's id.
 */
async function openUploaded(page: Page, lang: 'ro' | 'en', city: CityWorld): Promise<string> {
    await servePhotoImages(page);
    await rememberPhotoChoices(page, { lastPin: NEAR_ATHENAEUM });
    await seedPublicCity(city, AT);
    await page.goto(cityAddress(lang, 'photos'));
    await photoInput(page).setInputFiles(await photoFile(test.info(), FILE, await jpegBytes('#6b5e4c')));
    await awaitProcessed(city, 1);
    const [photo] = Object.keys(await city.emulators.collection(`cities/${city.city}/photos`));
    const id = String(photo);
    await page.goto(cityAddress(lang, `photos/${id}`));
    await expect(field(page, lang, 'adminContent.photos.field.titleRo')).toHaveValue(UPLOADED_TITLE);
    await adminMapReady(page);
    return id;
}

test(
    "A photo's place suggests titles from OpenStreetMap, and one fills the draft until Save",
    { tag: '@S-A09-HAPPY-TITLE-SUGGESTION' },
    async ({ page, lang, adminWorld, upstream, inputBudget }) => {
        test.setTimeout(150_000);
        const city = ownerCity(adminWorld);
        const photo = await openUploaded(page, lang, city);

        // The pin set: the suggestions come by themselves once the queue answers, with the attribution and its link.
        await clickMapAt(page, ATHENAEUM);
        const suggestions = assistSlot(page, 'title').locator('[data-assist-suggestions]').getByRole('button');
        await expect(suggestions.first()).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await suggestions.count()).toBeLessThanOrEqual(3);
        const licence = assistSlot(page, 'title').locator('[data-attribution]').getByRole('link');
        await expect(licence).toHaveAttribute('href', 'https://osm.org/copyright');
        await expect(licence).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(assistSlot(page, 'title').locator('[data-attribution]')).toContainText(
            assistText(lang, 'adminContent.assist.attribution'),
        );
        await expectStateSound(page, adminVisit('assist.suggestions', lang));

        // One click fills both titles in the draft; nothing is written before Save.
        const choosing = inputBudget.flow('suggestTitle', contentFlowBudget('suggestTitle'));
        await choosing.click(
            page.getByRole('button', { name: assistText(lang, 'adminContent.assist.use', { title: 'Ateneul Român' }), exact: true }),
        );
        await expect(field(page, lang, 'adminContent.photos.field.titleRo')).toHaveValue('Ateneul Român');
        await expect(field(page, lang, 'adminContent.photos.field.titleEn')).toHaveValue('Romanian Athenaeum');
        expect((await city.emulators.document(`cities/${city.city}/photos/${photo}`))?.['title']).toEqual({ ro: UPLOADED_TITLE });

        await saveButton(page, lang).click();
        await expect
            .poll(async () => (await city.emulators.document(`cities/${city.city}/photos/${photo}`))?.['title'])
            .toEqual({ ro: 'Ateneul Român', en: 'Romanian Athenaeum' });
        // One request reached Nominatim for the cell, at its centre, from the server only.
        expect(await cellCalls(upstream, ATHENAEUM)).toHaveLength(1);
        expect(await upstream.calls('browser', 'nominatim.reverse')).toHaveLength(0);
    },
);

test(
    'A Nominatim refusal leaves the admin typing the title, and the cool-down asks Nominatim nothing more',
    { tag: '@S-A09-BAD-NOMINATIM-429' },
    async ({ page, lang, adminWorld, upstream }) => {
        test.setTimeout(150_000);
        const city = ownerCity(adminWorld);
        await upstream.fail('nominatim', 'rateLimited', 'server');
        const photo = await openUploaded(page, lang, city);

        // The place set: the refusal in words under the title, the field as the upload left it and editable.
        await clickMapAt(page, ATHENAEUM);
        await expect(assistSlot(page, 'title').getByRole('alert')).toContainText(apiText(lang, 'apiError.assist.rateLimited'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const title = field(page, lang, 'adminContent.photos.field.titleRo');
        await expect(title).toHaveValue(UPLOADED_TITLE);
        await expect(title).toBeEditable();
        await expectStateSound(page, adminVisit('assist.suggestions-refused', lang));

        // During the cool-down, Suggest a title (here and elsewhere) is refused without asking Nominatim again: the
        // cool-down is the project's, so no request of anyone's reaches Nominatim meanwhile.
        const asked = (await upstream.calls('server', 'nominatim.reverse')).length;
        await slotButton(page, 'title').click();
        await expect(assistSlot(page, 'title').getByRole('alert')).toContainText(apiText(lang, 'apiError.assist.rateLimited'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await clickMapAt(page, ELSEWHERE);
        await expect(assistSlot(page, 'title').getByRole('alert')).toContainText(apiText(lang, 'apiError.assist.rateLimited'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect(await upstream.calls('server', 'nominatim.reverse')).toHaveLength(asked);
        expect(await cellCalls(upstream, ELSEWHERE)).toEqual([]);

        // The admin types the title, and Save writes it.
        await title.fill('Ateneul');
        await saveButton(page, lang).click();
        await expect
            .poll(async () => (await city.emulators.document(`cities/${city.city}/photos/${photo}`))?.['title'])
            .toEqual({ ro: 'Ateneul' });
    },
);
