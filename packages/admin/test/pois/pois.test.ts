import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { AreaStore } from '../../src/content/areas.js';
import { READ_WAIT_MS } from '../../src/content/read-once.js';
import { PAGE_SIZE } from '../../src/content/services.js';
import { LAST_CATEGORY_KEY } from '../../src/pois/actions.js';
import { POIS_MODULE } from '../../src/pois/pois.js';
import type { PoisIntents, PoisState } from '../../src/pois/state.js';
import { AREA, CITY, CONTAINER, POINT, poisWorld, seedCategory, seedPlace, seededWorld, settle, type PoisWorld } from './world.js';

function opened(world: PoisWorld, params: readonly string[] = []): AreaStore<PoisState, PoisIntents> {
    const store = POIS_MODULE.create(world.services);
    store.open(params);
    return store;
}

function seedPhoto(world: PoisWorld, id: string, title: string): void {
    world.store.put(FIRESTORE_PATHS.photo(CITY, id), {
        title: { ro: title },
        published: true,
        processing: 'done',
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.1 },
        ...world.store.stamp(),
    });
}

describe('places: the list', () => {
    it('happyPath_theListShowsTheCitysPlacesNewestFirstWithTheirCategories', () => {
        const world = seededWorld();

        const store = opened(world);

        expect(POIS_MODULE.area).toBe('pois');
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu', 'stavropoleos']);
        expect(store.state.categories.items.map((category) => category.id)).toEqual(['biserici', 'parcuri']);
        expect(store.state.frame?.view).toEqual({ center: [26.1, 44.43], zoom: 14, bearing: 0 });
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_filtersQueryOneIndexAndTheRestFilterTheLoadedPage', () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.setFilter({ category: 'parcuri' });
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu']);
        store.intents.setFilter({ category: null, unpublished: true });
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu']);
        store.intents.setFilter({ unpublished: false, search: 'STAVRO' });

        expect(store.state.filter).toEqual({ category: null, unpublished: false, search: 'STAVRO' });
        expect(store.state.list.items).toHaveLength(2);
    });

    it('badPath_aListenerThatFailsRecoversWithTryAgain', () => {
        const world = seededWorld();
        const store = opened(world);
        world.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });
        expect(store.state.list.status).toBe('error');

        store.intents.retry();
        store.intents.more();

        expect(store.state.list.status).toBe('ready');
        expect(world.denials.count).toBe(1);
    });

    it('happyPath_aBulkActionChangesTheSelectionAndReports', async () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.toggleSelected('cismigiu');
        store.intents.toggleSelected('stavropoleos');
        store.intents.toggleSelected('stavropoleos');
        expect(store.state.selection).toEqual(['cismigiu']);
        store.intents.selectAll();
        expect(store.state.selection).toEqual(['cismigiu', 'stavropoleos']);
        await store.intents.bulk({ kind: 'publish', published: true });

        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'cismigiu'))).toMatchObject({ published: true });
        expect(store.state.selection).toEqual([]);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkDone', params: { changed: '1', skipped: '1' } });
    });

    it('badPath_aBulkActionWithoutSelectionOrThatTheStoreRefusesKeepsTheSelection', async () => {
        const world = seededWorld();
        const store = opened(world);
        await store.intents.bulk({ kind: 'delete' });
        expect(world.store.writes).toEqual([]);

        store.intents.selectAll();
        world.store.outcomes.push({ ok: false, reason: 'denied' });
        await store.intents.bulk({ kind: 'delete' });

        expect(store.state.selection).toHaveLength(2);
        expect(world.denials.count).toBe(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkStopped', params: { changed: '0', skipped: '2' } });
        store.intents.clearSelection();
        expect(store.state.selection).toEqual([]);
    });

    it('badPath_aBulkActionThatGoesOfflineStopsWithoutAskingWhoThisIs', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.selectAll();
        world.store.outcomes.push({ ok: false, reason: 'offline' });

        await store.intents.bulk({ kind: 'move', category: 'biserici' });

        expect(world.denials.count).toBe(0);
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.bulkStopped');
    });

    it('happyPath_aBulkDeleteSaysHowToRestore', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.selectAll();

        await store.intents.bulk({ kind: 'delete' });

        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkDeleted', params: { changed: '2', skipped: '0' } });
        expect(store.state.list.items).toEqual([]);
    });
});

