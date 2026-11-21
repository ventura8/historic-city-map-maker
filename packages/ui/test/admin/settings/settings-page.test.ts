import { translate, type CityDoc } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';
import { FakeArea } from '../editing/fake-area.js';
import { cityDoc, draftOf, page, settingsState } from '../layers/fixtures.js';
import { nth } from '../ops/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';

function area(state: SettingsViewState = settingsState()): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, {
        saveSection: Promise.resolve({ ok: true }),
        saveOverlays: Promise.resolve({ ok: true }),
    });
}

function calls(store: FakeArea<SettingsViewState, SettingsIntentsPort>): readonly string[] {
    // `open` and `attachMap` (the page's map hands its box over as it renders) are the page's own, not the admin's.
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

/** The settings state with section `section` open over `city` (dirty fields, issues and the rest overridable). */
function sectionState(
    section: 'area' | 'texts' | 'theme',
    city: CityDoc = cityDoc(),
    more: Partial<SettingsViewState['citySection']> = {},
): SettingsViewState {
    const base = settingsState();
    return { ...base, section, citySection: { ...base.citySection, section, draft: draftOf(city), ...more } };
}

describe('<hcm-settings-page> sections', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theSectionsAreListedWithTheirHints', async () => {
        const settings = area();
        const { element } = await page('settings', settings);

        expect(deepAll(element, 'a.section-row').map((row) => row.getAttribute('href'))).toEqual([
            '#/settings/area',
            '#/settings/texts',
            '#/settings/theme',
            '#/settings/icon',
            '#/settings/imagery',
            '#/settings/categories',
            '#/settings/overlays',
            '#/settings/publish',
            '#/settings/budget',
            '#/settings/export',
            // M28 (@S-A180-HAPPY-SETTINGS-ROW): the sources are changed in Setup's Sources step.
            '#/setup/sources',
        ]);
        expect(deepText(element)).toContain('Which old images, places and photos the map uses');
        expect(deepText(element)).toContain('Name, About, privacy, credits');
        expect(deepText(element)).toContain('Whether visitors see the city');
        expect(deepText(element)).toContain('Choose a section.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_loadingAnErrorAndACityThatDoesNotExistYet', async () => {
        const base = sectionState('area');
        const settings = area({ ...base, city: { ...base.city, status: 'loading' } });
        const { element } = await page('settings', settings, { params: ['area'], locale: 'ro' });
        expect(deepAll(element, '[slot="detail"] hcm-loading-indicator')).toHaveLength(1);

        settings.set({ city: { ...base.city, status: 'error', failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        deep(deep(element, '[slot="detail"]'), 'hcm-button').click();
        expect(calls(settings)).toEqual(['retry']);

        settings.set({ city: { ...base.city, doc: null } });
        await updated(element);
        expect(deepText(element)).toContain('Orașul nu există încă. Pornește din Configurare.');
    });
});

describe('<hcm-settings-page> area', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theEdgesAndTheStartViewAreNumberFields', async () => {
        const city = cityDoc({ zoom: undefined });
        const settings = area(sectionState('area', city, { draft: draftOf(city, { dirty: ['bounds'] }) }));
        const { element } = await page('settings', settings, { params: ['area'] });

        expect((deep(element, '#area-west') as HTMLInputElement).value).toBe('25.9');
        expect((deep(element, '#area-zoom') as HTMLInputElement).value).toBe('');
        await userEvent.type(deep(element, '#area-north'), '5');
        await userEvent.type(deep(element, '#area-minZoom'), '9');
        deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button').click();
        deep(nth(deepAll(element, '.save-bar hcm-button'), 0), 'button').click();

        expect(calls(settings)).toEqual(['setNumber "north" "44.65"', 'setNumber "minZoom" "9"', 'saveSection', 'discardSection']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_zeroAreaBoundsAndContentLeftOutAreSaid', async () => {
        const city = cityDoc({ bounds: { west: 26, south: 44.3, east: 26, north: 44.6 } });
        const outside = [
            { kind: 'photo', id: 'p1', title: 'Colț' },
            { kind: 'poi', id: 'l1', title: 'Loc' },
        ] as const;
        const settings = area(
            sectionState('area', city, {
                draft: draftOf(city, { issues: [{ path: 'bounds', code: 'validation.bounds' }], dirty: ['bounds'] }),
                outside,
                checking: true,
            }),
        );
        const { element } = await page('settings', settings, { params: ['area'] });

        expect(deep(element, '#area-west').getAttribute('aria-invalid')).toBe('true');
        // The four edges are refused together: said once below them, each edge invalid and described by that message.
        expect(deepAll(element, '.shared-error').map((node) => [node.id, node.textContent])).toEqual([
            ['area-bounds-error', translate('en', 'validation.bounds')],
        ]);
        expect(deepAll(element, '.field .error')).toEqual([]);
        expect(['west', 'east', 'south', 'north'].map((name) => deep(element, `#area-${name}`).getAttribute('aria-describedby'))).toEqual(
            Array.from({ length: 4 }, () => 'area-bounds-error'),
        );
        expect(deepAll(element, '.alert a').map((link) => [link.getAttribute('href'), link.textContent])).toEqual([
            ['#/photos/p1', 'Photo “Colț”'],
            ['#/pois/l1', 'Place “Loc”'],
        ]);
        expect(deepText(element)).toContain('Checking the photos and places…');
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-settings-page> the map', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theAreaDrawsItsRectangleAndTakesTheMapsViewOnceTheMapIsReady', async () => {
        const settings = area({ ...sectionState('area'), map: { status: 'ready', drawing: null } });
        const { element } = await page('settings', settings, { params: ['area'] });
        const box = deep(element, 'hcm-admin-map');

        deep(deep(element, 'hcm-button.draw-area'), 'button').click();
        deep(deep(element, 'hcm-button.use-view'), 'button').click();
        box.dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: 1 } }));
        settings.set({ map: { status: 'ready', drawing: 'second' } });
        await updated(element);

        expect(calls(settings)).toEqual(['drawBounds', 'useMapView', 'zoomBy 1']);
        expect(settings.named('attachMap')).toHaveLength(1);
        expect(deep(element, 'hcm-button.draw-area').textContent.trim()).toBe('Stop drawing');
        expect(deep(deep(element, 'hcm-button.draw-area'), 'button').getAttribute('aria-pressed')).toBe('true');
        expect(deepText(element)).toContain('Now click the opposite corner.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAReadyMapTheToolsWaitAndTheOtherSectionsShowNoMap', async () => {
        const settings = area({ ...sectionState('area'), map: { status: 'loading', drawing: null } });
        const { element } = await page('settings', settings, { params: ['area'] });
        const off = (selector: string): boolean => (deep(element, selector) as HTMLElement & { disabled: boolean }).disabled;

        expect([off('hcm-button.draw-area'), off('hcm-button.use-view')]).toEqual([true, true]);
        settings.set({ ...sectionState('texts') });
        await updated(element);
        expect(deepAll(element, 'hcm-admin-map')).toEqual([]);
    });
});

