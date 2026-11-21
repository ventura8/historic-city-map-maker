import type { Locator, Page } from '@playwright/test';

import { recordLiveRegions } from '../support/live-regions.js';
import { expectStateSound } from '../support/state-check.js';
import { adminVisit } from './states.js';
import { expect, test } from '../admin/support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../admin/support/emulators.js';
import { apiText } from '../admin/support/i18n.js';
import { backToList, contentText, dialog, expectEntries, seedCity, seedPlace } from '../admin/support/ops.js';

/**
 * History (docs/research/M2c-interfaces.md §9.2; behaviour A23), in a city of the admin's own (the content world,
 * e2e/admin/support/content.ts): every edit of a place is recorded by the history triggers, a deleted place comes back
 * with Restore, a rename is reverted from the place's versions, and a version today's schema refuses is refused with
 * its reason. Another city's changes never reach the list: the query asks this city's entries (`cityId`, CR-M2c-14), so
 * they neither take its rows nor make it offer "Show more" (S-A23-BAD-OTHER-CITY). Each page follows the canonical list
 * and detail layout of its window, and every screen and dialog on the way runs the generic layout and accessibility
 * checkers (the ops section of e2e/tour/states.ts).
 *
 * Part of the layout and accessibility tour (DECISIONS-for-review.md §34c): it runs at every tour project's viewport,
 * scheme and language (tier `tour` on every push, `tour-matrix` in `all` and nightly), in a city of its own, so it
 * needs no lock beside the admin tier.
 */

// The content world's fakes (Mapbox, Google) are forwarded as in the admin projects.
test.use({ forwardUpstreams: true });

const AT = new Date('2026-10-17T09:00:00.000Z');
const LATER = new Date('2026-10-24T09:00:00.000Z');

/** The seeded city's name (`seedCity` of e2e/admin/support/ops.ts), which its creation entry reads. */
const CITY_NAME = { ro: /București/, en: /Bucharest/ } as const;

/** The list's further page. */
function showMore(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: contentText(lang, 'adminContent.common.more') });
}

