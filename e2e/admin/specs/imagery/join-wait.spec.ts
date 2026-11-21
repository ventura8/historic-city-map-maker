import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { seedJob } from '../../support/ops.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import { EAST, F039, F040, WEST, dateRow, joinButton, openDates, seedTwoFrames } from './join-world.js';
import { cardImport, closeImportNotice, detail, errorText, imageryText, publishedLayer, readyImagery, versionIdOf } from './world.js';

// One admin test at a time: the runs play in the server's upstream world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Join when it ends (behaviour A65, M18 item 4 of docs/research/M18-improvements.md): a date's frame already published as its own
 * layer, whose layer another job is still working on, refuses Join frames with its own words (`apiError.imagery.joinLayerBusy`, the
 * Functions emulator); the snackbar's Join when it ends waits, asking `imagery.join` again every `JOIN_WAIT_MS` while the admin is
 * open (the page's clock, moved on by the test), and once that job ended the join starts by itself and the snackbar says so.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** `JOIN_WAIT_MS` of packages/admin/src/imagery/join.ts: how often a waiting join asks again. */
const JOIN_WAIT_MS = 60_000;
const BUSY_JOB = 'rg-busy-on-the-layer';
const AT = new Date('2026-10-17T09:00:00.000Z');

test(
    'A join refused for a busy layer offers Join when it ends, which starts the join by itself once the layer is free',
    { tag: ['@S-A65-HAPPY-JOIN-WHEN-FREE', '@S-A65-BAD-JOIN-LAYER-BUSY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(480_000);
        await page.clock.install();
        await page.clock.resume();
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, { publishThroughMapbox: false });
        await seedTwoFrames(imagery);
        await imagery.script({
            attempts: [{ outcome: 'under' }],
            entities: { [F039]: [{ outcome: 'over', outputBounds: WEST }], [F040]: [{ outcome: 'under', outputBounds: EAST }] },
            join: [{ outcome: 'over' }],
        });

        // F039 imported alone, approved and published as a layer of its own.
        await openDates(page, lang);
        await cardImport(page, lang, F039).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await closeImportNotice(page, lang);
        const frame = versionIdOf(page);
        const approve = detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') });
        await approve.click({ timeout: FUNCTIONS_TIMEOUT_MS });
        const layer = await publishedLayer(imagery, frame, PUBLISH_TIMEOUT_MS);

        // Another job still works on that layer: Join frames is refused in its own words, with Join when it ends.
        const busy = { type: 'regeoref', status: 'running', params: { basedOn: frame }, layerId: layer.id, versionId: BUSY_JOB };
        await seedJob(imagery.cityWorld, BUSY_JOB, { ...busy, createdBy: adminWorld.accounts.owner.uid }, AT);
        await openDates(page, lang);
        await joinButton(dateRow(page), lang).click();
        await expect(dateRow(page).locator('[data-state="join-refused"]')).toContainText(
            errorText(lang, 'apiError.imagery.joinLayerBusy'),
            {
                timeout: FUNCTIONS_TIMEOUT_MS,
            },
        );
        expect(consoleErrors.takeMatching(/status of \d+ .*imagery-join/)).toHaveLength(1);
        await page
            .locator('hcm-snackbar')
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.join.whenFree') })
            .click();
        await expect(dateRow(page).locator('[data-state="join-refused"]')).toContainText(
            imageryText(lang, 'adminContent.imagery.join.waitingFree'),
        );
        await expectStateSound(page, adminVisit('imagery.join-waiting-free', lang));

        // Still busy a minute later: it waits on, and nothing was created.
        await page.clock.fastForward(JOIN_WAIT_MS);
        await expect
            .poll(() => consoleErrors.takeMatching(/status of \d+ .*imagery-join/).length, { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBe(1);
        expect(
            Object.keys(await adminWorld.emulators.collection(`cities/${imagery.city}/layerVersions`)).filter((id) => id.startsWith('jn')),
        ).toEqual([]);

        // The job ends; the next ask starts the join by itself, and the snackbar says so.
        await seedJob(imagery.cityWorld, BUSY_JOB, { ...busy, status: 'succeeded', createdBy: adminWorld.accounts.owner.uid }, AT);
        await page.clock.fastForward(JOIN_WAIT_MS);
        await expect(page.locator('hcm-snackbar')).toContainText(imageryText(lang, 'adminContent.imagery.join.started'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(dateRow(page).locator('[data-state="join-refused"]')).toBeHidden();
        const versions = Object.keys(await adminWorld.emulators.collection(`cities/${imagery.city}/layerVersions`));
        expect(versions.filter((id) => id.startsWith('jn'))).toHaveLength(1);
        expect(versions).toContain(frame);
    },
);
