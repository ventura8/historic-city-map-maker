import { expect, test } from '../../support/content-test.js';
import { contentText, expectEntries, seedCity, seedPlace } from '../../support/ops.js';

/**
 * History names a created document by its title (the live manual test of 2026-11-01, finding 38; behaviour A23), in a city
 * of the admin's own: a creation entry stores no version, so its row takes the title of the version the creation made
 * (the next entry's, or the document as it is now) like the changes beside it; only a creation whose document is gone,
 * with nothing newer listed, keeps its kind and id.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const LATER = new Date('2026-10-24T09:00:00.000Z');

test(
    'A creation is listed by its title like the changes beside it; one of a deleted place, listed alone, by its kind and id',
    { tag: ['@S-A23-HAPPY-CREATED-NAMED', '@S-A23-BAD-CREATED-GONE-UNNAMED'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await seedCity(content, AT);
        // A place created and never changed (named by the document now), one created then renamed (by the version the
        // creation made), one created then deleted.
        await seedPlace(content, 'arena', 'AreaOne', AT);
        await seedPlace(content, 'gara', 'Gara Veche', AT);
        await seedPlace(content, 'tram', 'Gresit', AT);
        await expectEntries(content, 'arena', 1);
        await expectEntries(content, 'gara', 1);
        await expectEntries(content, 'tram', 1);
        await content.emulators.updateFields(content.path('pois/gara'), { title: { ro: 'Gara de Nord' }, updatedAt: LATER }, [
            'title',
            'updatedAt',
        ]);
        await content.emulators.deleteDocument(content.path('pois/tram'));
        await expectEntries(content, 'gara', 2);
        await expectEntries(content, 'tram', 2);

        await page.goto(content.address(lang, 'history', { map: false }));
        const unnamed = (id: string): string =>
            contentText(lang, 'adminContent.history.unnamed', { kind: contentText(lang, 'adminContent.history.one.poi'), id });
        await expect(page.getByRole('link', { name: /AreaOne/ })).toHaveCount(1);
        // The renamed place's creation and its change both read the title it had then; the deleted one's two entries too.
        await expect(page.getByRole('link', { name: /Gara Veche/ })).toHaveCount(2);
        await expect(page.getByRole('link', { name: /Gresit/ })).toHaveCount(2);
        for (const id of ['arena', 'gara', 'tram']) {
            await expect(page.getByText(unnamed(id), { exact: true })).toHaveCount(0);
        }

        // Only the creations: the renamed place is named as it is now; the deleted one has no version left to name it.
        await page.getByLabel(contentText(lang, 'adminContent.history.actionLabel'), { exact: true }).selectOption('create');
        await expect(page.getByRole('link', { name: /Gara de Nord/ })).toHaveCount(1);
        await expect(page.getByText(unnamed('tram'), { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: /Gresit/ })).toHaveCount(0);
        await expect(page.getByRole('link', { name: /AreaOne/ })).toHaveCount(1);
    },
);
