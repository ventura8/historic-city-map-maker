import { translateAdminContent } from '@hcm/shared';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

import type { ContentWorld } from '../../support/content.js';
import { expect, test } from '../../support/content-test.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { uploadObject } from '../../support/imagery-store.js';
import { seedCity, seedJob } from '../../support/ops.js';

/**
 * Fix the tiles (docs/research/M20-import-local.md §19.13): an archive series waiting for approval (or on the map) is laid out again in
 * a new version of its layer that opens at the tile wizard; `imagery.relayout` runs in the Functions emulator. A USGS frame is not
 * offered it, and the georeferencer of a series with no picture of its own says what to do instead of "The scan cannot be shown".
 */

const SERIES = 'ar-mwgcdw8s-s-b250f2e03a5f';
const LAYER = 'bucuresti-actual-1-500';
const AT = new Date('2026-11-21T08:00:00Z');
const GOLDEN = resolve(import.meta.dirname, '../../../../pipeline/tests/contracts/version.awaiting-approval.json');

type Lang = 'ro' | 'en';

function text(lang: Lang, key: Parameters<typeof translateAdminContent>[1]): string {
    return translateAdminContent(lang, key);
}

/** The series waiting for approval as the worker leaves it; `origin` usgs for a frame, which Fix the tiles passes over. */
async function seedSeries(world: ContentWorld, origin: 'archive' | 'usgs', scan = true): Promise<void> {
    const folder = `rasters/${world.city}/${LAYER}/${SERIES}`;
    const golden = JSON.parse(
        readFileSync(GOLDEN, 'utf8').replaceAll('rasters/bucharest/kh-4a-corona-1966/job-1966-0712', folder),
    ) as Record<string, unknown>;
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 180, g: 180, b: 170 } } })
        .png()
        .toBuffer();
    await uploadObject(`${folder}/preview.png`, new Uint8Array(png), 'image/png');
    await seedCity(world, AT);
    await seedJob(
        world,
        SERIES,
        {
            ...{ type: 'archive-series', status: 'awaiting_approval', layerId: LAYER, versionId: SERIES },
            params: {
                archiveId: 'ar-0123456789abcdef',
                seriesId: 's-b250f2e03a5f',
                class: 'grid',
                sheets: 120,
                encoding: 'grey',
                order: 0,
            },
            ...{ runOn: 'local', localOnly: true, createdBy: world.uid, attempt: 1 },
            steps: { gather: { status: 'done' }, place: { status: 'done' }, export: { status: 'done' } },
        },
        AT,
    );
    const archive = { kind: 'archive', archiveId: 'ar-0123456789abcdef', seriesId: 's-b250f2e03a5f', sheetCount: 120 };
    const dropped = new Set([...(scan ? [] : ['scan']), ...(origin === 'archive' ? ['sensor', 'georef'] : [])]);
    const kept = Object.fromEntries(Object.entries(golden).filter(([key]) => !dropped.has(key)));
    await world.emulators.setDocument(`cities/${world.city}/layerVersions/${SERIES}`, {
        ...kept,
        ...{ layerId: LAYER, jobId: SERIES, origin, label: { ro: 'București actual 1:500' }, year: 1960 },
        ...(origin === 'archive' ? { source: archive } : {}),
        ...{ createdBy: world.uid, createdAt: AT, updatedBy: 'system:pipeline', updatedAt: AT },
    });
}

test(
    'The owner fixes the tiles of a placed series in a new version',
    { tag: ['@S-A-HAPPY-FIX-TILES'] },
    async ({ page, lang, content }) => {
        await seedSeries(content, 'archive');
        await page.goto(content.address(lang, `imagery/version/${SERIES}`, { map: false }));

        await page.getByRole('button', { name: text(lang, 'adminContent.imagery.fixTiles') }).click();

        await expect(page.locator('hcm-snackbar')).toContainText(text(lang, 'adminContent.imagery.notice.fixingTiles'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect
            .poll(async () => (await content.emulators.document(`cities/${content.city}/layerVersions/${SERIES}`))?.['state'], {
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toBe('cancelled');
    },
);

test(
    'A frame is not offered Fix the tiles, and a series with no picture says what to do',
    { tag: ['@S-A-BAD-FIX-TILES-STATE'] },
    async ({ page, lang, content }) => {
        await seedSeries(content, 'usgs');
        await page.goto(content.address(lang, `imagery/version/${SERIES}`, { map: false }));
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.imagery.fixTiles') })).toHaveCount(0);

        await seedSeries(content, 'archive', false);
        await page.goto(content.address(lang, `georef/${SERIES}`, { map: false }));
        await expect(page.getByText(text(lang, 'adminContent.georef.noScanSeries'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page.getByRole('link', { name: text(lang, 'adminContent.georef.openSeries') })).toHaveAttribute(
            'href',
            `#/imagery/version/${SERIES}`,
        );
    },
);
