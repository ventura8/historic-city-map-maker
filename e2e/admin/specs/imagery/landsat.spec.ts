import { LANDSAT_ATTRIBUTION } from '@hcm/shared';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import type { Page } from '@playwright/test';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import {
    cardImport,
    closeImportNotice,
    detail,
    errorText,
    imageryText,
    listedScenes,
    publishedLayer,
    readyImagery,
    sceneLink,
    sceneList,
    stepRow,
    stepStateText,
    versionIdOf,
    versionState,
} from './world.js';

// One admin test at a time: the harvest and the imports run in the server's upstream world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Landsat beside the declassified sources (behaviour A130, docs/research/M25-landsat.md §2, §4, §5): the fake USGS lists Landsat 5 TM's
 * and Landsat 8 and 9 OLI's scenes over the city (`usgs.landsatScenes`: the same M2M API, the same account); the Landsat chip narrows the list to them, a cloudy
 * scene ranks below a clear one of the same summer, Import (free) runs the stand-in pipeline's Landsat path (no locate, no georef: the
 * product is on the ground already; `warp` composes it and measures its shift from Sentinel-2) and the policy publishes it within a
 * pixel, credited to NASA and USGS. `imagery.tick` imports the clearest scene of a wanted year on its own; a delivery without a band
 * fails in plain words; a scene off by more than a pixel waits for Approve.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const CLEAR_1989 = 'LT51830291989193MTI00';
const CLOUDY_1989 = 'LT51830291989209MTI00';
const CLEAR_1990 = 'LT51830291990180MTI00';
/** Lesson 676: Landsat 8 and 9 OLI (`landsat_ot_c2_l1`), searched beside TM and ETM+. */
const OLI_2016 = 'LC81830292016198LGN01';
const OLI_2023 = 'LC91830292023199LGN00';
/** The six free declassified frames, the three Landsat 5 TM scenes and the two Landsat 8 and 9 OLI ones. */
const LISTED_FREE = 11;
const LISTED_LANDSAT = 5;

/** The page's own first search listed, then only Landsat's scenes. */
async function landsatListed(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await expect(sceneList(page, lang).getByRole('link')).toHaveCount(LISTED_FREE, { timeout: FUNCTIONS_TIMEOUT_MS });
    await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.landsat'), exact: true }).click();
    await expect(sceneList(page, lang).getByRole('link')).toHaveCount(LISTED_LANDSAT);
}

/** Import (free) on a Landsat card: the version's page, the notice closed. */
async function importScene(page: Page, lang: 'ro' | 'en', entityId: string): Promise<string> {
    await cardImport(page, lang, entityId).click();
    await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
    await closeImportNotice(page, lang);
    return versionIdOf(page);
}

test(
    'Landsat scenes are listed beside the declassified ones, and Import publishes one credited to NASA and USGS',
    { tag: ['@S-A130-HAPPY', '@S-A130-HAPPY-OLI'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        await upstream.scenario('usgs.landsatScenes', 'server');

        await landsatListed(page, lang);
        await expect(sceneLink(page, lang, CLEAR_1989)).toContainText(imageryText(lang, 'adminContent.imagery.reason.free'));
        await expect(sceneLink(page, lang, OLI_2016)).toContainText(imageryText(lang, 'adminContent.imagery.reason.free'));
        await expect(sceneLink(page, lang, OLI_2023)).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.results-landsat', lang));

        const versionId = await importScene(page, lang, CLEAR_1989);
        const layer = await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS);

        await expect(stepRow(page, lang, 'locate')).toContainText(stepStateText(lang, 'skipped'));
        expect((await imagery.version(versionId))?.['landsat']).toMatchObject({ checked: true, offsetPx: 0.4 });
        expect(await adminWorld.emulators.document(`cities/${imagery.city}/layers/${layer.id}`)).toMatchObject({
            kind: 'satellite',
            sensor: 'Landsat 5 TM',
            attribution: LANDSAT_ATTRIBUTION,
        });
    },
);

test(
    'The tick imports the clearest scene of a wanted year on its own, never the cloudy one',
    { tag: ['@S-A130-HAPPY-AUTO', '@S-A130-BAD-CLOUDY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await upstream.scenario('usgs.landsatScenes', 'server');
        await landsatListed(page, lang);

        // The same summer: the cloudy scene ranks below the clear one, and says why.
        const listed = await listedScenes(page, lang);
        expect(listed.indexOf(CLOUDY_1989)).toBeGreaterThan(listed.indexOf(CLEAR_1989));
        await expect(sceneLink(page, lang, CLOUDY_1989)).toContainText(
            imageryText(lang, 'adminContent.imagery.reason.cloud', { percent: '35' }),
        );

        await imagery.tick();

        const status = async (entityId: string) =>
            (await adminWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${entityId}`))?.['status'];
        await expect.poll(() => status(CLEAR_1989), { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('imported');
        expect([await status(CLOUDY_1989), await status(CLEAR_1990)]).toEqual(['candidate', 'candidate']);
    },
);

test(
    'A Landsat delivery without its red band fails in plain words',
    { tag: '@S-A130-BAD-MISSING-BAND' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await upstream.scenario('usgs.landsatScenes', 'server');
        await imagery.script({
            attempts: [{ outcome: 'fail', failAt: 'extract', code: 'apiError.imagery.missingBand', codeParams: { band: 'B3' } }],
        });
        await landsatListed(page, lang);

        await importScene(page, lang, CLEAR_1990);

        await expect(versionState(page, lang, 'adminContent.imagery.version.failed')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(errorText(lang, 'apiError.imagery.missingBand', { band: 'B3' }))).toBeVisible();
        await expect(stepRow(page, lang, 'extract')).toContainText(stepStateText(lang, 'failed'));
    },
);

test(
    'A Landsat scene off Sentinel-2 by more than a pixel waits for Approve and says why',
    { tag: '@S-A130-BAD-OFFSET' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        await upstream.scenario('usgs.landsatScenes', 'server');
        await imagery.script({ attempts: [{ outcome: 'under', landsat: { offsetPx: 1.7, offsetM: 51 } }] });
        await landsatListed(page, lang);

        const versionId = await importScene(page, lang, CLEAR_1989);

        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.landsat.held'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(
            detail(page).getByText(
                imageryText(lang, 'adminContent.imagery.landsat.offset', { pixels: lang === 'ro' ? '1,7' : '1.7', metres: '51' }),
            ),
        ).toBeVisible();
        expect((await imagery.version(versionId))?.['state']).toBe('awaiting_approval');
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.version-landsat-held', lang));
    },
);
