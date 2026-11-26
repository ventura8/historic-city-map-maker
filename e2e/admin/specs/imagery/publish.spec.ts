import { tilesetName } from '@hcm/shared';
import { MAPBOX_TOKENS } from '@hcm/test-support/fakes';
import type { APIRequestContext } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../../fixtures/world.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { IMAGERY_MAPBOX_USER } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { detail, imageryText, importFromList, readyImagery, versionState } from './world.js';

// One admin test at a time: the publisher runs in the server's world and reads setup/status and this month's usage.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Publishing behind the approval policy and the compute-unit guard (behaviours A17, A42; docs/research/M3-interfaces.md
 * §7): with auto-publish off in Settings every version waits for Approve, even one under the threshold; a publish that
 * does not fit the month's compute units waits with the guard's three choices and sends Mapbox nothing, also when the
 * policy approved it (CR-M3-33); the free Studio path ends with the tileset the admin uploaded in Mapbox Studio (the fake
 * MTS's account, as Studio would leave it) as the layer's source.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';

/** A message with its `{param}` holes as a pattern (`.+` for each). */
function pattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+'));
}

/** The tileset the admin uploads in Mapbox Studio, named after the file (`<tilesetName>.tif`), as Studio leaves it. */
async function uploadInStudio(api: APIRequestContext, name: string): Promise<void> {
    const tilesets = (path: string): string =>
        `${MOCK_API_ORIGIN}/h/api.mapbox.com/tilesets/v1/${path}?access_token=${MAPBOX_TOKENS.bootstrap}`;
    const response = await api.post(tilesets(`${IMAGERY_MAPBOX_USER}.${name}`), {
        data: { name, recipe: { version: 1, type: 'studio-upload' } },
    });
    expect(response.status()).toBe(200);
}

test(
    'With auto-publish off, every version waits for Approve',
    { tag: '@S-A17-BAD-AUTO-PUBLISH-OFF' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );

        // Settings, Historical imagery: auto-publish off, Save.
        await page.goto(adminPath(lang, 'settings/imagery'));
        const autoPublish = page.getByRole('switch', { name: imageryText(lang, 'adminContent.imagery.settings.autoPublish') });
        await expect(autoPublish).toBeChecked();
        await autoPublish.click();
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${imagery.city}`))?.['imagery'])
            .toMatchObject({
                autoPublish: false,
            });
        await expectStateSound(page, adminVisit('settings.imagery', lang));

        // A frame georeferenced under the threshold (6.2 m) now waits for a click.
        const versionId = await importFromList(page, lang, SCENE);
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })).toBeEnabled();
        expect((await imagery.version(versionId))?.['approval']).toBeUndefined();
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
    },
);

test(
    "A publish over the month's compute units waits with three choices, and the free Studio upload replaces it",
    { tag: ['@S-A42-BAD-OVER-BUDGET', '@S-A42-HAPPY-STUDIO'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // Under the threshold (approved on its own) but 1000 km² at zoom 16: 40 compute units, twice the month's free 20.
        await imagery.script({ attempts: [{ outcome: 'under', areaKm2: 1000 }] });
        const versionId = await importFromList(page, lang, SCENE);

        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.wait.computeUnits'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        // The three ways out, each saying what it means: the free Studio upload, next month, or pay about $X.
        await expect(
            detail(page)
                .getByRole('alert')
                .filter({ hasText: pattern(imageryText(lang, 'adminContent.imagery.approval.over')) }),
        ).toBeVisible();
        for (const key of [
            'adminContent.imagery.choice.studio',
            'adminContent.imagery.choice.defer',
            'adminContent.imagery.choice.pay',
        ] as const) {
            await expect(detail(page).getByRole('button', { name: pattern(imageryText(lang, key)) })).toBeEnabled();
        }
        expect(await imagery.version(versionId)).toMatchObject({ state: 'approved', approval: { auto: true }, guard: { verdict: 'over' } });
        expect(await upstream.calls('server', 'mapbox.tilesets')).toEqual([]);
        await expectStateSound(page, adminVisit('imagery.version-over-budget', lang));

        // Free: Studio -> the file to download, Mapbox Studio, then "I uploaded it" once the tileset is there.
        const studio = inputBudget.flow('chooseStudio', 3);
        await studio.click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.choice.studio') }));
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.studio.download') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('imagery.version-studio', lang));
        const download = page.waitForEvent('download');
        await studio.click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.studio.download') }));
        const layerId = String((await imagery.version(versionId))?.['layerId']);
        const name = tilesetName(imagery.city, layerId);
        expect((await download).suggestedFilename()).toBe(`${name}.tif`);
        await uploadInStudio(mockApiRequest, name);
        await studio.click(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.studio.done') }));

        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${imagery.city}/layers/${layerId}`))?.['mapbox'], {
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toMatchObject({ tilesetId: `${IMAGERY_MAPBOX_USER}.${name}`, origin: 'studio' });
        // The month's Mapbox use (`usage/mapbox-<month>`; M7 counts Cloud Run's beside it, `usage/cloudrun-<month>`).
        const mapboxUse = async (): Promise<Record<string, unknown> | undefined> =>
            Object.entries(await adminWorld.emulators.collection('usage')).find(([id]) => id.startsWith('mapbox-'))?.[1];
        await expect.poll(mapboxUse).toMatchObject({ studioUploads: 1 });
        expect(await upstream.calls('server', 'mapbox.tilesets.publish')).toEqual([]);
    },
);
