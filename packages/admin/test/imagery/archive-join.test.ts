// Finding of 2026-11-14 (the owner's harti.zip maps): Join with… on an archive map's page, the year's other maps it may be joined
// with, and the join itself (`src/imagery/archive-join.ts`).
import { describe, expect, it } from 'vitest';

import { archiveJoinCandidates, joinArchiveMaps } from '../../src/imagery/archive-join.js';
import { failure, settle } from '../app/fakes.js';
import { answer, at, CITY, callsOf, imageryWorld, VERSIONS, versionDoc } from './world.js';

const ARCHIVE = { kind: 'archive', archiveId: 'ar-971b77774eee2871', seriesId: 's-c7549c8348b5', sheetCount: 1 };
const BASE = { id: 'ar-north', layerId: 'n', year: 1978 };

function PART(versionId: string): Record<string, string> {
    return { versionId, layerId: versionId, entityId: versionId };
}

function archiveMap(layerId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return versionDoc({ layerId, jobId: layerId, origin: 'archive', year: 1978, source: ARCHIVE, ...overrides });
}

function seeded() {
    const world = imageryWorld();
    world.store.docs.set(VERSIONS('ar-north'), archiveMap('n'));
    world.store.docs.set(VERSIONS('rg-south'), archiveMap('s', { label: { ro: 'S' }, updatedAt: at('2026-11-14T19:00:00Z') }));
    world.store.docs.set(VERSIONS('ar-south-old'), archiveMap('s', { label: { ro: 'S vechi' }, updatedAt: at('2026-11-01T00:00:00Z') }));
    return world;
}

describe('Join with… on an archive map', () => {
    it('happyPath_theYearsOtherMapsAreOfferedOnceEachTheNewestVersion @S-A65-HAPPY-ARCHIVE-OFFER', async () => {
        const world = seeded();

        const found = archiveJoinCandidates(world.services, BASE);
        await settle();

        await expect(found).resolves.toEqual([
            { id: 'rg-south', layerId: 's', label: { ro: 'S' }, year: 1978, state: 'awaiting_approval' },
        ]);
    });

    it('happyPath_aPublishedVersionOfAMapWinsOverANewerOneOnItsWay', async () => {
        const world = seeded();
        world.store.docs.set(
            VERSIONS('ar-south-live'),
            archiveMap('s', {
                state: 'published',
                label: { ro: 'S' },
                updatedAt: at('2026-10-01T00:00:00Z'),
                mapbox: { tilesetId: 'u.s', origin: 'mts' },
            }),
        );

        const found = archiveJoinCandidates(world.services, BASE);
        await settle();

        await expect(found).resolves.toMatchObject([{ id: 'ar-south-live', state: 'published' }]);
    });

    it.each([
        ['another year', { year: 1974 }],
        ['no points of its own', { georef: undefined }],
        ['an upload with its embedded georeference', { georef: { method: 'embedded', transform: 'affine', gcps: [] } }],
        ['a USGS frame', { source: { kind: 'usgs', entityId: 'DS1', dataset: 'corona2', sensor: 'KH-4A', acquisitionDate: '1966-07-12' } }],
        ['part of a join already', { partOf: 'jn-other' }],
        ['rejected', { state: 'rejected' }],
    ])('badPath_aMapOf%sIsNotOffered @S-A65-BAD-ARCHIVE-OFFER', async (_name, overrides) => {
        const world = imageryWorld();
        world.store.docs.set(VERSIONS('ar-other'), archiveMap('other', overrides));

        const found = archiveJoinCandidates(world.services, BASE);
        await settle();

        await expect(found).resolves.toEqual([]);
    });

    it('happyPath_aMapAFailedJoinStampedIsOfferedAgain @S-A65-HAPPY-ARCHIVE-OFFER', async () => {
        const world = imageryWorld();
        world.store.docs.set(VERSIONS('ar-other'), archiveMap('other', { partOf: 'jn-old' }));
        world.store.docs.set(
            VERSIONS('jn-old'),
            archiveMap('old', { state: 'failed', origin: 'join', source: { kind: 'join', parts: [PART('ar-other'), PART('ar-x')] } }),
        );

        const found = archiveJoinCandidates(world.services, BASE);
        await settle();

        await expect(found).resolves.toMatchObject([{ id: 'ar-other' }]);
    });

    it('happyPath_theJoinIsAskedWithBothVersions', async () => {
        const world = seeded();
        answer(world.callables, 'imagery.join', () => ({ jobId: 'jn-n', versionId: 'jn-n', layerId: 'n' }));

        await expect(joinArchiveMaps(world.services, ['ar-north', 'rg-south'])).resolves.toBe('jn-n');
        expect(callsOf(world.callables, 'imagery.join')).toEqual([{ cityId: CITY, versionIds: ['ar-north', 'rg-south'] }]);
    });

    it('badPath_aRefusalIsSaidInPlainWordsAndNothingOpens', async () => {
        const world = seeded();
        world.callables.fail('imagery.join', failure('failed-precondition', 'apiError.imagery.joinNeedsPoints', { map: 'S' }));

        await expect(joinArchiveMaps(world.services, ['ar-north', 'rg-south'])).resolves.toBeNull();
        expect(world.notices).toEqual([{ key: 'apiError.imagery.joinNeedsPoints', params: { map: 'S' } }]);
    });
});
