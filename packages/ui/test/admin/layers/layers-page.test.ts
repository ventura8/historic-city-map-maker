import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { LayersIntentsPort, LayersViewState } from '../../../src/admin/layers/layers-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { LOADING, nth, ready } from '../ops/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { draftOf, editorOf, layerDoc, layerItem, layersState, page } from './fixtures.js';

function area(state: LayersViewState = layersState()): FakeArea<LayersViewState, LayersIntentsPort> {
    return new FakeArea<LayersViewState, LayersIntentsPort>(state, {
        save: Promise.resolve({ ok: true }),
        move: Promise.resolve(null),
        moveTo: Promise.resolve(null),
        confirmDelete: Promise.resolve(true),
        submitLink: Promise.resolve('planul-1911'),
    });
}

function calls(store: FakeArea<LayersViewState, LayersIntentsPort>): readonly string[] {
    // `open` and `attachMap` (the page's map hands its box over as it renders) are the page's own, not the admin's.
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

describe('<hcm-layers-page> list', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theLayersTopFirstWithTheirStateAndMoveButtons', async () => {
        const layers = area();
        const { element } = await page('layers', layers);

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/layers/plan', '#/layers/corona']);
        expect(rows[0]?.textContent).toContain('1911 · Processing · Not published · Linked');
        expect(rows[1]?.textContent).toContain('Corona 1968 (EN)');
        expect(deepText(element)).toContain('Choose a layer to edit it.');
        expect(layers.named('open')).toEqual(['open []']);
        expect(await axeViolations(element)).toEqual([]);
    });

    // M18 item 6 (docs/research/M18-improvements.md): the viewer's Places are the place categories, edited in Settings.
    it('happyPath_theHeadPointsToThePlaceCategories', async () => {
        const { element } = await page('layers', area());

        const link = deep(element, '.places a');
        expect(link.getAttribute('href')).toBe('#/settings/categories');
        expect(link.textContent).toBe('Place categories');
    });

    it('happyPath_equalOrdersFallBackToTheNewestYearThenTheId', async () => {
        const items = [layerItem({ id: 'b' }), layerItem({ id: 'a' }), layerItem({ id: 'c', year: 1970 })];
        const { element } = await page('layers', area(layersState({ list: ready(items) })));

        expect(deepAll(element, 'a.row').map((row) => row.getAttribute('href'))).toEqual(['#/layers/c', '#/layers/a', '#/layers/b']);
    });

    it('happyPath_moveUpDownAndLinkCallTheirIntents', async () => {
        const layers = area();
        const { element } = await page('layers', layers);

        deep(nth(deepAll(element, '.reorder-row'), 1), 'hcm-icon-button').click();
        nth(deepAll(nth(deepAll(element, '.reorder-row'), 0), 'hcm-icon-button'), 1).click();
        deep(deep(deep(element, '.list-head'), 'hcm-button'), 'button').click();

        expect(calls(layers)).toEqual(['move "corona" "up"', 'move "plan" "down"', 'openLink']);
    });

    it('happyPath_aDragByTheHandleMovesTheRow', async () => {
        const layers = area();
        const { element } = await page('layers', layers);
        const rows = deepAll(element, '.reorder-row');
        const handle = deep(nth(rows, 1), '.handle');
        const top = nth(rows, 0).getBoundingClientRect();
        handle.setPointerCapture = () => undefined;

        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientY: 500 }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: top.top + 2 }));
        expect(nth(rows, 0).hasAttribute('data-drop')).toBe(true);
        expect(nth(rows, 1).hasAttribute('data-dragging')).toBe(true);
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientY: top.top + 2 }));

        expect(calls(layers)).toEqual(['moveTo "corona" 0']);
        expect(deepAll(element, '[data-drop], [data-dragging]')).toHaveLength(0);
    });

    it('badPath_aCancelledDragOrAPointerWithoutADragMovesNothing', async () => {
        const layers = area();
        const { element } = await page('layers', layers);
        const handle = deep(nth(deepAll(element, '.reorder-row'), 0), '.handle');

        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: 10 }));
        handle.setPointerCapture = () => undefined;
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientY: 10 }));
        handle.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));

        expect(calls(layers)).toEqual([]);
    });

    it('badPath_noLayersYetLoadingAnErrorAndNoStore', async () => {
        const layers = area(layersState({ list: ready([]) }));
        const { element } = await page('layers', layers, { locale: 'ro' });
        expect(deepText(element)).toContain(
            'Straturile istorice vin din Imagini istorice: importă acolo o scenă USGS sau încarcă un GeoTIFF.',
        );

        layers.set({ list: LOADING });
        await updated(element);
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(1);

        layers.set({ list: { ...LOADING, status: 'error', failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        deep(deep(element, '.pane'), 'hcm-button').click();
        expect(calls(layers)).toEqual(['retry']);

        const { element: empty } = await page('layers', null);
        expect(empty.shadowRoot?.children).toHaveLength(0);
    });
});

describe('<hcm-layers-page> editor', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theEditorsFieldsSlidersAndSave', async () => {
        const layers = area(layersState({ editor: editorOf(layerDoc(), { draft: draftOf(layerDoc(), { dirty: ['opacity'] }) }) }));
        const { element } = await page('layers', layers, { params: ['corona'] });

        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('Corona 1968 (EN)');
        expect((deep(element, '#layer-label-ro') as HTMLInputElement).value).toBe('Corona 1968');
        expect(deepText(element)).toContain('Unsaved changes');
        await userEvent.type(deep(element, '#layer-year'), '9');
        deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button').click();
        deep(deep(element, '.group:nth-of-type(3) .actions'), 'hcm-button').click();

        expect(calls(layers)).toEqual(['setField "year" "19689"', 'save', 'resetAdjustments']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([800, 1600, 2560])('happyPath_onA %d px window the Romanian and English texts stay side by side', async (width) => {
        // The visual audit of 2026-10-18: a wide pane's auto-fit grid put the Romanian description beside both names.
        const layers = area(layersState({ editor: editorOf(layerDoc()) }));
        const { element } = await page('layers', layers, { params: ['corona'], width });
        const left = (id: string): number => deep(element, `#layer-${id}`).getBoundingClientRect().left;
        const top = (id: string): number => deep(element, `#layer-${id}`).getBoundingClientRect().top;

        expect(left('description-ro')).toBe(left('label-ro'));
        expect(left('description-en')).toBe(left('label-en'));
        expect(top('label-en')).toBe(top('label-ro'));
        expect(top('description-en')).toBe(top('description-ro'));
    });

    it('happyPath_switchesEditTheirFields', async () => {
        const layers = area(layersState({ editor: editorOf() }));
        const { element } = await page('layers', layers, { params: ['corona'] });

        const switches = deepAll(element, 'hcm-switch');
        nth(switches, 0).dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true }, bubbles: true, composed: true }));
        nth(switches, 1).dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false }, bubbles: true, composed: true }));

        expect(calls(layers)).toEqual(['edit {"defaultVisible":true}', 'edit {"published":false}']);
    });

    it('badPath_issuesAreSaidAtTheirFieldsAndANotReadyLayerIsExplained', async () => {
        const issues = [
            { path: 'year', code: 'validation.type' },
            { path: 'published', code: 'validation.value' },
        ] as const;
        const layers = area(
            layersState({
                editor: editorOf(layerDoc({ status: 'processing' }), { draft: draftOf(layerDoc({ status: 'processing' }), { issues }) }),
            }),
        );
        const { element } = await page('layers', layers, { params: ['corona'], locale: 'ro' });

        const year = deep(element, '#layer-year');
        expect(year.getAttribute('aria-invalid')).toBe('true');
        // A year that is not a number says how to write it (finding 37 of 2026-11-01).
        expect(deep(element, `#${String(year.getAttribute('aria-describedby'))}`).textContent).toBe('Scrie anul ca număr, de exemplu 1966');
        expect(deepText(element)).toContain('Stratul poate fi publicat după ce dalele lui sunt gata.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aConflictOffersBothChoicesAndAGoneLayerCannotBeDeleted', async () => {
        const conflict = { by: 'other', at: '2026-10-02T08:00:00.000Z', fields: ['opacity'] };
        const layers = area(
            layersState({ editor: editorOf(layerDoc(), { draft: draftOf(layerDoc(), { conflict, dirty: ['opacity'] }) }) }),
        );
        const { element } = await page('layers', layers, { params: ['corona'] });

        const buttons = deepAll(deep(element, '.alert'), 'hcm-button');
        deep(nth(buttons, 0), 'button').click();
        deep(nth(buttons, 1), 'button').click();
        expect(calls(layers)).toEqual(['keepMine', 'takeTheirs']);
        expect((deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button') as HTMLButtonElement).disabled).toBe(true);

        layers.set({ editor: editorOf(layerDoc(), { draft: draftOf(layerDoc(), { gone: true }) }) });
        await updated(element);
        expect(deepText(element)).toContain('The layer was deleted meanwhile. You can restore it from History.');
        expect(deepAll(element, 'hcm-confirm-dialog')).toHaveLength(0);
    });

    it('badPath_notFoundLoadingAndAFailedListener', async () => {
        const layers = area(layersState({ editor: editorOf(layerDoc(), { notFound: true }) }));
        const { element } = await page('layers', layers, { params: ['gone'] });
        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('This layer does not exist.');
        expect(deep(element, '.pane a').getAttribute('href')).toBe('#/layers');

        layers.set({ editor: editorOf(layerDoc(), { draft: { ...draftOf(layerDoc()), value: null } }) });
        await updated(element);
        expect(deepAll(element, '[slot="detail"] hcm-loading-indicator')).toHaveLength(1);

        layers.set({
            editor: editorOf(layerDoc(), {
                doc: { status: 'error', reconnecting: false, failure: { kind: 'denied', code: 'permission-denied' } },
            }),
        });
        await updated(element);
        deep(deep(element, '[slot="detail"]'), 'hcm-button').click();
        expect(calls(layers)).toEqual(['retry']);
    });

    it('happyPath_deleteAsksFirstAndGoesBackToTheList', async () => {
        const layers = area(layersState({ editor: editorOf() }));
        const { app, element } = await page('layers', layers, { params: ['corona'] });

        deep(deep(element, '.pane > .actions'), 'hcm-button').click();
        layers.set({ deletion: { phase: 'confirm', id: 'corona', label: 'Corona 1968', graceDays: 7 } });
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; body: string; headline: string };
        expect(dialog.open).toBe(true);
        // M18 item 5: a published image is deleted with the same question as at every other stage.
        expect(dialog.headline).toMatch(/^Delete this image\? \(“Corona 1968/);
        expect(dialog.body).toContain('Its Mapbox tileset is deleted after 7 days unless you restore it.');
        dialog.dispatchEvent(new CustomEvent('hcm-confirm'));
        await updated(element);
        await updated(element);

        expect(calls(layers)).toEqual(['askDelete', 'confirmDelete']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"layers","params":[]}']);
        dialog.dispatchEvent(new CustomEvent('hcm-cancel'));
        expect(calls(layers).at(-1)).toBe('cancelDelete');
    });

    it('happyPath_aLinkedLayerSaysItsTilesetStays', async () => {
        const layers = area(
            layersState({
                editor: editorOf(layerDoc({ mapbox: undefined })),
                deletion: { phase: 'confirm', id: 'corona', label: 'Corona', graceDays: 7 },
            }),
        );
        const { element } = await page('layers', layers, { params: ['corona'] });

        expect((deep(element, 'hcm-confirm-dialog') as HTMLElement & { body: string }).body).toContain(
            'The linked tileset stays in the Mapbox account.',
        );
        layers.set({ deletion: { phase: 'running', id: 'corona', label: 'Corona', graceDays: 7 } });
        await updated(element);
        expect(deepText(element)).toContain('Deleting…');
    });
});

describe('<hcm-layers-page> deleting a layer on its own tiles (M12)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aLayerOnItsOwnTilesSaysItsArchivesGoNotThatATilesetStays', async () => {
        const own = layerDoc({
            mapbox: undefined,
            source: { type: 'pmtiles', url: 'https://storage.googleapis.com/b/tiles/c/corona/v.pmtiles' },
            currentVersion: 'v',
        });
        const layers = area(
            layersState({ editor: editorOf(own), deletion: { phase: 'confirm', id: 'corona', label: 'Corona', graceDays: 7 } }),
        );
        const { element } = await page('layers', layers, { params: ['corona'] });

        const body = (deep(element, 'hcm-confirm-dialog') as HTMLElement & { body: string }).body;
        expect(body).toContain('Its tiles in your public bucket are deleted after 7 days unless you restore it.');
        expect(body).not.toContain('Mapbox');
    });
});

