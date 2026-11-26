/**
 * The fake USGS's buy flow (`docs/research/M4-interfaces.md` §8): a scene that must be ordered is not downloadable until
 * the spec says USGS delivered it (`usgs.ordersDelivered`), then `download-options` lists it and `download-request`
 * stages it; every answer names EarthExplorer's id of the scene's dataset as `dataset-search` records it (none for
 * Declass 3), which the order watch keeps for the card's deep link. Through the real USGS adapter, as the functions use it.
 */
import { createLogger } from '@hcm/shared';
import { createUpstreamFakes, USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createUsgsApi, createUsgsScenes } from '../../src/adapters/usgs.js';

const PAID = 'DS1105-1071DF076';
const PAID_PANORAMIC = 'D3C1209-100055F012';

async function session() {
    const fakes = createUpstreamFakes();
    const options = { fetch: fakes.fetch, log: createLogger('functions') };
    const apiKey = await createUsgsApi(options).login(USGS_CREDENTIALS.approved.username, USGS_CREDENTIALS.approved.applicationToken);
    return { fakes, apiKey, scenes: createUsgsScenes(options) };
}

describe('the fake USGS delivers bought scans', () => {
    it('happyPath_aBoughtSceneIsListedOnceDeliveredWithItsDatasetsId', async () => {
        const { fakes, apiKey, scenes } = await session();

        const before = await scenes.downloadOptions(apiKey, 'corona2', [PAID]);
        fakes.scenario('usgs.ordersDelivered');
        const after = await scenes.downloadOptions(apiKey, 'corona2', [PAID]);

        expect(before).toEqual([{ entityId: PAID, available: false, bytes: 0, datasetId: '5e839febdccb64b3' }]);
        expect(after).toEqual([{ entityId: PAID, available: true, bytes: 734_003_200, datasetId: '5e839febdccb64b3' }]);
    });

    it('happyPath_aFrameTheCatalogueDoesNotListIsScannedOnceASpecGivesItADelivery', async () => {
        const { fakes, apiKey, scenes } = await session();

        const before = await scenes.downloadOptions(apiKey, 'declassiii', ['D3C1202-200149F040']);
        fakes.state.usgs.deliveries.set('D3C1202-200149F040', () => new Uint8Array(3));
        const after = await scenes.downloadOptions(apiKey, 'declassiii', ['D3C1202-200149F040']);

        expect(before).toEqual([{ entityId: 'D3C1202-200149F040', available: false, bytes: 0 }]);
        expect(after).toEqual([{ entityId: 'D3C1202-200149F040', available: true, bytes: 3 }]);
    });

    it('badPath_declassThreeHasNoRecordedIdAndAnUnknownSceneIsNeverDelivered', async () => {
        const { fakes, apiKey, scenes } = await session();
        fakes.scenario('usgs.ordersDelivered');

        const options = await scenes.downloadOptions(apiKey, 'declassiii', [PAID_PANORAMIC, 'DS-UNKNOWN']);

        expect(options).toEqual([
            { entityId: PAID_PANORAMIC, available: true, bytes: 734_003_200 },
            { entityId: 'DS-UNKNOWN', available: false, bytes: 0 },
        ]);
        expect(await scenes.datasets(apiKey)).toEqual([
            { alias: 'corona2', datasetId: '5e839febdccb64b3' },
            { alias: 'declassii', datasetId: '5e839ff7d71d4811' },
        ]);
    });
});
