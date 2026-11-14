/**
 * `imagery.join` with `versionIds` (`functions/src/imagery/join-archive.ts`; finding of 2026-11-14, the owner's harti.zip maps): archive
 * maps that are parts of one map become one layer, each part on its own fit. Every check comes before anything is written.
 */
import type { LayerVersionDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { joinFunction } from '../../src/imagery/join.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    MAPBOX_USER,
    goldenGeoref,
    goldenOutput,
    readJob,
    readLayer,
    readVersion,
    readyWorld,
    renderedVersion,
    seedLayer,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const NORTH = 'ar-mw993zri-s-c7549c8348b5';
const SOUTH = 'rg-mwgrposm-s';

function archiveMap(layerId: string, label: string, overrides: Partial<LayerVersionDoc> = {}): LayerVersionDoc {
    return renderedVersion({
        layerId,
        jobId: layerId,
        origin: 'archive',
        state: 'published',
        year: 1978,
        label: { ro: label },
        source: { kind: 'archive', archiveId: 'ar-971b77774eee2871', seriesId: 's-c7549c8348b5', sheetCount: 1 },
        georef: { ...goldenGeoref(), method: 'gcps' },
        mapbox: { tilesetId: `${MAPBOX_USER}.hcm-bucharest-${layerId}`, origin: 'mts' },
        ...overrides,
    });
}

async function world(south: Partial<LayerVersionDoc> = {}): Promise<ImageryWorld> {
    const ready = await readyWorld();
    await seedVersion(ready, NORTH, archiveMap('n', 'N'));
    await seedVersion(ready, SOUTH, archiveMap('s', 'S', south));
    await seedLayer(ready, 'n', { currentVersion: NORTH });
    return ready;
}

function join(ready: ImageryWorld, versionIds: readonly string[]) {
    return joinFunction(() => ready.deps).run(adminCall({ cityId: CITY, versionIds }));
}

describe('imagery.join: archive maps', () => {
    it('happyPath_twoHalvesBecomeANewVersionOfTheFirstPublishedLayerEachOnItsOwnFit @S-A65-HAPPY-ARCHIVE', async () => {
        const ready = await world();

        const answer = await join(ready, [NORTH, SOUTH]);

        expect(answer.layerId).toBe('n');
        const job = await readJob(ready, answer.jobId);
        expect(job).toMatchObject({ type: 'layer-join', waitReason: 'parts', layerId: 'n' });
        expect(job?.params).toEqual({
            parts: [
                { versionId: NORTH, layerId: 'n' },
                { versionId: SOUTH, layerId: 's' },
            ],
            maxzoom: 16,
        });
        const version = await readVersion(ready, answer.jobId);
        expect(version).toMatchObject({ origin: 'join', label: { ro: 'N + S' }, year: 1978 });
        expect(version?.source).toEqual({
            kind: 'join',
            parts: [
                { versionId: NORTH, layerId: 'n', entityId: NORTH },
                { versionId: SOUTH, layerId: 's', entityId: SOUTH },
            ],
        });
        expect((await readVersion(ready, SOUTH))?.partOf).toBe(answer.jobId);
        expect((await readLayer(ready, 'n'))?.pendingVersion).toBe(answer.jobId);
    });

    it('badPath_aMapWithNoPointsOfItsOwnIsRefusedInPlainWordsAndNothingIsWritten @S-A65-BAD-ARCHIVE-NO-POINTS', async () => {
        const ready = await world();
        await seedVersion(ready, SOUTH, omit(archiveMap('s', 'S'), ['georef']));

        expect((await failureOf(join(ready, [NORTH, SOUTH]))).details).toMatchObject({
            code: 'apiError.imagery.joinNeedsPoints',
            params: { map: 'S' },
        });
        expect((await readVersion(ready, NORTH))?.partOf).toBeUndefined();
    });

    it('badPath_twoVersionsOfOneMapAreRefused', async () => {
        const ready = await world({ layerId: 'n' });

        expect((await failureOf(join(ready, [NORTH, SOUTH]))).details).toMatchObject({ code: 'apiError.imagery.joinSameLayer' });
    });

    it('badPath_aUsgsFrameOrAMapNoLongerUsableIsNoArchivePart', async () => {
        const ready = await world({ state: 'rejected' });

        expect((await failureOf(join(ready, [NORTH, SOUTH]))).details).toMatchObject({ code: 'apiError.imagery.joinPartGone' });
    });

    it('badPath_oneMapAloneIsNoJoin', async () => {
        const ready = await world();

        expect((await failureOf(join(ready, [NORTH, NORTH]))).details).toMatchObject({ code: 'apiError.invalidRequest' });
    });

    it('badPath_aLayerWithAVersionOnItsWayRefusesTheJoin', async () => {
        const ready = await world();
        await seedLayer(ready, 'n', { currentVersion: NORTH, pendingVersion: 'rg-other' });

        expect((await failureOf(join(ready, [NORTH, SOUTH]))).details).toMatchObject({ code: 'apiError.imagery.joinLayerBusy' });
    });

    it('happyPath_withNoPartPublishedTheJoinReservesALayerOfItsOwn', async () => {
        const ready = await readyWorld();
        await seedVersion(ready, NORTH, archiveMap('n', 'N', { state: 'awaiting_approval' }));
        await seedVersion(ready, SOUTH, archiveMap('s', 'S', { state: 'awaiting_approval', output: { ...goldenOutput(), maxzoom: 18 } }));

        const answer = await join(ready, [NORTH, SOUTH]);

        expect(answer.layerId).not.toBe('n');
        expect((await readJob(ready, answer.jobId))?.params).toMatchObject({ maxzoom: 18 });
    });
});
