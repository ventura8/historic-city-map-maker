// Undo of a delete: wait for the delete's history entry, then history.revert.
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CallableFailure } from '../../src/firebase/ports.js';
import { deleteEntry, undoDelete, UNDO_WAIT_MS } from '../../src/photos/undo.js';
import { at, CITY, photosWorld, settle } from './world.js';

const HISTORY = FIRESTORE_PATHS.history({ entity: 'photo', cityId: CITY, entityId: 'p1' });

function entry(action: 'update' | 'delete', iso: string) {
    return {
        entity: 'photo',
        entityId: 'p1',
        action,
        previous: { title: { ro: 'x' } },
        changedFields: [],
        updatedBy: 'admin-uid',
        updatedAt: at(iso),
    };
}

describe('deleteEntry', () => {
    it('happyPath_theEntryAlreadyWrittenIsFoundAtOnce', async () => {
        const world = photosWorld();
        world.store.put(`${HISTORY}/0000000000002-b`, entry('delete', '2026-10-17T10:00:02.000Z'));

        await expect(deleteEntry(world.services, 'p1')).resolves.toBe('0000000000002-b');
        expect(world.store.listeners()).toBe(0);
    });

    it('happyPath_theEntryWrittenLaterIsWaitedFor', async () => {
        const world = photosWorld();
        world.store.put(`${HISTORY}/0000000000001-a`, entry('update', '2026-10-17T10:00:01.000Z'));
        const found = deleteEntry(world.services, 'p1');

        world.store.put(`${HISTORY}/0000000000002-b`, entry('delete', '2026-10-17T10:00:02.000Z'));

        await expect(found).resolves.toBe('0000000000002-b');
    });

    it('badPath_noEntryWithinTheWaitIsNull', async () => {
        const world = photosWorld();
        const found = deleteEntry(world.services, 'p1');

        world.clock.advance(UNDO_WAIT_MS);

        await expect(found).resolves.toBeNull();
        expect(world.store.listeners()).toBe(0);
    });

    it('badPath_aFailedListenerIsNull', async () => {
        const world = photosWorld();
        const found = deleteEntry(world.services, 'p1');

        world.store.fail(HISTORY, { kind: 'denied', code: 'permission-denied' });

        await expect(found).resolves.toBeNull();
    });
});

describe('undoDelete', () => {
    it('happyPath_theDeleteIsReverted', async () => {
        const world = photosWorld();
        world.store.put(`${HISTORY}/0000000000002-b`, entry('delete', '2026-10-17T10:00:02.000Z'));
        world.callables.answer('history.revert', () => ({ restoredFields: ['title'] }));

        await expect(undoDelete(world.services, 'p1')).resolves.toEqual({ ok: true });

        expect(world.callables.calls).toEqual([
            { name: 'history.revert', request: { cityId: CITY, entity: 'photo', entityId: 'p1', entryId: '0000000000002-b' } },
        ]);
    });

    it('badPath_withoutTheEntryUndoSaysToUseHistory', async () => {
        const world = photosWorld();
        const undone = undoDelete(world.services, 'p1');
        await settle();

        world.clock.advance(UNDO_WAIT_MS);

        await expect(undone).resolves.toEqual({ ok: false, error: 'adminContent.photos.undo.unavailable' });
    });

    it('badPath_aRefusedRevertSaysWhy', async () => {
        const world = photosWorld();
        world.store.put(`${HISTORY}/0000000000002-b`, entry('delete', '2026-10-17T10:00:02.000Z'));
        world.callables.fail('history.revert', new CallableFailure('failed-precondition', { code: 'apiError.history.nothingToRestore' }));

        await expect(undoDelete(world.services, 'p1')).resolves.toEqual({ ok: false, error: 'apiError.history.nothingToRestore' });

        world.callables.fail('history.revert', new Error('network'));
        await expect(undoDelete(world.services, 'p1')).resolves.toEqual({ ok: false, error: 'apiError.internal' });
    });
});
