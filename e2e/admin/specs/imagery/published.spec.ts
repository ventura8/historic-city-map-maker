import { DEFAULT_RMSE_THRESHOLD_M } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import {
    detail,
    expectLayerInViewer,
    importFromList,
    imageryText,
    publishedLayer,
    readyImagery,
    stepRow,
    stepStateText,
    versionState,
} from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * A free scene from Import to the public map (behaviours A12, A17, docs/research/M3-interfaces.md §1, §4, §7): Import on
 * its card -> `imagery.import` (the Functions emulator) -> the dispatcher -> the fake Cloud Run -> the stand-in runner,
 * scripted per test (e2e/admin/support/imagery-runner.ts), which writes what the raster pipeline writes -> the version
 * waits for approval, or the policy approves it -> the publisher (the Cloud Tasks emulator's `imagery.publish`) -> the
 * fake MTS -> the layer, the manifest and the viewer, which paints the tileset's colour and fades it with the layer's
 * opacity slider. The minimum admin input is counted. Each publish waits for the fake MTS and the manifest build: these
 * tests run on a push at a phone and a laptop, and at the other admin projects in `tour-matrix` (e2e/projects.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

test(
    'A free scene imports to a draft, is approved and appears in the viewer',
    { tag: ['@S-A12-HAPPY', '@S-A17-BAD-RMSE-ABOVE-THRESHOLD'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await imagery.script({ attempts: [{ outcome: 'over', holdAt: 'georef' }] });

        // One click: Import on the scene's card (docs/research/M3-interfaces.md §1: the search ran when the page opened).
        const importing = inputBudget.flow('importScene', 1);
        const versionId = await importFromList(page, lang, SCENE, (target) => importing.click(target));

        // The steps advance live: the run holds before georeferencing, then goes on.
        await expect(stepRow(page, lang, 'reference')).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(stepRow(page, lang, 'georef')).toContainText(stepStateText(lang, 'pending'));
        await expect(versionState(page, lang, 'adminContent.imagery.version.processing')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-steps', lang));
        await expect.poll(async () => imagery.release(), { timeout: FUNCTIONS_TIMEOUT_MS }).toBe(1);
        await expect(stepRow(page, lang, 'register')).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS });

        // Over the threshold: the draft waits with both numbers and the compute-unit cost; nothing reaches Mapbox.
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const over = imageryText(lang, 'adminContent.imagery.approval.rmseOver', {
            rmse: (28.4).toLocaleString(lang),
            threshold: String(DEFAULT_RMSE_THRESHOLD_M),
        });
        await expect(detail(page).getByText(over)).toBeVisible();
        await expect(detail(page).locator('[data-estimate]')).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-approval', lang));
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);

        // Approve (one click) -> the fake MTS -> published, and the viewer shows it.
        const approving = inputBudget.flow('approveVersion', 1);
        await approving.click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') }));
        const layer = await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS);
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toHaveLength(1);
        await expectLayerInViewer(page, lang, imagery, layer);
    },
);

test(
    'Under the threshold, Import is the only click',
    { tag: ['@S-A12-HAPPY-AUTO-PUBLISHED', '@S-A17-HAPPY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const importing = inputBudget.flow('importScene', 1);
        const versionId = await importFromList(page, lang, SCENE, (target) => importing.click(target));

        // The checkpoint error (6.2 m) is under the city's 15 m and fits the month: approved by the server, published.
        const layer = await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS);
        expect(await imagery.version(versionId)).toMatchObject({
            source: { entityId: SCENE },
            approval: { auto: true, by: 'system:imagery', thresholdM: 15 },
        });
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('imagery.version-published', lang));
        const label = ((await imagery.version(versionId))?.['label'] ?? {}) as Readonly<Record<string, string>>;
        await page.goto(adminPath(lang, 'layers'));
        await expect(page.getByRole('link', { name: String(label[lang]) })).toBeVisible();
        await expectLayerInViewer(page, lang, imagery, layer);
    },
);
