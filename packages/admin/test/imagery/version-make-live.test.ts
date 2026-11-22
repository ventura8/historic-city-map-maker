/**
 * Make this version the live one on the version page (`packages/admin/src/imagery/version.ts`, S-A231-*; lesson 759): `imagery.makeLive`
 * with the open version's id; a refusal (its tiles gone) stays on the card as its code's text.
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

describe('the version page: Make this version the live one', () => {
    it('happyPath_aSupersededVersionIsMadeLive @S-A231-HAPPY-MAKE-LIVE', async () => {
        const { version, store, callables, notices } = page();
        store.docs.set(VERSIONS(ID), versionDoc({ state: 'superseded' }));
        answer(callables, 'imagery.makeLive', () => ({ live: true }));
        version.show(ID);

        await expect(version.makeLive()).resolves.toBe(true);

        expect(callsOf(callables, 'imagery.makeLive')).toEqual([{ cityId: 'bucharest', versionId: ID }]);
        expect(notices.map((notice) => notice.key)).toEqual(['adminContent.imagery.notice.madeLive']);
    });

    it('badPath_tilesGoneStaysOnTheCard @S-A231-BAD-TILES-GONE', async () => {
        const { version, store, callables, state } = page();
        store.docs.set(VERSIONS(ID), versionDoc({ state: 'superseded' }));
        callables.answer('imagery.makeLive' as never, () => Promise.reject(failure('failed-precondition', 'apiError.imagery.tilesGone')));
        version.show(ID);

        await expect(version.makeLive()).resolves.toBe(false);

        expect(state()?.refusal).toEqual({ key: 'apiError.imagery.tilesGone' });
        expect(state()?.acting).toBeNull();
    });
});
