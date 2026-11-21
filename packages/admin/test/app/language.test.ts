/** The admin's language switch: fetched, shown, remembered, or kept with a notice (docs/I18N.md → Loading). */
import { describe, expect, it, vi } from 'vitest';

import { adminLanguage } from '../../src/app/language.js';
import { LANGUAGE_KEY } from '../../src/state/locale.js';
import { MemoryStore } from './fakes.js';

function world(loaded: boolean): {
    readonly local: MemoryStore;
    readonly update: ReturnType<typeof vi.fn>;
    readonly language: ReturnType<typeof adminLanguage>;
} {
    const local = new MemoryStore();
    const update = vi.fn();
    const shell = { update, notice: (input: object) => ({ ...input, id: 7 }) as never };
    const load = (): Promise<boolean> => Promise.resolve(loaded);
    return { local, update, language: adminLanguage({ fetch: vi.fn(), local, shell, load }) };
}

/** A language file that arrives when the test says so: every request waits for `arrive`. */
function slowFiles(): { readonly load: (locale: string) => Promise<boolean>; readonly arrive: (ok: boolean) => void } {
    const waiting: ((ok: boolean) => void)[] = [];
    return {
        load: () => new Promise<boolean>((resolve) => waiting.push(resolve)),
        arrive: (ok) => {
            waiting.forEach((resolve) => {
                resolve(ok);
            });
        },
    };
}

describe('adminLanguage', () => {
    it('happyPath_aChosenLanguageIsShownAndRememberedOnceItsTextsAreHere', async () => {
        const w = world(true);
        await w.language.choose('ja');
        expect(w.update).toHaveBeenCalledWith({ locale: 'ja' });
        expect(w.local.get(LANGUAGE_KEY)).toBe('ja');
    });

    it('happyPath_theFirstLanguageIsShownWithoutBeingRemembered', async () => {
        const w = world(true);
        await w.language.start('nl');
        await w.language.start('ro');
        expect(w.update).toHaveBeenCalledTimes(1);
        expect(w.update).toHaveBeenCalledWith({ locale: 'nl' });
        expect(w.local.get(LANGUAGE_KEY)).toBeNull();
    });

    it('badPath_aLanguageWhoseTextsCannotBeFetchedKeepsTheLanguageAndSaysSo', async () => {
        const w = world(false);
        await w.language.choose('fa');
        expect(w.update).toHaveBeenCalledWith({ notice: { key: 'adminShell.language.unavailable', params: { language: 'فارسی' }, id: 7 } });
        expect(w.update).not.toHaveBeenCalledWith({ locale: 'fa' });
        expect(w.local.get(LANGUAGE_KEY)).toBeNull();
    });

    it('happyPath_aSlowLanguageThenEnglishEndsInEnglishAndStoresEnglish', async () => {
        const local = new MemoryStore();
        const update = vi.fn();
        const { load, arrive } = slowFiles();
        const language = adminLanguage({ fetch: vi.fn(), local, shell: { update, notice: vi.fn() }, load });

        const french = language.choose('fr');
        await language.choose('en');
        arrive(true);
        await french;

        expect(update.mock.calls).toEqual([[{ locale: 'en' }]]);
        expect(local.get(LANGUAGE_KEY)).toBe('en');
    });

    it('badPath_theBootsFetchResolvingAfterAMenuChoiceNeverUndoesIt', async () => {
        const local = new MemoryStore();
        const update = vi.fn();
        const { load, arrive } = slowFiles();
        const language = adminLanguage({ fetch: vi.fn(), local, shell: { update, notice: vi.fn() }, load });

        const boot = language.start('uk');
        await language.choose('ro');
        arrive(true);
        await boot;

        expect(update.mock.calls).toEqual([[{ locale: 'ro' }]]);
        expect(local.get(LANGUAGE_KEY)).toBe('ro');
    });

    it('badPath_aSupersededLanguageThatCannotBeFetchedSaysNothing', async () => {
        const local = new MemoryStore();
        const update = vi.fn();
        const { load, arrive } = slowFiles();
        const language = adminLanguage({ fetch: vi.fn(), local, shell: { update, notice: vi.fn() }, load });

        const german = language.choose('de');
        await language.choose('en');
        arrive(false);
        await german;
        await language.choose('xx' as never);

        expect(update.mock.calls).toEqual([[{ locale: 'en' }]]);
    });
});
