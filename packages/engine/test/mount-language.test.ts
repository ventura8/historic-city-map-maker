/** The public API in the viewer's sixteen languages: `setLang`, and a boot error in a language fetched first (V11, V17). */
import { registerCatalogue, type ViewerLocale } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';
import { describe, expect, it } from 'vitest';

import type { CatalogueLoader } from '../src/core/catalogues.js';
import { mount } from '../src/mount.js';
import { settle } from './core/support.js';
import { config, FakeContainer, testEnvironment } from './mount-support.js';

/** Engine folders asked for, and a loader per folder that knows the languages in `ok` (registering their texts). */
function catalogues(...ok: readonly ViewerLocale[]): {
    readonly folders: (string | undefined)[];
    readonly asked: ViewerLocale[];
    readonly make: (engineBase: string | undefined) => CatalogueLoader;
} {
    const folders: (string | undefined)[] = [];
    const asked: ViewerLocale[] = [];
    const make = (engineBase: string | undefined): CatalogueLoader => {
        folders.push(engineBase);
        return (locale) => {
            asked.push(locale);
            if (ok.includes(locale)) {
                registerCatalogue(locale, VIEWER_CATALOGUES[locale]);
            }
            return Promise.resolve(ok.includes(locale));
        };
    };
    return { folders, asked, make };
}

describe('setLang', () => {
    it('happyPath_anyViewerLanguageByItsCodeOrATagOfIt', async () => {
        const languages = catalogues('it', 'pt');
        const world = testEnvironment({ catalogues: languages.make });
        const controller = mount(new FakeContainer().element, config({ engineBase: 'https://cdn.example.org/engine/' }), world.env);
        await controller.ready;

        controller.setLang('it');
        await settle();
        expect(world.viewer.store?.getState().locale).toBe('it');

        controller.setLang('pt-BR' as ViewerLocale);
        await settle();
        expect(world.viewer.store?.getState().locale).toBe('pt');
        expect(languages.folders).toEqual(['https://cdn.example.org/engine/']);
    });

    it.each(['xx', 'sv', '', 'constructor'])('badPath_%s_isIgnored', async (code) => {
        const world = testEnvironment();
        const controller = mount(new FakeContainer().element, config(), world.env);
        await controller.ready;

        controller.setLang(code as ViewerLocale);
        await settle();

        expect(world.viewer.store?.getState()).toMatchObject({ locale: 'ro', toast: null });
    });
});

describe('a boot error in a language not bundled', () => {
    it('happyPath_theCardWaitsForItsLanguagesTexts', async () => {
        const languages = catalogues('es');
        const world = testEnvironment({ catalogues: languages.make });

        const controller = mount(new FakeContainer().element, { manifestUrl: 'http://example.org/manifest.json', lang: 'es' }, world.env);

        expect(world.viewer.bootError).toBeNull();
        await expect(controller.ready).resolves.toEqual({ ok: false, code: 'error.config.invalid' });
        await settle();
        expect(world.viewer.getAttribute('lang')).toBe('es');
        expect(world.viewer.bootError?.params?.['detail']).toContain(VIEWER_CATALOGUES.es['validation.assetUrl']);
        expect(languages.folders).toEqual([undefined]);
    });

    it('badPath_aLanguageThatCannotLoadShowsTheCardInRomanian', async () => {
        const languages = catalogues('ro');
        const world = testEnvironment({ catalogues: languages.make, noMapbox: true });

        mount(new FakeContainer().element, config({ lang: 'ko' }), world.env);
        await settle();

        expect(languages.asked).toEqual(['ko', 'ro']);
        expect(world.viewer.getAttribute('lang')).toBe('ro');
        expect(world.viewer.bootError).toEqual({ code: 'error.mapLoad', retryable: false });
    });

    it('badPath_noLanguageAtAllLeavesTheLanguageAskedForAndTheEnginesOwnCard', async () => {
        const world = testEnvironment({ catalogues: () => () => Promise.resolve(false), noMapbox: true });

        mount(new FakeContainer().element, config({ lang: 'hi' }), world.env);
        await settle();

        expect(world.viewer.getAttribute('lang')).toBe('hi');
        expect(world.viewer.bootError).toEqual({ code: 'error.mapLoad', retryable: false });
    });
});