describe('<hcm-settings-page> an edge of its own', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_anEdgeThatIsNoNumberIsSaidAtThatEdgeOnly', async () => {
        const city = cityDoc();
        const issues = [
            { path: 'bounds.west', code: 'validation.type' },
            { path: 'bounds', code: 'validation.bounds' },
        ] as const;
        const settings = area(sectionState('area', city, { draft: draftOf(city, { issues, dirty: ['bounds'] }) }));
        const { element } = await page('settings', settings, { params: ['area'] });

        expect(deep(element, '#area-west').getAttribute('aria-describedby')).toBe('area-west-error');
        expect(deep(element, '#area-east').getAttribute('aria-describedby')).toBe('area-bounds-error');
        expect(deepAll(element, '.field .error').map((node) => node.id)).toEqual(['area-west-error']);
        expect(deepAll(element, '.shared-error')).toHaveLength(1);
    });
});

describe('<hcm-settings-page> texts', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theNamesAboutWithItsPreviewAndTheCredits', async () => {
        const city = cityDoc({
            about: { ro: 'Despre **oraș** <b>nu</b>' },
            credits: [{ label: { ro: 'Arhiva', en: 'Archive' }, url: 'https://arhiva.example' }, { label: { ro: 'B', en: 'B' } }],
        });
        const settings = area(sectionState('texts', city));
        const { element } = await page('settings', settings, { params: ['texts'] });

        const preview = deep(element, 'figure.preview');
        expect(deepAll(preview, 'strong').map((node) => node.textContent)).toEqual(['oraș']);
        expect(deepAll(preview, 'b')).toHaveLength(0);
        expect(preview.textContent).toContain('<b>nu</b>');
        await userEvent.type(deep(element, '#name-en'), '!');
        await userEvent.type(deep(element, '#about-en'), 'A');
        await userEvent.type(deep(element, '#credit-1-url'), '/');
        const actions = deepAll(nth(deepAll(element, '.credit'), 1), 'hcm-icon-button');
        for (const button of actions) {
            button.click();
        }
        deep(deep(element, '.credits + .actions'), 'button').click();

        expect(calls(settings)).toEqual([
            'setText "name" "en" "Bucharest!"',
            'setText "about" "en" "A"',
            'editCredit 0 "url" "https://arhiva.example/"',
            'moveCredit 1 -1',
            'moveCredit 1 1',
            'removeCredit 1',
            'addCredit',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_linksThatAreNotHttpsAreNamedAndTheFiftiethCreditIsTheLast', async () => {
        const credits = Array.from({ length: 50 }, (_x, index) => ({ label: { ro: `R${String(index)}`, en: `E${String(index)}` } }));
        const city = cityDoc({ privacy: { ro: '[x](http://bad.example)' }, credits });
        const settings = area(sectionState('texts', city, { linkLines: { about: { ro: [], en: [] }, privacy: { ro: [1], en: [] } } }));
        const { element } = await page('settings', settings, { params: ['texts'], locale: 'ro' });

        expect(deepText(element)).toContain('Linkurile care nu sunt https trebuie corectate (rândurile 1).');
        expect(deepText(element)).toContain('Cel mult 50 mulțumiri.');
    });
});