describe('places: the years', () => {
    it('badPath_aYearAfterNextYearByTheClockIsRefused', async () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        const next = new Date(world.clock.now()).getUTCFullYear() + 1;

        store.intents.edit({ yearStart: next + 1 });
        expect(await store.intents.save()).toMatchObject({ ok: false, issues: [{ path: 'yearStart', code: 'validation.tooBig' }] });
        store.intents.edit({ yearStart: next });
        expect(await store.intents.save()).toEqual({ ok: true });
    });

    it('badPath_anImportedFeatureDatedAfterNextYearIsRefused', async () => {
        const world = seededWorld();
        const store = opened(world);
        const next = new Date(world.clock.now()).getUTCFullYear() + 1;
        const features = [next, next + 1].map((yearStart) => ({
            type: 'Feature',
            geometry: POINT,
            properties: { title: 'Nou', yearStart },
        }));
        const text = JSON.stringify({ type: 'FeatureCollection', features });

        await store.intents.chooseImport({ name: 'a.geojson', size: text.length, text: () => Promise.resolve(text) });
        store.intents.setImportCategory('biserici');

        expect(store.state.importing?.plan?.refused).toEqual([{ number: 2, title: 'Nou', reason: 'invalid', path: 'yearStart' }]);
    });
});

describe('places: adding and editing', () => {
    it('happyPath_aNewPlaceStartsInTheLastCategoryAndSavesPublished', async () => {
        const world = seededWorld();
        world.services.local.set(LAST_CATEGORY_KEY, 'parcuri');
        const store = opened(world);

        const id = store.intents.add('point');
        store.open([id]);
        expect(store.state.editor?.draft?.value).toMatchObject({ category: 'parcuri', geometry: null, published: true });
        // Finding 42 of 2026-11-01: a new place nobody touched leaves without a question; a typed title is an edit.
        expect(store.hasUnsavedChanges()).toBe(false);
        store.intents.edit({ title: { ro: 'Statuia' } });
        expect(store.hasUnsavedChanges()).toBe(true);
        store.intents.editVertex({ kind: 'add', index: -1, position: [26.1, 44.43] });
        // Every place needs a year (the owner's request of 2026-11-12): Save waits for one.
        expect(await store.intents.save()).toMatchObject({ ok: false, issues: [{ path: 'yearStart', code: 'validation.required' }] });
        store.intents.edit({ yearStart: 1890 });
        const outcome = await store.intents.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, id))).toMatchObject({
            category: 'parcuri',
            published: true,
            title: { ro: 'Statuia' },
        });
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.saved' });
        expect(world.services.local.get(LAST_CATEGORY_KEY)).toBe('parcuri');
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_addingWhileAPlaceIsOpenKeepsThatPlaceOpen', () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);

        store.intents.add('point');

        expect(store.state.editor?.id).toBe('stavropoleos');
    });

    it('badPath_offlineAnEmptyCachedListOfCategoriesDoesNotTurnSaveOff', () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        store.intents.edit({ title: { ro: 'Stavropoleos, 1724' } });
        expect(store.state.editor?.draft?.issues).toEqual([]);

        // Offline, the categories answer from a cache that holds none of them.
        world.store.setOffline(true);
        world.store.drop(FIRESTORE_PATHS.poiCategory(CITY, 'biserici'));
        world.store.drop(FIRESTORE_PATHS.poiCategory(CITY, 'parcuri'));
        store.intents.edit({ title: { ro: 'Stavropoleos, 1725' } });

        expect(store.state.categories).toMatchObject({ items: [], reconnecting: true });
        expect(store.state.editor?.draft?.issues).toEqual([]);
    });

    it('badPath_withoutAMapFactoryTheMapIsUnavailable', () => {
        const world = seededWorld({ maps: null });
        const store = opened(world);

        store.intents.attachMap(CONTAINER);

        expect(store.state.map).toBe('failed');
    });

    it('happyPath_withoutARememberedCategoryTheFirstIsUsed', () => {
        const world = seededWorld();
        const store = opened(world);

        store.open([store.intents.add('linestring')]);

        expect(store.state.editor).toMatchObject({ shape: 'linestring', draft: { value: { category: 'biserici' } } });
    });

    it('badPath_aPlaceAddedBeforeTheCategoriesArriveGetsTheRememberedOneOnceTheyDo', () => {
        const world = poisWorld();
        world.services.local.set(LAST_CATEGORY_KEY, 'parcuri');
        const store = opened(world);
        const early = store.intents.add('point');
        store.open([store.intents.add('point')]);
        expect(store.state.editor?.draft?.value.category).toBe('');

        // The fake delivers each category as it is written; Firestore's first snapshot has them all.
        seedCategory(world, 'parcuri', 2);
        seedCategory(world, 'biserici', 1);
        expect(store.state.editor?.draft?.value.category).toBe('parcuri');
        // The category filled in once listed is a default, not the admin's edit (finding 42 of 2026-11-01).
        expect(store.hasUnsavedChanges()).toBe(false);
        store.open([early]);

        expect(store.state.editor?.draft?.value.category).toBe('parcuri');
        expect(store.state.editor?.draft?.issues.some((issue) => issue.path === 'category')).toBe(false);
    });

    it('badPath_aSaveTheStoreRefusesSaysWhy', async () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        store.intents.edit({ published: false });
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        const outcome = await store.intents.save();
        store.intents.edit({ title: { ro: '' } });
        const invalid = await store.intents.save();

        expect(outcome).toEqual({ ok: false, reason: 'denied' });
        expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
        expect(world.notices.map((notice) => notice.key)).toEqual(['adminContent.pois.denied', 'adminContent.pois.invalid']);
        expect(world.denials.count).toBe(1);
    });

    it('badPath_anUnknownOrMalformedIdIsNotFound', async () => {
        const world = seededWorld();
        const store = opened(world, ['nu-exista']);
        expect(store.state.editor?.status).toBe('not-found');

        store.open(['a/b']);

        expect(store.state.editor).toMatchObject({ id: 'a/b', status: 'not-found', draft: null });
        expect(await store.intents.save()).toBeNull();
        expect(await store.intents.remove()).toBeNull();
        expect(store.intents.addAtCentre()).toBe(false);
        expect(store.intents.undoLastVertex()).toBe(false);
        expect(store.intents.editVertex({ kind: 'remove', index: 0 })).toBe(false);
        store.intents.redraw('point');
        store.intents.selectVertex(0);
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.edit({ title: { ro: 'x' } });
        store.open([]);
        expect(store.state.editor).toBeNull();
    });

    it('happyPath_theOpenPlaceFollowsItsDocumentAndTheVertexList', () => {
        const world = seededWorld();
        const store = opened(world, ['cismigiu']);

        store.intents.selectVertex(0);
        store.intents.editVertex({ kind: 'move', index: 0, by: 1 });
        store.intents.redraw('point');
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();

        expect(store.state.editor).toMatchObject({ id: 'cismigiu', shape: 'polygon', draft: { value: { geometry: AREA } } });
    });
});

