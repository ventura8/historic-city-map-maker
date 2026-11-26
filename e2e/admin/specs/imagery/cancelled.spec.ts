import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { errorText, imageryText, readyImagery } from './world.js';

// One admin test at a time: the Imagery area reads setup/status and the city's versions.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Work's folded Cancelled versions (t130) and their Remove (t131): a version its own job cancelled (Snap my points with too
 * few matching points) is listed apart under a closed group; Remove warns, then `imagery.deleteVersion` takes it, or its
 * refusal is said while the row stays.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' } as const;

async function seedCancelled(imagery: ImageryWorld, id: string, jobStatus: 'cancelled' | 'running'): Promise<void> {
    const at = new Date();
    await imagery.seedVersion(
        id,
        {
            ...{ layerId: `kh-4a-${id}`, origin: 'usgs', state: 'cancelled', year: 1966, date: '1966-07-12', sensor: 'KH-4A' },
            source: { kind: 'usgs', ...SCENE, acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
        },
        at,
    );
    await imagery.seedJob(id, { type: 'usgs-import', status: jobStatus, params: SCENE, layerId: `kh-4a-${id}`, versionId: id }, at);
}

async function openWork(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: '0' }) }).click();
}

function group(page: Page) {
    return page.locator('[data-cancelled-versions]');
}

test(
    'A version its own job cancelled is folded apart, and Remove deletes it after a warning',
    { tag: ['@S-A190-HAPPY', '@S-A191-HAPPY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedCancelled(imagery, 'snap-1', 'cancelled');
        await openWork(page, lang);

        const heading = page.getByRole('heading', { name: imageryText(lang, 'adminContent.imagery.cancelled', { count: '1' }) });
        await expect(heading).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(group(page)).not.toHaveAttribute('open');
        await expect(page.locator('[data-version="snap-1"]')).toBeHidden();
        await heading.click();
        const row = group(page).locator('[data-version="snap-1"]');
        await expect(row).toBeVisible();
        await row.getByText(imageryText(lang, 'adminContent.imagery.removeVersion'), { exact: true }).click();
        await expect(row.getByText(imageryText(lang, 'adminContent.imagery.removeVersionWarning'))).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.work-cancelled', lang));
        await row.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.removeVersionConfirm') }).click();

        await expect.poll(async () => imagery.version('snap-1'), { timeout: FUNCTIONS_TIMEOUT_MS }).toBeUndefined();
        await expect(group(page)).toHaveCount(0, { timeout: FUNCTIONS_TIMEOUT_MS });
    },
);

test(
    'No cancelled version shows no group, and a refused Remove is said while the row stays',
    { tag: ['@S-A190-BAD-NONE', '@S-A191-BAD-REFUSED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await openWork(page, lang);
        await expect(page.getByText(imageryText(lang, 'adminContent.imagery.noWork'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(group(page)).toHaveCount(0);

        // Its job still runs (a Cancel not yet taken): the server refuses the deletion.
        await seedCancelled(imagery, 'snap-2', 'running');
        const row = group(page).locator('[data-version="snap-2"]');
        await group(page).locator('summary').first().click();
        await row.getByText(imageryText(lang, 'adminContent.imagery.removeVersion'), { exact: true }).click();
        await row.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.removeVersionConfirm') }).click();

        await expect(page.locator('hcm-snackbar').filter({ hasText: errorText(lang, 'apiError.imagery.deleteRunning') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        // The refusal is the callable's 400, which the browser logs.
        expect(consoleErrors.takeMatching(/status of 400 .*imagery-deleteVersion/)).toHaveLength(1);
        expect(await imagery.version('snap-2')).toMatchObject({ state: 'cancelled' });
        await expect(row).toBeVisible();
    },
);
