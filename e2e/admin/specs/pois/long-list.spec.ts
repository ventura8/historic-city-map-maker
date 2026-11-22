import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { seedPublicCity } from '../../support/flows.js';
import { contentText } from '../../support/ops.js';
import { poisText, seedCategories, seedPlace } from './places.js';

/**
 * A long list of places (owner, 2026-11-22: the 315 places of "Disappeared streets" needed Show more after Show more):
 * the list reads every place, says how many there are, draws them a window at a time as the reader scrolls, and its
 * search finds a place past the first page. No click on Show more anywhere.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');
const COUNT = 315;

test(
    'A list of 315 places says how many it holds, reaches the last as the reader scrolls, and its search sees every place',
    { tag: ['@S-A32-HAPPY-WHOLE-LIST', '@S-A32-BAD-WHOLE-LIST-NO-MATCH'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        const numbers = Array.from({ length: COUNT }, (_, index) => index);
        for (let start = 0; start < COUNT; start += 25) {
            await Promise.all(
                numbers.slice(start, start + 25).map((index) => {
                    const number = String(index).padStart(3, '0');
                    return seedPlace(
                        content,
                        { id: `str-${number}`, title: `Strada ${number}`, at: [26.1, 44.43] },
                        new Date(AT.getTime() + index * 1000),
                    );
                }),
            );
        }
        await page.goto(content.address(lang, 'pois', { map: false }));

        const list = page.locator('hcm-poi-list');
        await expect(list.locator('.list-count')).toHaveText(poisText(lang, 'adminContent.pois.count', { count: String(COUNT) }));
        // Scrolling to the end draws the next window: the oldest place, the last row, is reached without a click.
        await expect(async () => {
            await list.locator('li.item').last().scrollIntoViewIfNeeded();
            await expect(list.locator('li.item')).toHaveCount(COUNT, { timeout: 1000 });
        }).toPass({ timeout: 30_000 });
        // Every row drawn: the state's checkers walk all of them (no window grows during the Tab round).
        await expectStateSound(page, adminVisit('pois.long-list', lang));
        await list.getByText('Strada 000', { exact: true }).scrollIntoViewIfNeeded();
        await expect(list.getByText('Strada 000', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.common.more') })).toHaveCount(0);

        // The search reads every place, not one page: the oldest is found.
        const search = list.getByRole('searchbox', { name: poisText(lang, 'adminContent.pois.search') });
        await search.fill('Strada 000');
        await expect(list.locator('li.item')).toHaveCount(1);
        await expect(list.locator('.list-count')).toHaveText(poisText(lang, 'adminContent.pois.count', { count: '1' }));

        // A search that matches nothing says so, and counts none.
        await search.fill('Bulevardul care nu există');
        await expect(list.getByText(poisText(lang, 'adminContent.pois.noMatch'))).toBeVisible();
        await expect(list.locator('.list-count')).toHaveText(poisText(lang, 'adminContent.pois.count', { count: '0' }));
    },
);