describe('places: the map', () => {
    it('happyPath_theMapShowsThePlacesAndAClickOpensOne', async () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.attachMap(CONTAINER);
        await settle();
        world.maps.map.clickPoi('stavropoleos');
        world.maps.map.clickPoi('stavropoleos');

        expect(store.state.map).toBe('ready');
        expect(store.state.clicked).toEqual({ id: 'stavropoleos', seq: 2 });
        const drawn = world.maps.map.callsOf('addVectorOverlay').map((args) => (args[0] as { id: string }).id);
        expect(drawn).toContain('biserici');
        expect(drawn).toContain('parcuri');
    });

    it('happyPath_drawingOnTheMapShapesTheOpenPlaceAndAddAtCentreAddsAVertex', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.attachMap(CONTAINER);
        await settle();
        const id = store.intents.add('polygon');
        store.open([id]);
        expect(world.maps.draw.mode).toBe('draw-polygon');

        world.maps.draw.emitRefused({
            kind: 'outside',
            bounds: [
                [26, 44],
                [27, 45],
            ],
        });
        expect(store.state.editor?.refusal).toBe('outside');
        world.maps.draw.emitChange([{ id, geometry: AREA }]);
        expect(store.state.editor?.draft?.value.geometry).toEqual(AREA);
        world.maps.map.view = { center: [26.105, 44.435], zoom: 16, bearing: 0 };
        store.intents.selectVertex(0);
        expect(store.intents.addAtCentre()).toBe(true);
        store.intents.setTool('select');
        store.intents.zoomBy(-1);

        expect(store.state.editor?.draft?.value.geometry?.type).toBe('Polygon');
        expect(world.maps.draw.mode).toBe('select');
        store.intents.detachMap();
        expect(store.state.map).toBe('none');
    });
});

