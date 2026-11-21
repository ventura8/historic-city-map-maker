import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { withDraft } from '../../../src/admin/pois/hcm-poi-list.js';
import { saveFile } from '../../../src/admin/pois/hcm-pois-page.js';
import { categoryName, localized, poiHref, reasonText, refusalText, yearsText } from '../../../src/admin/pois/poi-text.js';
import { bulkAction, cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { area, asked, CATEGORIES, draft, editor, place, poisPage, poisState, ready, route, VALUE } from './fixtures.js';

function press(element: HTMLElement): void {
    deep(element, 'button').click();
}

describe('<hcm-pois-page>: the list', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theListShowsEachPlaceWithItsCategoryYearsAndShape', async () => {
        const store = area();
        const { element } = await poisPage(store);

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/pois/stavropoleos', '#/pois/cismigiu']);
        expect(rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Stavropoleos Church Churches · from 1890 · Point',
            'Cișmigiu Parcuri · until 1900 · Area · Unpublished',
        ]);
        expect(deepText(element)).toContain('Choose a place in the list or on the map, or add one.');
        expect(store.named('open')).toEqual(['open []']);
        expect(store.named('attachMap')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aPlaceStoredWithoutAYearSaysYearMissing', async () => {
        const undated = place({ id: 'undated', title: { ro: 'Hanul cu Tei' }, yearStart: null, yearEnd: null });
        const store = area(poisState({ list: ready([place(), undated]) }));
        const { element } = await poisPage(store);

        const rows = deepAll(element, 'a.row').map((row) => row.textContent.replace(/\s+/g, ' ').trim());
        expect(rows).toEqual(['Stavropoleos Church Churches · from 1890 · Point', 'Hanul cu Tei Churches · Point Year missing']);
        expect(deepAll(element, '.year-missing').map((badge) => badge.textContent)).toEqual(['Year missing']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_filtersSearchAndSelectionGoToTheArea', async () => {
        const store = area();
        const { element } = await poisPage(store);

        const chips = deepAll(element, 'hcm-chip');
        for (const chip of chips) {
            press(chip);
        }
        const search = deep(element, '#search') as HTMLInputElement;
        search.value = 'cis';
        search.dispatchEvent(new Event('input'));
        const box = deep(element, '.check input') as HTMLInputElement;
        box.click();

        expect(asked(store)).toEqual([
            'setFilter {"category":null}',
            'setFilter {"category":"biserici"}',
            'setFilter {"category":"parcuri"}',
            'setFilter {"unpublished":true}',
            'setFilter {"search":"cis"}',
            'toggleSelected "stavropoleos"',
        ]);
    });

    it('happyPath_theFilterAndTheSearchShowOnlyTheirPlaces', async () => {
        const store = area(poisState({ filter: { category: null, unpublished: true, search: '' } }));
        const { element } = await poisPage(store);
        expect(deepAll(element, 'a.row')).toHaveLength(1);

        store.set({ filter: { category: null, unpublished: false, search: 'zzz' } });
        await updated(element);

        expect(deepAll(element, 'a.row')).toEqual([]);
        expect(deepText(element)).toContain('No loaded place matches the filter.');
    });

    it('happyPath_addPlaceAsksTheShapeThenOpensTheNewPlace', async () => {
        const store = area();
        const { element, app } = await poisPage(store);

        press(deep(element, 'hcm-button.add'));
        await updated(element);
        expect(deep(element, 'hcm-button.add').getAttribute('aria-expanded')).toBe('true');
        press(deep(element, 'hcm-button.add-polygon'));
        await updated(element);

        expect(store.named('add')).toEqual(['add "polygon"']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"pois","params":["new-1"]}']);
        expect(deepAll(element, '.shapes')).toEqual([]);
    });
});

