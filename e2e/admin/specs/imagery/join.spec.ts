import { DEFAULT_NEW_CITY_LIMITS } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import {
    EAST,
    F039,
    F040,
    F041,
    WEST,
    dateRow,
    joinButton,
    joinFromRow,
    joinWith,
    openDates,
    partRow,
    partsOf,
    planRows,
    seedFrame,
    seedTwoFrames,
    tickUntil,
} from './join-world.js';
import {
    cardImport,
    closeImportNotice,
    detail,
    errorText,
    expectLayerInViewer,
    imageryText,
    publishedLayer,
    readyImagery,
    versionIdOf,
    versionState,
} from './world.js';

// One admin test at a time: the runs play in the server's upstream world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A whole-city layer from one date's frames (behaviours A65, A66; `docs/research/M8-join-interfaces.md`): Find's rows come from
 * the plan the page's own search wrote, Join frames goes through `imagery.join` (the Functions emulator), the frames' imports and
 * the join through the dispatcher, the fake Cloud Run and the stand-in, which writes what the pipeline writes; the frames that are
 * not ready hold the join, and the tick lets it go. The real pipeline's run is join-pipeline.spec.ts. Published joins reach the
 * viewer; what no screen shows (a mixed set, the frames' jobs and files) is `functions/test/imagery/join*.test.ts`.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The script of two frames holding part of the city each, and of their join. */
function twoFrames(
    join: Parameters<ImageryWorld['script']>[0]['attempts'],
    first = {},
    second = {},
): Parameters<ImageryWorld['script']>[0] {
    return {
        attempts: [{ outcome: 'under' }],
        entities: {
            [F039]: [{ outcome: 'under', outputBounds: WEST, ...first }],
            [F040]: [{ outcome: 'under', outputBounds: EAST, ...second }],
        },
        join,
    };
}

/** The report's Approve, in the open join's card. */
function approveOf(page: Page, lang: 'ro' | 'en') {
    return detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') });
}

test(
    "A frame of part of the city joins its date's other, waits for it, and is approved and published as one layer",
    {
        tag: ['@S-A65-HAPPY', '@S-A65-BAD-OVER-THRESHOLD', '@S-A65-BAD-PART-NOT-AUTO', '@S-A65-HAPPY-FINALIZE-SCENES'],
    },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(480_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await seedTwoFrames(imagery);
        await imagery.script(twoFrames([{ outcome: 'over' }], { outcome: 'over' }, { holdAt: 'warp' }));
        await openDates(page, lang);

        // Live F039's path: the frame imported alone covers about half the city and waits for approval.
        await cardImport(page, lang, F039).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await closeImportNotice(page, lang);
        const frame = versionIdOf(page);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const offer = detail(page).locator('[data-join-offer]');
        const offered = imageryText(lang, 'adminContent.imagery.join.offer', { percent: '55', frames: 'F040', total: '100' });
        await expect(offer.getByText(offered)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(offer).toContainText(imageryText(lang, 'adminContent.imagery.join.toDownload', { count: '1' }));
        await expectStateSound(page, adminVisit('imagery.join-offer', lang));

        // One click: the join's page, its frames each with its state, waiting for the one still rendering.
        const joining = inputBudget.flow('joinFrames', 1);
        const join = await joinWith(page, () => joining.click(joinButton(offer, lang)));
        await expect(detail(page).locator('[data-state="join-waiting"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.join.waiting'),
            {
                timeout: FUNCTIONS_TIMEOUT_MS,
            },
        );
        await expect(partRow(page, F039)).toContainText(imageryText(lang, 'adminContent.imagery.version.awaitingApproval'));
        await expect(partRow(page, F040)).toContainText(imageryText(lang, 'adminContent.imagery.version.processing'));
        await expectStateSound(page, adminVisit('imagery.join-waiting', lang));

        // The frame goes on and the tick starts the join. Over the threshold it waits, and says what it measured.
        await expect.poll(async () => imagery.release(), { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
        await tickUntil(imagery, join, 'awaiting_approval');
        const report = detail(page).locator('[data-join-report]');
        const [before, after] = [(42.6).toLocaleString(lang), (3.1).toLocaleString(lang)];
        await expect(report).toContainText(imageryText(lang, 'adminContent.imagery.join.coverageMeasured', { percent: '96' }));
        await expect(report.locator('[data-seam="applied"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.join.seam', { a: 'F039', b: 'F040', before, after }),
        );
        await expect(report).toContainText(
            imageryText(lang, 'adminContent.imagery.join.absolute', { metres: (28.4).toLocaleString(lang) }),
        );
        await expect(report).toContainText(imageryText(lang, 'adminContent.imagery.join.maxShift', { metres: (9.4).toLocaleString(lang) }));
        await expectStateSound(page, adminVisit('imagery.join-approval', lang));

        // Neither the join nor its frame under the threshold published itself.
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
        const parts = await partsOf(imagery, join);
        const second = parts.find((part) => part.entityId === F040)?.versionId ?? '';
        expect((await imagery.version(second))?.['approval']).toBeUndefined();

        // Approve: one layer, its frames joined, their scenes on it, and the viewer shows it.
        await inputBudget.flow('approveVersion', 1).click(approveOf(page, lang));
        const layer = await publishedLayer(imagery, join, PUBLISH_TIMEOUT_MS);
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toHaveLength(1);
        expect((await imagery.version(frame))?.['state']).toBe('joined');
        expect((await imagery.version(second))?.['state']).toBe('joined');
        const scene = await adminWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${F040}`);
        expect(scene?.['layerId']).toBe(layer.id);
        await expectLayerInViewer(page, lang, imagery, layer);
    },
);

test(
    'A join within every limit publishes itself; Join frames is the only click',
    { tag: '@S-A65-HAPPY-AUTO' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await seedTwoFrames(imagery);
        await imagery.script(twoFrames([{ outcome: 'under' }]));
        await openDates(page, lang);
        await expect(dateRow(page)).toContainText(
            imageryText(lang, 'adminContent.imagery.join.rowCoverage', { frames: '2', percent: '100' }),
        );
        const joining = inputBudget.flow('joinFrames', 1);
        const join = await joinWith(page, () => joining.click(joinButton(dateRow(page), lang)));
        await expect
            .poll(
                async () => {
                    await imagery.tick();
                    return (await imagery.version(join))?.['approval'];
                },
                { timeout: PUBLISH_TIMEOUT_MS },
            )
            .toMatchObject({ auto: true, by: 'system:imagery' });
        const layer = await publishedLayer(imagery, join, PUBLISH_TIMEOUT_MS);
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toHaveLength(1);
        expect(layer.id).not.toBe('');
    },
);

test(
    'A join that came out short takes the next frame; only that frame is downloaded',
    { tag: '@S-A65-HAPPY-ADD-FRAME' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        // A third frame the plan leaves out: its estimate of the two reaches the city. The pipeline's measure will not.
        await seedFrame(imagery, { entityId: F041, bounds: EAST });
        await imagery.scannedFrames([F041]);
        await imagery.script({ ...twoFrames([{ outcome: 'over', join: { coveragePct: 62 } }]) });
        await openDates(page, lang);
        const first = await joinFromRow(page, lang);
        await tickUntil(imagery, first, 'awaiting_approval');
        await expect(detail(page).locator('[data-join-report]')).toContainText(
            imageryText(lang, 'adminContent.imagery.join.coverageMeasured', { percent: '62' }),
        );

        // The row the server wrote names it as a spare, and the card offers it.
        const [row] = (await planRows(imagery)) ?? [];
        expect(row?.frames.map((frame) => frame.entityId)).toEqual([F039, F040]);
        expect(row?.spareFrames).toEqual([F041]);
        const add = detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.join.addFrame', { frame: 'F041' }) });
        const second = await joinWith(page, async () => {
            await add.click();
            await expect.poll(() => versionIdOf(page), { timeout: FUNCTIONS_TIMEOUT_MS }).not.toBe(first);
        });

        // The old join gave way; the new one holds the three frames; the two that rendered ran once.
        await expect(partRow(page, F041)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect((await partsOf(imagery, second)).map((part) => part.entityId)).toEqual([F039, F040, F041]);
        expect((await imagery.version(first))?.['state']).toBe('rejected');
        await tickUntil(imagery, second, 'awaiting_approval');
        const imports = (await imagery.runs()).map((run) => run.jobId).filter((jobId) => !jobId.startsWith('jn'));
        expect(new Set(imports).size).toBe(3);
    },
);

test(
    'A frame that needs points holds the join, whose page links the georeferencer; a held frame refuses its own approval',
    { tag: ['@S-A65-BAD-PART-NEEDS-POINTS', '@S-A65-BAD-PART-HELD'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        await imagery.script(twoFrames([{ outcome: 'under' }], { outcome: 'no-match' }));
        await openDates(page, lang);
        const join = await joinFromRow(page, lang);
        const parts = await partsOf(imagery, join);
        const [points, held] = [parts[0]?.versionId ?? '', parts[1]?.versionId ?? ''];

        await expect(partRow(page, F039).getByRole('link')).toHaveAttribute('href', new RegExp(`#/georef/${points}$`), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(partRow(page, F039)).toContainText(imageryText(lang, 'adminContent.imagery.version.needsGcps'));
        await expect(partRow(page, F040)).toContainText(imageryText(lang, 'adminContent.imagery.version.awaitingApproval'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-state="join-waiting"]')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.join-part-needs-points', lang));

        // The tick does not start it: only the two frames ran.
        await imagery.tick();
        expect(await imagery.job(join)).toMatchObject({ status: 'queued', waitReason: 'parts' });
        expect((await imagery.runs()).filter((run) => run.jobId === join)).toEqual([]);

        // Work asks for the frame that needs points, not for the one the join holds.
        await page.goto(adminPath(lang, 'imagery'));
        await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: '3' }) }).click();
        const waiting = page.getByRole('region', { name: imageryText(lang, 'adminContent.imagery.needsYou') });
        await expect(waiting.locator(`[data-version="${points}"]`)).toBeVisible();
        await expect(waiting.locator(`[data-version="${held}"]`)).toBeHidden();
        // The join and its frames share a label: each row says which it is.
        await expect(waiting.locator(`[data-version="${points}"] .row-title`)).toContainText('F039');
        await expect(page.locator(`[data-version="${join}"] .row-title`)).toContainText(
            imageryText(lang, 'adminContent.imagery.origin.join'),
        );

        // The held frame's page leads to its join, and its Approve is refused.
        await page.goto(adminPath(lang, `imagery/version/${held}`));
        await expect(detail(page).locator('[data-state="join-holds"]').getByRole('link')).toHaveAttribute(
            'href',
            new RegExp(`/imagery/version/${join}$`),
        );
        await expect(detail(page).locator('[data-join-offer]')).toBeHidden();
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.jobs.cancel') })).toBeHidden();
        await approveOf(page, lang).click();
        await expect(detail(page).getByRole('alert')).toContainText(errorText(lang, 'apiError.imagery.joinPartHeld', { frame: F040 }), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect(consoleErrors.takeMatching(/status of 400 .*imagery-approve/)).toHaveLength(1);
        await expectStateSound(page, adminVisit('imagery.join-holds', lang));
        expect((await imagery.version(held))?.['state']).toBe('awaiting_approval');
    },
);