describe('places: deleting', () => {
    it('happyPath_aDeleteOffersUndoThatRestoresThePlace', async () => {
        const world = seededWorld();
        world.callables.answer('history.revert', () => ({ restoredFields: [] }));
        const store = opened(world, ['stavropoleos']);

        const outcome = await store.intents.remove();
        const notice = world.notices.at(-1);
        world.store.put(`${FIRESTORE_PATHS.history({ entity: 'poi', cityId: CITY, entityId: 'stavropoleos' })}/20261017120000000-a`, {
            ...{
                entity: 'poi',
                entityId: 'stavropoleos',
                action: 'delete',
                previous: { title: { ro: 'Stavropoleos' } },
                changedFields: [],
            },
            ...world.store.stamp(),
        });
        notice?.action?.run();
        await settle();

        expect(outcome).toEqual({ ok: true });
        expect(notice?.key).toBe('adminContent.pois.deleted');
        expect(notice?.action?.key).toBe('adminContent.pois.undo');
        expect(world.callables.named('history.revert')).toBe(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.restored' });
        expect(store.state.editor?.draft?.gone).toBe(true);
        world.clock.advance(10_000);
    });

    it('badPath_anUploadersDeleteOffersNoUndoTheyCouldNotUse @S-A90-BAD-NO-UNDO', async () => {
        const world = seededWorld({ cityRole: () => 'uploader' });
        const store = opened(world, ['stavropoleos']);
        await store.intents.remove();
        const notice = world.notices.at(-1);
        expect(notice?.key).toBe('adminContent.pois.deleted');
        expect(notice?.action).toBeUndefined();
    });

    it('badPath_aDeleteTheStoreRefusesSaysWhyAndAnUnavailableUndoToo', async () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        world.store.outcomes.push({ ok: false, reason: 'conflict' });

        const refused = await store.intents.remove();
        const deleted = await store.intents.remove();
        world.clock.advance(10_000);
        world.notices.at(-1)?.action?.run();
        await settle();

        expect(refused).toEqual({ ok: false, reason: 'conflict' });
        expect(deleted).toEqual({ ok: true });
        expect(world.notices.map((notice) => notice.key)).toEqual([
            'adminContent.pois.conflict',
            'adminContent.pois.deleted',
            'adminContent.pois.undoUnavailable',
        ]);
    });

    it('badPath_aNewPlaceHasNothingToDelete', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.open([store.intents.add('point')]);

        expect(await store.intents.remove()).toBeNull();
    });
});

