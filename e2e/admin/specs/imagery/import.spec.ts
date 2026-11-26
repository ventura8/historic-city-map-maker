import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import {
    awaitHarvest,
    cardImport,
    closeImportNotice,
    detail,
    errorText,
    importFromList,
    imageryText,
    readyImagery,
    stepRow,
    stepStateText,
    TARGET_FRAMES,
    versionIdOf,
    versionState,
} from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * An import on its way (behaviour A12, docs/research/M3-interfaces.md §4.5): Import on its card -> `imagery.import` (the
 * Functions emulator) -> the dispatcher -> the fake Cloud Run -> the stand-in runner, scripted per test
 * (e2e/admin/support/imagery-runner.ts): a run held and cancelled, a failed run retried from its failed step, USGS
 * maintenance waiting for the tick. The imports that reach the public map are published.spec.ts.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

/** The Work tab, by the count its label says. */
function workTab(page: Page, lang: 'ro' | 'en', count: number): Locator {
    return page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: String(count) }) });
}

/** Cancels the open version's job, as an admin does: Cancel, then Cancel in the question; waits until it is cancelled. */
async function cancelOpenImport(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await detail(page)
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await page
        .locator('hcm-dialog[open]')
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await expect(versionState(page, lang, 'adminContent.imagery.version.cancelled')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

test(
    'Work counts an import while it runs, and no more once it ended',
    { tag: ['@S-A12-HAPPY-WORK-COUNT', '@S-A12-BAD-WORK-COUNT-ENDED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'under', holdAt: 'warp' }] });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        await expect(workTab(page, lang, 0)).toBeVisible();

        // Import: while the job runs (held before warp), Work's tab counts its version, live (finding 54 of 2026-11-01).
        await cardImport(page, lang, SCENE).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        const versionId = versionIdOf(page);
        await closeImportNotice(page, lang);
        await expect(stepRow(page, lang, 'georef')).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await page.goto(adminPath(lang, 'imagery'));
        await expect(workTab(page, lang, 1)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        // Cancelled, the import leaves Work, and its count with it.
        await page.goto(adminPath(lang, `imagery/version/${versionId}`));
        await cancelOpenImport(page, lang);
        await page.goto(adminPath(lang, 'imagery'));
        await expect(workTab(page, lang, 0)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    },
);

/** A size on a step line as the page writes it: gigabytes with at most two decimals, in the admin's language. */
function gigabytes(lang: 'ro' | 'en', bytes: number): string {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 2 }).format(bytes / 1e9);
}

test(
    'A long download shows its bytes of the total, and its bytes alone while the total is unknown',
    { tag: ['@S-A12-HAPPY-DOWNLOAD-BYTES', '@S-A12-BAD-DOWNLOAD-SIZE-UNKNOWN'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The pipeline's fetch reports 1.234 of 3.4 GB received (finding 55 of 2026-11-01: a long download looked stuck).
        await imagery.script({ attempts: [{ outcome: 'under', downloading: { received: 1_234_000_000, total: 3_400_000_000 } }] });
        const versionId = await importFromList(page, lang, SCENE);
        const running = stepStateText(lang, 'running');
        const ofTotal = imageryText(lang, 'adminContent.imagery.bytesOf', {
            received: gigabytes(lang, 1_234_000_000),
            total: gigabytes(lang, 3_400_000_000),
        });
        await expect(stepRow(page, lang, 'fetch')).toContainText(`${running} · ${ofTotal} GB`, { timeout: FUNCTIONS_TIMEOUT_MS });
        // The bar moves with the bytes: the download's share of the job, as the job records it.
        const progress = Number((await imagery.job(versionId))?.['progress']);
        expect(progress).toBeGreaterThan(0);
        const bar = imageryText(lang, 'adminContent.jobs.progress', { percent: String(Math.round(progress * 100)) });
        await expect(detail(page).getByRole('progressbar', { name: bar })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-downloading', lang));

        // A delivery whose size USGS did not say: the bytes received alone.
        await imagery.script({ attempts: [{ outcome: 'under', downloading: { received: 524_000_000 } }] });
        await importFromList(page, lang, TARGET_FRAMES[1]);
        await expect(stepRow(page, lang, 'fetch')).toContainText(`${running} · ${gigabytes(lang, 524_000_000)} GB`, {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
    },
);

test('An import can be cancelled', { tag: '@S-A12-BAD-CANCEL' }, async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
    const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
    await imagery.script({ attempts: [{ outcome: 'under', holdAt: 'warp' }] });
    await importFromList(page, lang, SCENE);
    await expect(stepRow(page, lang, 'georef')).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS });
    const versionId = versionIdOf(page);

    // Cancel asks first; confirmed, the execution gets its SIGTERM and the job and its version end cancelled.
    await detail(page)
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await page
        .locator('hcm-dialog[open]')
        .getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })
        .click();
    await expect(versionState(page, lang, 'adminContent.imagery.version.cancelled')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await expectStateSound(page, adminVisit('imagery.version-cancelled', lang));
    await expect.poll(async () => (await imagery.job(versionId))?.['status'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cancelled');
    expect(await imagery.objects(`work/${imagery.city}/${versionId}/`)).toEqual([]);

    // The reserved layer id is free again: the scene can be imported once more.
    await expect
        .poll(async () => (await imagery.cityWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${SCENE}`))?.['status'], {
            timeout: FUNCTIONS_TIMEOUT_MS,
        })
        .toBe('candidate');
    await page.goto(adminPath(lang, `imagery/scene/${SCENE}`));
    await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
});

test(
    'A failed import can be retried successfully',
    { tag: '@S-A12-BAD-RETRY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The georeference done before the failure measured 28.4 m: the retried job keeps it and waits for Approve.
        await imagery.script({
            attempts: [
                { outcome: 'fail', failAt: 'warp', code: 'apiError.imagery.processingFailed', checkpointRmseM: 28.4 },
                { outcome: 'over' },
            ],
        });
        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.processingFailed'))).toBeVisible();
        await expect(stepRow(page, lang, 'warp')).toContainText(stepStateText(lang, 'failed'));
        await expectStateSound(page, adminVisit('imagery.version-failed', lang));

        // Retry: the job resumes at its failed step, the steps done before skipped, and renders the version.
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(stepRow(page, lang, 'warp')).toContainText(stepStateText(lang, 'done'));
        // The second run ends just after its last write, which the page may show first.
        await expect
            .poll(async () => (await imagery.runs()).map((run) => [run.attempt, run.outcome, run.state]))
            .toEqual([
                // Finding 56: attempt 1's download on the small job, then its processing; the retry downloads nothing again.
                [1, 'fail', 'ended'],
                [1, 'fail', 'ended'],
                [2, 'over', 'ended'],
            ]);
        const lines = Object.values(await imagery.logs(versionIdOf(page))).map((line) => String(line['message']));
        expect(lines.filter((line) => line === 'fetch started')).toHaveLength(1);
    },
);

test(
    'A failure no retry cures offers no Try again, and the failed version is deleted for good',
    {
        tag: [
            '@S-A12-BAD-NOT-RETRYABLE',
            '@S-A12-BAD-FAILED-DISMISSED',
            '@S-A12-HAPPY-DISMISS-IMPORT-AGAIN',
            '@S-A33-HAPPY-ONE-DELETE',
            '@S-A125-HAPPY-DELETE-VERSION',
        ],
    },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A token Mapbox refused is no retry's to cure (out of memory is, since finding 58: a later pipeline may fit it).
        await imagery.script({ attempts: [{ outcome: 'fail', failAt: 'warp', code: 'apiError.mapbox.tokenInvalid' }] });
        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.mapbox.tokenInvalid'))).toBeVisible();
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })).toHaveCount(0);

        // S-A125: one Delete on the page, Delete this version (no Dismiss beside it, whose Delete only hid the version); it asks
        // first, saying what goes and that the originals stay; confirmed, the version and its job go and the page shows the list.
        const remove = imageryText(lang, 'adminContent.imagery.deleteVersion');
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.reject'), exact: true })).toHaveCount(
            0,
        );
        await detail(page).getByRole('button', { name: remove, exact: true }).click();
        const question = page.locator('hcm-dialog[open]');
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.deleteVersion'));
        await expect(question).toContainText(imageryText(lang, 'adminContent.imagery.confirm.deleteBody'));
        await expectStateSound(page, adminVisit('imagery.version-delete', lang));
        await question.getByRole('button', { name: remove, exact: true }).click();
        await expect(page).toHaveURL(/#\/imagery\/?$/, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect.poll(async () => imagery.version(versionId), { timeout: FUNCTIONS_TIMEOUT_MS }).toBeUndefined();
        expect(await imagery.job(versionId)).toBeUndefined();

        // Finding 85: the frame can be imported again.
        await page.goto(adminPath(lang, `imagery/scene/${SCENE}`));
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
    },
);

test(
    'A frame that ran out of memory says so and offers Try again',
    { tag: '@S-A12-HAPPY-OUT-OF-MEMORY-RETRY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // Finding 58 of 2026-11-01: the run killed for its memory ends failed with the reason, and Try again is offered.
        await imagery.script({
            attempts: [{ outcome: 'fail', failAt: 'stitch', code: 'apiError.imagery.outOfMemory' }, { outcome: 'over' }],
        });
        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.outOfMemory'))).toBeVisible();
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
    },
);

test(
    "A run lost in a step shows that step failed and only the failure's sentence, not its code",
    { tag: '@S-A12-BAD-LOST-RUN-STEP' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        // Findings 60 and 61 of 2026-11-02: imagery.tick failed a job whose run died in stitch (out of memory on the largest
        // machine): its step stayed "running", and its message, the bare code, showed under the translated sentence.
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        const at = new Date();
        const scene = { entityId: SCENE, dataset: 'corona2', sensor: 'KH-4A' } as const;
        const error = { code: 'apiError.imagery.outOfMemory', message: 'apiError.imagery.outOfMemory' };
        await imagery.seedVersion(
            'lost-1',
            {
                ...{ layerId: 'kh-4a-corona-1966', origin: 'usgs', state: 'failed', year: 1966, date: '1966-07-12', sensor: 'KH-4A' },
                source: { kind: 'usgs', ...scene, acquisitionDate: '1966-07-12' },
                label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
                error: { code: error.code },
            },
            at,
        );
        const steps = { fetch: { status: 'done' }, extract: { status: 'done' }, stitch: { status: 'running', bytes: 1000 } };
        await imagery.seedJob(
            'lost-1',
            { type: 'usgs-import', status: 'failed', params: scene, layerId: 'kh-4a-corona-1966', versionId: 'lost-1', steps, error },
            at,
        );

        await page.goto(adminPath(lang, 'imagery/version/lost-1'));
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.outOfMemory'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(stepRow(page, lang, 'stitch')).toContainText(stepStateText(lang, 'failed'));
        await expect(stepRow(page, lang, 'stitch')).not.toContainText(stepStateText(lang, 'running'));
        await expect(stepRow(page, lang, 'fetch')).toContainText(stepStateText(lang, 'done'));
        await expect(detail(page).getByText('apiError.imagery.outOfMemory')).toHaveCount(0);
        await expectStateSound(page, adminVisit('imagery.version-lost-run', lang));
    },
);

test(
    'USGS maintenance makes the import wait, not fail',
    { tag: '@S-A12-BAD-USGS-MAINTENANCE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // USGS answers its maintenance page while the download is prepared; retried at once by the next tick.
        await imagery.script({ attempts: [{ outcome: 'maintenance', retryInMinutes: 0 }, { outcome: 'over' }] });
        await importFromList(page, lang, SCENE);

        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.wait.usgsMaintenance'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(versionState(page, lang, 'adminContent.imagery.version.processing')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-usgs-wait', lang));

        await imagery.tick();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        // The resumed attempt downloads on the small job, then is processed on the standard one (finding 56).
        expect((await imagery.runs()).map((run) => run.outcome)).toEqual(['maintenance', 'over', 'over']);
    },
);
