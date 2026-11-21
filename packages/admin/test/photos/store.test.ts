// The photos area end to end over the fakes: the list and its bulk actions, uploads, the open editor with its map
// (the pin, the direction, the cone), save with the sticky fields and the last pin, delete with Undo, and the map's
// lifecycle (one map per page visit).
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { PHOTOS_MODULE } from '../../src/photos/module.js';
import { LAST_PIN_KEY, STICKY_KEY } from '../../src/photos/session.js';
import { cityPlace, DEFAULT_CITY_ZOOM, type PhotosStore } from '../../src/photos/store.js';
import { at, CITY, CONTAINER, file, photoDoc, photoPath, photosWorld, seedCity, seedPhoto, settle, type PhotosWorld } from './world.js';

function area(world: PhotosWorld = photosWorld()): { world: PhotosWorld; store: PhotosStore } {
    seedCity(world);
    return { world, store: PHOTOS_MODULE.create(world.services) };
}

const HISTORY = FIRESTORE_PATHS.history({ entity: 'photo', cityId: CITY, entityId: 'p1' });

describe('the photos area: list and bulk', () => {
    it('happyPath_theListOpensWithItsRowsAndTheSticky', () => {
        const { world, store } = area();
        world.services.local.set(STICKY_KEY, JSON.stringify({ author: 'Ion' }));
        seedPhoto(world, 'p1');
        const store2 = PHOTOS_MODULE.create(world.services);
        const states: unknown[] = [];
        const stop = store2.subscribe((state) => states.push(state));

        store2.open([]);

        expect(store2.state.list.rows.map((row) => row.id)).toEqual(['p1']);
        expect(store2.state.sticky).toEqual({ author: 'Ion' });
        expect(states.length).toBeGreaterThan(0);
        stop();
        expect(PHOTOS_MODULE.area).toBe('photos');
        store.destroy();
    });

    it('happyPath_listIntentsReachTheList', () => {
        const { world, store } = area();
        seedPhoto(world, 'a', { published: true });
        seedPhoto(world, 'b');
        store.open([]);

        store.intents.setFilter('published');
        expect(store.state.list.rows.map((row) => row.id)).toEqual(['a']);
        store.intents.setFilter('all');
        store.intents.search({ text: 'zzz', yearFrom: null, yearTo: null });
        expect(store.state.list.rows).toEqual([]);
        store.intents.search({ text: '', yearFrom: null, yearTo: null });
        store.intents.toggleSelected('a');
        store.intents.selectAll();
        expect(store.state.list.selection).toHaveLength(2);
        store.intents.clearSelection();
        expect(store.state.list.selection).toEqual([]);
        store.intents.more();
        store.intents.retry();
        expect(store.state.list.status).toBe('ready');
    });

    it('badPath_bulkPublishSkipsWhatCannotBePublishedAndSaysWhy', async () => {
        const { world, store } = area();
        seedPhoto(world, 'ok');
        seedPhoto(world, 'unknown', { license: 'unknown' });
        store.open([]);
        store.intents.selectAll();

        await store.intents.bulk({ kind: 'publish' });

        expect(world.store.docs.get(photoPath('ok'))).toMatchObject({ published: true });
        const notice = world.notices.at(-1);
        expect(notice).toMatchObject({
            key: 'adminContent.photos.bulk.publish',
            params: { done: '1', skipped: '1' },
            action: { key: 'adminContent.photos.bulk.seeWhy' },
        });
        expect(store.state.list.selection).toEqual(['unknown']);
        notice?.action?.run();
        expect(store.state.report).toMatchObject({ kind: 'publish', skipped: [{ id: 'unknown', reason: 'license' }] });
        store.intents.closeReport();
        expect(store.state.report).toBeNull();
        store.intents.showReport();
        expect(store.state.report).not.toBeNull();
    });

    it('happyPath_setFieldsRemembersThemForNewPhotos', async () => {
        const { world, store } = area();
        seedPhoto(world, 'a');
        store.open([]);
        store.intents.selectAll();

        await store.intents.bulk({ kind: 'setFields', fields: { author: 'Ion', license: 'CC0' } });

        expect(world.store.docs.get(photoPath('a'))).toMatchObject({ author: 'Ion', license: 'CC0' });
        expect(store.state.sticky).toEqual({ author: 'Ion', license: 'CC0' });
        expect(world.notices.at(-1)).not.toHaveProperty('action');
    });

    it('happyPath_oneClickRightsAndPlaceConfirmations', async () => {
        const { world, store } = area();
        seedPhoto(world, 'a', { rightsReview: true });
        store.open([]);

        await store.intents.confirmRights('a');
        await store.intents.confirmRights('ghost');
        world.services.local.set('hcm:admin:photoCheckPlace', JSON.stringify(['a']));
        store.intents.confirmPlace('a');

        expect(world.store.docs.get(photoPath('a'))).toMatchObject({ rightsReview: false });
        expect(store.state.list.rows[0]?.checkPlace).toBe(false);
    });

    it('happyPath_uploadIntentsReachTheQueue', async () => {
        const { world, store } = area();
        store.open([]);

        const before = store.busy();
        store.intents.upload([file('a.jpg'), file('b.pdf')]);
        await settle();
        // Review of M18 item 1: a photo still being sent holds the self-reload back.
        expect([before, store.busy()]).toEqual([false, true]);
        store.intents.cancelUpload(1);
        store.intents.retryUpload(1);
        store.intents.dismissUpload(2);
        store.intents.clearUploads();
        await settle();

        expect(world.uploads.started).toHaveLength(1);
        expect([store.state.uploads, store.busy()]).toEqual([[], false]);
    });
});

