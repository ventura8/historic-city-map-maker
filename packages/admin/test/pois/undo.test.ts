import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { DeleteUndo, UNDO_WAIT_MS } from '../../src/pois/undo.js';
import { failure } from '../app/fakes.js';
import { CITY, poisWorld, settle, type PoisWorld } from './world.js';

const HISTORY = FIRESTORE_PATHS.history({ entity: 'poi', cityId: CITY, entityId: 'stavropoleos' });

function entry(world: PoisWorld, id: string, action: 'delete' | 'update'): void {
    world.store.put(`${HISTORY}/${id}`, {
        entity: 'poi',
        entityId: 'stavropoleos',
        action,
        previous: { title: { ro: 'Stavropoleos' } },
        changedFields: [],
        ...world.store.stamp(),
    });
    world.store.now += 1000;
}

function undoOf(world: PoisWorld): DeleteUndo {
    return new DeleteUndo('stavropoleos', { cityId: CITY, store: world.store, callables: world.callables, clock: world.clock });
}

describe('undo of a delete', () => {
    it('happyPath_theDeletesEntryIsRestored', async () => {
        const world = poisWorld();
        world.callables.answer('history.revert', () => ({ restoredFields: ['title'] }));
        const undo = undoOf(world);
        entry(world, '20261017120000000-a', 'update');
        entry(world, '20261017120001000-b', 'delete');

        const result = await undo.undo();

        expect(result).toEqual({ ok: true });
        expect(world.callables.calls).toEqual([
            { name: 'history.revert', request: { cityId: CITY, entity: 'poi', entityId: 'stavropoleos', entryId: '20261017120001000-b' } },
        ]);
        expect(world.store.listeners(HISTORY)).toBe(0);
    });

    it('happyPath_anUndoBeforeTheEntryWaitsForIt', async () => {
        const world = poisWorld();
        world.callables.answer('history.revert', () => ({ restoredFields: [] }));
        const undo = undoOf(world);

        const result = undo.undo();
        await settle();
        entry(world, '20261017120001000-b', 'delete');

        await expect(result).resolves.toEqual({ ok: true });
    });

    it('happyPath_anEntryAlreadyWrittenIsFoundAtOnce', async () => {
        const world = poisWorld();
        world.callables.answer('history.revert', () => ({ restoredFields: [] }));
        entry(world, '20261017120001000-b', 'delete');

        const undo = undoOf(world);

        await expect(undo.undo()).resolves.toEqual({ ok: true });
        expect(world.store.listeners(HISTORY)).toBe(0);
    });

    it('badPath_withoutTheEntryAfterTenSecondsUndoIsUnavailable', async () => {
        const world = poisWorld();
        const undo = undoOf(world);

        world.clock.advance(UNDO_WAIT_MS);
        const result = await undo.undo();

        expect(result).toEqual({ ok: false, error: 'adminContent.pois.undoUnavailable' });
        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_aFailedListenerOrARefusedRevertSaysWhy', async () => {
        const world = poisWorld();
        world.callables.fail('history.revert', failure('failed-precondition', 'apiError.history.nothingToRestore'));
        const failed = undoOf(world);
        world.store.fail(HISTORY, { kind: 'denied', code: 'permission-denied' });
        entry(world, '20261017120001000-b', 'delete');
        const refused = undoOf(world);
        world.callables.fail('history.revert', new Error('network'));
        const broken = undoOf(world);

        expect(await failed.undo()).toEqual({ ok: false, error: 'adminContent.pois.undoUnavailable' });
        world.callables.fail('history.revert', failure('failed-precondition', 'apiError.history.nothingToRestore'));
        expect(await refused.undo()).toEqual({ ok: false, error: 'apiError.history.nothingToRestore' });
        world.callables.fail('history.revert', new Error('network'));
        expect(await broken.undo()).toEqual({ ok: false, error: 'apiError.internal' });
    });

    it('happyPath_disposeStopsWatching', () => {
        const world = poisWorld();
        const undo = undoOf(world);

        undo.dispose();
        undo.dispose();

        expect(world.store.listeners(HISTORY)).toBe(0);
    });
});
