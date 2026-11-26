import { createLogger, type Credit } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { withLegacyFixes, type AimFields, type LegacyFixStore, type PhotoPlace, type PlaceHistory } from '../../src/import/legacy-fixes.js';
import type { LegacyImport, LegacyImportProgress } from '../../src/import/legacy-import.js';

const BASE = 'https://admin.e2e.test/admin/';
const MIGRATED = { lat: 44.448214, lng: 26.139544 };
const LATER = { lat: 44.448183, lng: 26.139431 };
const CORRECTIONS = {
    'parcul-ferdinand-1930': {
        location: LATER,
        bearing: 219.1,
        fov: 50,
        migrated: { location: MIGRATED },
        source: 'https://old.example/p.jpg',
    },
};
const RECORDS = [
    { sourceFile: 'a.jpg', photo: { id: 'a', author: 'Dan Perry' } },
    { sourceFile: 'b.jpg', photo: { id: 'b', author: 'Studiourile Buftea' } },
    { sourceFile: 'c.jpg', photo: { id: 'c' } },
    null,
];
const MIGRATED_LINE: Credit = { label: { ro: 'Fotografii: Dan Perry', en: 'Photos: Dan Perry' } };
const DONE: LegacyImportProgress = { done: 57, total: 57, failed: [] };

interface World {
    readonly places: Map<string, PhotoPlace>;
    readonly histories: Map<string, PlaceHistory>;
    credits: readonly Credit[] | null;
    readonly aimed: [string, AimFields][];
    readonly store: LegacyFixStore;
}

function world(): World {
    const w: World = {
        places: new Map([['parcul-ferdinand-1930', { location: MIGRATED }]]),
        histories: new Map(),
        credits: [MIGRATED_LINE],
        aimed: [],
        store: {
            place: (_city, id) => Promise.resolve(w.places.get(id) ?? null),
            history: (_city, id) => Promise.resolve(w.histories.get(id) ?? { placed: false, aimed: false }),
            aim: (_city, id, fields) => {
                w.aimed.push([id, fields]);
                w.places.set(id, { ...w.places.get(id), ...fields });
                return Promise.resolve();
            },
            credits: () => Promise.resolve(w.credits),
            saveCredits: (_city, credits) => {
                w.credits = credits;
                return Promise.resolve();
            },
        },
    };
    return w;
}

function bundle(files: Readonly<Record<string, unknown>> = { 'corrections.json': CORRECTIONS, 'photos.json': RECORDS }): typeof fetch {
    const fetcher: typeof fetch = (input) => {
        const name = (input instanceof Request ? input.url : String(input)).slice(`${BASE}legacy/bucharest/`.length);
        const body = files[name];
        return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : Response.json(body));
    };
    return fetcher;
}

function importer(progress: LegacyImportProgress = DONE): LegacyImport {
    return {
        detect: () => Promise.resolve(progress),
        run: (onProgress) => {
            onProgress(progress);
            return Promise.resolve(progress);
        },
    };
}

function subject(w: World, fetcher = bundle(), inner = importer()): LegacyImport {
    return withLegacyFixes(inner, { fetch: fetcher, store: w.store, cityId: 'bucharest', baseUrl: BASE, log: createLogger('test') });
}

describe('withLegacyFixes', () => {
    it('happyPath_countsThenAddsTheOldSitesDirectionAndTheNewAuthorInOneRun', async () => {
        const w = world();
        const fixes = subject(w);
        const seen: LegacyImportProgress[] = [];

        await expect(fixes.detect()).resolves.toEqual({ ...DONE, directions: 1, credits: true });
        const final = await fixes.run((progress) => seen.push(progress));

        expect(w.aimed).toEqual([['parcul-ferdinand-1930', { bearing: 219.1, fov: 50, location: LATER }]]);
        expect(w.credits).toEqual([
            { label: { ro: 'Fotografii: Dan Perry, Studiourile Buftea', en: 'Photos: Dan Perry, Studiourile Buftea' } },
        ]);
        expect(seen[0]).toEqual({ ...DONE, directions: 1, credits: true });
        expect(final).toEqual({ ...DONE, directions: 0, credits: false });
        // Idempotent: the photo now holds the old site's direction, the credits name both authors.
        await expect(fixes.detect()).resolves.toEqual({ ...DONE, directions: 0, credits: false });
        await fixes.run(() => undefined);
        expect(w.aimed).toHaveLength(1);
    });

    it('happyPath_aPointThePersonMovedStaysWhileTheMissingDirectionIsAdded', async () => {
        const w = world();
        w.places.set('parcul-ferdinand-1930', { location: { lat: 44.45, lng: 26.14 } });

        await subject(w).run(() => undefined);

        expect(w.aimed).toEqual([['parcul-ferdinand-1930', { bearing: 219.1, fov: 50 }]]);
    });

    it('badPath_theOwnersDirectionOrPlaceIsNeverOverwritten', async () => {
        const w = world();
        const fixes = subject(w);
        // The owner aimed it: a direction of their own, or one set and removed again.
        w.places.set('parcul-ferdinand-1930', { location: MIGRATED, bearing: 10, fov: 30 });
        await expect(fixes.detect()).resolves.toMatchObject({ directions: 0 });
        w.places.set('parcul-ferdinand-1930', { location: MIGRATED });
        w.histories.set('parcul-ferdinand-1930', { placed: false, aimed: true });
        await expect(fixes.detect()).resolves.toMatchObject({ directions: 0 });
        // Moved by the owner to where it was, then never aimed: the direction is added, the point stays.
        w.histories.set('parcul-ferdinand-1930', { placed: true, aimed: false });
        await fixes.run(() => undefined);
        expect(w.aimed).toEqual([['parcul-ferdinand-1930', { bearing: 219.1, fov: 50 }]]);
    });

    it('badPath_aDeletedOrUnplacedPhotoAndACityWithoutCreditsGetNothing', async () => {
        const w = world();
        w.places.set('parcul-ferdinand-1930', {});
        w.histories.set('parcul-ferdinand-1930', { placed: true, aimed: false });
        w.credits = null;

        await expect(subject(w).detect()).resolves.toEqual({ ...DONE, directions: 0, credits: false });
        w.places.clear();
        await expect(subject(w).detect()).resolves.toMatchObject({ directions: 0 });
    });

    it('badPath_aBundleWithoutCorrectionsOrWithBrokenOnesAddsNoDirection', async () => {
        const w = world();

        await expect(subject(w, bundle({})).detect()).resolves.toEqual({ ...DONE, directions: 0, credits: false });
        await expect(subject(w, bundle({ 'corrections.json': { x: 1 }, 'photos.json': {} })).detect()).resolves.toEqual({
            ...DONE,
            directions: 0,
            credits: false,
        });
    });

    it('badPath_aFailedReadChangesNothingAndAFailedWriteStaysToDo', async () => {
        const w = world();
        vi.spyOn(w.store, 'place').mockRejectedValueOnce(new Error('offline'));
        await expect(subject(w).detect()).resolves.toEqual({ ...DONE, directions: 0, credits: false });

        vi.spyOn(w.store, 'aim').mockRejectedValueOnce(new Error('permission-denied'));
        vi.spyOn(w.store, 'saveCredits').mockRejectedValueOnce(new Error('permission-denied'));
        const final = await subject(w).run(() => undefined);

        expect(final).toEqual({
            ...DONE,
            failed: [{ id: 'parcul-ferdinand-1930', detail: 'apiError.unavailable' }],
            directions: 1,
            credits: true,
        });
    });
});