describe('the photos area: the editor and its map', () => {
    it('happyPath_aRoutedPhotoOpensItsEditorOnTheMap', async () => {
        const { world, store } = area(photosWorld({ locale: () => 'en' }));
        seedPhoto(world, 'p1', { bearing: 90 });
        seedPhoto(world, 'p2', { title: { ro: 'Doi', en: 'Two' } });
        store.open(['p1']);
        let opened = '';

        store.intents.attachMap(CONTAINER, (photoId) => {
            opened = photoId;
        });
        await settle();

        expect(store.state.map).toBe('ready');
        expect(world.maps.created).toEqual([
            {
                container: CONTAINER,
                options: {
                    bounds: [
                        [26, 44.3],
                        [26.3, 44.55],
                    ],
                    view: { center: [26.15, 44.425], zoom: DEFAULT_CITY_ZOOM, bearing: 0 },
                    locale: 'en',
                },
            },
        ]);
        const shown = world.maps.port.data.at(-1)?.features ?? [];
        expect(shown.map((feature) => [feature.geometry.type, feature.properties.id])).toEqual([
            ['Point', 'p2'],
            ['Point', 'p1'],
            ['Polygon', 'p1'],
        ]);
        expect(shown[0]?.properties).toMatchObject({ title: 'Two' });
        expect(world.maps.draw.loaded).toEqual([{ id: 'photo-location', geometry: { type: 'Point', coordinates: [26.1, 44.43] } }]);
        world.maps.port.click('p2');
        expect(opened).toBe('p2');
        store.intents.focusPhoto('p2');
        store.intents.focusPhoto('ghost');
        store.intents.zoomBy(1);
        // The routed photo was brought into view when its map was ready, then the focus and the zoom step.
        expect(world.maps.port.flights).toHaveLength(3);
        expect(world.maps.port.flights[0]).toEqual({ center: [26.1, 44.43] });
    });

    it('happyPath_editsPreviewLiveAndSaveRemembersTheStickyAndThePin', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();

        world.maps.draw.emitChange({
            features: [{ id: 'photo-location', geometry: { type: 'Point', coordinates: [26.12, 44.44] } }],
            final: true,
        });
        store.intents.edit({ author: 'Ion', fov: 90 });
        const direction = store.intents.setDirection();
        await settle();
        expect(store.state.editor?.picking).toBe(true);
        world.maps.draw.resolvePick([26.13, 44.44]);
        await direction;

        expect(store.state.editor?.value).toMatchObject({ location: { lat: 44.44, lng: 26.12 }, author: 'Ion', fov: 90, bearing: 90 });
        expect(store.hasUnsavedChanges()).toBe(true);
        const cone = world.maps.port.data.at(-1)?.features.find((feature) => feature.geometry.type === 'Polygon');
        expect(cone?.properties.id).toBe('p1');

        await expect(store.intents.save()).resolves.toBe(true);

        expect(world.store.docs.get(photoPath('p1'))).toMatchObject({
            author: 'Ion',
            fov: 90,
            bearing: 90,
            location: { lat: 44.44, lng: 26.12 },
        });
        expect(JSON.parse(world.services.local.get(LAST_PIN_KEY) ?? '[]')).toEqual([26.12, 44.44]);
        expect(store.state.sticky).toMatchObject({ author: 'Ion', license: 'CC-BY-4.0' });
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.saved' });
    });

    it('happyPath_theKeyboardSetsTheDirectionFromTheMapsCentre', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();
        world.maps.port.center = [26.1, 44.44];

        store.intents.pointAtCentre();
        store.intents.edit({ location: { lat: 44.4, lng: 26.1 } });
        await settle();

        expect(store.state.editor?.value?.bearing).toBe(0);
        expect(world.maps.draw.loaded[0]?.geometry.coordinates).toEqual([26.1, 44.4]);
        const cancelled = store.intents.setDirection();
        await settle();
        store.intents.cancelDirection();
        await cancelled;
        expect(store.state.editor?.picking).toBe(false);
    });
});