test(
    'Frames that never meet say so, and wait for Approve',
    { tag: '@S-A65-BAD-NO-SEAMS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        await imagery.script(twoFrames([{ outcome: 'under', join: { seams: [], maxShiftM: 0 } }]));
        await openDates(page, lang);
        const join = await joinFromRow(page, lang);
        await tickUntil(imagery, join, 'awaiting_approval');
        const report = detail(page).locator('[data-join-report]');
        await expect(report.locator('[data-state="join-no-seams"]')).toHaveText(imageryText(lang, 'adminContent.imagery.join.noSeams'));
        await expect(approveOf(page, lang)).toBeVisible();
        expect((await imagery.version(join))?.['approval']).toBeUndefined();
        await expectStateSound(page, adminVisit('imagery.join-no-seams', lang));
    },
);

test(
    'A seam whose correction did not help says nothing moved, and waits for Approve',
    { tag: '@S-A65-BAD-SEAM-REFUSED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        const refused = {
            a: F039,
            b: F040,
            measured: true,
            applied: false,
            samples: 20,
            heldOut: 4,
            beforeRmseM: 12,
            afterRmseM: 12,
            maxShiftM: 0,
        };
        await imagery.script(twoFrames([{ outcome: 'under', join: { seams: [refused], maxShiftM: 0 } }]));
        await openDates(page, lang);
        const join = await joinFromRow(page, lang);
        await tickUntil(imagery, join, 'awaiting_approval');
        await expect(detail(page).locator('[data-seam="not-applied"]')).toContainText(
            imageryText(lang, 'adminContent.imagery.join.seamRefused', { a: 'F039', b: 'F040', before: '12' }),
        );
        await expect(approveOf(page, lang)).toBeVisible();
        expect((await imagery.version(join))?.['approval']).toBeUndefined();
        await expectStateSound(page, adminVisit('imagery.join-seam-refused', lang));
    },
);

