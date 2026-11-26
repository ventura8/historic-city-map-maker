/**
 * The test kit's `FakeContentStore` (`@hcm/test-support/fake-content-store`) reads a dotted field path into maps the way
 * Firestore does (CR-M3-27): the Imagery area's scene query filters on `downloadAvailable` and orders by `rank.score`.
 */
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const sceneSchema = z.object({ downloadAvailable: z.boolean(), rank: z.object({ score: z.number() }) });

function seeded(): FakeContentStore {
    const store = new FakeContentStore();
    store.docs.set('cities/c/usgsScenes/low', { downloadAvailable: true, rank: { score: 40 } });
    store.docs.set('cities/c/usgsScenes/high', { downloadAvailable: true, rank: { score: 92 } });
    store.docs.set('cities/c/usgsScenes/paid', { downloadAvailable: false, rank: { score: 99 } });
    store.docs.set('cities/c/usgsScenes/least', { downloadAvailable: true, rank: { score: 10 } });
    return store;
}

function idsOf(store: FakeContentStore, query: Parameters<FakeContentStore['watchQuery']>[2]): string[] {
    let ids: string[] = [];
    const stop = store.watchQuery(
        'cities/c/usgsScenes',
        sceneSchema.partial(),
        query,
        (page) => {
            ids = page.docs.map((doc) => doc.id);
        },
        () => undefined,
    );
    stop();
    return ids;
}

describe('FakeContentStore field paths', () => {
    it('happyPath_aQueryOrdersAndFiltersByADottedPath', () => {
        const store = seeded();

        expect(idsOf(store, { where: [['downloadAvailable', '==', true]], orderBy: [['rank.score', 'desc']] })).toEqual([
            'high',
            'low',
            'least',
        ]);
        expect(idsOf(store, { where: [['rank.score', '>=', 90]] })).toEqual(['high', 'paid']);
    });

    it('badPath_aPathThroughAMissingMapReadsNothing', () => {
        const store = seeded();
        store.docs.set('cities/c/usgsScenes/flat', { downloadAvailable: true, rank: 7 });

        expect(idsOf(store, { where: [['rank.score.value', '==', 92]] })).toEqual([]);
        expect(idsOf(store, { where: [['rank.score', '==', 92]] })).toEqual(['high']);
    });
});