describe('places: files and photos', () => {
    /** The ids a file of the export holds. */
    function exported(file: { readonly text: string } | null): string[] {
        return (JSON.parse(file?.text ?? '{"features":[]}') as { features: { id: string }[] }).features.map((feature) => feature.id);
    }

    it('happyPath_theExportHoldsTheSelection', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.toggleSelected('stavropoleos');

        const selection = await store.intents.exportPlaces(true);

        expect(selection).toMatchObject({ name: 'bucharest-places-2025-10-09.geojson', type: 'application/geo+json' });
        expect(exported(selection)).toEqual(['stavropoleos']);
    });

    it('happyPath_exportAllHoldsTheWholeCityPastTheLoadedPageAndAnyFilter @S-A34-HAPPY-EXPORT-ALL-PLACES', async () => {
        const world = seededWorld();
        for (let place = 0; place < PAGE_SIZE; place += 1) {
            seedPlace(world, `loc-${String(place)}`);
        }
        const store = opened(world);
        store.intents.setFilter({ category: 'parcuri' });
        expect(store.state.list.items).toHaveLength(1);

        const reading = store.intents.exportPlaces(false);
        expect(store.state.exporting).toBe(true);
        const all = await reading;

        expect(store.state.exporting).toBe(false);
        expect(exported(all)).toHaveLength(PAGE_SIZE + 2);
        expect(world.store.listeners(FIRESTORE_PATHS.pois(CITY))).toBe(1);
    });

    it('badPath_exportAllNeverTakesTheCachesPartOfTheCityForAllOfIt @S-A34-BAD-EXPORT-ALL-UNREAD', async () => {
        const world = seededWorld();
        const store = opened(world);
        world.store.setOffline(true);

        const reading = store.intents.exportPlaces(false);
        await settle();
        world.clock.advance(READ_WAIT_MS);

        expect(await reading).toBeNull();
        expect(store.state.exporting).toBe(false);
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.exportFailed');
    });

    it('badPath_exportAllSaysHowManyPlacesItLeftOutThatFailTheirSchema @S-A34-BAD-UNREADABLE-PLACE', async () => {
        const world = seededWorld();
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'stricat'), { title: 42 });
        const store = opened(world);

        const all = await store.intents.exportPlaces(false);

        expect(exported(all).length).toBeGreaterThan(0);
        expect(exported(all)).not.toContain('stricat');
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.exportPartial', params: { count: '1' } });
    });

    it('badPath_exportAllRefusedAsksWhoThisIs @S-A34-BAD-EXPORT-ALL-UNREAD', async () => {
        const world = seededWorld();
        const store = opened(world);
        world.store.setOffline(true);

        const reading = store.intents.exportPlaces(false);
        await settle();
        world.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });

        expect(await reading).toBeNull();
        // The list's own listener says so once, and the export's read again.
        expect(world.denials.count).toBe(2);
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.exportFailed');
    });

    it('badPath_aFileThatNamesAPlacePastTheLoadedPageUpdatesItWithNoDuplicate @S-A34-BAD-REIMPORT-NO-DUPLICATES', async () => {
        const world = seededWorld();
        for (let place = 0; place < PAGE_SIZE; place += 1) {
            seedPlace(world, `loc-${String(place)}`);
        }
        const store = opened(world);
        expect(store.state.list.items.map((item) => item.id)).not.toContain('stavropoleos');
        const file = await store.intents.exportPlaces(false);
        const again = file?.text ?? '';

        await store.intents.chooseImport({ name: 'a.geojson', size: again.length, text: () => Promise.resolve(again) });

        expect(store.state.importing?.plan).toMatchObject({ created: [], updated: [], unchanged: PAGE_SIZE + 2 });
    });
});