test(
    'Every edit of a place is recorded, a deleted place comes back, and a refused revert says why',
    {
        tag: [
            '@S-A23-HAPPY',
            '@S-A23-HAPPY-RESTORE-DELETED',
            '@S-A23-BAD-REFUSED-SHOWN',
            '@S-A23-BAD-OTHER-CITY',
            '@S-A31-HAPPY-EDITORS',
            '@S-A21-BAD-LEAK-CHECK',
        ],
    },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(240_000);
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(content, AT);
        // Another city's deletion, newer than every change of this one: the triggers' entry as they write it, with its city.
        await content.emulators.setDocument(`cities/${content.city}-elsewhere/pois/far/history/1792828800000-far`, {
            cityId: `${content.city}-elsewhere`,
            entity: 'poi',
            entityId: 'far',
            action: 'delete',
            previous: { title: { ro: 'Moara din alt oraș' } },
            changedFields: [],
            updatedBy: 'system:history',
            updatedAt: LATER,
        });
        await page.goto(content.address(lang, 'history'));

        // A place created then renamed, another created then deleted: the history triggers record each change.
        await seedPlace(content, 'gara', 'Gara Veche', AT);
        await expectEntries(content, 'gara', 1);
        await content.emulators.updateFields(content.path(`pois/gara`), { title: { ro: 'Gara de Nord' }, updatedAt: LATER }, [
            'title',
            'updatedAt',
        ]);
        await seedPlace(content, 'tram', 'Depoul de tramvaie', AT);
        await expectEntries(content, 'tram', 1);
        await content.emulators.deleteDocument(content.path(`pois/tram`));
        await expectEntries(content, 'gara', 2);
        await expectEntries(content, 'tram', 2);
        // The city's own creation entry is in too, so no row arrives during the Tab round.
        await expect.poll(async () => Object.keys(await content.collection('history')).length, { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
        // An entry names the place as it was before its change, a creation as its document was made (the renamed place's
        // creation and change both read Gara Veche, the city's creation its name: finding 38 of 2026-11-01); the other
        // city's deletion is not listed, and five entries offer no further page.
        await expect(page.getByRole('link', { name: /Gara Veche/ })).toHaveCount(2);
        await expect(page.getByRole('link', { name: CITY_NAME[lang] })).toBeVisible();
        await expect(page.getByText('Moara din alt oraș')).toHaveCount(0);
        await expect(showMore(page, lang)).toHaveCount(0);
        await expectStateSound(page, adminVisit('history.recent', lang));

        // The Deleted filter; Restore asks first, then brings the place back.
        await page.getByLabel(contentText(lang, 'adminContent.history.actionLabel'), { exact: true }).selectOption('delete');
        const restore = page
            .getByRole('listitem')
            .filter({ hasText: 'Depoul de tramvaie' })
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') });
        await expect(restore).toBeVisible();
        // The filtered list has settled: the server answered, so no cached page says "Reconnecting" or offers a further page
        // for a moment (the Tab round of a loaded machine met that button and then lost it, lesson 135). One deletion of
        // this city offers no further page, however many other cities' deletions the shared emulators hold (lessons 145,
        // 149).
        await expect(page.getByRole('status').filter({ hasText: contentText(lang, 'adminContent.common.reconnecting') })).toHaveCount(0);
        await expect(page.getByText('Moara din alt oraș')).toHaveCount(0);
        await expect(showMore(page, lang)).toHaveCount(0);
        await expectStateSound(page, adminVisit('history.deleted', lang));
        await restore.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectStateSound(page, adminVisit('history.revert-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.restore') })
            .click();
        await expect.poll(async () => (await content.document(`pois/tram`))?.['title']).toEqual({ ro: 'Depoul de tramvaie' });

        // The renamed place's versions; reverting the rename brings the old title back.
        await page.goto(content.address(lang, 'history/poi/gara'));
        await expect(
            page.getByRole('heading', { level: 2, name: contentText(lang, 'adminContent.history.of', { name: 'Gara de Nord' }) }),
        ).toBeVisible();
        // The changed fields are named as the editors name them ("Title"), never as stored (`title`).
        const titleField = contentText(lang, 'adminContent.field.title');
        await page
            .getByRole('button', { name: new RegExp(contentText(lang, 'adminContent.history.fields', { fields: titleField })) })
            .click();
        await expect(page.getByText(/Gara Veche/).first()).toBeVisible();
        await expect(page.getByRole('term').filter({ hasText: titleField })).toBeVisible();
        await expectStateSound(page, adminVisit('history.document', lang));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.history.revert') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.revert') })
            .click();
        await expect.poll(async () => (await content.document(`pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });

        // A version today's schema refuses (an old entry, written before entries named their city, so it shows only among
        // the place's versions): the revert is refused, said as an alert, and nothing changes.
        await content.setDocument(`pois/gara/history/0946684800000-old`, {
            entity: 'poi',
            entityId: 'gara',
            action: 'update',
            previous: { title: 7 },
            changedFields: ['title'],
            updatedBy: 'system:history',
            updatedAt: new Date('2000-01-01T00:00:00.000Z'),
        });
        await backToList(page, lang);
        const old = page.getByRole('button', { name: /2000/ });
        await old.click();
        await page.getByRole('button', { name: contentText(lang, 'adminContent.history.revert') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.history.revert') })
            .click();
        await expect(
            page.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.history.invalidSnapshot', { count: '1' }).slice(0, 40) }),
        ).toBeVisible();
        // The callable's refusal (failed-precondition) is an HTTP 400, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
        await expectStateSound(page, adminVisit('history.revert-refused', lang));
        expect((await content.document(`pois/gara`))?.['title']).toEqual({ ro: 'Gara Veche' });
    },
);
