/**
 * Work's cancelled versions (t130, S-A190-*): read apart from the live ones; Remove on a row (t131, S-A191-*) deletes one by
 * its id through `imagery.deleteVersion`, and a refusal is told in the notice.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import { failure, settle } from '../app/fakes.js';
import { answer, CITY, callsOf, cityDoc, imageryWorld, setupStatus, VERSIONS, versionDoc } from './world.js';

const LIVE = 'job-1966-0712';
const SNAPPED = 'job-1966-snap';

function seeded() {
    const world = imageryWorld();
    world.store.docs.set(FIRESTORE_PATHS.setupStatus, setupStatus('ok'));
    world.store.docs.set(FIRESTORE_PATHS.city(CITY), cityDoc());
    world.store.docs.set(VERSIONS(LIVE), versionDoc());
    world.store.docs.set(VERSIONS(SNAPPED), versionDoc({ state: 'cancelled' }));
    return world;
}

describe('the Imagery area: cancelled versions', () => {
    it('happyPath_aCancelledVersionIsReadApartAndRemovedByItsId @S-A190-HAPPY @S-A191-HAPPY', async () => {
        const { services, callables, notices } = seeded();
        answer(callables, 'imagery.deleteVersion', () => ({ deleted: true }));
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open([]);
        await settle();

        expect(imagery.state.versions.items.map((version) => version.id)).toEqual([LIVE]);
        expect(imagery.state.cancelled.items.map((version) => version.id)).toEqual([SNAPPED]);
        await expect(imagery.intents.removeVersion(SNAPPED)).resolves.toBe(true);

        expect(callsOf(callables, 'imagery.deleteVersion')).toEqual([{ cityId: CITY, versionId: SNAPPED }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.versionDeleted']);
        imagery.close();
    });

    it('badPath_aRefusedRemoveIsToldAndTheVersionStays @S-A191-BAD-REFUSED', async () => {
        const { services, callables, notices, store } = seeded();
        callables.answer('imagery.deleteVersion' as never, () =>
            Promise.reject(failure('failed-precondition', 'apiError.imagery.deleteRunning')),
        );
        const imagery = IMAGERY_MODULE.create(services);
        imagery.open([]);
        await settle();

        await expect(imagery.intents.removeVersion(SNAPPED)).resolves.toBe(false);

        expect(notices.map((notice) => notice.key)).toEqual(['apiError.imagery.deleteRunning']);
        expect(store.docs.has(VERSIONS(SNAPPED))).toBe(true);
        imagery.close();
    });
});
