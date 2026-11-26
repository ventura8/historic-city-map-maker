import { CLOUD_ESTIMATE_VERSION, RANKING_VERSION } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { FREE_1968, FRESH_HARVEST, imageryText, listedScenes, readyImagery, sceneList, TARGET_FRAMES } from './world.js';

// One admin test at a time: the Imagery area reads setup/status, and the scenes live in the server's world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The scene list keeps its order while it is in use (behaviour A234, the owner 2026-11-25; DECISIONS-for-review.md §251):
 * a measured preview ranks a frame again, and the open list followed at once, under the pointer and the keyboard. While
 * the pointer or the focus is in the list the rows stay; once both have left, the new order shows and a note says so.
 * Each re-ranking here is a scene whose rank the server rewrites to the top with a new reason, which its card shows: the
 * page has it once that reason is on screen.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENES = [...TARGET_FRAMES, FREE_1968];

async function seeded(world: ImageryWorld): Promise<void> {
    for (const entityId of SCENES) {
        await world.seedScene(entityId, FRESH_HARVEST, {
            cloudEstimate: { percent: 0, version: CLOUD_ESTIMATE_VERSION },
            rank: { score: 50, reasons: [], version: RANKING_VERSION },
        });
        await world.seedBrowse(entityId, FRESH_HARVEST);
    }
}

/** The server ranks `entityId` first, with a coverage of `percent` as its first reason. */
async function rankFirst(world: ImageryWorld, entityId: string, percent: string): Promise<void> {
    const path = `cities/${world.city}/usgsScenes/${entityId}`;
    const rank = { score: 100, reasons: [{ code: 'coverage', params: { percent } }], version: RANKING_VERSION };
    await world.cityWorld.emulators.updateFields(path, { rank }, ['rank']);
}

function card(page: Page, lang: 'ro' | 'en', entityId: string) {
    return sceneList(page, lang).locator(`li[data-scene="${entityId}"]`);
}

test(
    'A list in use keeps its rows where they were, and takes the new order with a note once the pointer has left',
    { tag: '@S-A234-HAPPY-ORDER-HELD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seeded(imagery);
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(SCENES.length, { timeout: FUNCTIONS_TIMEOUT_MS });
        const note = page.locator('hcm-imagery-page p.resorted');

        // The previews already have measurements. The next server rank change happens while the pointer is in the list.
        await sceneList(page, lang).getByRole('link').first().hover();
        const before = await listedScenes(page, lang);
        const last = before.at(-1) ?? '';
        await rankFirst(imagery, last, '77');
        await expect(card(page, lang, last)).toContainText(imageryText(lang, 'adminContent.imagery.reason.coverage', { percent: '77' }));
        expect(await listedScenes(page, lang)).toEqual(before);
        await expect(note).toHaveText('');

        await page.mouse.move(0, 0);
        await expect.poll(async () => (await listedScenes(page, lang))[0]).toBe(last);
        await expect(note).toHaveText(imageryText(lang, 'adminContent.imagery.resorted'));
        await expect(note).toHaveAttribute('role', 'status');
    },
);

test(
    'A list nobody is using takes each new order at once, with no note',
    { tag: '@S-A234-BAD-ORDER-LIVE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seeded(imagery);
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(SCENES.length, { timeout: FUNCTIONS_TIMEOUT_MS });
        const last = (await listedScenes(page, lang)).at(-1) ?? '';

        await page.mouse.move(0, 0);
        await rankFirst(imagery, last, '78');
        await expect.poll(async () => (await listedScenes(page, lang))[0]).toBe(last);
        await expect(page.locator('hcm-imagery-page p.resorted')).toHaveText('');
    },
);