describe('<hcm-pois-page>: bulk actions and files', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_bulkActionsAskBeforeMovingOrDeleting', async () => {
        const store = area(poisState({ selection: ['stavropoleos', 'cismigiu'] }));
        const { element } = await poisPage(store);
        expect(deepText(element)).toContain('Selected: 2');

        const bulk = deep(element, '.bulk-bar');
        press(deep(bulk, 'hcm-button.select-all'));
        press(deep(bulk, 'hcm-icon-button.clear'));
        await bulkAction(element, 'publish');
        await bulkAction(element, 'unpublish');
        await bulkAction(element, 'move');
        const select = deep(element, '#move-category') as HTMLSelectElement;
        select.value = 'parcuri';
        select.dispatchEvent(new Event('change'));
        press(deep(element, 'hcm-button.move-confirm'));
        await updated(element);
        await bulkAction(element, 'delete');
        const confirm = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; headline: string };
        expect(confirm.headline).toBe('Delete the selected places (2)?');
        deep(confirm, '.confirm').click();
        await updated(element);

        expect(asked(store)).toEqual([
            'selectAll',
            'clearSelection',
            'bulk {"kind":"publish","published":true}',
            'bulk {"kind":"publish","published":false}',
            'bulk {"kind":"move","category":"parcuri"}',
            'bulk {"kind":"delete"}',
        ]);
    });

    it('badPath_cancellingTheMoveOrTheBulkDeleteChangesNothing', async () => {
        const store = area(poisState({ selection: ['cismigiu'] }));
        const { element } = await poisPage(store);

        await bulkAction(element, 'move');
        deep(element, '.move-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'cancel' } }));
        await updated(element);
        await bulkAction(element, 'delete');
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        expect(asked(store)).toEqual([]);
    });

    it('happyPath_exportSavesAFileAndImportHandsTheFileOver', async () => {
        const store = area(poisState({ selection: ['cismigiu'] }));
        const { element } = await poisPage(store);
        const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:places');
        const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);

        press(deep(element, 'hcm-button.export'));
        await updated(element);
        const input = deep(element, '.file-input') as HTMLInputElement;
        const opened = vi.spyOn(input, 'click').mockReturnValue(undefined);
        press(deep(element, 'hcm-button.import'));
        const transfer = new DataTransfer();
        transfer.items.add(new File(['{}'], 'places.geojson', { type: 'application/geo+json' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change'));
        input.dispatchEvent(new Event('change'));

        expect(store.named('exportPlaces')).toEqual(['exportPlaces true']);
        expect(store.named('chooseImport')).toHaveLength(1);
        expect(opened).toHaveBeenCalledOnce();
        expect(input.hidden).toBe(true);
        expect(created).toHaveBeenCalledOnce();
        expect(clicked).toHaveBeenCalledOnce();
        expect(revoked).toHaveBeenCalledWith('blob:places');
        expect(deepText(element)).toContain('Export the selection (GeoJSON)');
        vi.restoreAllMocks();
    });

    it('badPath_aListThatFailsOffersTryAgainAndMore', async () => {
        const store = area(poisState({ list: ready([place()], { hasMore: true, reconnecting: true }) }));
        const { element } = await poisPage(store, { locale: 'ro' });
        press(deep(element, '.more hcm-button'));
        store.set({
            list: { status: 'error', items: [], hasMore: false, reconnecting: false, failure: { kind: 'failed', code: 'internal' } },
        });
        await updated(element);
        press(deep(element, '.alert + .actions hcm-button'));

        expect(asked(store)).toEqual(['more', 'retry']);
        expect(deepText(element)).toContain('Încearcă din nou');
    });
});

describe('<hcm-pois-page>: the map centre', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_beforeTheCityIsReadAddAtCentreWaits', async () => {
        const waiting = await poisPage(area(poisState({ editor: editor(), frame: null })), { params: ['stavropoleos'] });
        const known = await poisPage(area(poisState({ editor: editor(), frame: { view: { center: [26.1, 44.43] } } })), {
            params: ['stavropoleos'],
        });

        const addCentre = (element: HTMLElement): boolean =>
            (deep(element, 'hcm-icon-button.add-centre') as HTMLElement & { disabled: boolean }).disabled;
        expect([addCentre(waiting.element), addCentre(known.element)]).toEqual([true, false]);
    });
});

