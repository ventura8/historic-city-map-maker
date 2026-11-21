import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { EAST, WEST, dateRow, openDates, planRows, seedFrame } from './join-world.js';
import { imageryText, readyImagery, sceneList } from './world.js';

// One admin test at a time: the search runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Not useful (behaviour A152; the owner's report of 2026-11-13, "this scan is useless, too many clouds", a 1964 frame the whole-city
 * plan kept offering to buy): the scene's page sets it aside with why, the plan is written again without it and its Buy this scan,
 * the list hides it under Hide not useful, and Undo brings it back; a frame its preview shows probably cloudy over the city warns
 * on its page and beside its Buy this scan. The callable's refusals (an imported scene, a moderator) are functions rows.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const DATE = '1964-08-21';
const [WEST_FRAME, NORTH_EAST, CLOUDY] = ['D3C1203-200130F031', 'D3C1203-200130F032', 'D3C1203-200130F033'];
/** The north-east quarter: free, it completes part of the east; the paid frame would add the rest. */
const NORTH_EAST_BOUNDS = { ...EAST, south: 44.45 };

function buyLink(page: Page, lang: 'ro' | 'en'): ReturnType<Page['getByRole']> {
    const name = imageryText(lang, 'adminContent.imagery.join.buyFrame', { frame: 'F033' });
    return dateRow(page, DATE).getByRole('link', { name });
}

test(
    'A cloudy paid scan is warned, marked Not useful, leaves the plan and its Buy this scan, and Undo brings it back',
    { tag: ['@S-A152-HAPPY', '@S-A152-HAPPY-UNDO', '@S-A152-BAD-CLOUDY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedFrame(imagery, { entityId: WEST_FRAME, bounds: WEST, date: DATE });
        await seedFrame(imagery, { entityId: NORTH_EAST, bounds: NORTH_EAST_BOUNDS, date: DATE });
        await seedFrame(imagery, { entityId: CLOUDY, bounds: EAST, date: DATE, free: false, cloudPercent: 72 });
        await openDates(page, lang, DATE);

        // The plan warns before anyone buys the cloudy frame.
        await expect(buyLink(page, lang)).toBeVisible();
        await expect(dateRow(page, DATE).locator('[data-state="join-cloudy"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.cloudy.beforeBuying', { percent: '72' }),
        );
        await buyLink(page, lang).click();
        await expect(page).toHaveURL(new RegExp(`/imagery/scene/${CLOUDY}$`));
        await expect(page.locator('[data-state="cloudy-warning"]')).toContainText(
            imageryText(lang, 'adminContent.imagery.cloudy.tag', { percent: '72' }),
        );
        await expectStateSound(page, adminVisit('imagery.scene-cloudy', lang));

        // Not useful: Clouds, one click; the plan is written again with what else completes the date.
        const prefix = imageryText(lang, 'adminContent.imagery.unusable.prefix');
        await page.getByRole('button', { name: `${prefix} ${imageryText(lang, 'adminContent.imagery.unusable.clouds')}` }).click();
        const marked = page.locator('[data-state="unusable-marked"]');
        await expect(marked).toContainText(imageryText(lang, 'adminContent.imagery.unusable.clouds'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(async () => (await planRows(imagery))?.find((row) => row.date === DATE), { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ paidFrames: [], frames: [{ entityId: WEST_FRAME }, { entityId: NORTH_EAST }] });
        await expectStateSound(page, adminVisit('imagery.scene-unusable', lang));

        // Find: no Buy this scan for it; the list hides it under Hide not useful, and shows it with its chip once that is off.
        await page.goto(adminPath(lang, 'imagery'));
        await expect(dateRow(page, DATE)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(buyLink(page, lang)).toBeHidden();
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') }).click();
        const card = sceneList(page, lang).locator(`li[data-scene="${CLOUDY}"]`);
        await expect(card).toBeHidden();
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.hideRejected') }).click();
        await expect(card.locator('[data-state="unusable"]')).toHaveText(imageryText(lang, 'adminContent.imagery.unusable.tag'));

        // Undo on its page: offered again, and the plan's Buy this scan is back.
        await page.goto(adminPath(lang, `imagery/scene/${CLOUDY}`));
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.unusable.undo') }).click();
        await expect(page.locator('[data-scene-unusable] hcm-button[data-unusable="clouds"]')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect
            .poll(async () => (await planRows(imagery))?.find((row) => row.date === DATE)?.paidFrames, { timeout: FUNCTIONS_TIMEOUT_MS })
            .toEqual([CLOUDY]);
    },
);