describe('<hcm-settings-page> theme', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aPresetPreviewsTheThemeAndTheBasemapIsChosen', async () => {
        const city = cityDoc({ theme: { seedColor: '#8B5E3C', tokens: BASELINE_THEME } });
        const settings = area(sectionState('theme', city));
        const { element } = await page('settings', settings, { params: ['theme'] });
        const preview = { ...BASELINE_THEME, light: { ...BASELINE_THEME.light, '--md-sys-color-primary': '#00658f' } };
        const primary = (): string => getComputedStyle(element).getPropertyValue('--md-sys-color-primary').trim();

        const presets = deepAll(element, '.preset');
        expect(presets.map((preset) => preset.getAttribute('aria-pressed'))).toEqual([
            'true',
            'false',
            'false',
            'false',
            'false',
            'false',
            'false',
            'false',
        ]);
        nth(presets, 5).click();
        await userEvent.type(deep(element, '#seed-hex'), '0');
        nth(deepAll(element, 'input[name="basemap"]'), 1).click();
        settings.set({
            citySection: { ...settings.state.citySection, theme: { typed: '#00658f', invalid: false, adjusted: false, preview } },
        });
        await updated(element);

        expect(calls(settings)).toEqual(['setSeed "#00658f"', 'setSeed "#8b5e3c0"', 'setBasemap "standard-satellite"']);
        expect(deepText(element)).toContain('The whole admin now shows the new theme.');
        // The shell wears the preview for the whole admin (CR-M2c-28): the page sets no theme of its own.
        expect(primary()).not.toBe('#00658f');
        expect(await axeViolations(element)).toEqual([]);
        settings.set({
            citySection: { ...settings.state.citySection, theme: { typed: '', invalid: false, adjusted: false, preview: null } },
        });
        await updated(element);
        expect(deepText(element)).not.toContain('The whole admin now shows the new theme.');
    });

    it('badPath_anInvalidSeedAndAMovedOneAreSaid', async () => {
        const settings = area(
            sectionState('theme', cityDoc({ basemap: { style: 'mapbox://styles/someone/custom' } }), {
                theme: { typed: '#zz', invalid: true, adjusted: false, preview: null },
            }),
        );
        const { element } = await page('settings', settings, { params: ['theme'], locale: 'ro' });

        expect(deep(element, '#seed-hex').getAttribute('aria-invalid')).toBe('true');
        expect(deepText(element)).toContain('Scrie o culoare de forma #8b5e3c.');
        expect(deepText(element)).toContain('Orașul folosește alt stil, care rămâne până alegi unul.');
        settings.set({
            citySection: { ...settings.state.citySection, theme: { typed: '#ffe082', invalid: false, adjusted: true, preview: null } },
        });
        await updated(element);
        expect(deepText(element)).toContain('nuanța apropiată #8b5e3c');
    });
});