describe('<hcm-layers-page> editor: dates and extra-large pages', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theExactDateReadsInTheAdminsLanguageAndIsStoredAsAnIsoDate', async () => {
        const layer = layerDoc({ date: '1968-08-24' });
        const layers = area(layersState({ editor: editorOf(layer) }));
        const { element } = await page('layers', layers, { params: ['corona'], locale: 'ro' });
        const date = deep(element, '#layer-date') as HTMLInputElement;

        // Never the browser's date input, whose pattern follows the browser's language (mm/dd/yyyy in an American one).
        expect(date.type).toBe('text');
        expect(date.value).toBe('24.08.1968');
        expect(date.placeholder).toBe('zz.ll.aaaa');
        expect(deepText(element)).toContain('Scrie data ca zz.ll.aaaa.');
        await userEvent.clear(date);
        await userEvent.type(date, '25.08.1968');

        expect(calls(layers).at(-1)).toBe('setField "date" "1968-08-25"');
        expect(calls(layers)).toContain('setField "date" "25.08.196"');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        [1300, false],
        [2560, true],
    ])('happyPath_onA %d px page the map sits beside the groups: %s', async (width, beside) => {
        const layers = area(layersState({ editor: editorOf(layerDoc()), map: 'ready' }));
        const { element } = await page('layers', layers, { params: ['corona'], width });
        const map = deep(element, 'hcm-admin-map').getBoundingClientRect();
        const label = deep(element, '#layer-label-ro').getBoundingClientRect();

        expect(map.left >= label.right).toBe(beside);
        expect(map.bottom <= label.top).toBe(!beside);
    });
});

