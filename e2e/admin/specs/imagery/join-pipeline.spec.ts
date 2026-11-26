import { relative } from 'node:path';

import type { Bounds } from '../../support/imagery-geometry.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { REPO_ROOT } from '../../support/imagery-runner.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { dateRow, joinFromRow, JOIN_TIMEOUT_MS, partsOf, planRows, seedFrame, tickUntil } from './join-world.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import { FRAME_CENTRE, FRAME_CITY, generateJoinScenes, SYNTHETIC_NEIGHBOUR, SYNTHETIC_SCENE } from './synthetic.js';
import { awaitHarvest, expectLayerInViewer, publishedLayer, readyImagery, versionState } from './world.js';

// One admin test at a time: the runs play in the server's upstream world and read setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The real raster pipeline joins a date's frames in the admin's world (M8, `docs/research/M8-join-interfaces.md` §3, §8): Join
 * frames on the date's row -> both frames run `python -m hcm_pipeline run` of the quality image's pipeline venv, against the
 * Firestore and Storage emulators and the mock APIs' USGS, STAC and Overpass, which answer the two synthetic frames of
 * `scenes.py --join` (generated into the test's folder, never committed) -> the tick starts the `layer-join` job, whose `align`
 * and `merge` run for real -> within every limit the policy publishes it -> the viewer shows one layer.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** A box around a frame's corners. */
function boundsOfCorners(corners: Readonly<Record<string, { readonly lat: number; readonly lng: number }>>): Bounds {
    const [lats, lngs] = [Object.values(corners).map(({ lat }) => lat), Object.values(corners).map(({ lng }) => lng)];
    return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

test(
    'The real pipeline joins two synthetic frames: the seam closes, the policy publishes one layer, and the viewer shows it',
    { tag: '@S-P05-HAPPY-ADMIN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }, testInfo) => {
        test.setTimeout(900_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const dir = testInfo.outputPath('synthetic');
        const corners = generateJoinScenes(dir);
        await imagery.useSyntheticScene(relative(REPO_ROOT, dir));
        await imagery.script({ runner: 'python', attempts: [{ outcome: 'under' }] });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        // The search's last write: nothing rewrites the plan after this.
        await expect.poll(() => planRows(imagery), { timeout: FUNCTIONS_TIMEOUT_MS }).toEqual([]);

        // The harvested 1966 frame takes the synthetic frame's corners, its neighbour joins it, the city takes the world's size.
        const { emulators } = adminWorld;
        const scenePath = `cities/${imagery.city}/usgsScenes/${SYNTHETIC_SCENE}`;
        const scene = (await emulators.document(scenePath)) as { acquisitionDate: string; sensor: 'KH-4A'; dataset: string };
        await emulators.updateFields(scenePath, { corners: corners[SYNTHETIC_SCENE] }, ['corners']);
        await emulators.updateFields(`cities/${imagery.city}`, { bounds: FRAME_CITY }, ['bounds']);
        const neighbour = corners[SYNTHETIC_NEIGHBOUR];
        await seedFrame(imagery, {
            entityId: SYNTHETIC_NEIGHBOUR,
            bounds: boundsOfCorners(neighbour ?? {}),
            date: scene.acquisitionDate,
            sensor: scene.sensor,
            dataset: scene.dataset,
            ...(neighbour === undefined ? {} : { corners: neighbour }),
        });

        // The search ran before the city had this size: the plan's row as the next harvest writes it.
        const row = {
            date: scene.acquisitionDate,
            sensor: scene.sensor,
            frames: [SYNTHETIC_SCENE, SYNTHETIC_NEIGHBOUR].map((entityId) => ({ entityId, free: true })),
            paidFrames: [],
            coveragePct: 100,
            framesToDownload: 2,
            winter: false,
        };
        await emulators.setDocument(`cities/${imagery.city}/imageryPlans/dates`, { rows: [row], updatedAt: new Date() });
        await expect(dateRow(page, scene.acquisitionDate)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        const join = await joinFromRow(page, lang, scene.acquisitionDate);
        await expect
            .poll(
                async () => {
                    const parts = await partsOf(imagery, join);
                    const states = await Promise.all(parts.map(async (part) => (await imagery.version(part.versionId))?.['state']));
                    return states.every((state) => state === 'awaiting_approval');
                },
                { message: 'both frames rendered', timeout: JOIN_TIMEOUT_MS * 2, intervals: [2000] },
            )
            .toBe(true);
        await tickUntil(imagery, join, 'published');

        // What the pipeline measured: one seam, closed, every limit met, so the policy published it; the page says so.
        const version = await imagery.version(join);
        const report = version?.['join'] as { seams: { afterRmseM: number }[]; coveragePct: number };
        expect(report.seams).toHaveLength(1);
        expect(report.seams[0]).toMatchObject({ measured: true, applied: true });
        expect(Number(report.seams[0]?.afterRmseM)).toBeLessThanOrEqual(15);
        expect(report.coveragePct).toBeGreaterThanOrEqual(90);
        expect(version?.['approval']).toMatchObject({ auto: true, by: 'system:imagery' });
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        const layer = await publishedLayer(imagery, join, PUBLISH_TIMEOUT_MS);
        await expectLayerInViewer(page, lang, imagery, layer, FRAME_CENTRE);
    },
);
