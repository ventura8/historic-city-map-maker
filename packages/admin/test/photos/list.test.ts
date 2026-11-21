// The photo list: one live query per filter, More, the search over the loaded photos, the selection, reconnecting.
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { PhotoList } from '../../src/photos/list.js';
import type { PhotosListState } from '../../src/photos/state.js';
import { at, CITY, photosWorld, seedPhoto, type PhotosWorld } from './world.js';

const PHOTOS = FIRESTORE_PATHS.photos(CITY);

function listWorld(checkPlace: ReadonlySet<string> = new Set()) {
    const world = photosWorld();
    const states: PhotosListState[] = [];
    const list = new PhotoList({
        ...{ store: world.store, clock: world.clock, cityId: CITY, denied: world.services.denied },
        checkPlace: () => checkPlace,
        changed: (state) => {
            states.push(state);
        },
    });
    return { world, list, states };
}

function seedMany(world: PhotosWorld, count: number): void {
    for (let index = 0; index < count; index += 1) {
        seedPhoto(world, `p${String(index).padStart(3, '0')}`, {
            updatedAt: at(new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString()),
        });
    }
}

describe('PhotoList', () => {
    it('happyPath_thePhotosAreListedNewestChangeFirst', () => {
        const { world, list } = listWorld(new Set(['older']));
        seedPhoto(world, 'older', { updatedAt: at('2026-10-17T09:00:00.000Z') });
        seedPhoto(world, 'newer', { updatedAt: at('2026-10-17T11:00:00.000Z'), published: true });

        list.open();
        list.open();

        expect(list.state).toMatchObject({ status: 'ready', loaded: 2, hasMore: false });
        expect(list.state.rows.map((row) => [row.id, row.checkPlace])).toEqual([
            ['newer', false],
            ['older', true],
        ]);
        expect(list.doc('newer')?.data.published).toBe(true);
        expect(world.store.listeners(PHOTOS)).toBe(1);
    });

    it('happyPath_aFilterIsItsOwnQueryAndClearsTheSelection', () => {
        const { world, list } = listWorld();
        seedPhoto(world, 'a', { published: true });
        seedPhoto(world, 'b');
        list.open();
        list.toggle('a');

        list.setFilter('unpublished');
        list.setFilter('unpublished');

        expect(list.state).toMatchObject({ filter: 'unpublished', selection: [] });
        expect(list.state.rows.map((row) => row.id)).toEqual(['b']);
    });

    it('happyPath_moreLoadsOnePageMore', () => {
        const { world, list } = listWorld();
        seedMany(world, 60);
        list.open();
        expect(list.state).toMatchObject({ loaded: 50, hasMore: true });

        list.more();

        expect(list.state).toMatchObject({ loaded: 60, hasMore: false });
    });

    it('happyPath_theSearchNarrowsTheLoadedPhotos', () => {
        const { world, list } = listWorld();
        seedPhoto(world, 'a', { title: { ro: 'Piața Romană' } });
        seedPhoto(world, 'b');
        list.open();

        list.setSearch({ text: 'romana', yearFrom: null, yearTo: null });

        expect(list.state).toMatchObject({ loaded: 2 });
        expect(list.state.rows.map((row) => row.id)).toEqual(['a']);
    });

    it('happyPath_theSelection', () => {
        const { world, list } = listWorld();
        seedPhoto(world, 'a');
        seedPhoto(world, 'b');
        list.open();

        list.toggle('a');
        list.toggle('b');
        list.toggle('a');
        expect(list.state.selection).toEqual(['b']);
        list.selectAll();
        expect(
            list
                .selected()
                .map((stored) => stored.id)
                .toSorted((a, b) => a.localeCompare(b)),
        ).toEqual(['a', 'b']);
        world.store.drop(world.store.docs.keys().next().value ?? '');
        expect(list.state.selection).toHaveLength(1);
        list.select(['x', 'x']);
        expect(list.state.selection).toEqual(['x']);
    });

    it('badPath_aLostListenerReconnectsAndARefusedOneIsAnError', () => {
        const { world, list } = listWorld();
        seedPhoto(world, 'a');
        list.open();

        world.store.fail(PHOTOS, { kind: 'unavailable', code: 'unavailable' });
        expect(list.state).toMatchObject({ status: 'ready', reconnecting: true });
        world.clock.advance(1000);
        expect(list.state).toMatchObject({ status: 'ready', reconnecting: false });

        world.store.fail(PHOTOS, { kind: 'denied', code: 'permission-denied' });
        expect(list.state).toMatchObject({ status: 'error', failure: { kind: 'denied' } });
        expect(world.denials.count).toBe(1);
        list.retry();
        expect(list.state.status).toBe('ready');
        list.close();
        expect(world.store.listeners(PHOTOS)).toBe(0);
    });

    it('happyPath_refreshRecomputesTheRows', () => {
        const { world, list, states } = listWorld();
        seedPhoto(world, 'a');
        list.open();
        const before = states.length;

        list.refresh();

        expect(states).toHaveLength(before + 1);
    });
});