describe('<hcm-layers-page> editor sliders', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_slidersSendTheirValuesAndAnnounceOnRelease', async () => {
        const layers = area(layersState({ editor: editorOf(layerDoc({ adjustments: { contrast: 0.2 } })) }));
        const { element } = await page('layers', layers, { params: ['corona'] });
        const sliders = deepAll(element, 'hcm-slider');

        expect(sliders.map((slider) => slider.getAttribute('value-text'))).toEqual(['80 %', '0 %', '0 %', '+20 %', '0 %']);
        nth(sliders, 0).dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 40 }, bubbles: true, composed: true }));
        nth(sliders, 3).dispatchEvent(new CustomEvent('hcm-input', { detail: { value: 30 }, bubbles: true, composed: true }));
        nth(sliders, 3).dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 35 }, bubbles: true, composed: true }));
        await updated(element);

        expect(calls(layers)).toEqual(['setOpacity 40', 'setAdjustment "contrast" 30', 'setAdjustment "contrast" 35']);
        expect(deep(element, '.visually-hidden[role="status"]').textContent).toBe('Contrast: +35 %');
    });

    it('badPath_aSliderMoveTheStoreClampsIsPutBackAndSaidAsKept', async () => {
        const kept = editorOf(layerDoc({ adjustments: { brightnessMin: 0.5 } }));
        const layers = area(layersState({ editor: kept }));
        const { element } = await page('layers', layers, { params: ['corona'] });
        const white = nth(deepAll(element, 'hcm-slider'), 2) as HTMLElement & { value: number };
        const handle = deep(white, '[role="slider"]');

        handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, composed: true }));
        expect(white.value).toBe(0);
        layers.set({ editor: editorOf(layerDoc({ adjustments: { brightnessMin: 0.5, brightnessMax: 0.5 } })) });
        await updated(element);
        expect(white.value).toBe(50);
        white.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 0 }, bubbles: true, composed: true }));
        await updated(element);

        expect(calls(layers)).toEqual(['setAdjustment "brightnessMax" 0', 'setAdjustment "brightnessMax" 0']);
        expect(deep(element, '.visually-hidden[role="status"]').textContent).toBe('White level: -50 %');
    });
});