describe('the photos area: the editor without a map', () => {
    it('badPath_aPinDraggedOutsideTheCityIsRefusedWithAMessage', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();

        world.maps.draw.emitRefused();

        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.pin.outside' });
    });

    it('badPath_aSaveThatFailsSaysWhy', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.intents.edit({ author: 'Ion' });
        world.store.setOffline(true);

        await expect(store.intents.save()).resolves.toBe(false);

        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.error.offline' });
    });

    it('badPath_withoutAnEditorTheEditorIntentsDoNothing', async () => {
        const { world, store } = area();
        store.open([]);

        store.intents.edit({ author: 'Ion' });
        store.intents.applySuggestion('year');
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.retryPhoto();
        store.intents.replaceImage(file('a.jpg'));
        store.intents.cancelReplace();
        store.intents.dismissReplace();
        store.intents.uploadVersion('improved', file('a.jpg'));
        store.intents.cancelVersion('improved');
        store.intents.dismissVersion('improved');
        store.intents.pointAtCentre();
        store.intents.cancelDirection();
        await store.intents.setDirection();

        await expect(store.intents.save()).resolves.toBe(false);
        expect(world.store.writes).toEqual([]);
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('badPath_anEXIFPlaceOutsideTheCityCannotBeApplied', () => {
        const { world, store } = area();
        seedPhoto(world, 'p1', { suggested: { location: { lat: 47, lng: 27 }, year: 1936 } });
        store.open(['p1']);

        store.intents.applySuggestion('location');
        store.intents.applySuggestion('year');

        expect(world.notices).toEqual([{ key: 'adminContent.photos.suggestion.outside' }]);
        expect(store.state.editor?.value?.year).toBe(1936);
    });
});

describe('the photos area: intents and the map lifecycle', () => {
    it('happyPath_editorIntentsReachTheDraftAndTheReplacement', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);

        store.intents.edit({ author: 'Ion' });
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.retryPhoto();
        store.intents.replaceImage(file('new.jpg'));
        expect(store.state.editor?.replace?.phase).toBe('uploading');
        store.intents.cancelReplace();
        await settle();
        store.intents.dismissReplace();
        store.intents.uploadVersion('colorized', file('color.jpg'));
        expect(store.state.editor?.versionUploads.colorized?.phase).toBe('uploading');
        store.intents.cancelVersion('colorized');
        store.intents.dismissVersion('colorized');

        expect(store.state.editor).toMatchObject({ dirty: [], replace: null, versionUploads: { improved: null, colorized: null } });
    });

    it('badPath_withoutAMapFactoryTheMapIsUnavailable', async () => {
        const world = photosWorld({ maps: null });
        const { store } = area(world);
        store.open([]);

        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();
        store.intents.focusPhoto('p1');
        store.intents.zoomBy(1);

        expect(store.state.map).toBe('unavailable');
        await store.intents.setDirection();
    });

    it('happyPath_theMapWaitsForTheCityAndIsDestroyedWhenThePageGoes', async () => {
        const world = photosWorld();
        const store = PHOTOS_MODULE.create(world.services);
        store.open([]);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();
        expect(world.maps.created).toEqual([]);

        seedCity(world, { center: { lat: 44.4, lng: 26.1 }, zoom: 12 });
        await settle();
        expect(world.maps.created).toHaveLength(1);
        world.store.drop(FIRESTORE_PATHS.city(CITY));

        store.close();
        expect(world.maps.destroyed).toBe(1);
        expect(store.state.map).toBe('none');
        store.intents.detachMap();
        store.open([]);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();
        expect(world.maps.created).toHaveLength(2);
        store.destroy();
    });

    it('happyPath_backToTheListClosesTheEditorAndTakesThePinAway', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.open(['p1']);
        store.intents.attachMap(CONTAINER, () => undefined);
        await settle();

        store.open([]);
        await settle();
        world.maps.draw.emitChange({
            features: [{ id: 'photo-location', geometry: { type: 'Point', coordinates: [26.12, 44.44] } }],
            final: true,
        });

        expect(store.state.editor).toBeNull();
        expect(world.maps.draw.loaded).toEqual([]);
        expect(world.store.listeners(photoPath('p1'))).toBe(0);
    });

    it('happyPath_cityPlaceFromTheCityDocument', () => {
        expect(cityPlace({ bounds: { west: 26, south: 44, east: 27, north: 45 }, center: { lat: 44.4, lng: 26.1 }, zoom: 12 })).toEqual({
            bounds: [
                [26, 44],
                [27, 45],
            ],
            view: { center: [26.1, 44.4], zoom: 12, bearing: 0 },
        });
    });
});