describe('<hcm-settings-page> overlays', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theOverlayListPreviewsAndSaves', async () => {
        const rows = [
            { id: 'corona', kind: 'raster', label: { ro: 'Corona' }, visible: false, opacity: 0.8, toggleable: true },
            { id: 'photos', kind: 'photos', label: { ro: 'Fotografii', en: 'Photos' }, visible: true, opacity: 1, toggleable: false },
            {
                id: 'cladiri',
                kind: 'poi',
                label: { ro: 'Clădiri' },
                visible: true,
                opacity: 0.7,
                toggleable: false,
                color: '#8b5e3c',
                icon: 'domain',
            },
        ] as const;
        const settings = area({ ...settingsState(), section: 'overlays', overlays: { rows, changes: 2, saving: false } });
        const { element } = await page('settings', settings, { params: ['overlays'] });

        const list = deep(element, 'hcm-overlay-list');
        expect(deepAll(list, 'hcm-switch')).toHaveLength(1);
        list.dispatchEvent(new CustomEvent('hcm-overlay-opacity', { detail: { id: 'photos', opacity: 0.6, final: true } }));
        list.dispatchEvent(new CustomEvent('hcm-overlay-opacity', { detail: { id: 'unknown', opacity: 0.5, final: true } }));
        list.dispatchEvent(new CustomEvent('hcm-overlay-visibility', { detail: { id: 'corona', visible: true } }));
        const buttons = deepAll(element, '.save-bar hcm-button');
        deep(nth(buttons, 0), 'button').click();
        deep(nth(buttons, 1), 'button').click();

        expect(calls(settings)).toEqual([
            'setOverlayOpacity "photos" "photos" 60',
            'setOverlayOpacity "raster" "unknown" 50',
            'setShownAtStart "corona" true',
            'discardOverlays',
            'saveOverlays',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-settings-page> a revoked admin', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    /** Whether a control is off (a kit element's or a native one's `disabled`). */
    const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;

    it.each(['area', 'texts', 'theme'] as const)(
        'badPath_theSection %s is read-only: fields read-only, nothing writes',
        async (section) => {
            const city = cityDoc({ credits: [{ label: { ro: 'Arhiva', en: 'Archive' } }] });
            const settings = area(sectionState(section, city, { draft: draftOf(city, { dirty: ['zoom'] }) }));
            const { element } = await page('settings', settings, { params: [section], revoked: true });
            const detail = deep(element, '[slot="detail"]');

            expect(deepText(detail)).toContain('Read only: your access was removed.');
            expect(deepAll(detail, '.save-bar hcm-button').map(off)).toEqual([true, true]);
            expect(
                deepAll(detail, 'input:not([type="color"]):not([type="radio"]), textarea').every(
                    (field) => (field as HTMLInputElement).readOnly,
                ),
            ).toBe(true);
            expect(
                deepAll(detail, 'input[type="color"], input[type="radio"], button.preset, hcm-icon-button, .group hcm-button').every(off),
            ).toBe(true);
        },
    );

    it('badPath_theOverlaysAreReadOnly', async () => {
        const rows = [{ id: 'corona', kind: 'raster', label: { ro: 'Corona' }, visible: false, opacity: 0.8, toggleable: true }] as const;
        const settings = area({ ...settingsState(), section: 'overlays', overlays: { rows, changes: 1, saving: false } });
        const { element } = await page('settings', settings, { params: ['overlays'], revoked: true });

        expect((deep(element, 'hcm-overlay-list') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(deepAll(deep(element, 'hcm-overlay-list'), 'hcm-switch, hcm-slider').every(off)).toBe(true);
        expect(deepAll(element, '.save-bar hcm-button').map(off)).toEqual([true, true]);
    });

    it('happyPath_aConflictNamesWhoSavedTheCityAndWhen', async () => {
        const city = cityDoc();
        const conflict = { by: 'owner-uid', at: '2026-10-02T08:00:00.000Z', fields: ['zoom', 'center'] };
        const settings = area(sectionState('area', city, { draft: draftOf(city, { conflict, dirty: ['zoom'] }) }));
        const { element } = await page('settings', settings, { params: ['area'], revoked: true });

        expect(deepText(deep(element, '.alert'))).toContain('Saved by you on');
        expect(deepText(deep(element, '.alert'))).toContain('Start zoom, Start centre');
        expect(deepAll(deep(element, '.alert'), 'hcm-button').every(off)).toBe(true);
    });
});

describe('<hcm-settings-page> edges', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_aConflictInACitySectionOffersBothChoices', async () => {
        const city = cityDoc();
        const conflict = { by: 'other', at: 'v2', fields: ['zoom'] };
        const settings = area(sectionState('area', city, { draft: draftOf(city, { conflict, dirty: ['zoom'] }) }));
        const { element } = await page('settings', settings, { params: ['area'] });

        for (const button of deepAll(deep(element, '.alert'), 'hcm-button')) {
            deep(button, 'button').click();
        }

        expect(calls(settings)).toEqual(['keepMine', 'takeTheirs']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each(['area', 'texts', 'theme'] as const)('badPath_aSectionBeforeItsDraftIsReadShowsItsHeading_%s', async (section) => {
        const base = sectionState(section);
        const settings = area({ ...base, citySection: { ...base.citySection, draft: { ...base.citySection.draft, value: null } } });
        const { element } = await page('settings', settings, { params: [section] });

        expect(deepAll(element, '[slot="detail"] input')).toHaveLength(0);
        expect(deep(element, '[slot="detail"] h2[data-detail-heading]').textContent).not.toBe('');
    });

    it('happyPath_backFromACategoryGoesToTheCategoriesAndFromASectionToTheList', async () => {
        const base = settingsState();
        const settings = area({ ...base, section: 'categories', category: null });
        const { app, element } = await page('settings', settings, { params: ['categories'] });

        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
        expect(app.named('navigate')).toEqual(['navigate {"id":"settings","params":[]}']);

        const handle = deep(nth(deepAll(element, '.reorder-row'), 1), '.handle');
        const top = nth(deepAll(element, '.reorder-row'), 0).getBoundingClientRect();
        handle.setPointerCapture = () => undefined;
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientY: 600 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: top.top + 1 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientY: top.top + 1 }));
        expect(calls(settings)).toEqual(['moveCategoryTo "biserici" 0']);
    });
});
