import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runBulk } from '../../src/pois/bulk.js';
import type { PoiItem } from '../../src/pois/model.js';
import { CITY, POINT, poisWorld } from './world.js';

function item(id: string, extra: Partial<PoiItem> = {}): PoiItem {
    const value = { category: 'biserici', geometry: POINT, title: { ro: id }, links: [], photoIds: [], published: true };
    return {
        id,
        version: 'v',
        category: 'biserici',
        title: { ro: id },
        yearStart: null,
        yearEnd: null,
        yearSeen: null,
        shape: 'point',
        published: true,
        geometry: POINT,
        value,
        ...extra,
    };
}

describe('bulk actions on places', () => {
    it('happyPath_publishMoveAndDeleteWriteOnlyWhatChanges', async () => {
        const world = poisWorld();
        const places = [item('a'), item('b', { published: false }), item('c', { category: 'parcuri' })];

        const published = await runBulk(world.store, CITY, { kind: 'publish', published: true }, places);
        const moved = await runBulk(world.store, CITY, { kind: 'move', category: 'parcuri' }, places);
        const deleted = await runBulk(world.store, CITY, { kind: 'delete' }, places);

        expect(published).toEqual({ changed: 1, skipped: 2, failure: null });
        expect(moved).toEqual({ changed: 2, skipped: 1, failure: null });
        expect(deleted).toEqual({ changed: 3, skipped: 0, failure: null });
        expect(world.store.writes).toEqual([
            { kind: 'batch', writes: [{ kind: 'update', path: FIRESTORE_PATHS.poi(CITY, 'b'), fields: { published: true } }] },
            {
                kind: 'batch',
                writes: [
                    { kind: 'update', path: FIRESTORE_PATHS.poi(CITY, 'a'), fields: { category: 'parcuri' } },
                    { kind: 'update', path: FIRESTORE_PATHS.poi(CITY, 'b'), fields: { category: 'parcuri' } },
                ],
            },
            { kind: 'batch', writes: ['a', 'b', 'c'].map((id) => ({ kind: 'delete', path: FIRESTORE_PATHS.poi(CITY, id) })) },
        ]);
    });

    it('badPath_aRefusedBatchStopsAndSaysHowManyChanged', async () => {
        const world = poisWorld();
        const places = Array.from({ length: 501 }, (_unused, index) => item(`p${String(index)}`));
        world.store.outcomes.push({ ok: true }, { ok: false, reason: 'offline' });

        const outcome = await runBulk(world.store, CITY, { kind: 'delete' }, places);

        expect(outcome).toEqual({ changed: 500, skipped: 1, failure: 'offline' });
    });
});