describe('<hcm-pois-page>: the open place', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theOpenPlaceShowsItsEditorBelowTheMap', async () => {
        const store = area(poisState({ editor: editor(), map: 'ready' }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });

        expect(deep(element, 'a.row[aria-current="page"]').getAttribute('href')).toBe('#/pois/stavropoleos');
        expect(deep(deep(element, 'hcm-poi-editor'), 'h2').textContent).toBe('Stavropoleos Church');
        deep(element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: 1 } }));
        expect(store.named('zoomBy')).toEqual(['zoomBy 1']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theListPreviewsTheOpenPlacesDraft', async () => {
        const value = { ...VALUE, title: { ro: 'Stavropoleos', en: 'Stavropoleos Monastery' }, yearStart: 1724, published: false };
        const store = area(poisState({ editor: editor({ draft: draft({ value, dirty: ['title', 'yearStart', 'published'] }) }) }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });

        // The open place's row shows what Save would write; the other row as stored.
        const rows = deepAll(element, 'a.row').map((row) => row.textContent.replace(/\s+/g, ' ').trim());
        expect(rows).toEqual([
            'Stavropoleos Monastery Churches · from 1724 · Point · Unpublished',
            'Cișmigiu Parcuri · until 1900 · Area · Unpublished',
        ]);
        expect(withDraft([], null)).toEqual([]);
    });

    it('happyPath_aDeleteAsksFirstThenLeavesTheDeletedPlace', async () => {
        const store = area(poisState({ editor: editor() }));
        const { element, app } = await poisPage(store, { params: ['stavropoleos'] });

        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-delete'));
        await updated(element);
        const confirm = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string };
        expect(confirm.headline).toBe('Delete "Stavropoleos Church"?');
        deep(confirm, '.confirm').click();
        await updated(element);

        expect(store.named('remove')).toEqual(['remove']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"pois","params":[]}']);
    });

    it('badPath_aRefusedDeleteKeepsThePlaceOpen', async () => {
        const store = area(poisState({ editor: editor() }), { remove: Promise.resolve({ ok: false }) });
        const { element, app } = await poisPage(store, { params: ['stavropoleos'] });

        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-delete'));
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(app.named('navigate')).toEqual([]);
    });

    it('happyPath_redrawingADrawnPlaceAsksAndANewOneRedrawsAtOnce', async () => {
        const store = area(poisState({ editor: editor() }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });
        const poiEditor = deep(element, 'hcm-poi-editor');

        poiEditor.dispatchEvent(new CustomEvent('hcm-redraw', { detail: { shape: 'polygon' } }));
        await updated(element);
        const confirm = deep(element, 'hcm-confirm-dialog') as HTMLElement & { headline: string; destructive: boolean };
        expect([confirm.headline, confirm.destructive]).toEqual(['Redraw the place?', false]);
        deep(confirm, '.confirm').click();
        await updated(element);
        store.set({ editor: editor({ draft: draft({ value: { ...draft().value, geometry: null } }) }) });
        await updated(element);
        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-redraw', { detail: { shape: 'linestring' } }));

        expect(store.named('redraw')).toEqual(['redraw "polygon"', 'redraw "linestring"']);
    });

    it('happyPath_thePhotoPickerChoosesAndRemovesPhotos', async () => {
        const photos = ready([
            { id: 'p1', title: { ro: 'Lipscani', en: 'Lipscani Street' }, year: 1930, thumb: 'https://example.org/t.webp' },
            { id: 'p2', title: { ro: 'Obor' }, year: null, thumb: null },
        ]);
        const store = area(poisState({ editor: editor({ draft: draft({ value: { ...draft().value, photoIds: ['p1'] } }) }), photos }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });

        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-pick-photos'));
        await updated(element);
        const picker = deep(element, '.photo-picker') as HTMLElement & { open: boolean };
        expect(picker.open).toBe(true);
        const boxes = deepAll(picker, 'input[type="checkbox"]');
        boxes[0]?.click();
        boxes[1]?.click();
        picker.dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'close' } }));
        await updated(element);

        expect(store.named('loadPhotos')).toEqual(['loadPhotos']);
        expect(store.named('edit')).toEqual(['edit {"photoIds":[]}', 'edit {"photoIds":["p1","p2"]}']);
        expect(deepText(picker)).toContain('Obor (no year)');
        expect(picker.open).toBe(false);
    });

    it('badPath_anUnknownPlaceSaysNotFoundWithItsHistory', async () => {
        const store = area(poisState({ editor: { ...editor({ id: 'gone', draft: null }), status: 'not-found' } }));
        const { element } = await poisPage(store, { params: ['gone'] });

        expect(deepText(element)).toContain('This place does not exist or was deleted.');
        expect(deepAll(element, '.detail a').map((link) => link.getAttribute('href'))).toEqual(['#/history/poi/gone', '#/pois']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_backFromAPlaceReturnsToTheListAndAStrayConfirmationDoesNothing', async () => {
        const store = area(poisState({ editor: editor() }));
        const { element, app } = await poisPage(store, { params: ['stavropoleos'] });

        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
        deep(element, 'hcm-confirm-dialog').dispatchEvent(new CustomEvent('hcm-confirm'));
        await updated(element);

        expect(app.named('navigate')).toEqual(['navigate {"id":"pois","params":[]}']);
        expect(asked(store)).toEqual([]);
    });

    it('happyPath_thePickerStopsAtTwentyPhotos', async () => {
        const ids = Array.from({ length: 20 }, (_unused, index) => ['p', String(index)].join(''));
        const photos = ready([...ids, 'extra'].map((id) => ({ id, title: { ro: id }, year: 1930, thumb: null })));
        const store = area(poisState({ editor: editor({ draft: draft({ value: { ...draft().value, photoIds: ids } }) }), photos }));
        const { element } = await poisPage(store, { params: ['stavropoleos'] });

        deep(element, 'hcm-poi-editor').dispatchEvent(new CustomEvent('hcm-pick-photos'));
        await updated(element);

        const boxes = deepAll(deep(element, '.photo-picker'), 'input[type="checkbox"]') as HTMLInputElement[];
        expect(boxes.map((box) => box.disabled)).toEqual([...ids.map(() => false), true]);
    });

    it('happyPath_aClickOnTheMapOpensThePlaceOnce', async () => {
        const store = area();
        const { element, app } = await poisPage(store);

        store.set({ clicked: { id: 'cismigiu', seq: 1 } });
        await updated(element);
        store.set({ clicked: { id: 'cismigiu', seq: 1 }, busy: true });
        await updated(element);

        expect(app.named('navigate')).toEqual(['navigate {"id":"pois","params":["cismigiu"]}']);
    });
});

