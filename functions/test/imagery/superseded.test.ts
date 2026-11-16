import { STORAGE_PATHS, publicObjectUrl } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { deleteSupersededFunction, listSupersededFunction } from '../../src/imagery/superseded.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, at, readVersion, readyWorld, renderedVersion, seedCity, seedLayer, seedVersion } from './world.js';

const LAYER = 'kh-9-hexagon-1983';
const PUBLIC_V1 = STORAGE_PATHS.layerTiles(CITY, LAYER, 'v1');
const PUBLIC_V2 = STORAGE_PATHS.layerTiles(CITY, LAYER, 'v2');

function superseded(id: string, path: string, url: string) {
    return renderedVersion({
        layerId: LAYER,
        jobId: id,
        state: 'superseded',
        year: 1983,
        own: { path, url, bytes: 7, publishedAt: at('2026-10-23T08:00:00.000Z') },
    });
}

describe('superseded own tiles callables', () => {
    it('happyPath_listShowsSupersededVersionsPerLayerAndCountsTiles', async () => {
        const made = await readyWorld();
        await seedCity(made, { imagery: {} });
        const url1 = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V1);
        const url2 = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V2);
        await seedVersion(made, 'v1', superseded('v1', PUBLIC_V1, url1));
        await seedVersion(made, 'v2', superseded('v2', PUBLIC_V2, url2));
        made.deps.blobs.put('public', PUBLIC_V1, new Uint8Array(7));
        made.deps.blobs.put('public', PUBLIC_V2, new Uint8Array(7));

        const answer = await listSupersededFunction(() => made.deps).run(adminCall({ cityId: CITY }));

        expect(answer.versions).toBe(2);
        expect(answer.tiles).toBe(2);
        expect(answer.layers).toHaveLength(1);
        expect(answer.layers[0]).toMatchObject({ layerId: LAYER });
    });

    it('badPath_aSupersededVersionShownAgainIsNotListed', async () => {
        const made = await readyWorld();
        await seedCity(made, { imagery: {} });
        const url = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V1);
        await seedVersion(made, 'v1', superseded('v1', PUBLIC_V1, url));
        await seedLayer(made, LAYER, { source: { type: 'pmtiles', url } });

        const answer = await listSupersededFunction(() => made.deps).run(adminCall({ cityId: CITY }));

        expect(answer).toEqual({ layers: [], versions: 0, tiles: 0 });
    });

    it('happyPath_deleteRemovesAllListedTilesAndMarksVersionsRemoved', async () => {
        const made = await readyWorld();
        await seedCity(made, { imagery: {} });
        const url1 = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V1);
        const url2 = publicObjectUrl(made.deps.config.buckets.public, PUBLIC_V2);
        await seedVersion(made, 'v1', superseded('v1', PUBLIC_V1, url1));
        await seedVersion(made, 'v2', superseded('v2', PUBLIC_V2, url2));
        made.deps.blobs.put('public', PUBLIC_V1, new Uint8Array(7));
        made.deps.blobs.put('public', PUBLIC_V2, new Uint8Array(7));

        const answer = await deleteSupersededFunction(() => made.deps).run(adminCall({ cityId: CITY }));

        expect(answer).toEqual({ deletedVersions: 2, deletedTiles: 2 });
        expect(await made.deps.blobs.stat('public', PUBLIC_V1)).toBeUndefined();
        expect(await made.deps.blobs.stat('public', PUBLIC_V2)).toBeUndefined();
        expect((await readVersion(made, 'v1'))?.own?.removedAt).toBeDefined();
        expect((await readVersion(made, 'v2'))?.own?.removedAt).toBeDefined();
    });
});
