/** The visitor's language among sixteen, its texts fetched first (V11; `core/catalogues.ts`, DECISIONS-for-review.md §218). */
import { hasCatalogue, type ViewerLocale } from '@hcm/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CatalogueLoader } from '../../src/core/catalogues.js';
import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { harness, loaded } from './harness.js';
import { settle } from './support.js';

/**
 * A loader whose every answer the test gives (`answer(locale, ok)` settles that language's request), but at once for a
 * language the page has, as the engine's own.
 */
function scriptedLoader(): { readonly load: CatalogueLoader & ReturnType<typeof vi.fn>; answer(locale: ViewerLocale, ok: boolean): void } {
    const pending = new Map<ViewerLocale, (ok: boolean) => void>();
    const load = vi.fn((locale: ViewerLocale) =>
        hasCatalogue(locale)
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
                  pending.set(locale, resolve);
              }),
    );
    return {
        load,
        answer(locale, ok) {
            pending.get(locale)?.(ok);
        },
    };
}

/** A loader that answers at once: true for the languages in `ok`. */
function answering(...ok: readonly ViewerLocale[]): CatalogueLoader & ReturnType<typeof vi.fn> {
    return vi.fn((locale: ViewerLocale) => Promise.resolve(ok.includes(locale)));
}

describe('switching to a language the page does not have yet', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theLanguageCommitsOnceItsTextsAreHere', async () => {
        const loader = scriptedLoader();
        const { store, map, storage, location } = await loaded({ catalogues: loader.load });

        store.setLocale('de');
        expect(store.getState().locale).toBe('ro');

        loader.answer('de', true);
        await settle();
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);

        expect(store.getState().locale).toBe('de');
        expect(storage.get('hcm:bucuresti:lang')).toBe('de');
        expect(location.written.at(-1)).toContain('lang=de');
        expect(map.callsOf('setLocale').at(-1)).toEqual(['de']);
    });

    it('badPath_aLanguageThatCannotBeFetchedLeavesThePageAsItWasAndSaysSo', async () => {
        const loader = scriptedLoader();
        const { store, storage } = await loaded({ catalogues: loader.load });

        store.setLocale('ja');
        loader.answer('ja', false);
        await settle();

        expect(store.getState().locale).toBe('ro');
        expect(store.getState().toast).toEqual({ key: 'language.unavailable' });
        expect(storage.get('hcm:bucuresti:lang')).toBeUndefined();
    });

    it('badPath_theLatestChoiceWinsOverOneStillLoading', async () => {
        const loader = scriptedLoader();
        const { store } = await loaded({ catalogues: loader.load });

        store.setLocale('de');
        store.setLocale('fr');
        loader.answer('fr', true);
        loader.answer('de', true);
        await settle();
        expect(store.getState().locale).toBe('fr');

        store.setLocale('ko');
        store.setLocale('en');
        loader.answer('ko', true);
        await settle();
        expect(store.getState().locale).toBe('en');
    });

    it('badPath_aFailureOfAnEarlierChoiceSaysNothing', async () => {
        const loader = scriptedLoader();
        const { store } = await loaded({ catalogues: loader.load });

        store.setLocale('hi');
        store.setLocale('en');
        loader.answer('hi', false);
        await settle();

        expect(store.getState().locale).toBe('en');
        expect(store.getState().toast).toBeNull();
    });

    it('badPath_aHashLanguageGoesThroughItsTexts', async () => {
        const loader = scriptedLoader();
        const { store, location } = await loaded({ catalogues: loader.load });

        location.navigate('#14/44.42700/26.08530&lang=uk');
        expect(store.getState().locale).toBe('ro');
        expect(store.getState().view.zoom).toBe(14);

        loader.answer('uk', true);
        await settle();

        expect(store.getState().locale).toBe('uk');
    });
});

describe('the boot language', () => {
    it('happyPath_theUrlsLanguageIsFetchedBesideTheManifest', async () => {
        const catalogues = answering('ar');
        const { store, map } = await loaded({ hash: '#lang=ar', catalogues });

        expect(catalogues).toHaveBeenCalledWith('ar');
        expect(store.getState()).toMatchObject({ status: 'ready', locale: 'ar', toast: null });
        expect(map.callsOf('mount')).toHaveLength(1);
    });

    it('badPath_aBootLanguageThatCannotLoadFallsBackToRomanian', async () => {
        const { store } = await loaded({ search: '?lang=zh', catalogues: answering('ro') });

        expect(store.getState()).toMatchObject({ status: 'ready', locale: 'ro', toast: { key: 'language.unavailable' } });
    });

    it('badPath_noLanguageAtAllLeavesTheBilingualCard', async () => {
        const { store, map } = await loaded({ hash: '#lang=tr', catalogues: answering() });

        expect(store.getState()).toMatchObject({ status: 'error', error: { code: 'error.generic', retryable: true }, locale: 'tr' });
        expect(map.callsOf('mount')).toEqual([]);
    });

    it('badPath_aManifestErrorWaitsForTheLanguageToo', async () => {
        const catalogues = answering('pl');
        const { store } = await loaded({
            hash: '#lang=pl',
            catalogues,
            response: () => Promise.resolve(new Response('', { status: 404 })),
        });

        expect(store.getState()).toMatchObject({ status: 'error', error: { code: 'error.manifest.notFound' }, locale: 'pl' });
    });

    it('badPath_aStoreDestroyedWhileTheLanguageLoadsDoesNothing', async () => {
        const loader = scriptedLoader();
        const parts = harness({ hash: '#lang=it', catalogues: loader.load });

        const loading = parts.store.load();
        await settle();
        parts.store.destroy();
        loader.answer('it', true);
        await loading;

        expect(parts.map.callsOf('mount')).toEqual([]);
    });
});

describe('the boot language and the manifest both failing', () => {
    it('badPath_theManifestsErrorIsTheOneReported', async () => {
        const { store } = await loaded({
            hash: '#lang=es',
            catalogues: answering(),
            response: () => Promise.resolve(new Response('', { status: 404 })),
        });

        expect(store.getState()).toMatchObject({ status: 'error', error: { code: 'error.manifest.notFound' } });
    });
});
