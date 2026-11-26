import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { PlaceActions } from '../../src/pois/actions.js';
import type { PlaceEditor } from '../../src/pois/editor.js';
import { POIS_MODULE } from '../../src/pois/pois.js';
import { CITY, seededWorld, settle } from './world.js';

/**
 * The owner, 2026-11-22: a delete that closed its question and did nothing (place 84QFbxLR2AsyRcZ3nq9v, saved moments
 * before). A place saved for the first time has no snapshot yet; its delete must still go through, and a refused or a
 * busy one must say so.
 */

/** An editor of `id` whose draft is saved (not new) and has, or has not yet, its snapshot. */
function savedEditor(id: string, version: string | null): PlaceEditor {
    const base = version === null ? null : { version };
    return { id, state: { draft: { isNew: false, base } } } as unknown as PlaceEditor;
}

describe('deleting a place right after its first Save', () => {
    it('happyPath_aPlaceWithoutItsSnapshotYetIsDeletedAndLeavesTheListAtOnce @S-A33-HAPPY-DELETE-FRESH', async () => {
        const world = seededWorld();
        const actions = new PlaceActions(world.services, () => undefined);

        let dropped = 0;
        const outcome = await actions.remove(savedEditor('stavropoleos', null), () => {
            dropped += 1;
        });
        expect(dropped).toBe(1);

        expect(outcome).toEqual({ ok: true });
        expect(world.store.docs.has(FIRESTORE_PATHS.poi(CITY, 'stavropoleos'))).toBe(false);
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.deleted');

        const other = seededWorld();
        const store = POIS_MODULE.create(other.services);
        store.open(['stavropoleos']);
        await settle();
        expect(store.state.list.items.map((item) => item.id)).toContain('stavropoleos');
        await store.intents.remove();
        expect(store.state.list.items.map((item) => item.id)).not.toContain('stavropoleos');
    });

    it('badPath_aRefusedDeleteSaysWhyAndTryAgainDeletesAndABusyOneSaysToWait @S-A33-BAD-DELETE-REFUSED', async () => {
        const world = seededWorld();
        const actions = new PlaceActions(world.services, () => undefined);
        world.store.outcomes.push({ ok: false, reason: 'offline' });

        const dropped: string[] = [];
        const refused = await actions.remove(savedEditor('stavropoleos', null), () => dropped.push('stavropoleos'));
        expect(dropped).toEqual([]);
        const notice = world.notices.at(-1);
        notice?.action?.run();
        await settle();

        expect(refused).toEqual({ ok: false, reason: 'offline' });
        expect([notice?.key, notice?.action?.key]).toEqual(['adminContent.pois.offline', 'adminContent.common.retry']);
        expect(world.store.docs.has(FIRESTORE_PATHS.poi(CITY, 'stavropoleos'))).toBe(false);
        expect(dropped).toEqual(['stavropoleos']);
        expect(actions.busyDelete()).toBeNull();
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.deleteBusy');
    });
});
