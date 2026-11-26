/**
 * Delete this version on the version page (`packages/admin/src/imagery/version.ts`, S-A125-*): `imagery.deleteVersion` with the open
 * version's id; a refusal stays on the card as its code's text.
 */
import { describe, expect, it } from 'vitest';

import { VersionPage, type VersionPageState } from '../../src/imagery/version.js';
import { failure } from '../app/fakes.js';
import { answer, callsOf, imageryWorld, VERSIONS, versionDoc } from './world.js';

const ID = 'job-1966-0712';

function page() {
    const world = imageryWorld();
    let state: VersionPageState | null = null;
    const version = new VersionPage(world.services, world.files, (next) => {
        state = next;
    });
    return { ...world, version, state: () => state };
}

describe('the version page: Delete this version', () => {
    it('happyPath_aCancelledVersionIsDeleted @S-A125-HAPPY-DELETE-VERSION', async () => {
        const { version, store, callables, notices } = page();
        store.docs.set(VERSIONS(ID), versionDoc({ state: 'cancelled' }));
        answer(callables, 'imagery.deleteVersion', () => ({ deleted: true }));
        version.show(ID);

        await expect(version.deleteVersion()).resolves.toBe(true);

        expect(callsOf(callables, 'imagery.deleteVersion')).toEqual([{ cityId: 'bucharest', versionId: ID }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.versionDeleted']);
    });

    it('badPath_aRefusalStaysOnTheCard @S-A125-BAD-DELETE-RUNNING', async () => {
        const { version, store, callables, state } = page();
        store.docs.set(VERSIONS(ID), versionDoc({ state: 'cancelled' }));
        callables.answer('imagery.deleteVersion' as never, () =>
            Promise.reject(failure('failed-precondition', 'apiError.imagery.deleteRunning')),
        );
        version.show(ID);

        await expect(version.deleteVersion()).resolves.toBe(false);

        expect(state()?.refusal).toEqual({ key: 'apiError.imagery.deleteRunning' });
        expect(state()?.acting).toBeNull();
    });
});
