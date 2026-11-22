import { expect, test } from '../../support/content-test.js';
import { contentText } from '../../support/ops.js';
import { poisText, seedCategories, seedPlace } from './places.js';
import { seedPublicCity } from '../../support/flows.js';

/**
 * A delete either happens, the place leaving the list at once, or says why with Try again (the owner, 2026-11-22: a
 * delete closed its question and left the place, saying nothing).
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
/** The emulator's commit of a transaction (a delete is one). */
const COMMIT = /documents:commit/;

test(
    'A deleted place leaves the list at once; a delete that cannot reach the server says so and Try again deletes it',
    { tag: ['@S-A33-HAPPY-DELETE-FRESH', '@S-A33-BAD-DELETE-REFUSED'] },
    async ({ page, lang, content }) => {
        test.setTimeout(150_000);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        await seedPlace(content, { id: 'gara', title: 'Gara de Nord', at: [26.0726, 44.4467] }, AT);
        await seedPlace(content, { id: 'obor', title: 'Hala Obor', at: [26.1263, 44.4497] }, AT);
        const list = page.locator('hcm-poi-list');
        const remove = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.delete') });
        const confirm = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.deleteConfirm'), exact: true });

        // The server refuses the commit: the place stays, the snackbar says why and offers Try again, which deletes it.
        await page.route(COMMIT, (route) => route.abort('internetdisconnected'));
        await page.goto(content.address(lang, 'pois/obor', { map: false }));
        await remove.click();
        await confirm.click();
        const retry = page.getByRole('button', { name: contentText(lang, 'adminContent.common.retry') });
        await expect(retry).toBeVisible({ timeout: 60_000 });
        await expect(list.getByRole('link', { name: /Hala Obor/ })).toBeVisible();
        await page.unroute(COMMIT);
        await retry.click();
        await expect.poll(async () => Object.keys(await content.collection('pois'))).toEqual(['gara']);
        await expect(list.getByRole('link', { name: /Hala Obor/ })).toHaveCount(0);

        // A delete that goes through: the place leaves the list at once, and the store.
        await page.goto(content.address(lang, 'pois/gara', { map: false }));
        await remove.click();
        await confirm.click();
        await expect(list.getByRole('link', { name: /Gara de Nord/ })).toHaveCount(0);
        await expect.poll(async () => Object.keys(await content.collection('pois'))).toEqual([]);
    },
);