describe('<hcm-layers-page> link dialog', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    const LINK = {
        form: { address: 'anotheraccount.plan', tileSize: 256, labelRo: '', labelEn: '', year: '', kind: 'map', attribution: '' },
        issues: [{ path: 'label.ro', code: 'validation.tooSmall' }],
        refusal: { code: 'apiError.layers.foreignTileset', params: { owner: 'anotheraccount' } },
        origins: ['https://tiles.example.test'],
        tried: true,
        sending: false,
        probe: { status: 'idle' },
    } as const;

    it('happyPath_theFormItsRefusalAndTheOriginsToAllow', async () => {
        const layers = area(layersState({ link: LINK }));
        const { app, element } = await page('layers', layers);

        const text = deepText(element);
        expect(text).toContain('The tileset belongs to the Mapbox account “anotheraccount”.');
        expect(text).toContain('Tiles from https://tiles.example.test do not show on the public map yet');
        expect(deep(element, '#link-label-ro, #link-labelRo').getAttribute('aria-invalid')).toBe('true');
        await userEvent.type(deep(element, '#link-labelRo'), 'P');
        (deep(element, '#link-kind') as HTMLSelectElement).value = 'aerial';
        deep(element, '#link-kind').dispatchEvent(new Event('change'));
        (deep(element, '#link-size') as HTMLSelectElement).value = '512';
        deep(element, '#link-size').dispatchEvent(new Event('change'));
        const buttons = deepAll(element, 'hcm-dialog > hcm-button');
        deep(nth(buttons, 1), 'button').click();
        await updated(element);
        await updated(element);

        expect(calls(layers)).toEqual([
            'editLink {"labelRo":"P"}',
            'editLink {"kind":"aerial"}',
            'editLink {"tileSize":512}',
            'submitLink',
        ]);
        expect(app.named('navigate')).toEqual(['navigate {"id":"layers","params":["planul-1911"]}']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_cancelOrEscClosesTheDialog', async () => {
        const layers = area(layersState({ link: { ...LINK, refusal: null, origins: [] } }));
        const { element } = await page('layers', layers);

        deep(nth(deepAll(element, 'hcm-dialog > hcm-button'), 0), 'button').click();
        deep(element, 'hcm-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'cancel' } }));
        (deep(element, '#link-size') as HTMLSelectElement).value = '256';
        deep(element, '#link-size').dispatchEvent(new Event('change'));

        expect(calls(layers)).toEqual(['closeLink', 'closeLink', 'editLink {"tileSize":256}']);
    });

    it('badPath_aRefusedLinkStaysAndTheDialogsCloseEventClosesIt', async () => {
        const layers = new FakeArea<LayersViewState, LayersIntentsPort>(layersState({ link: { ...LINK, sending: true } }), {
            submitLink: Promise.resolve(null),
        });
        const { app, element } = await page('layers', layers);

        expect(deepText(element)).toContain('Linking…');
        deep(nth(deepAll(element, 'hcm-dialog > hcm-button'), 1), 'button').click();
        await updated(element);
        deep(element, 'hcm-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'close' } }));

        expect(calls(layers)).toEqual(['submitLink', 'closeLink']);
        expect(app.named('navigate')).toEqual([]);
    });
});

describe('<hcm-layers-page> link dialog: Check (M3)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    const READY = {
        form: {
            address: 'https://tiles.example.test/{z}/{x}/{y}.png',
            tileSize: 256,
            labelRo: 'Plan',
            labelEn: '',
            year: '1911',
            kind: 'map',
            attribution: '',
        },
        issues: [],
        refusal: null,
        origins: ['https://tiles.example.test'],
        tried: false,
        sending: false,
    } as const;

    function linkButton(element: HTMLElement): HTMLElement & { disabled: boolean } {
        return nth(deepAll(element, 'hcm-dialog > hcm-button'), 1) as HTMLElement & { disabled: boolean };
    }

    it('happyPath_checkAsksOneTileAndSaysWhatAnswered', async () => {
        const layers = area(layersState({ link: { ...READY, probe: { status: 'idle' } } }));
        const { element } = await page('layers', layers);

        deep(deep(deep(element, '.dialog-body'), '.actions hcm-button'), 'button').click();
        layers.set({ link: { ...READY, probe: { status: 'checking' } } });
        await updated(element);
        const checking = [
            deepText(element),
            (deep(deep(element, '.dialog-body'), '.actions hcm-button') as HTMLElement & { disabled: boolean }).disabled,
        ];
        layers.set({ link: { ...READY, probe: { status: 'ok', contentType: 'image/png' } } });
        await updated(element);

        expect(calls(layers)).toEqual(['checkLink']);
        expect(checking).toEqual([expect.stringContaining('Asking for one tile…'), true]);
        expect(deep(element, '[data-probe="ok"]').textContent).toContain('The tiles answer.');
        expect(linkButton(element).disabled).toBe(false);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aSourceWithoutTilesKeepsLinkOff', async () => {
        const failed = { status: 'failed', refusal: { code: 'apiError.imagery.tilesNotFound' } } as const;
        const layers = area(layersState({ link: { ...READY, probe: failed } }));
        const { element } = await page('layers', layers);

        expect(deep(element, '[data-probe="failed"]').getAttribute('role')).toBe('alert');
        expect(deep(element, '[data-probe="failed"]').textContent).toContain(
            'The source has no map pieces at this address. Check the address copied from the source.',
        );
        expect(linkButton(element).disabled).toBe(true);
    });
});

