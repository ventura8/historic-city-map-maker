/** The viewer in its sixteen languages: right to left, the engine's own bilingual card, the list, city texts' fallback (V11). */
import { LANGUAGE_NAMES, registerCatalogue, translate, VIEWER_LOCALES } from '@hcm/shared';
import { VIEWER_CATALOGUES } from '@hcm/shared/viewer-catalogues';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { mapboxLanguage } from '../../src/map/lifecycle.js';
import { defineHcmAboutDialog, HCM_ABOUT_DIALOG_TAG, type HcmAboutDialog } from '../../src/viewer/hcm-about-dialog.js';
import { defineHcmPhotoSheet, HCM_PHOTO_SHEET_TAG, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { photoCountText } from '../../src/viewer/text.js';
import { defineKitDoubles, fireKitEvent, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';
import { idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, mountViewer } from './viewer-harness.js';

const MANIFEST = testManifest();

beforeAll(() => {
    for (const locale of ['ar', 'de', 'pl'] as const) {
        registerCatalogue(locale, VIEWER_CATALOGUES[locale]);
    }
    defineKitDoubles();
    defineHcmPoiDetail();
    defineHcmPhotoSheet();
    defineHcmAboutDialog();
});

afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.removeAttribute('dir');
    document.documentElement.lang = 'en';
});

describe('<hcm-map-viewer> right to left', () => {
    it('happyPath_arabicMirrorsTheViewerButNotItsMap', async () => {
        const { element } = await mountViewer(readyState(MANIFEST, { locale: 'ar' }), COMPACT);
        await element.updateComplete;

        expect(element.dir).toBe('rtl');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toBe('ar');
        expect(shadowQuery(element, '.map').getAttribute('dir')).toBe('ltr');
        expect(getComputedStyle(element).direction).toBe('rtl');
    });

    it('badPath_everyOtherLanguageIsLeftToRight', async () => {
        const { element } = await mountViewer(readyState(MANIFEST, { locale: 'de' }), COMPACT);

        expect(element.dir).toBe('ltr');
        expect(element.getAttribute('lang')).toBe('de');
    });
});

describe('<hcm-map-viewer> without any language', () => {
    it('badPath_aBootErrorWithNoCatalogueShowsTheEnginesBilingualCard', async () => {
        const { element } = await mountViewer(
            { ...idleState(), locale: 'ko', status: 'error', error: { code: 'error.generic', retryable: true } },
            COMPACT,
        );

        const card = shadowQuery(element, '.catalogue-down');
        expect(card.getAttribute('role')).toBe('alert');
        expect(Array.from(card.querySelectorAll('p')).map((line) => [line.lang, line.textContent])).toEqual([
            ['ro', 'Harta nu s-a putut încărca.'],
            ['en', 'The map could not be loaded.'],
        ]);
        expect(element.shadowRoot?.querySelector('hcm-error-card')).toBeNull();
    });

    it('happyPath_whileItsTextsLoadTheSkeletonSaysNothing', async () => {
        const { element } = await mountViewer({ ...idleState(), locale: 'ko', status: 'loading' }, COMPACT);

        expect(element.shadowRoot?.querySelector('.catalogue-down')).toBeNull();
        expect(shadowQuery(element, '.skeleton').textContent.trim()).toBe('');
    });
});

describe('the language list', () => {
    it('happyPath_sixteenLanguagesEachByItsOwnNameInItsOwnLanguage', async () => {
        const about = await mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, {
            open: true,
            mode: 'settings',
            city: MANIFEST.city,
            locale: 'de',
        });
        const list = shadowQuery(about, 'hcm-language-select') as HTMLElement & {
            readonly options: readonly { readonly value: string; readonly label: string; readonly lang?: string }[];
            readonly value: string;
        };

        expect(list.options).toHaveLength(VIEWER_LOCALES.length);
        expect(list.options.map((option) => option.label)).toEqual(Object.values(LANGUAGE_NAMES));
        expect(list.options.every((option) => option.lang === option.value)).toBe(true);
        expect(list.value).toBe('de');
    });

    it('badPath_theListKeepsThePagesLanguageUntilThePageSwitches', async () => {
        const about = await mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, {
            open: true,
            mode: 'settings',
            city: MANIFEST.city,
            locale: 'ro',
        });
        const list = shadowQuery(about, 'hcm-language-select') as HTMLElement & { value: string };
        const events = recordEvents(about, 'hcm-locale-change');

        fireKitEvent(list, 'hcm-change', { value: 'ja' });

        expect(events).toEqual([{ type: 'hcm-locale-change', detail: { locale: 'ja' } }]);
        expect(list.value).toBe('ro');
        about.locale = 'ja';
        await about.updateComplete;
        expect(list.value).toBe('ja');
    });

    it('happyPath_aCitysTextNamesTheLanguageItIsShownIn', async () => {
        const about = await mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, { open: true, city: MANIFEST.city, locale: 'de' });

        expect(shadowQuery(about, 'h3').getAttribute('lang')).toBe('en');
        expect(shadowText(about)).toContain(translate('de', 'content.fallback', { language: 'English' }));
    });

    it('badPath_aCitysOwnLanguageNeedsNoNote', async () => {
        const about = await mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, { open: true, city: MANIFEST.city, locale: 'ro' });

        expect(shadowQuery(about, 'h3').getAttribute('lang')).toBe('ro');
        expect(about.shadowRoot?.querySelector('.fallback-note')).toBeNull();
    });
});

describe('a photo in a language its texts lack', () => {
    it('happyPath_theDescriptionNamesItsLanguageAndANoteSaysSo', async () => {
        // Its title has English, its description only Romanian.
        const photo = MANIFEST.photos.find((candidate) => candidate.id === 'mihai-voda-1978');
        const sheet = await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photos: MANIFEST.photos,
            photo: photo ?? null,
            open: true,
            mode: 'docked',
            locale: 'pl',
        });

        expect(sheet.shadowRoot?.querySelector('.details p[lang]')?.getAttribute('lang')).toBe('ro');
        expect(shadowText(sheet)).toContain(translate('pl', 'content.fallback', { language: 'English' }));
    });
});

describe('counted texts and the basemap', () => {
    it.each([
        ['pl', 5, 'photos.count.many'],
        ['pl', 3, 'photos.count.few'],
        ['ar', 2, 'photos.count.two'],
        ['ar', 0, 'photos.count.zero'],
        ['de', 1, 'photos.count.one'],
    ] as const)('happyPath_%s_%i_photosUseTheirPluralForm', (locale, count, key) => {
        expect(photoCountText(count, locale)).toBe(translate(locale, key, { count: String(count) }));
    });

    it('happyPath_theBasemapsLabelsFollowTheLanguageSimplifiedChineseByItsScript', () => {
        expect(['de', 'ar', 'ro', 'zh'].map((locale) => mapboxLanguage(locale as 'de'))).toEqual(['de', 'ar', 'ro', 'zh-Hans']);
    });
});
