// A revoked admin's editors (DECISIONS-for-review.md §35e): every write is refused at once while the shell says so; reads
// and new ids pass through.
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import { writesRefusedWhen } from '../../src/content/revoked.js';
import { asContentStore } from './world.js';

const NOTE = z.object({ text: z.string() });

describe('writesRefusedWhen', () => {
    it('happyPath_beforeTheRevocationEverythingReachesTheStore', async () => {
        const fake = new FakeContentStore();
        const store = writesRefusedWhen(asContentStore(fake), () => false);

        expect(await store.create('notes/a', { text: 'a' })).toEqual({ ok: true });
        const seen: unknown[] = [];
        const stop = store.watchDoc(
            'notes/a',
            NOTE,
            (doc) => seen.push(doc?.data),
            () => undefined,
        );
        expect(seen).toEqual([{ text: 'a' }]);
        stop();
        expect(await store.count('notes', {})).toBe(1);
        expect(store.newId()).toMatch(/^[A-Za-z0-9_-]+$/);
        const pages: number[] = [];
        store.watchQuery(
            'notes',
            NOTE,
            {},
            (page) => pages.push(page.docs.length),
            () => undefined,
        )();
        expect(pages).toEqual([1]);
    });

    it('badPath_afterTheRevocationEveryWriteIsRefusedAndNothingIsWritten', async () => {
        const fake = new FakeContentStore();
        const revoked = { now: false };
        const store = writesRefusedWhen(asContentStore(fake), () => revoked.now);
        await store.create('notes/a', { text: 'a' });
        const written = fake.writes.length;
        revoked.now = true;

        const denied = { ok: false, reason: 'denied' };
        expect(await store.create('notes/b', { text: 'b' })).toEqual(denied);
        expect(await store.update('notes/a', { text: 'changed' }, null)).toEqual(denied);
        expect(await store.remove('notes/a', null)).toEqual(denied);
        expect(await store.batch([{ kind: 'delete', path: 'notes/a' }])).toEqual(denied);
        expect(fake.writes).toHaveLength(written);
    });
});
