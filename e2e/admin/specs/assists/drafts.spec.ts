import { VERTEX_MODEL_ID, VERTEX_MODEL_IDS } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { awaitManifest, entry, seedPublicCity } from '../../support/flows.js';
import { apiText } from '../../support/i18n.js';
import { photosText, seedPhoto, servePhotoImages } from '../../support/photos.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { seedCategories, seedPlace } from '../pois/places.js';
import { seedLayer } from '../settings/world.js';
import { assistSlot, assistText, AT, cityAddress, ownerCity, slotButton, START } from './world.js';

// One admin test at a time: the month's AI counters and the server's fake Vertex AI are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Translation drafts (behaviours A09, A45; docs/research/M4-interfaces.md §4.1, §4.3): the draft button beside a Romanian
 * and English pair calls `assist.translateDraft` in the Functions emulator, which asks the fake Vertex AI of the server's
 * world (its answer: the text and `(English draft)`); the draft fills the other field of the editor's draft with the
 * model's note, and only Save writes, so the manifest changes only then. An unavailable model gives no draft, and nothing
 * is saved or published. The place and layer editors draft the same way.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The photo of a test (one id each: a trigger of an earlier test may still write below its photo). */
const PHOTO = { draft: 'p-ateneu-draft', refused: 'p-ateneu-refused', modelGone: 'p-ateneu-model-gone' } as const;

function photoField(page: Page, lang: 'ro' | 'en', key: Parameters<typeof photosText>[1]): Locator {
    return page.locator('hcm-admin-photo-editor').getByLabel(photosText(lang, key), { exact: true });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true });
}

/** A published photo titled in Romanian only, its editor open. */
async function openPhoto(page: Page, lang: 'ro' | 'en', city: ReturnType<typeof ownerCity>, id: string): Promise<void> {
    await servePhotoImages(page);
    await seedPublicCity(city, AT);
    await seedPhoto(city, { id, title: 'Ateneul Român', extra: { published: true, location: { lat: START[1], lng: START[0] } } }, AT);
    await page.goto(cityAddress(lang, `photos/${id}`));
    await expect(photoField(page, lang, 'adminContent.photos.field.titleRo')).toHaveValue('Ateneul Român');
}

