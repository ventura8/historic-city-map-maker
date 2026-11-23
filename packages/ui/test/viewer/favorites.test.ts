/** V91: the favourites' storage, their rows and the page's store (`favorites.ts`). */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    FavoritesStore,
    MAX_FAVORITES,
    favoriteEntries,
    favoritesKey,
    parseFavorites,
    toggled,
    type Favorite,
} from '../../src/viewer/favorites.js';
import { testManifest } from './fixtures.js';

afterEach(() => {
    vi.restoreAllMocks();
    // Only this file's keys: other test files share the page's storage.
    for (const key of Object.keys(localStorage).filter((name) => name.endsWith(':favorites'))) {
        localStorage.removeItem(key);
    }
});

describe('parseFavorites', () => {
    it('happyPath_keepsWellFormedEntries', () => {
        const raw = JSON.stringify([
            { kind: 'poi', id: 'casa-uranus', extra: 1 },
            { kind: 'layer', id: 'kh9-1977' },
        ]);
        expect(parseFavorites(raw)).toEqual([
            { kind: 'poi', id: 'casa-uranus' },
            { kind: 'layer', id: 'kh9-1977' },
        ]);
    });

    it('badInput_dropsWhatItCannotRead', () => {
        expect(parseFavorites(null)).toEqual([]);
        expect(parseFavorites('{not json')).toEqual([]);
        expect(parseFavorites('{"kind":"poi"}')).toEqual([]);
        expect(
            parseFavorites(JSON.stringify([null, 3, { kind: 'city', id: 'x' }, { kind: 'poi', id: 'a b' }, { kind: 'poi', id: 7 }])),
        ).toEqual([]);
    });
});

describe('toggled', () => {
    const one: Favorite = { kind: 'photo', id: 'one' };

    it('happyPath_addsAtTheFrontThenRemoves', () => {
        const list = toggled([{ kind: 'poi', id: 'x' }], one);
        expect(list[0]).toEqual(one);
        expect(toggled(list, one)).toEqual([{ kind: 'poi', id: 'x' }]);
    });

    it('edgeCase_keepsAtMostTheLimit', () => {
        const full = Array.from({ length: MAX_FAVORITES }, (_, index) => ({ kind: 'poi' as const, id: `p${String(index)}` }));
        const list = toggled(full, one);
        expect(list).toHaveLength(MAX_FAVORITES);
        expect(list[0]).toEqual(one);
    });
});

describe('favoriteEntries', () => {
    it('happyPath_titlesEachKindInTheVisitorsLanguage', () => {
        const manifest = testManifest((raw) => {
            raw['stories'] = [{ id: 'teatrul', title: { ro: 'Teatrul', en: 'The theatre' }, body: { ro: 'Text.' } }];
            raw['unplaced'] = [];
        });
        const entries = favoriteEntries(
            [
                { kind: 'layer', id: 'kh9-1977' },
                { kind: 'photo', id: 'mihai-voda-1978' },
                { kind: 'poi', id: 'casa-uranus' },
                { kind: 'story', id: 'teatrul' },
            ],
            manifest,
            'en',
        );
        expect(entries.map((entry) => [entry.kind, entry.title, entry.icon])).toEqual([
            ['layer', 'KH-9 1977 (1977)', 'layers'],
            ['photo', 'Mihai Vodă church', 'image'],
            ['poi', expect.any(String), 'place'],
            ['story', 'The theatre', 'museum'],
        ]);
    });

    it('badInput_leavesOutWhatTheCityRemoved', () => {
        const manifest = testManifest();
        const gone: Favorite[] = [
            { kind: 'layer', id: 'gone' },
            { kind: 'photo', id: 'gone' },
            { kind: 'poi', id: 'gone' },
            { kind: 'story', id: 'gone' },
        ];
        expect(favoriteEntries(gone, manifest, 'ro')).toEqual([]);
    });
});

describe('FavoritesStore', () => {
    it('happyPath_loadsTogglesAndRemembersPerCity', () => {
        localStorage.setItem(favoritesKey('cluj'), JSON.stringify([{ kind: 'poi', id: 'a' }]));
        const store = new FavoritesStore();
        const changes = vi.fn();
        store.addEventListener('change', changes);
        store.load('cluj');
        expect(store.has('poi', 'a')).toBe(true);
        store.load('cluj');
        expect(changes).toHaveBeenCalledTimes(1);
        store.toggle('layer', 'b');
        expect(parseFavorites(localStorage.getItem(favoritesKey('cluj')))).toEqual([
            { kind: 'layer', id: 'b' },
            { kind: 'poi', id: 'a' },
        ]);
        expect(store.persisted).toBe(true);
        store.load('bacau');
        expect(store.list).toEqual([]);
    });

    it('edgeCase_aToggleBeforeAnyCityStaysInMemory', () => {
        const store = new FavoritesStore();
        store.toggle('story', 's');
        expect(store.has('story', 's')).toBe(true);
        expect(Object.keys(localStorage).filter((name) => name.endsWith(':favorites'))).toEqual([]);
    });

    it('badInput_blockedStorageKeepsThePageListAndSaysItIsNotSaved', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });
        const store = new FavoritesStore();
        store.load('blocked');
        expect(store.list).toEqual([]);
        expect(store.persisted).toBe(false);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        store.toggle('poi', 'a');
        expect(store.has('poi', 'a')).toBe(true);
        expect(store.persisted).toBe(false);
    });

    it('badInput_noStorageAtAll', () => {
        vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
            throw new DOMException('denied', 'SecurityError');
        });
        const store = new FavoritesStore();
        store.load('none');
        expect(store.persisted).toBe(false);
        store.toggle('poi', 'a');
        expect(store.persisted).toBe(false);
    });
});
