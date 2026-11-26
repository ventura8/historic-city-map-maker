/** The languages' texts, fetched when first shown (`core/catalogues.ts`, DECISIONS-for-review.md §218). */
import { hasCatalogue, translate } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';
import { describe, expect, it, vi } from 'vitest';

import { catalogueLoader, firstCatalogue, presentCatalogue, type CatalogueSource } from '../../src/core/catalogues.js';
import { jsonResponse } from './support.js';

const FOLDER = 'https://cdn.example.org/engine@1.0.0/i18n/';

function file(locale: string, overrides: Readonly<Record<string, unknown>> = {}): unknown {
    return { engine: '1.0.0', locale, messages: VIEWER_CATALOGUES.ro, ...overrides };
}

function source(answer: (url: string) => Promise<Response>): CatalogueSource & { readonly fetch: ReturnType<typeof vi.fn> } {
    return { fetch: vi.fn(answer), folder: FOLDER, engineVersion: '1.0.0', retryDelaysMs: [] };
}

describe('catalogueLoader', () => {
    it('happyPath_fetchesTheLanguageOnceAndRegistersIt', async () => {
        const de = source(() => Promise.resolve(jsonResponse(file('de', { messages: VIEWER_CATALOGUES.de }))));
        const load = catalogueLoader(de);

        const [first, second] = await Promise.all([load('de'), load('de')]);

        expect([first, second]).toEqual([true, true]);
        expect(de.fetch).toHaveBeenCalledTimes(1);
        expect(de.fetch.mock.calls[0]?.[0]).toBe(`${FOLDER}de.json`);
        expect(translate('de', 'layers.title')).toBe(VIEWER_CATALOGUES.de['layers.title']);
        expect(await load('de')).toBe(true);
        expect(de.fetch).toHaveBeenCalledTimes(1);
    });

    it('happyPath_aLanguageStillTranslatedShowsEnglishForEachKeyItLacks', async () => {
        const fa = source(() => Promise.resolve(jsonResponse(file('fa', { messages: { 'layers.title': 'لایه‌ها' }, fallback: 'en' }))));

        expect(await catalogueLoader(fa)('fa')).toBe(true);

        expect(translate('fa', 'layers.title')).toBe('لایه‌ها');
        expect(translate('fa', 'theme.label')).toBe(translate('en', 'theme.label'));
        expect(fa.fetch).toHaveBeenCalledTimes(1);
    });

    it('happyPath_aLanguageThePageHasNeedsNoRequest', async () => {
        const none = source(() => Promise.reject(new Error('no request expected')));

        expect(await catalogueLoader(none)('ro')).toBe(true);
        expect(none.fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['a 404', () => Promise.resolve(new Response('', { status: 404 }))],
        ['a network error', () => Promise.reject(new TypeError('offline'))],
        ['not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
        ['another engine', () => Promise.resolve(jsonResponse(file('fr', { engine: '0.9.0' })))],
        ['another language', () => Promise.resolve(jsonResponse(file('es')))],
        ['a value that is not a text', () => Promise.resolve(jsonResponse(file('fr', { messages: { 'layers.title': 42 } })))],
        ['no messages', () => Promise.resolve(jsonResponse(file('fr', { messages: null })))],
        ['null', () => Promise.resolve(jsonResponse(null))],
    ])('badPath_%s_isRefusedAndTriedAgainNextTime', async (_case, answer) => {
        const fr = source(answer);
        const load = catalogueLoader(fr);

        expect(await load('fr')).toBe(false);
        expect(hasCatalogue('fr')).toBe(false);
        expect(await load('fr')).toBe(false);
        expect(fr.fetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('badPath_aRequestThatNeverAnswersTimesOut', async () => {
        vi.useFakeTimers();
        try {
            const slow: CatalogueSource = {
                folder: FOLDER,
                engineVersion: '1.0.0',
                timeoutMs: 50,
                fetch: (_url, init) => abortable(init.signal),
            };
            const pending = catalogueLoader(slow)('pl');

            await vi.advanceTimersByTimeAsync(60);

            expect(await pending).toBe(false);
            expect(hasCatalogue('pl')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

/** A fetch that rejects when its signal aborts (the timeout), and never answers otherwise. */
function abortable(signal: AbortSignal): Promise<Response> {
    return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
        });
    });
}

describe('firstCatalogue', () => {
    it('happyPath_theLanguageAskedForWhenItLoads', async () => {
        expect(await firstCatalogue(() => Promise.resolve(true), 'uk')).toBe('uk');
    });

    it('badPath_romanianWhenTheLanguageAskedForCannotLoad', async () => {
        const load = vi.fn((locale: string) => Promise.resolve(locale === 'ro'));

        expect(await firstCatalogue(load, 'uk')).toBe('ro');
        expect(load.mock.calls.map(([locale]) => locale)).toEqual(['uk', 'ro']);
    });

    it('badPath_nullWhenNotEvenRomanianLoads', async () => {
        const load = vi.fn(() => Promise.resolve(false));

        expect(await firstCatalogue(load, 'uk')).toBeNull();
        expect(await firstCatalogue(load, 'ro')).toBeNull();
        expect(load).toHaveBeenCalledTimes(3);
    });

    it('happyPath_withoutALoaderOnlyTheLanguagesThePageHas', async () => {
        expect(await presentCatalogue('en')).toBe(true);
        expect(await presentCatalogue('ko')).toBe(false);
    });
});
