/** The languages beyond Romanian and English, fetched when chosen (docs/I18N.md → Loading). */
import { hasCatalogue, translateAdminShell, type UiLocale } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import { firstShown, isBundled, messagesOf, switchLanguage, uiCatalogueLoader } from '../../src/state/ui-language.js';

function serving(files: Readonly<Record<string, unknown>>): { readonly fetch: typeof fetch; readonly asked: string[] } {
    const asked: string[] = [];
    const fetchFile = (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === 'string' ? input : new Request(input).url;
        asked.push(url);
        const body = files[url];
        return Promise.resolve(body === undefined ? new Response('', { status: 404 }) : Response.json(body));
    };
    return { fetch: fetchFile, asked };
}

describe('uiCatalogueLoader', () => {
    it('happyPath_aLanguagesFileIsFetchedOnceAndJoinsTheRegistry', async () => {
        const site = serving({ '/admin/i18n/id.json': { locale: 'id', messages: { 'adminShell.notice.close': 'Tutup pesan' } } });
        const load = uiCatalogueLoader(site.fetch, '/admin/i18n/');

        const [first, second] = await Promise.all([load('id'), load('id')]);

        expect([first, second]).toEqual([true, true]);
        expect(site.asked).toEqual(['/admin/i18n/id.json']);
        expect(hasCatalogue('id')).toBe(true);
        expect(translateAdminShell('id', 'adminShell.notice.close')).toBe('Tutup pesan');
        expect(await load('id')).toBe(true);
        expect(site.asked).toHaveLength(1);
    });

    it('happyPath_romanianAndEnglishAreHereWithoutAFetch', async () => {
        const site = serving({});
        const load = uiCatalogueLoader(site.fetch, '/admin/i18n/');

        expect(await load('ro')).toBe(true);
        expect(await load('en')).toBe(true);
        expect(site.asked).toEqual([]);
    });

    it.each([
        ['a missing file', {}],
        ['another language', { '/i18n/bg.json': { locale: 'el', messages: {} } }],
        ['a value that is no text', { '/i18n/bg.json': { locale: 'bg', messages: { a: 1 } } }],
        ['no messages', { '/i18n/bg.json': { locale: 'bg' } }],
    ])('badPath_%s_isRefusedAndTriedAgainNextTime', async (_case, files) => {
        const site = serving(files);
        const load = uiCatalogueLoader(site.fetch, '/i18n/');

        expect(await load('bg')).toBe(false);
        expect(await load('bg')).toBe(false);
        expect(site.asked).toEqual(['/i18n/bg.json', '/i18n/bg.json']);
    });

    it('badPath_aNetworkErrorIsAFileNotFetched', async () => {
        const load = uiCatalogueLoader(() => Promise.reject(new TypeError('Failed to fetch')), 'i18n/');

        expect(await load('bn')).toBe(false);
    });
});

describe('messagesOf and firstShown', () => {
    it('happyPath_aFileOfTheLanguageWithTextsIsTaken', () => {
        expect(messagesOf({ locale: 'fa', messages: { a: 'ب' } }, 'fa')).toEqual({ a: 'ب' });
    });

    it('badPath_anythingElseIsNot', () => {
        expect(messagesOf(null, 'fa')).toBeNull();
        expect(messagesOf({ locale: 'fa', messages: null }, 'fa')).toBeNull();
    });

    it('happyPath_aBundledLanguageShowsAtOnceAndAnyOtherAfterEnglish', () => {
        expect(firstShown('ro')).toBe('ro');
        expect(firstShown('en')).toBe('en');
        expect(firstShown('ur')).toBe('en');
        expect(isBundled('ur')).toBe(false);
    });
});

describe('switchLanguage', () => {
    const world = (loaded: boolean) => ({
        apply: vi.fn<(locale: UiLocale) => void>(),
        unavailable: vi.fn<(locale: UiLocale) => void>(),
        load: vi.fn<(locale: UiLocale) => Promise<boolean>>(() => Promise.resolve(loaded)),
    });

    it('happyPath_aFetchedLanguageIsAppliedOnceItsTextsAreHere', async () => {
        const w = world(true);
        await switchLanguage(w, 'tr');
        expect(w.apply).toHaveBeenCalledWith('tr');
        expect(w.unavailable).not.toHaveBeenCalled();
    });

    it('happyPath_aBundledLanguageIsAppliedAtOnce', () => {
        const w = world(false);
        void switchLanguage(w, 'en');
        expect(w.apply).toHaveBeenCalledWith('en');
        expect(w.load).not.toHaveBeenCalled();
    });

    it('badPath_aLanguageWhoseTextsCannotBeFetchedIsNotApplied', async () => {
        const w = world(false);
        await switchLanguage(w, 'hi');
        expect(w.apply).not.toHaveBeenCalled();
        expect(w.unavailable).toHaveBeenCalledWith('hi');
    });

    it('badPath_anUnknownCodeIsIgnored', async () => {
        const w = world(true);
        await switchLanguage(w, 'sv');
        expect(w.load).not.toHaveBeenCalled();
        expect(w.apply).not.toHaveBeenCalled();
    });
});
