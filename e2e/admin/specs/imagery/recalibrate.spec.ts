import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import { detail, errorText, imageryText, importFromList, readyImagery, versionIdOf, versionState } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Calibrate again (behaviour A89; docs/research/M16-recalibrate.md): on a version waiting for approval the owner asks for Refine
 * automatically; the page opens the new version, made by `imagery.recalibrate` in the Functions emulator and the stand-in pipeline, which
 * shows both fits on the same checks and replaces the waiting one only once it is rendered. A refine with nothing better ends with its
 * reason in words and leaves the waiting version as it was. Approve of a fit not shown better asks first (the unit tiers).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

/** The version's Delete (M18 item 5: one word at every stage). */
function deleteButton(page: Page, lang: 'ro' | 'en') {
    return detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.reject'), exact: true });
}

/** A figure as the page writes it (`numberText`). */
function metres(lang: 'ro' | 'en', value: number): string {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value);
}

test(
    'Refine automatically: a new version beside the waiting one, both fits on the same checks, and it replaces it once rendered',
    { tag: ['@S-A89-HAPPY-REFINE', '@S-A89-HAPPY-REPLACES-WAITING', '@S-A89-HAPPY-APPROVE-BETTER', '@S-A89-BAD-DELETE-WAITING-BASE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over' }], regeoref: [{ outcome: 'under', beforeM: 28.4 }] });
        const current = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('section.recalibrate')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-recalibrate', lang));

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.recalibrate.refine') })
            .click();

        await expect.poll(() => versionIdOf(page), { timeout: FUNCTIONS_TIMEOUT_MS }).not.toBe(current);
        const refined = versionIdOf(page);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const figures = imageryText(lang, 'adminContent.imagery.recalibrate.figures', {
            before: metres(lang, 28.4),
            after: metres(lang, 6.2),
            checks: '3',
        });
        await expect(detail(page).locator('[data-verdict="better"]')).toHaveText(figures);
        await expect.poll(async () => (await imagery.version(current))?.['state']).toBe('cancelled');
        await expectStateSound(page, adminVisit('imagery.version-recalibrated', lang));

        // The merge of M16 with M18 item 5: the waiting version it replaced is gone, so Delete asks as for any image.
        await deleteButton(page, lang).click();
        const question = page.locator('hcm-dialog[open]');
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.reject'));
        await expect(question).not.toContainText(imageryText(lang, 'adminContent.imagery.confirm.rejectRecalibrationBody'));
        await question.getByRole('button', { name: imageryText(lang, 'adminContent.common.cancel') }).click();
        await expect(question).toBeHidden();

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })
            .click();

        await expect.poll(async () => (await imagery.version(refined))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('published');
        expect((await imagery.version(refined))?.['recalibration']).toMatchObject({ route: 'auto', before: { rmseM: 28.4 } });
    },
);

test(
    'A refine with nothing better says so in words and leaves the waiting version as it was',
    { tag: ['@S-A89-BAD-NOT-IMPROVED', '@S-A89-BAD-DECLINE-KEEPS-WAITING'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'over' }], regeoref: [{ outcome: 'declined', beforeM: 6 }] });
        const current = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.recalibrate.refine') })
            .click();

        await expect.poll(() => versionIdOf(page), { timeout: FUNCTIONS_TIMEOUT_MS }).not.toBe(current);
        // The pipeline writes its figures as text, one decimal (`steps/recalibrate.py`).
        const reason = errorText(lang, 'apiError.imagery.notImproved', { before: '6.0', after: '6.2' });
        await expect(detail(page).getByText(reason)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('imagery.version-refine-declined', lang));
        expect((await imagery.version(current))?.['state']).toBe('awaiting_approval');
    },
);

test(
    'Delete on a recalibration of a published layer asks about the new fit, and the published version stays',
    { tag: '@S-A89-HAPPY-DELETE-NEW-FIT' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await imagery.script({ attempts: [{ outcome: 'under' }], regeoref: [{ outcome: 'under', beforeM: 28.4 }] });
        const current = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: PUBLISH_TIMEOUT_MS });

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.recalibrate.refine') })
            .click();
        await expect.poll(() => versionIdOf(page), { timeout: FUNCTIONS_TIMEOUT_MS }).not.toBe(current);
        const refined = versionIdOf(page);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        await deleteButton(page, lang).click();
        const question = page.locator('hcm-dialog[open]');
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.rejectRecalibration'));
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.rejectRecalibrationBody'));
        await question.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.reject'), exact: true }).click();

        await expect(page.locator('hcm-snackbar')).toContainText(imageryText(lang, 'adminContent.imagery.notice.rejectedRecalibration'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect.poll(async () => (await imagery.version(refined))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('rejected');
        expect((await imagery.version(current))?.['state']).toBe('published');
    },
);