describe('places: importing and the photos', () => {
    it('happyPath_anImportIsPreviewedOnTheMapAndWritten', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.attachMap(CONTAINER);
        await settle();
        const text = JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: POINT, properties: { title: 'Nou', yearStart: 1890 } }],
        });

        await store.intents.chooseImport({ name: 'a.geojson', size: text.length, text: () => Promise.resolve(text) });
        expect(store.state.importing?.plan?.refused).toHaveLength(1);
        store.intents.setImportCategory('biserici');
        const preview = world.maps.map.callsOf('addVectorOverlay').map((args) => args[0] as { id: string; clickable?: boolean });
        expect(preview.at(-1)).toMatchObject({ id: 'hcm-import', clickable: false });
        await store.intents.commitImport();
        expect(store.state.importing?.status).toBe('done');
        store.intents.closeImport();

        expect(store.state.importing).toBeNull();
        expect(store.state.list.items).toHaveLength(3);
    });

    it('happyPath_thePhotoPickerReadsThePhotosOnce', () => {
        const world = seededWorld();
        world.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), {
            title: { ro: 'Lipscani' },
            year: 1930,
            published: true,
            processing: 'done',
            license: 'CC-BY-4.0',
            location: { lat: 44.43, lng: 26.1 },
            image: { web: 'https://example.org/w.webp', thumb: 'https://example.org/t.webp', sha256: 'a'.repeat(64), w: 10, h: 10 },
            ...world.store.stamp(),
        });
        const store = opened(world);

        store.intents.loadPhotos();
        store.intents.loadPhotos();

        expect(store.state.photos?.items).toEqual([
            { id: 'p1', title: { ro: 'Lipscani' }, year: 1930, thumb: 'https://example.org/t.webp' },
        ]);
        expect(world.store.listeners(FIRESTORE_PATHS.photos(CITY))).toBe(1);
    });

    it('happyPath_anUploadersPickerAsksForTheirOwnPhotos @S-A90-HAPPY-UPLOADER-PICKER', () => {
        const world = seededWorld({ cityRole: () => 'uploader' });
        const photo = (createdBy: string, title: string) => ({
            title: { ro: title },
            published: false,
            processing: 'pending',
            license: 'PD',
            createdBy,
            ...world.store.stamp(),
        });
        world.store.put(FIRESTORE_PATHS.photo(CITY, 'mine'), photo('admin-uid', 'A mea'));
        world.store.put(FIRESTORE_PATHS.photo(CITY, 'theirs'), photo('someone', 'A altcuiva'));
        const store = opened(world);
        store.intents.loadPhotos();
        expect(store.state.photos?.items.map((item) => item.id)).toEqual(['mine']);
    });

    it('happyPath_thePickerReadsThePhotosPastItsFirstPage @S-A32-HAPPY-PHOTO-PICKER-PAGES', () => {
        const world = seededWorld();
        for (let photo = 0; photo <= PAGE_SIZE; photo += 1) {
            seedPhoto(world, `p${String(photo)}`, `Foto ${String(photo)}`);
        }
        const store = opened(world);

        store.intents.loadPhotos();
        expect([store.state.photos?.items.length, store.state.photos?.hasMore]).toEqual([PAGE_SIZE, true]);
        store.intents.morePhotos();

        expect([store.state.photos?.items.length, store.state.photos?.hasMore]).toEqual([PAGE_SIZE + 1, false]);
    });

    it('badPath_aPickerWhoseReadFailedCanTryAgain', () => {
        const world = seededWorld();
        seedPhoto(world, 'p1', 'Lipscani');
        const store = opened(world);
        store.intents.retry();
        expect(world.store.listeners(FIRESTORE_PATHS.photos(CITY))).toBe(0);
        store.intents.loadPhotos();

        world.store.fail(FIRESTORE_PATHS.photos(CITY), { kind: 'failed', code: 'internal' });
        expect(store.state.photos?.status).toBe('error');
        store.intents.retry();

        expect(store.state.photos?.status).toBe('ready');
    });

    it('happyPath_aLinkedPhotoIsNamedFromItsOwnReadWithThePickerClosed @S-A32-BAD-LINKED-PHOTO-PAST-PAGE', async () => {
        const world = seededWorld();
        seedPhoto(world, 'p1', 'Lipscani');
        seedPlace(world, 'cu-poze', { photoIds: ['p1', 'gone'] });
        const store = opened(world);

        store.open(['cu-poze']);
        await settle();

        expect(store.state.photos).toBeNull();
        expect(store.state.linkedPhotos.map((photo) => [photo.id, photo.title.ro])).toEqual([['p1', 'Lipscani']]);
        const reads = world.store.listeners(FIRESTORE_PATHS.photo(CITY, 'p1'));
        store.intents.edit({ title: { ro: 'Alt titlu' } });
        expect(world.store.listeners(FIRESTORE_PATHS.photo(CITY, 'p1'))).toBe(reads);

        store.open([]);
        expect(world.store.listeners(FIRESTORE_PATHS.photo(CITY, 'p1'))).toBe(0);
    });

    it('badPath_aLinkedPhotoThatCannotBeReadKeepsItsId', async () => {
        const world = seededWorld();
        seedPhoto(world, 'p1', 'Lipscani');
        seedPlace(world, 'cu-poze', { photoIds: ['p1'] });
        const store = opened(world);
        world.store.fail(FIRESTORE_PATHS.photo(CITY, 'p1'), { kind: 'failed', code: 'internal' });
        world.store.docs.delete(FIRESTORE_PATHS.photo(CITY, 'p1'));

        store.open(['cu-poze']);
        await settle();

        expect(store.state.linkedPhotos).toEqual([]);
    });
});

describe('places: closing', () => {
    it('happyPath_closeStopsEveryListenerAndDestroyForgetsNewPlaces', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.add('point');
        store.intents.attachMap(CONTAINER);
        await settle();

        store.close();
        store.destroy();

        expect(world.store.listeners()).toBe(0);
        expect(world.maps.destroyed).toBe(1);
        seedPlace(world, 'nou');
        expect(store.state.list.items).toHaveLength(2);
    });
});