test(
    'A seam that could not be measured is said and waits for Approve; Reject gives the frames back, and they join again',
    { tag: ['@S-A65-BAD-UNMEASURED', '@S-A65-BAD-REJECTED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        await imagery.script(twoFrames([{ outcome: 'under', seamsUnmeasured: true, join: { maxShiftM: 0 } }]));
        await openDates(page, lang);
        const join = await joinFromRow(page, lang);
        await tickUntil(imagery, join, 'awaiting_approval');
        const report = detail(page).locator('[data-join-report]');
        await expect(report.locator('[data-seam="unmeasured"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.join.seamUnmeasured', { a: 'F039', b: 'F040' }),
        );
        await expect(approveOf(page, lang)).toBeVisible();
        expect((await imagery.version(join))?.['approval']).toBeUndefined();
        await expectStateSound(page, adminVisit('imagery.join-unmeasured', lang));

        // Reject: only the join ends. Its frames wait for approval again and their scenes stay imported.
        const reject = imageryText(lang, 'adminContent.imagery.reject');
        await detail(page).getByRole('button', { name: reject, exact: true }).click();
        await page.locator('hcm-dialog[open]').getByRole('button', { name: reject, exact: true }).click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.rejected')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        const [part] = await partsOf(imagery, join);
        expect((await imagery.version(part?.versionId ?? ''))?.['state']).toBe('awaiting_approval');
        const scene = await adminWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${F039}`);
        expect(scene).toMatchObject({ status: 'imported' });
        await openDates(page, lang);
        await expect(joinButton(dateRow(page), lang)).toBeEnabled();
    },
);

test(
    'A join whose frames lie too far apart fails, says which, and leads to the georeferencer',
    { tag: '@S-A65-BAD-SEAM-TOO-FAR' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        const code = 'apiError.imagery.joinSeamTooFar';
        await imagery.script(twoFrames([{ outcome: 'fail', failAt: 'align', code, codeParams: { a: F039, b: F040 } }]));
        await openDates(page, lang);
        const join = await joinFromRow(page, lang);
        await tickUntil(imagery, join, 'failed');
        await expect(detail(page).getByRole('alert')).toContainText(errorText(lang, code, { a: F039, b: F040 }), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const [first] = await partsOf(imagery, join);
        await expect(partRow(page, F039).getByRole('link')).toHaveAttribute('href', new RegExp(`#/georef/${first?.versionId ?? ''}$`));
        // The same frames would only measure the same: Join frames with the fixed frame cures this, and no Retry offers otherwise.
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })).toBeHidden();
        await expectStateSound(page, adminVisit('imagery.join-failed', lang));
    },
);

test(
    "Join frames past today's limit is refused beside the button, and nothing is created",
    { tag: '@S-A65-BAD-DAILY-LIMIT' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await seedTwoFrames(imagery);
        await adminWorld.emulators.updateFields(`cities/${imagery.city}`, { limits: { ...DEFAULT_NEW_CITY_LIMITS, rasterJobsPerDay: 2 } }, [
            'limits',
        ]);
        await openDates(page, lang);
        await joinButton(dateRow(page), lang).click();
        await expect(dateRow(page).locator('[data-state="join-refused"]')).toContainText(
            errorText(lang, 'apiError.imagery.dailyLimit', { limit: '2' }),
            { timeout: FUNCTIONS_TIMEOUT_MS },
        );
        expect(consoleErrors.takeMatching(/status of \d+ .*imagery-join/)).toHaveLength(1);
        expect(await adminWorld.emulators.collection(`cities/${imagery.city}/layerVersions`)).toEqual({});
        expect(await adminWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${F039}`)).toMatchObject({ status: 'candidate' });
        await expectStateSound(page, adminVisit('imagery.join-refused', lang));
    },
);
