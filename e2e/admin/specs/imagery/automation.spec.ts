import { notificationEventId } from '@hcm/shared';
import { publishedTileColour } from '@hcm/test-support/fakes';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { closeCompare, compareChooser, divider, expectMapCounts } from '../../../support/compare.js';
import { expectColourAt, mapFraction, mapIdle } from '../../../support/map.js';
import { t } from '../../../support/viewer.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { awaitManifest, entry, openPublicViewer } from '../../support/flows.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { followDeepLink, standInProviderPages } from '../../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { inboxRow, notifyText } from '../notify/world.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import {
    detail,
    FREE_1968,
    FRESH_HARVEST,
    IMAGERY_AT,
    imageryText,
    importFromList,
    PAID_FRAMES,
    publishedLayer,
    readyImagery,
    sceneLink,
    TARGET_FRAMES,
    versionState,
    type PublishedLayer,
} from './world.js';

// One admin test at a time: the orders read setup/status, the runs and USGS's answers are the server's upstream world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * M4's automation from end to end (behaviour A48; docs/research/M4-interfaces.md §0, §1.5, §2.4, §3, §5): the admin buys
 * a scan the human way (the order card's EarthExplorer page, then I ordered it: the flow's two inputs), and everything
 * after is the server's. A day later the daily watch (`imagery.tick`'s orders step, its due date seeded as a day passing:
 * the server's clock cannot be moved) finds the scan delivered and imports it into the M3 pipeline; the stand-in runner
 * writes what the pipeline writes (automatic points under the city's RMSE threshold, or over it); under it the policy
 * approves and the fake MTS publishes, the manifest lists the layer, the admins' inbox says what happened, and the public
 * viewer compares the bought scan with an older layer on two maps (the second one created for compare and destroyed on
 * Close). Over it, the version waits for Approve, the inbox says so and nothing reaches Mapbox.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The 1966 Corona frame, free: the older layer. */
const OLDER = TARGET_FRAMES[0];
/** The 1968 Corona frame USGS has not scanned: the scan the admin buys. */
const BOUGHT = PAID_FRAMES[0];
/** An empty corner of the city (no photo, no place): only the basemap and the layers draw there. */
const EMPTY_VIEW = '15/44.37000/25.97000';
/** A window wide enough for the second map (compare's toggle replaces it under 600 px). */
const WIDE = { width: 1280, height: 800 };

interface Fixture {
    readonly imagery: ImageryWorld;
    readonly path: string;
}

/**
 * The city ready for imagery and published; `seeded`, with the scenes the area lists (a recent harvest the page does not
 * repeat), else the page's own first search harvests them.
 */
async function boughtSceneWorld(fixtures: Parameters<typeof readyImagery>[0], uid: string, seeded: boolean): Promise<Fixture> {
    const imagery = await readyImagery(fixtures, uid, {}, { published: true });
    const scenes = seeded ? [...TARGET_FRAMES, FREE_1968, ...PAID_FRAMES] : [];
    for (const entityId of scenes) {
        await imagery.seedScene(entityId, FRESH_HARVEST);
    }
    return { imagery, path: `cities/${imagery.city}/usgsScenes/${BOUGHT}` };
}

/** The bought scene's preview in our bucket (the fake browse host never serves that one: S-A11-BAD-BROWSE-UNAVAILABLE). */
async function seedPreview(fixture: Fixture): Promise<void> {
    await fixture.imagery.seedBrowse(BOUGHT, IMAGERY_AT);
}

/** The order of the bought scene as the server keeps it. */
async function orderOf(fixture: Fixture): Promise<Readonly<Record<string, unknown>>> {
    const scene = await fixture.imagery.cityWorld.emulators.document(fixture.path);
    return (scene?.['order'] ?? {}) as Readonly<Record<string, unknown>>;
}

/** A day passes: the order is due for the daily watch (`order.nextCheckAt` in the past). */
async function dayPasses(fixture: Fixture): Promise<void> {
    await fixture.imagery.cityWorld.emulators.updateFields(fixture.path, { order: { nextCheckAt: IMAGERY_AT } }, ['order.nextCheckAt']);
}

/** The daily watch runs once and starts the import of the delivered scan by itself: the import's job (its version's) id. */
async function watchImports(fixture: Fixture): Promise<string> {
    await fixture.imagery.tick();
    await expect.poll(async () => (await orderOf(fixture))['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('importing');
    return String((await orderOf(fixture))['importJobId']);
}

function orderCard(page: Page): Locator {
    return detail(page).locator('.order-card');
}

/** The open scene's order card button `key`. */
function orderButton(page: Page, lang: 'ro' | 'en', key: Parameters<typeof imageryText>[1]): Locator {
    return orderCard(page).getByRole('button', { name: imageryText(lang, key) });
}

/** The scenes that must be bought join the list (Free only off), then the bought scene's page opens with its order card. */
async function openBoughtScene(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') }).click();
    await sceneLink(page, lang, BOUGHT).click();
    await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.needsOrder'));
}

/** I ordered it (through `click`, a counted flow's in the happy path), and the card says the order is watched. */
async function markOrdered(page: Page, lang: 'ro' | 'en', click: (target: Locator) => Promise<void>): Promise<void> {
    await click(orderButton(page, lang, 'adminContent.orders.markOrdered'));
    await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.ordered'), {
        timeout: FUNCTIONS_TIMEOUT_MS,
    });
}

/** The label a layer shows in `lang` (a layer named in Romanian only shows that name). */
function labelIn(layer: PublishedLayer, lang: 'ro' | 'en'): string {
    return layer.label[lang] ?? String(layer.label['ro']);
}

test(
    'A bought scan reaches the public map by itself and the viewer compares it with an older layer',
    { tag: '@S-A48-HAPPY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(900_000);
        const fixture = await boughtSceneWorld(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
            false,
        );
        const { imagery } = fixture;
        await standInProviderPages(page.context(), ['https://earthexplorer.usgs.gov']);

        // The older layer: the free 1966 frame from the page's own harvest, imported with one click and published under the
        // threshold (M3).
        const olderVersion = await importFromList(page, lang, OLDER, (target) => inputBudget.flow('importScene', 1).click(target));
        await seedPreview(fixture);
        const older = await publishedLayer(imagery, olderVersion, PUBLISH_TIMEOUT_MS);

        // The scan to buy: its order card, its EarthExplorer page (the purchase is the admin's own step there), I ordered it.
        await openBoughtScene(page, lang);
        const buying = inputBudget.flow('buyScan', contentFlowBudget('buyScan'));
        const earthExplorer = orderCard(page).getByRole('link', { name: new RegExp(`^${imageryText(lang, 'adminContent.orders.open')}`) });
        await followDeepLink(page, () => buying.click(earthExplorer));
        await markOrdered(page, lang, (target) => buying.click(target));

        // From here on, no input: USGS delivers, a day passes, the watch imports it, the page follows live.
        await upstream.scenario('usgs.ordersDelivered', 'server');
        await dayPasses(fixture);
        const versionId = await watchImports(fixture);
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.importing'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        expect(await imagery.job(versionId)).toMatchObject({ type: 'usgs-import', createdBy: adminWorld.accounts.owner.uid });

        // The pipeline's automatic points are under the threshold: approved by the server and published, no click.
        const bought = await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS);
        expect(await imagery.version(versionId)).toMatchObject({
            source: { entityId: BOUGHT },
            approval: { auto: true, by: 'system:imagery' },
        });
        await imagery.tick();
        await expect.poll(async () => (await orderOf(fixture))['state'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('imported');

        // The inbox says what happened; the import's item opens the published version.
        await page.goto(adminPath(lang, 'inbox'));
        const delivered = inboxRow(page, notificationEventId('order.delivered', imagery.city, BOUGHT));
        const imported = inboxRow(page, notificationEventId('order.imported', imagery.city, BOUGHT));
        await expect(delivered).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(imported).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await imported.click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/version/${versionId}$`));
        await expect(versionState(page, lang, 'adminContent.imagery.version.published')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        // The public viewer: the bought scan left of the divider, the 1966 layer right of it, on two maps; Close removes one.
        const manifest = await awaitManifest(
            imagery.cityWorld,
            `lists layers ${older.id} and ${bought.id}`,
            (built) => entry(built, 'layers', older.id) !== undefined && entry(built, 'layers', bought.id) !== undefined,
        );
        await page.setViewportSize(WIDE);
        await openPublicViewer(page, manifest, { lang, hash: `${EMPTY_VIEW}&layers=${bought.id}&cmp=${older.id}&sw=50` });
        await expectMapCounts(page, 2, 0);
        await expect(compareChooser(page, lang)).toHaveValue(older.id);
        await expect(divider(page, lang)).toHaveAttribute(
            'aria-valuetext',
            t(lang, 'compare.value', { left: labelIn(bought, lang), a: '50', right: labelIn(older, lang), b: '50' }),
        );
        await mapIdle(page);
        await expectColourAt(page, await mapFraction(page, 0.2, 0.3), publishedTileColour(bought.tilesetId), 'the bought scan', {
            tolerance: 10,
        });
        await expectColourAt(page, await mapFraction(page, 0.8, 0.3), publishedTileColour(older.tilesetId), 'the 1966 layer', {
            tolerance: 10,
        });
        await closeCompare(page, lang).click();
        await expectMapCounts(page, 2, 1);
    },
);

test(
    'A bought scan over the threshold waits for Approve, and the inbox says so',
    { tag: '@S-A48-BAD-OVER-THRESHOLD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(420_000);
        const fixture = await boughtSceneWorld(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
            true,
        );
        await seedPreview(fixture);
        const { imagery } = fixture;
        // Bought and marked (the inputs are S-A13-HAPPY's and the happy path's), then a day passes.
        await openBoughtScene(page, lang);
        await markOrdered(page, lang, (target) => target.click());
        await dayPasses(fixture);
        await imagery.script({ attempts: [{ outcome: 'over' }] });
        await upstream.scenario('usgs.ordersDelivered', 'server');

        const versionId = await watchImports(fixture);
        await expect
            .poll(async () => (await imagery.version(versionId))?.['state'], { timeout: PUBLISH_TIMEOUT_MS })
            .toBe('awaiting_approval');

        // The inbox's item opens the version, which waits with Approve; nothing reached Mapbox.
        await page.goto(adminPath(lang, 'inbox'));
        const waiting = inboxRow(page, notificationEventId('layer.readyToApprove', imagery.city, versionId));
        await expect(waiting).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        const label = ((await imagery.version(versionId))?.['label'] ?? {}) as Readonly<Record<string, string>>;
        await expect(waiting).toContainText(
            notifyText(lang, 'adminContent.notify.event.layer.readyToApprove', { label: label[lang] ?? String(label['ro']) }),
        );
        await waiting.click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/version/${versionId}$`));
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toEqual([]);
    },
);
