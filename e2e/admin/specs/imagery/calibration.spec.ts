import type { Calibration, CalibrationAlignment } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { deleteObjects } from '../../support/imagery-store.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { detail, errorText, importFromList, imageryText, readyImagery, versionState } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * What a version's page says of how the frame was found (behaviour A67, docs/research/M9-calibration.md §8) and why it waits
 * (behaviour A17, §11): the stand-in writes what `locate` and `export` write, per attempt (e2e/admin/support/imagery-run.ts); the
 * real search is the pipeline's (behaviour P06).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';
const PROVED: Calibration = {
    how: 'votes',
    votes: { agreed: 22, tiles: 196 },
    tiles: { agreed: 712, tried: 946 },
    crossValidatedM: 16.3,
    coveredPct: 95,
    measuredPct: 88.2,
};

test(
    'A frame found with no landmark says how, what agrees, its error and the city it covers',
    { tag: '@S-A67-HAPPY-CALIBRATION' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({ attempts: [{ outcome: 'over', calibration: PROVED, coveragePct: 96 }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const block = detail(page).locator('[data-calibration="votes"]');
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.how.votes'));
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.tiles', { agreed: '712', tried: '946' }));
        await expect(block).toContainText(
            imageryText(lang, 'adminContent.imagery.calibration.error', { metres: (16.3).toLocaleString(lang) }),
        );
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.join.coverageMeasured', { percent: '96' }));
        await expect(detail(page).locator('[data-waits]')).toHaveCount(0);
        await expectStateSound(page, adminVisit('imagery.version-calibrated', lang));
    },
);

test(
    'A frame lined up with earlier photos names them, and the one whose streets sat off',
    { tag: ['@S-A67-HAPPY-ALIGNED', '@S-A67-BAD-ALIGNED-LEFT-OUT'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        const alignment: CalibrationAlignment = {
            partners: [
                { versionId: 'v-1972', year: 1972, ties: 1420, tried: 1643, status: 'used', offsetM: 1.4 },
                { versionId: 'v-1977', year: 1977, ties: 810, tried: 1961, status: 'used', offsetM: 0.2 },
                { versionId: 'v-1966', year: 1966, ties: 78, tried: 124, status: 'few' },
                { versionId: 'v-1978', year: 1978, ties: 900, tried: 1500, status: 'disagrees', offsetM: 9.24 },
            ],
        };
        await imagery.script({ attempts: [{ outcome: 'over', calibration: { ...PROVED, alignment }, coveragePct: 96 }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const block = detail(page).locator('[data-calibration="votes"]');
        await expect(block).toContainText(
            imageryText(lang, 'adminContent.imagery.calibration.aligned', { years: '1972, 1977', ties: '2230' }),
        );
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.stayed'));
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.leftOut', { years: '1978' }));
        await expect(block).not.toContainText('1966');
        await expectStateSound(page, adminVisit('imagery.version-aligned', lang));
    },
);

test(
    'A frame the local AI proposed says on which graphics card, and that the proof held it',
    { tag: '@S-A68-HAPPY-DEVICE-SHOWN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        const proposer = { name: 'aliked-lightglue', device: 'gpu', deviceName: 'NVIDIA RTX 3080', seconds: 31, support: 46 } as const;
        await imagery.script({ attempts: [{ outcome: 'over', calibration: { ...PROVED, how: 'local-ai', proposer }, coveragePct: 96 }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const block = detail(page).locator('[data-calibration="local-ai"]');
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.how.localAi', { device: 'NVIDIA RTX 3080' }));
        await expect(block).toContainText(imageryText(lang, 'adminContent.imagery.calibration.tiles', { agreed: '712', tried: '946' }));
        await expectStateSound(page, adminVisit('imagery.version-local-ai', lang));
    },
);

test(
    'A frame nothing found asks for a few rough points',
    { tag: '@S-A67-BAD-NOT-FOUND' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({ attempts: [{ outcome: 'no-match', calibration: { how: 'none', refusal: 'no-votes' } }] });

        await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).locator('[data-calibration="none"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.notFound'),
        );
        await expect(detail(page).getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-not-found', lang));
    },
);

test(
    'Locate again: a frame waiting for points searches again, and this time the proof holds',
    { tag: ['@S-A69-HAPPY-LOCATE-AGAIN', '@S-A69-HAPPY-REFUSED-MAY-PROVE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({
            attempts: [
                { outcome: 'no-match', calibration: { how: 'none', refusal: 'no-votes' } },
                { outcome: 'over', calibration: PROVED, coveragePct: 96 },
            ],
        });
        await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.locateAgain') })
            .click();

        await expect(
            page.locator('hcm-snackbar').filter({ hasText: imageryText(lang, 'adminContent.imagery.notice.locating') }),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-calibration="votes"]')).toBeVisible();
        await expect(detail(page).locator('[data-calibration="none"]')).toHaveCount(0);
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.locateAgain') })).toHaveCount(0);
    },
);

test(
    'Locate again with the working files and the delivery gone says why, and the frame still waits for points',
    { tag: '@S-A69-BAD-INPUTS-GONE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await imagery.script({ attempts: [{ outcome: 'no-match', calibration: { how: 'none', refusal: 'no-votes' } }] });
        const versionId = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await deleteObjects(`work/${PROJECT_CITY}/${versionId}/`);

        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.locateAgain') })
            .click();

        await expect(
            detail(page)
                .getByRole('alert')
                .filter({ hasText: errorText(lang, 'apiError.imagery.locateInputsGone') }),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible();
        await expect(detail(page).getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-locate-refused', lang));
        expect(consoleErrors.takeMatching(/imagery-locateAgain/).length).toBeGreaterThan(0);
    },
);

test(
    'A frame under the threshold holding part of the city waits, and says why',
    { tag: '@S-A17-BAD-PART-OF-CITY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await imagery.script({ attempts: [{ outcome: 'under', calibration: PROVED, coveragePct: 62 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="coverage"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.coverage'),
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.version-coverage', lang));
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
    },
);

test(
    'A frame the proof refused waits for one click, however low its figure',
    { tag: '@S-A17-BAD-NOT-PROVED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await imagery.script({ attempts: [{ outcome: 'under', calibration: { how: 'none', refusal: 'gross' }, coveragePct: 96 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="not-proved"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.notProved'),
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.version-not-proved', lang));
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
    },
);

test(
    'A proved frame with a check dropped as gross waits for one click',
    { tag: '@S-A17-BAD-CHECKS-DROPPED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const calibration: Calibration = { ...PROVED, measuredPct: 85, checksDropped: 2 };
        await imagery.script({ attempts: [{ outcome: 'under', calibration, coveragePct: 96 }] });

        const versionId = await importFromList(page, lang, SCENE);

        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).locator('[data-waits="not-proved"]')).toHaveText(
            imageryText(lang, 'adminContent.imagery.calibration.waits.notProved'),
        );
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
    },
);