describe('<hcm-layers-page> focus and navigation', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aSaveThatDisablesTheFocusedButtonMovesTheFocusToTheHeading', async () => {
        const dirty = editorOf(layerDoc(), { draft: draftOf(layerDoc(), { dirty: ['opacity'] }) });
        const layers = area(layersState({ editor: dirty, list: ready([layerItem()], { hasMore: true }) }));
        const { app, element } = await page('layers', layers, { params: ['corona'] });
        const save = deep(nth(deepAll(element, '.save-bar hcm-button'), 1), 'button');
        save.focus();

        layers.set({ editor: editorOf() });
        await updated(element);

        expect(element.shadowRoot?.activeElement?.matches('h2[data-detail-heading]')).toBe(true);
        deep(deep(element, '.more'), 'button').click();
        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
        expect(app.named('navigate')).toEqual(['navigate {"id":"layers","params":[]}']);
    });

    it('happyPath_theEditorsMapHandsItsHostAndZoomToTheStore', async () => {
        const layers = area(layersState({ editor: editorOf(), map: 'ready' }));
        const { element } = await page('layers', layers, { params: ['corona'] });
        const map = deep(element, 'hcm-admin-map');

        map.dispatchEvent(new CustomEvent('hcm-map-host', { detail: { container: document.createElement('div') } }));
        map.dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: 1 } }));

        expect(calls(layers)).toEqual(['zoomBy 1']);
        expect(layers.named('attachMap')).toEqual(['attachMap {}', 'attachMap {}']);
        expect(deepAll(map, 'hcm-icon-button')).toHaveLength(2);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-layers-page> editor: a conflict and a revoked admin', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theConflictNamesWhoSavedAndWhenAndTheFieldsByName', async () => {
        const conflict = { by: 'other', at: '2026-10-02T08:00:00.000Z', fields: ['opacity', 'defaultVisible'] };
        const layers = area(
            layersState({ editor: editorOf(layerDoc(), { draft: draftOf(layerDoc(), { conflict, dirty: ['opacity'] }) }) }),
        );
        const { app, element } = await page('layers', layers, { params: ['corona'] });
        app.set({ people: { other: 'Ana Pop' } });
        (element as HTMLElement & { state: unknown }).state = app.state;
        await updated(element);

        expect(deepText(deep(element, '.alert'))).toContain('Saved by Ana Pop on');
        expect(deepText(deep(element, '.alert'))).toContain('Opacity, Shown at start');
    });

    it('badPath_aRevokedAdminsLayerIsReadOnly', async () => {
        const layers = area(layersState({ editor: editorOf(layerDoc(), { draft: draftOf(layerDoc(), { dirty: ['opacity'] }) }) }));
        const { element } = await page('layers', layers, { params: ['corona'], revoked: true });
        const off = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;

        expect(element.hasAttribute('read-only')).toBe(true);
        expect(deepText(element)).toContain('Read only: your access was removed.');
        expect(deepAll(element, '.save-bar hcm-button').map(off)).toEqual([true, true]);
        const fields = deepAll(deep(element, '[slot="detail"]'), 'input, textarea');
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.every((field) => (field as HTMLInputElement).readOnly)).toBe(true);
        expect(deepAll(element, 'hcm-switch, hcm-slider').every(off)).toBe(true);
        expect(deepAll(element, '.group hcm-button, .pane > .actions hcm-button').every(off)).toBe(true);
        expect(off(deep(deep(element, '.list-head'), 'hcm-button'))).toBe(true);
        expect(deepAll(element, '.reorder-row .moves, .reorder-row .handle')).toEqual([]);
        expect(deepAll(element, '.reorder-row a.row')).toHaveLength(2);
    });
});