describe('<hcm-pois-page>: the import', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aFileBeingReadSaysSoAndACategoryChosenStaysOffered', async () => {
        const plan = {
            created: [{}],
            updated: [],
            unchanged: 0,
            refused: [{ number: 2, title: null, reason: 'altitude' as const, path: null }],
            uncategorised: 0,
        };
        const store = area(
            poisState({
                importing: { status: 'reading', fileName: 'a.geojson', refusal: null, plan: null, fallbackCategory: null, written: 0 },
            }),
        );
        const { element } = await poisPage(store);
        const dialog = deep(element, '.import-dialog');
        expect(deepText(dialog)).toContain('Reading the file…');

        store.set({ importing: { status: 'preview', fileName: 'a.geojson', refusal: null, plan, fallbackCategory: null, written: 0 } });
        await updated(element);
        expect(deepAll(dialog, '#import-category')).toEqual([]);
        expect(deepText(dialog)).toContain('Item 2 : it has an altitude');
        store.set({
            importing: { status: 'preview', fileName: 'a.geojson', refusal: null, plan, fallbackCategory: 'parcuri', written: 0 },
        });
        await updated(element);

        expect((deep(dialog, '#import-category') as HTMLSelectElement).value).toBe('parcuri');
    });

    it('happyPath_thePreviewCountsAndRefusalsThenImport', async () => {
        const plan = {
            created: [{}],
            updated: [{}],
            unchanged: 3,
            refused: [{ number: 4, title: 'Departe', reason: 'outside' as const, path: 'geometry' }],
            uncategorised: 1,
        };
        const store = area(
            poisState({
                importing: { status: 'preview', fileName: 'locuri.geojson', refusal: null, plan, fallbackCategory: null, written: 0 },
            }),
        );
        const { element } = await poisPage(store);
        const dialog = deep(element, '.import-dialog') as HTMLElement & { open: boolean; headline: string };

        expect(dialog.headline).toBe('Import from locuri.geojson');
        expect(deepText(dialog)).toContain('New: 1');
        expect(deepText(dialog)).toContain('Item 4 Departe: outside the city');
        const select = deep(dialog, '#import-category') as HTMLSelectElement;
        select.value = 'parcuri';
        select.dispatchEvent(new Event('change'));
        press(deep(dialog, 'hcm-button.import-go'));
        dialog.dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'close' } }));

        expect(asked(store)).toEqual(['setImportCategory "parcuri"', 'commitImport', 'closeImport']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedFileOrAFailedImportSaysWhyAndCannotBeImported', async () => {
        const store = area(
            poisState({
                importing: { status: 'refused', fileName: 'a.kml', refusal: 'not-geojson', plan: null, fallbackCategory: null, written: 0 },
            }),
        );
        const { element } = await poisPage(store);
        const dialog = deep(element, '.import-dialog');
        expect(deepText(dialog)).toContain('The file is not GeoJSON');
        expect(deepAll(dialog, 'hcm-button.import-go')).toEqual([]);

        store.set({
            importing: {
                status: 'failed',
                fileName: 'a.geojson',
                refusal: null,
                plan: { created: [{}], updated: [], unchanged: 0, refused: [], uncategorised: 0 },
                fallbackCategory: 'biserici',
                written: 0,
            },
        });
        await updated(element);
        expect(deepText(dialog)).toContain('The import stopped: a write was refused. Places imported before it: 0.');
        store.set({
            importing: { status: 'refused', fileName: 'a.geojson', refusal: null, plan: null, fallbackCategory: null, written: 0 },
        });
        await updated(element);
        expect(deep(dialog, 'p.alert').textContent).toBe('');
        store.set({
            importing: {
                ...{ status: 'refused', fileName: 'mari.geojson', refusal: 'too-many', plan: null, fallbackCategory: null, written: 0 },
                limit: { existing: 2, adding: 4999 },
            },
        });
        await updated(element);
        expect(deep(dialog, 'p.alert').textContent).toBe('Too many places: the city has 2, the file adds 4999 and a city may have 5000.');
    });

    it('happyPath_whileWritingAndOnceDoneTheProgressShows', async () => {
        const plan = { created: [{}, {}], updated: [], unchanged: 0, refused: [], uncategorised: 0 };
        const store = area(
            poisState({
                importing: { status: 'writing', fileName: 'a.geojson', refusal: null, plan, fallbackCategory: 'biserici', written: 1 },
            }),
        );
        const { element } = await poisPage(store);
        const dialog = deep(element, '.import-dialog');

        expect(deepText(dialog)).toContain('Writing the places: 1 of 2…');
        expect(deepAll(dialog, '#import-category')).toEqual([]);
        store.set({ importing: { status: 'done', fileName: 'a.geojson', refusal: null, plan, fallbackCategory: 'biserici', written: 2 } });
        await updated(element);
        expect(deepText(dialog)).toContain('Places imported: 2');
    });
});

