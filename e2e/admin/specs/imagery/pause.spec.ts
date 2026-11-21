import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { contentText } from '../../support/ops.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { readyImagery } from './world.js';

// One admin test at a time, as worker.spec.ts: the pipeline's record is in `setup/status`, the project's singleton.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Pause (the owner's request of 2026-11-13; docs/research/M7-local-worker.md → Pause; behaviours A170, A171): a version's job is
 * paused and resumed from its page (`imagery.pause` in the Functions emulator), Pause all and Resume all on Jobs, and the city's
 * computer paused for an hour and resumed from the Jobs page's computer card. A finished job offers no Pause.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date();
const WORKER = 'w-0123456789abcdef';
const SCENE = { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' } as const;
const LAYER = 'kh-4a-corona-1966';

function text(lang: 'ro' | 'en', key: AdminWorkerKey): string {
    return translateAdminWorker(lang, key);
}

/** The city's computer, seen a minute ago, idle. */
async function seedWorker(imagery: ImageryWorld, uid: string): Promise<void> {
    const seen = new Date(NOW.getTime() - 60_000);
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${WORKER}`, {
        ...{ uid, version: '1.0.0', startedAt: seen, lastSeenAt: seen, state: 'idle' },
        ...{ updatedBy: 'system:worker', updatedAt: seen },
    });
}

/** A version and its import job, `status` (queued for the computer unless said). */
async function seedJob(imagery: ImageryWorld, id: string, owner: string, status = 'queued'): Promise<void> {
    await imagery.seedVersion(
        id,
        {
            ...{ layerId: LAYER, origin: 'usgs', state: 'processing', year: 1966, date: '1966-07-12', sensor: 'KH-4A' },
            source: { kind: 'usgs', ...SCENE, acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
        },
        NOW,
    );
    const job = { type: 'usgs-import', status, params: { ...SCENE }, layerId: LAYER, versionId: id, runOn: 'local', createdBy: owner };
    await imagery.seedJob(id, { ...job, waitReason: status === 'queued' ? 'worker' : 'approval' }, NOW);
}

function pauseCard(page: Page): Locator {
    return page.locator('hcm-job-pause');
}

test(
    'A job is paused and resumed from its page and from Jobs, and the computer is paused for an hour and resumed',
    { tag: ['@S-A170-HAPPY', '@S-A170-HAPPY-ALL', '@S-A171-HAPPY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(180_000);
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedWorker(imagery, owner);
        await seedJob(imagery, 'pause-1', owner);

        // The version's page: Pause, then who paused it and when, and Resume.
        await page.goto(adminPath(lang, 'imagery/version/pause-1'));
        await pauseCard(page)
            .getByRole('button', { name: text(lang, 'adminWorker.job.pause') })
            .click({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect
            .poll(async () => (await imagery.job('pause-1'))?.['paused'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ by: owner });
        await expect(pauseCard(page).locator('[data-paused]')).toContainText(text(lang, 'adminWorker.job.you'));
        await expectStateSound(page, adminVisit('worker.job-paused', lang));
        await pauseCard(page)
            .getByRole('button', { name: text(lang, 'adminWorker.job.resume') })
            .click();
        await expect.poll(async () => (await imagery.job('pause-1'))?.['paused'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBeUndefined();

        // Jobs: Pause all says how many and the row reads Paused; Resume all puts it back.
        // The list (on a phone the open job replaces it), where Pause all is.
        await page.goto(adminPath(lang, 'jobs'));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.pauseAll') }).click();
        await expect(page.getByText(contentText(lang, 'adminContent.jobs.status.paused'), { exact: false }).first()).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await page.goto(adminPath(lang, 'jobs/pause-1'));
        await expect(page.locator('hcm-jobs-page span[data-paused]')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.jobs-pause-all', lang));
        await page.goto(adminPath(lang, 'jobs'));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.resumeAll') }).click();
        await expect.poll(async () => (await imagery.job('pause-1'))?.['paused'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBeUndefined();

        // The computer: For 1 hour, then who paused it and until when, and Resume.
        const card = page.locator('hcm-worker-panel');
        await card.getByRole('button', { name: text(lang, 'adminWorker.pause.hour') }).click();
        await expect(card.locator('[data-computer-paused]')).toContainText(text(lang, 'adminWorker.pause.byYou'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.computer-paused', lang));
        await card.getByRole('button', { name: text(lang, 'adminWorker.pause.resume') }).click();
        await expect(card.locator('[data-computer-pause]')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    },
);

test(
    'A finished job offers no Pause, and Resume all with nothing paused says so',
    { tag: ['@S-A170-BAD-FINISHED', '@S-A170-BAD-NOTHING'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedJob(imagery, 'done-1', owner, 'awaiting_approval');

        await page.goto(adminPath(lang, 'imagery/version/done-1'));
        await expect(page.locator('hcm-job-pause').getByRole('button')).toHaveCount(0);

        await page.goto(adminPath(lang, 'jobs'));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.jobs.resumeAll') }).click();
        await expect(page.getByText(contentText(lang, 'adminContent.jobs.nothingToResume'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    },
);