describe('the photos area: delete and Undo', () => {
    it('badPath_anUploadersDeleteOffersNoUndoTheyCouldNotUse @S-A90-BAD-NO-UNDO', async () => {
        const { world, store } = area(photosWorld({ cityRole: () => 'uploader' }));
        seedPhoto(world, 'p1');
        store.open(['p1']);
        store.intents.requestDelete();
        await store.intents.confirmDelete();
        const notice = world.notices.at(-1);
        expect(notice?.key).toBe('adminContent.photos.deleted');
        expect(notice?.action).toBeUndefined();
    });

    it('happyPath_theOpenPhotoIsDeletedAndUndoBringsItBack', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open(['p1']);
        world.callables.answer('history.revert', () => ({ restoredFields: [] }));

        store.intents.requestDelete();
        expect(store.state.confirm).toEqual({ ids: ['p1'], title: 'Calea Victoriei' });
        await expect(store.intents.confirmDelete()).resolves.toBe(true);

        expect(world.store.docs.has(photoPath('p1'))).toBe(false);
        const notice = world.notices.at(-1);
        expect(notice).toMatchObject({
            key: 'adminContent.photos.deleted',
            params: { title: 'Calea Victoriei' },
            action: { key: 'adminContent.photos.undoAction' },
        });
        world.store.put(`${HISTORY}/0000000000002-b`, {
            ...{ entity: 'photo', entityId: 'p1', action: 'delete', previous: { title: { ro: 'x' } }, changedFields: [] },
            ...{ updatedBy: 'admin-uid', updatedAt: at('2026-10-17T12:00:00.000Z') },
        });
        notice?.action?.run();
        await settle();
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.restored' });
    });

    it('badPath_undoThatCannotFindTheEntrySaysToUseHistory', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open([]);
        store.intents.requestDelete(['p1']);
        await store.intents.confirmDelete();

        world.notices.at(-1)?.action?.run();
        await settle();
        world.clock.advance(10_000);
        await settle();

        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.undo.unavailable' });
    });

    it('badPath_aDeleteThatFailsSaysWhyAndCancelChangesNothing', async () => {
        const { world, store } = area();
        seedPhoto(world, 'p1');
        store.open([]);

        store.intents.requestDelete(['p1']);
        store.intents.cancelConfirm();
        await expect(store.intents.confirmDelete()).resolves.toBe(false);
        store.intents.requestDelete([]);
        store.intents.requestDelete();
        expect(store.state.confirm).toBeNull();

        world.store.setOffline(true);
        store.intents.requestDelete(['p1']);
        await expect(store.intents.confirmDelete()).resolves.toBe(false);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.photos.error.offline' });
    });

    it('happyPath_aSelectionIsDeletedInOneBatchAndPointsToHistory', async () => {
        const { world, store } = area();
        seedPhoto(world, 'a');
        seedPhoto(world, 'b');
        store.open([]);

        store.intents.requestDelete(['a', 'b']);
        expect(store.state.confirm).toEqual({ ids: ['a', 'b'], title: null });
        await store.intents.confirmDelete();

        expect(world.store.docs.has(photoPath('a'))).toBe(false);
        expect(world.notices.at(-1)).toMatchObject({ key: 'adminContent.photos.bulk.delete', params: { done: '2', skipped: '0' } });
    });
});

describe('the photos area: M13', () => {
    it('happyPath_anUploaderListsTheirOwnAndAnEditorEveryones @S-A90-BAD-OTHERS-HIDDEN', async () => {
        const uploader = photosWorld({ cityRole: () => 'uploader' });
        seedCity(uploader);
        uploader.store.put(FIRESTORE_PATHS.photo(CITY, 'mine'), photoDoc({ createdBy: 'admin-uid' }));
        uploader.store.put(FIRESTORE_PATHS.photo(CITY, 'theirs'), photoDoc({ createdBy: 'someone' }));
        const area = PHOTOS_MODULE.create(uploader.services);
        area.open([]);
        await settle();
        expect(area.state.role).toBe('uploader');
        expect(area.state.list.rows.map((row) => row.id)).toEqual(['mine']);
    });

    it('happyPath_aPhotoWithNoPlaceGetsAPinAtTheMapsCentre @S-V40-HAPPY-MANIFEST', async () => {
        const world = photosWorld();
        seedCity(world);
        const lost = Object.entries(photoDoc()).filter(([key]) => key !== 'location' && key !== 'bearing' && key !== 'fov');
        world.store.put(FIRESTORE_PATHS.photo(CITY, 'lost'), Object.fromEntries(lost));
        const area = PHOTOS_MODULE.create(world.services);
        area.open(['lost']);
        await settle();
        area.intents.attachMap(CONTAINER, () => undefined);
        await settle();
        expect(area.state.editor?.value?.location).toBeUndefined();
        area.intents.placeAtCentre();
        await settle();
        expect(area.state.editor?.value?.location).toEqual({ lat: 44.43, lng: 26.1 });
    });
});