describe('<hcm-pois-page>: windows', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aCompactListOffersTheMapAndBackReturnsToTheList', async () => {
        const store = area();
        const { element } = await poisPage(store, { width: 400 });
        expect(store.named('attachMap')).toEqual([]);

        const choice = deep(element, 'hcm-segmented-button');
        choice.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'map' } }));
        await updated(element);
        expect(store.named('attachMap')).toHaveLength(1);
        deep(element, 'hcm-list-detail').dispatchEvent(new CustomEvent('hcm-back'));
        await updated(element);

        expect((element as HTMLElement & { mapView: boolean }).mapView).toBe(false);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aListWithoutItsViewShowsNothing', async () => {
        const list = document.createElement('hcm-poi-list');
        document.body.append(list);
        await (list as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

        expect(list.shadowRoot?.childElementCount ?? 0).toBe(0);
    });

    it('badPath_withoutAStoreThePageShowsNothingAndLeavingClosesIt', async () => {
        const { element } = await poisPage(null);
        expect(element.shadowRoot?.childElementCount ?? 0).toBe(0);

        const store = area();
        const shown = await poisPage(store, { params: ['stavropoleos'] });
        await route(shown.app, shown.element, []);
        shown.element.remove();

        expect(store.named('close')).toEqual(['close']);
    });
});

describe('the places page: texts', () => {
    it('happyPath_yearsCategoriesAndReasonsInBothLanguages', () => {
        expect(yearsText('en', 1890, 1900)).toBe('1890–1900');
        expect(yearsText('ro', null, null)).toBe('Fără ani');
        expect(categoryName('en', CATEGORIES, 'parcuri')).toBe('Parcuri');
        expect(categoryName('ro', CATEGORIES, 'nimic')).toBe('Categorie necunoscută');
        expect(localized('en', { ro: 'Biserică' })).toBe('Biserică');
        expect(refusalText('ro', 'self-intersection')).toBe('Laturile suprafeței nu se pot intersecta.');
        expect(reasonText('en', 'invalid', 'title.ro')).toBe('an invalid field');
        expect(reasonText('en', 'invalid', null)).toBe('an invalid field');
        expect(poiHref('a')).toBe('#/pois/a');
    });

    it('badPath_saveFileRevokesItsAddressAfterTheDownload', () => {
        const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
        const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockReturnValue(undefined);

        saveFile(document, { name: 'a.geojson', type: 'application/geo+json', text: '{}' });

        expect([created.mock.calls.length, clicked.mock.calls.length, revoked.mock.calls[0]?.[0]]).toEqual([1, 1, 'blob:x']);
        expect(document.querySelectorAll('a[download]')).toHaveLength(0);
        vi.restoreAllMocks();
    });
});