test(
    'An English draft of the Romanian title fills the field until Save, then the manifest carries it',
    { tag: '@S-A09-HAPPY-TRANSLATE-DRAFT' },
    async ({ page, lang, adminWorld, upstream, inputBudget }) => {
        const city = ownerCity(adminWorld);
        await openPhoto(page, lang, city, PHOTO.draft);

        const drafting = inputBudget.flow('translateDraft', contentFlowBudget('translateDraft'));
        await drafting.click(slotButton(page, 'draft-title'));
        const english = photoField(page, lang, 'adminContent.photos.field.titleEn');
        await expect(english).toHaveValue('Ateneul Român (English draft)', { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(assistSlot(page, 'draft-title').locator('[data-draft-note]')).toContainText(
            assistText(lang, 'adminContent.assist.draftNote', { model: VERTEX_MODEL_ID }),
        );
        await expectStateSound(page, adminVisit('assist.draft', lang));

        // Only the draft holds it: the document is as it was, and the model was asked once, by the server.
        expect((await city.emulators.document(`cities/${city.city}/photos/${PHOTO.draft}`))?.['title']).toEqual({ ro: 'Ateneul Român' });
        expect(await upstream.calls('server', 'vertex-ai.generateContent')).toHaveLength(1);

        await drafting.click(saveButton(page, lang));
        const manifest = await awaitManifest(
            city,
            'carries the English title',
            (built) =>
                (entry(built, 'photos', PHOTO.draft)?.['title'] as { en?: string } | undefined)?.en === 'Ateneul Român (English draft)',
        );
        expect(entry(manifest, 'photos', PHOTO.draft)?.['title']).toEqual({ ro: 'Ateneul Român', en: 'Ateneul Român (English draft)' });
    },
);

test(
    'An unavailable AI gives no draft, and nothing is saved or published',
    { tag: '@S-A09-BAD-AI-UNAVAILABLE' },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        const city = ownerCity(adminWorld);
        await upstream.fail('vertex-ai', 'unavailable', 'server');
        await openPhoto(page, lang, city, PHOTO.refused);
        const before = await city.emulators.document(`cities/${city.city}/photos/${PHOTO.refused}`);

        await slotButton(page, 'draft-title').click();
        await expect(assistSlot(page, 'draft-title').getByRole('alert')).toContainText(apiText(lang, 'apiError.assist.unavailable'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(photoField(page, lang, 'adminContent.photos.field.titleEn')).toHaveValue('');
        await expect(saveButton(page, lang)).toBeDisabled();
        await expectStateSound(page, adminVisit('assist.draft-refused', lang));

        // Nothing written: the photo is the seeded one (so nothing to publish); the callable's refusal is the 503 logged.
        expect(await city.emulators.document(`cities/${city.city}/photos/${PHOTO.refused}`)).toEqual(before);
        expect(consoleErrors.takeMatching(/status of 503 .*assist-translateDraft/)).toHaveLength(1);
    },
);

test(
    'A model Vertex AI does not offer to the project is named on the drafts button, not reported as a server error',
    { tag: '@S-A45-BAD-MODEL-UNAVAILABLE' },
    async ({ page, lang, adminWorld, upstream, consoleErrors }) => {
        // M6 (finding 20 of docs/research/manual-test-2026-10-25.md): Google answers 404 for a publisher model it retired or
        // does not offer; with none of the list offered (§67g) every model tried is named, as the setup self-test names
        // them (functions/test/setup/self-test.test.ts).
        const city = ownerCity(adminWorld);
        await upstream.scenario('vertex-ai.modelUnavailable', 'server');
        await openPhoto(page, lang, city, PHOTO.modelGone);

        await slotButton(page, 'draft-title').click();
        const alert = assistSlot(page, 'draft-title').getByRole('alert');
        await expect(alert).toContainText(apiText(lang, 'apiError.assist.modelUnavailable', { model: VERTEX_MODEL_IDS.join(', ') }), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(alert).not.toContainText(apiText(lang, 'apiError.internal'));
        await expect(photoField(page, lang, 'adminContent.photos.field.titleEn')).toHaveValue('');
        expect(await upstream.calls('server', 'vertex-ai.generateContent')).toHaveLength(VERTEX_MODEL_IDS.length);
        // A failed precondition, which the browser logs as the callable's 400.
        expect(consoleErrors.takeMatching(/status of 400 .*assist-translateDraft/)).toHaveLength(1);
    },
);

/** A place's Romanian description: two paragraphs and a Markdown link. */
const DESCRIPTION = 'Sala de concerte din 1888.\n\nVezi [Arhiva](https://arhiva.example/ateneu).';

/** The project's city with its categories, a place described in Romanian (two paragraphs and a link) and a layer. */
async function seedPlaceAndLayer(city: ReturnType<typeof ownerCity>): Promise<void> {
    await seedPublicCity(city, AT);
    await seedCategories(city, AT);
    await seedPlace(city, { id: 'ateneu', title: 'Ateneul Român', at: START, extra: { description: { ro: DESCRIPTION } } }, AT);
    await seedLayer(city, 'corona-1968', AT);
}

test(
    "A place's description draft keeps its paragraphs and its link, only in the editor's draft",
    { tag: '@S-A45-HAPPY' },
    async ({ page, lang, adminWorld }) => {
        const city = ownerCity(adminWorld);
        await seedPlaceAndLayer(city);

        await page.goto(cityAddress(lang, 'pois/ateneu'));
        await expect(page.locator('hcm-poi-editor #description-ro')).toHaveValue(DESCRIPTION);
        await slotButton(page, 'draft-description').click();
        await expect(page.locator('hcm-poi-editor #description-en')).toHaveValue(`${DESCRIPTION} (English draft)`, {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('assist.place-draft', lang));
        expect((await city.emulators.document(`cities/${city.city}/pois/ateneu`))?.['description']).toEqual({ ro: DESCRIPTION });
    },
);

test(
    "A layer's label draft fills the English label, only in the editor's draft",
    { tag: '@S-A45-HAPPY' },
    async ({ page, lang, adminWorld }) => {
        const city = ownerCity(adminWorld);
        await seedPlaceAndLayer(city);

        // A layer has no place: no title to suggest, only the drafts of its texts.
        await page.goto(cityAddress(lang, 'layers/corona-1968'));
        await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
        await expect(assistSlot(page, 'title')).toHaveCount(0);
        await slotButton(page, 'draft-label').click();
        await expect(page.locator('#layer-label-en')).toHaveValue('Corona 1968 (English draft)', { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('assist.layer-draft', lang));
        expect((await city.emulators.document(`cities/${city.city}/layers/corona-1968`))?.['label']).toEqual({ ro: 'Corona 1968' });
    },
);
