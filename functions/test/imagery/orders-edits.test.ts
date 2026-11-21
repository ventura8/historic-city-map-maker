/**
 * What M4's orders change in the M3 imagery functions (`docs/research/M4-interfaces.md` §1.2, §1.6): the harvest keeps a
 * scene's order (only the order callables and the watch write it) and records EarthExplorer's id of each scene's dataset
 * (`dataset-search`, once a run; a failure only leaves the ids unknown), and an Import of a scene that has an order moves
 * the order to `importing` in the import's own transaction.
 */
import { describe, expect, it } from 'vitest';

import { importFunction } from '../../src/imagery/import.js';
import { searchFunction } from '../../src/imagery/search.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { adminCall } from '../publish/fakes.js';
import { sceneRecord } from '../support/imagery-fakes.js';
import { CORONA_EE_ID, PAID, listDownload, order, seedPaid } from './orders-world.js';
import { CITY, NOW, readScene, readyWorld } from './world.js';

const FREE = 'DS1105-1071DF075';
const PANORAMIC = 'D3C1216-401178F016';

function harvestWorld() {
    return readyWorld(NOW, {
        corona2: [sceneRecord(FREE), sceneRecord(PAID, { downloadAvailable: false, acquisitionDate: '1968-12-11' })],
        declassiii: [sceneRecord(PANORAMIC, { acquisitionDate: '1980-07-16' })],
    });
}

function search(world: Awaited<ReturnType<typeof harvestWorld>>) {
    return searchFunction(() => world.deps).run(adminCall({ cityId: CITY }));
}

describe('the harvest', () => {
    it('happyPath_aSceneKeepsItsOrderAndLearnsItsEarthExplorerId', async () => {
        const world = await harvestWorld();
        await seedPaid(world, PAID, { order: order({ state: 'reminder', remindersSent: [7] }) });

        await search(world);

        const paid = await readScene(world, PAID);
        expect(paid?.order).toEqual(order({ state: 'reminder', remindersSent: [7] }));
        expect(paid?.eeDatasetId).toBe(CORONA_EE_ID);
        expect((await readScene(world, FREE))?.eeDatasetId).toBe(CORONA_EE_ID);
        // `dataset-search` names no id for Declass 3 (UNVERIFIED): the scene has none, and its card names the entity id.
        expect((await readScene(world, PANORAMIC))?.eeDatasetId).toBeUndefined();
        expect(world.scenes.recorder.argsOf('datasets')).toHaveLength(1);
    });

    it('badPath_datasetIdsThatCannotBeReadLeaveTheKnownOnes', async () => {
        const world = await harvestWorld();
        await seedPaid(world, PANORAMIC, { dataset: 'declassiii', sensor: 'KH-9-pan', eeDatasetId: 'abc123def4567890' });
        world.scenes.recorder.failNext('datasets', new UpstreamError('usgs', 'maintenance', { status: 503 }));

        await expect(search(world)).resolves.toMatchObject({ found: 3 });

        expect((await readScene(world, PANORAMIC))?.eeDatasetId).toBe('abc123def4567890');
        expect((await readScene(world, FREE))?.eeDatasetId).toBeUndefined();
        expect(world.deps.recording.records.map((record) => record.message)).toContain('usgs dataset ids not read');
    });

    it('badPath_anIdWithoutTheShapeOfOneIsNotKept', async () => {
        const world = await harvestWorld();
        world.scenes.datasetIds.splice(0, world.scenes.datasetIds.length, { alias: 'corona2', datasetId: 'not an id' });

        await search(world);

        expect((await readScene(world, FREE))?.eeDatasetId).toBeUndefined();
    });
});

describe('imagery.import of a scene that has an order', () => {
    it('happyPath_theOrderMovesToImportingInTheImportsTransaction', async () => {
        const world = await readyWorld();
        // The harvest found the bought scan downloadable before the watch asked: the admin imports it by hand.
        await seedPaid(world, PAID, { downloadAvailable: true, order: order() });
        listDownload(world, PAID, true);

        const { jobId } = await importFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId: PAID }));

        expect((await readScene(world, PAID))?.order).toMatchObject({ state: 'importing', importJobId: jobId });
    });
});
