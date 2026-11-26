import { FIRESTORE_PATHS, type CityDoc } from '@hcm/shared';
import type { ThemeTokenSet } from '@hcm/ui/dynamic-color';
import { describe, expect, it } from 'vitest';

import { PreviewLayer } from '../../src/layers/preview.js';
import { READ_WAIT_MS } from '../../src/content/read-once.js';
import { CategoryEditor } from '../../src/settings/category-editor.js';
import { reportOutcome } from '../../src/settings/report.js';
import { settingsModule } from '../../src/settings/settings.js';
import type { SettingsState } from '../../src/settings/state.js';
import { settle } from '../app/fakes.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';
import {
    CATEGORY_PATH,
    CITY_PATH,
    categoryDoc,
    cityDoc,
    LAYER_PATH,
    layerDoc,
    photoDoc,
    poiDoc,
    RecordingPreview,
} from '../layers/fixtures.js';

const TOKENS = (seed: string): ThemeTokenSet => ({
    light: { '--md-sys-color-primary': seed },
    dark: { '--md-sys-color-primary': seed },
    highContrastLight: { '--md-sys-color-primary': seed },
    highContrastDark: { '--md-sys-color-primary': seed },
});

function open(
    params: readonly string[],
    city: CityDoc | null = cityDoc(),
    passes: (tokens: ThemeTokenSet) => boolean = () => true,
    readOnly = false,
) {
    const world = contentWorld({ theme: TOKENS, readOnly: () => readOnly });
    if (city !== null) {
        world.store.docs.set(CITY_PATH, city);
    }
    world.store.docs.set(LAYER_PATH('corona'), layerDoc({ order: 2, year: 1968 }));
    world.store.docs.set(CATEGORY_PATH('cladiri'), categoryDoc({ order: 0 }));
    world.store.docs.set(CATEGORY_PATH('biserici'), categoryDoc({ label: { ro: 'Biserici' }, icon: 'church', order: 1 }));
    const store = settingsModule({ passes }).create(world.services);
    const states: SettingsState[] = [];
    store.subscribe((state) => states.push(state));
    const preview = new RecordingPreview();
    store.intents.attachPreview(preview);
    store.open(params);
    return { world, store, states, preview };
}

function city(world: ContentWorld): Record<string, unknown> | undefined {
    return world.store.docs.get(CITY_PATH);
}

describe('the sections', () => {
    it('happyPath_theCityLayersAndCategoriesAreReadLive', () => {
        const { store } = open([]);

        expect(store.state.section).toBeNull();
        expect(store.state.city.doc?.data.name.ro).toBe('București');
        expect(store.state.categories.items.map((category) => category.id)).toEqual(['cladiri', 'biserici']);
        expect(store.state.layers.items.map((layer) => layer.id)).toEqual(['corona']);
        expect(store.state.canAddCategory).toBe(true);
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('badPath_aFailedListenerAndTryAgain', () => {
        const { store, world } = open(['area']);
        world.store.fail(CITY_PATH, { kind: 'failed', code: 'internal' });
        expect(store.state.city.status).toBe('error');
        store.intents.retry();
        expect(store.state.city.status).toBe('ready');
    });

    it('happyPath_closeDetachesEveryListener', () => {
        const { store, world } = open(['categories', 'cladiri']);
        store.close();
        expect(world.store.listeners()).toBe(0);
        store.destroy();
    });
});

describe('the area section', () => {
    it('happyPath_boundsAndTheStartViewAreSaved', async () => {
        const { store, world } = open(['area']);

        store.intents.editCity({ bounds: { west: 25.8, south: 44.2, east: 26.4, north: 44.7 }, minZoom: 10, maxZoom: 18 });
        store.intents.useView({ center: [26.1, 44.45], zoom: 12.5 });
        expect(store.hasUnsavedChanges()).toBe(true);
        await store.intents.saveSection();

        expect(city(world)).toMatchObject({
            bounds: { west: 25.8, east: 26.4 },
            center: { lat: 44.45, lng: 26.1 },
            zoom: 12.5,
            minZoom: 10,
        });
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.saved');
    });

    it('happyPath_typedNumbersBecomeTheBoundsCentreAndZooms', async () => {
        const { store, world } = open(['area'], cityDoc({ center: undefined, zoom: undefined }));

        store.intents.setNumber('west', '25,8');
        store.intents.setNumber('north', '44.7');
        store.intents.setNumber('lat', '44.44');
        store.intents.setNumber('lng', '26.11');
        store.intents.setNumber('zoom', '12');
        store.intents.setNumber('minZoom', '10');
        store.intents.setNumber('maxZoom', '');
        store.intents.setNumber('south', '44.3');
        store.intents.setNumber('east', '26.3');
        await store.intents.saveSection();

        expect(city(world)).toMatchObject({
            bounds: { west: 25.8, south: 44.3, east: 26.3, north: 44.7 },
            center: { lat: 44.44, lng: 26.11 },
            zoom: 12,
            minZoom: 10,
        });
        store.intents.setNumber('lng', '');
        expect(store.state.citySection.draft.value?.center?.lng).toBeNaN();
    });

    it('badPath_zeroAreaBoundsAreRefusedAtTheField', async () => {
        const { store, world } = open(['area']);

        store.intents.editCity({ bounds: { west: 26, south: 44.3, east: 26, north: 44.6 } });
        const outcome = await store.intents.saveSection();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect(store.state.citySection.draft.issues.map((issue) => issue.path)).toContain('bounds');
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_boundsThatLeaveContentOutAreRefusedWithTheList', async () => {
        const { store, world } = open(['area']);
        world.store.docs.set(FIRESTORE_PATHS.photo(CITY, 'p1'), photoDoc(44.59, 26.29, 'Colț'));
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l1'), poiDoc(44.31, 25.91, 'Loc'));

        store.intents.editCity({ bounds: { west: 26.9, south: 45.2, east: 27, north: 45.3 } });
        const outcome = await store.intents.saveSection();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect(store.state.citySection.outside).toEqual([
            { kind: 'photo', id: 'p1', title: 'Colț' },
            { kind: 'poi', id: 'l1', title: 'Loc' },
        ]);
        expect(world.store.writes).toEqual([]);
        store.intents.editCity({ bounds: { west: 25.8, south: 44.2, east: 26.4, north: 44.7 } });
        expect(store.state.citySection.outside).toEqual([]);
    });

    it('badPath_aConflictAndItsResolution', () => {
        const { store, world } = open(['area']);
        store.intents.editCity({ zoom: 14 });
        world.store.put(CITY_PATH, cityDoc({ zoom: 11, updatedBy: 'other', updatedAt: { seconds: 1_791_000_000, nanoseconds: 0 } }));
        expect(store.state.citySection.draft.conflict?.fields).toEqual(['zoom']);
        // The conflict names who saved: the shell is asked for the admins' names (DECISIONS-for-review.md §42c).
        expect(world.peopleAsked.count).toBeGreaterThan(0);

        store.intents.keepMine();
        expect(store.state.citySection.draft.value?.zoom).toBe(14);
        world.store.put(CITY_PATH, cityDoc({ zoom: 12, updatedAt: { seconds: 1_792_000_000, nanoseconds: 0 } }));
        store.intents.takeTheirs();
        expect(store.state.citySection.draft.value?.zoom).toBe(12);
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_cityIntentsOutsideACitySectionDoNothing', async () => {
        const { store, world } = open(['overlays']);
        store.intents.setNumber('zoom', '3');
        store.intents.setText('about', 'en', 'About');
        store.intents.setSeed('#00658f');
        store.intents.addCredit();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.discardSection();
        expect(await store.intents.saveSection()).toBeNull();
        expect(world.store.writes).toEqual([]);
    });

    it('happyPath_theBoundsGrowWithoutReadingTheContent', async () => {
        const { store, world } = open(['area']);
        store.intents.setNumber('west', '25');
        await store.intents.saveSection();
        expect(world.store.writes).toHaveLength(1);
        expect(store.state.citySection.checking).toBe(false);
    });

    it('badPath_aCityThatDoesNotExistYet', async () => {
        const { store } = open(['area'], null);
        expect(store.state.city).toMatchObject({ status: 'ready', doc: null });
        store.intents.editCity({ zoom: 3 });
        store.intents.setNumber('zoom', '3');
        store.intents.setText('name', 'ro', 'x');
        store.intents.addCredit();
        expect(await store.intents.saveSection()).toBeNull();
    });
});

describe('the texts section', () => {
    it('happyPath_namesAboutAndCreditsAreSaved', async () => {
        const { store, world } = open(['texts']);

        store.intents.setText('name', 'en', 'Lost Bucharest');
        store.intents.setText('about', 'ro', 'Despre **oraș**');
        store.intents.addCredit();
        store.intents.editCredit(0, 'ro', 'Arhiva');
        store.intents.editCredit(0, 'en', 'Archive');
        store.intents.addCredit();
        store.intents.editCredit(1, 'ro', 'B');
        store.intents.editCredit(1, 'en', 'B');
        store.intents.moveCredit(1, -1);
        store.intents.addCredit();
        store.intents.removeCredit(2);
        await store.intents.saveSection();

        expect(city(world)).toMatchObject({
            name: { ro: 'București', en: 'Lost Bucharest' },
            about: { ro: 'Despre **oraș**' },
            credits: [{ label: { ro: 'B', en: 'B' } }, { label: { ro: 'Arhiva', en: 'Archive' } }],
        });
    });

    it('badPath_aLinkThatIsNotHttpsRefusesTheSave', async () => {
        const { store, world } = open(['texts']);

        store.intents.setText('privacy', 'ro', '[date](http://bad.example)');
        const outcome = await store.intents.saveSection();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect(store.state.citySection.draft.issues).toContainEqual({ path: 'privacy.ro', code: 'validation.markdownLink' });
        expect(store.state.citySection.linkLines).toEqual({ about: { ro: [], en: [] }, privacy: { ro: [1], en: [] } });
        store.intents.discardSection();
        expect(store.state.citySection.draft.dirty).toEqual([]);
        expect(world.store.writes).toEqual([]);
    });
});

describe('the theme section', () => {
    it('happyPath_aSeedIsPreviewedAndSavedWithItsTokens', async () => {
        const { store, world } = open(['theme']);

        store.intents.setSeed('#00658F');
        expect(store.state.citySection.theme).toEqual({ typed: '#00658F', invalid: false, adjusted: false, preview: TOKENS('#00658f') });
        store.intents.setBasemap('standard-satellite');
        await store.intents.saveSection();

        expect(city(world)).toMatchObject({
            theme: { seedColor: '#00658f', tokens: TOKENS('#00658f') },
            basemap: { style: 'mapbox://styles/mapbox/standard-satellite' },
        });
        expect(store.state.citySection.theme.preview).toBeNull();
        // The shell wore the preview on the whole admin from the seed to the Save (CR-M2c-28).
        expect(world.previews).toEqual([TOKENS('#00658f'), null]);
    });

    it('badPath_anInvalidSeedPreviewsNothingAndDiscardEndsThePreview', () => {
        const { store, world } = open(['theme']);

        store.intents.setSeed('#00658F');
        store.intents.setSeed('#00');
        expect(store.state.citySection.theme).toMatchObject({ typed: '#00', invalid: true });
        store.intents.discardSection();

        expect(store.state.citySection.theme.preview).toBeNull();
        expect(world.store.writes).toEqual([]);
        expect(world.previews).toEqual([TOKENS('#00658f'), null]);
    });

    it('badPath_leavingSettingsOrSigningOutEndsThePreview', () => {
        const { store, world } = open(['theme']);
        store.intents.setSeed('#00658F');

        store.close();
        store.open(['theme']);
        store.intents.setSeed('#00658F');
        store.destroy();

        expect(world.previews).toEqual([TOKENS('#00658f'), null, TOKENS('#00658f'), null]);
    });

    it('badPath_aLowContrastSeedIsMovedWithAWarning', () => {
        const { store } = open(['theme'], cityDoc(), (tokens) => tokens.light['--md-sys-color-primary'] !== '#ffe082');

        store.intents.setSeed('#ffe082');

        expect(store.state.citySection.theme.adjusted).toBe(true);
        expect(store.state.citySection.draft.value?.theme?.seedColor).not.toBe('#ffe082');
    });
});

describe('the categories section', () => {
    it('happyPath_aNewCategoryIsCreatedUnderTheSlugOfItsLabel', async () => {
        const { store, world, preview } = open(['categories', '_new']);
        expect(store.state.category).toMatchObject({ id: '_new', isNew: true, value: { order: 2 } });

        store.intents.setCategoryLabel('ro', 'Școli vechi');
        store.intents.setCategoryLabel('en', 'Old schools');
        store.intents.editCategory({ icon: 'school', color: '#3f6836' });
        store.intents.setCategoryOpacity(80);
        expect(store.hasUnsavedChanges()).toBe(true);
        const id = await store.intents.saveCategory();

        expect(id).toBe('scoli-vechi');
        expect(world.store.docs.get(CATEGORY_PATH('scoli-vechi'))).toMatchObject({
            label: { ro: 'Școli vechi', en: 'Old schools' },
            icon: 'school',
            color: '#3f6836',
            defaultOpacity: 0.8,
            order: 2,
        });
        expect(preview.calls).toEqual([]);
    });

    it('happyPath_aNewDisappearedStreetsCategoryIsSavedHiddenPinnedAndCredited_badPathAnEmptiedCreditIsLeftOut (M27)', async () => {
        const { store, world } = open(['categories', '_new']);
        store.intents.setCategoryLabel('ro', 'Străzi dispărute');
        store.intents.editCategory({ defaultVisible: false, pinned: true, attribution: 'OSM' });
        store.intents.editCategory({ attribution: undefined });
        const saved = world.store.docs.get(CATEGORY_PATH((await store.intents.saveCategory()) ?? ''));

        expect(saved).toMatchObject({ defaultVisible: false, pinned: true });
        expect(Object.keys(saved ?? {})).not.toContain('attribution');
    });

    it('happyPath_aNewCategorysIconFollowsItsLabelUntilOneIsPicked', () => {
        const { store } = open(['categories', '_new']);
        const icon = (): string | undefined => store.state.category?.value?.icon;

        store.intents.setCategoryLabel('ro', 'Fântâni');
        expect(icon()).toBe('water');
        store.intents.setCategoryLabel('ro', 'Biserici');
        expect(icon()).toBe('church');
        store.intents.editCategory({ icon: 'museum' });
        store.intents.setCategoryLabel('ro', 'Fântâni');
        expect(icon()).toBe('museum');

        store.intents.discardCategory();
        expect(icon()).toBe('location_on');
        store.intents.setCategoryLabel('en', 'Fountains');
        expect(icon()).toBe('water');
    });

    it('badPath_aLabelWithNoKnownWordKeepsThePin', () => {
        const { store } = open(['categories', '_new']);

        store.intents.setCategoryLabel('ro', 'Corona 1968');

        expect(store.state.category?.value?.icon).toBe('location_on');
    });

    it('badPath_aNewCategoryWithoutANameOrWithAnUnreadableColourIsRefused', async () => {
        const { store, world } = open(['categories', '_new']);

        store.intents.editCategory({ color: '#ffe082' });
        expect(store.state.category?.proposedColor).not.toBeNull();
        expect(await store.intents.saveCategory()).toBeNull();
        expect(store.state.category?.issues.map((issue) => issue.path)).toEqual(['label.ro', 'color']);

        store.intents.useProposedColor();
        expect(store.state.category?.proposedColor).toBeNull();
        store.intents.discardCategory();
        expect(store.state.category).toMatchObject({ dirty: false, value: { color: '#8b5e3c' } });
        expect(world.store.writes).toEqual([]);
    });

    it('happyPath_anExistingCategoryPreviewsLiveAndSaves', async () => {
        const { store, world, preview } = open(['categories', 'cladiri']);

        store.intents.setCategoryOpacity(30);
        expect(preview.last).toEqual({ kind: 'poi-category', id: 'cladiri', opacity: 0.3, color: '#8b5e3c', icon: 'domain' });
        expect(await store.intents.saveCategory()).toBe('cladiri');
        expect(world.store.docs.get(CATEGORY_PATH('cladiri'))).toMatchObject({ defaultOpacity: 0.3 });

        store.open(['categories']);
        expect(preview.calls.at(-1)).toEqual(['restore', { kind: 'poi-category', id: 'cladiri' }]);
    });

    it('badPath_anUnknownCategoryIsNotFound', () => {
        const { store } = open(['categories', 'gone']);
        expect(store.state.category).toMatchObject({ id: 'gone', notFound: true });
    });

    it('happyPath_reorderWritesTheMovedCategories', async () => {
        const { store, world } = open(['categories']);

        expect(await store.intents.moveCategory('biserici', 'up')).toEqual({ ok: true });
        expect(store.state.categories.items.map((category) => category.id)).toEqual(['biserici', 'cladiri']);
        expect(await store.intents.moveCategoryTo('biserici', 0)).toBeNull();
        expect(world.store.writes).toHaveLength(1);
    });

    it('badPath_theFiftyFirstCategoryCannotBeAdded', () => {
        const { store, world } = open(['categories']);
        for (let index = 0; index < 48; index += 1) {
            world.store.docs.set(CATEGORY_PATH(`c${String(index)}`), categoryDoc({ order: index + 2 }));
        }
        world.store.put(CATEGORY_PATH('c48'), categoryDoc({ order: 60 }));

        expect(store.state.categories.items).toHaveLength(51);
        expect(store.state.canAddCategory).toBe(false);
    });
});

describe('smaller bounds whose check cannot read', () => {
    it('badPath_boundsWhoseCheckCannotReadTheContentAreRefused @S-A19-BAD-BOUNDS-UNREAD', async () => {
        const { store, world } = open(['area']);
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l1'), poiDoc(44.31, 25.91, 'Loc'));
        store.intents.editCity({ bounds: { west: 26.9, south: 45.2, east: 27, north: 45.3 } });
        world.store.setOffline(true);

        const saving = store.intents.saveSection();
        await settle();
        world.clock.advance(READ_WAIT_MS);

        expect(await saving).toEqual({ ok: false, reason: 'offline' });
        expect(world.store.writes).toEqual([]);
        expect(store.state.citySection.checking).toBe(false);
    });

    it('badPath_boundsWhoseCheckIsRefusedHalfWaySayDenied @S-A19-BAD-BOUNDS-UNREAD', async () => {
        const { store, world } = open(['area']);
        store.intents.editCity({ bounds: { west: 26.9, south: 45.2, east: 27, north: 45.3 } });
        world.store.setOffline(true);

        const saving = store.intents.saveSection();
        await settle();
        world.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });
        world.store.setOffline(false);

        expect(await saving).toEqual({ ok: false, reason: 'denied' });
        expect(world.store.writes).toEqual([]);
    });
});

describe('deleting a category', () => {
    it('happyPath_aCategoryInUseMovesItsPlacesFirst', async () => {
        const { store, world } = open(['categories', 'cladiri']);
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l1'), poiDoc(44.4, 26.1, 'Loc', 'cladiri'));
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l2'), poiDoc(44.4, 26.1, 'Alt loc', 'biserici'));

        await store.intents.askDeleteCategory();
        expect(store.state.categoryDeletion).toMatchObject({ phase: 'confirm', inUse: 1, target: null });
        expect(await store.intents.confirmDeleteCategory()).toBe(false);
        store.intents.setDeleteTarget('biserici');
        expect(await store.intents.confirmDeleteCategory()).toBe(true);

        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'l1'))).toMatchObject({ category: 'biserici' });
        expect(world.store.docs.has(CATEGORY_PATH('cladiri'))).toBe(false);
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.categoryDeleted');
    });

    it('badPath_aCategoryWhosePlacesCannotBeReadIsNotDeleted @S-A33-BAD-CATEGORY-UNREAD', async () => {
        const { store, world } = open(['categories', 'cladiri']);
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l1'), poiDoc(44.4, 26.1, 'Loc', 'cladiri'));
        await store.intents.askDeleteCategory();
        store.intents.setDeleteTarget('biserici');
        world.store.setOffline(true);

        const confirming = store.intents.confirmDeleteCategory();
        await settle();
        world.clock.advance(READ_WAIT_MS);

        expect(await confirming).toBe(false);
        expect(world.store.writes).toEqual([]);
        expect(world.store.docs.has(CATEGORY_PATH('cladiri'))).toBe(true);
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'l1'))).toMatchObject({ category: 'cladiri' });
        expect(store.state.categoryDeletion).toMatchObject({ phase: 'confirm', target: 'biserici' });
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.refused.offline');
    });

    it('badPath_aCategoryWhosePlacesAreRefusedSaysDeniedAndAsksWhoThisIs @S-A33-BAD-CATEGORY-UNREAD', async () => {
        const { store, world } = open(['categories', 'cladiri']);
        world.store.docs.set(FIRESTORE_PATHS.poi(CITY, 'l1'), poiDoc(44.4, 26.1, 'Loc', 'cladiri'));
        await store.intents.askDeleteCategory();
        store.intents.setDeleteTarget('biserici');
        world.store.setOffline(true);

        const confirming = store.intents.confirmDeleteCategory();
        await settle();
        world.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });

        expect(await confirming).toBe(false);
        expect(world.store.docs.has(CATEGORY_PATH('cladiri'))).toBe(true);
        expect(world.denials.count).toBe(1);
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.refused.denied');
    });

    it('badPath_cancelAndARefusedBatchKeepTheCategory', async () => {
        const { store, world } = open(['categories', 'biserici']);
        await store.intents.askDeleteCategory();
        store.intents.cancelDeleteCategory();
        expect(store.state.categoryDeletion).toEqual({ phase: 'idle' });

        await store.intents.askDeleteCategory();
        await store.intents.askDeleteCategory();
        world.store.outcomes.push({ ok: false, reason: 'offline' });
        expect(await store.intents.confirmDeleteCategory()).toBe(false);

        expect(world.store.docs.has(CATEGORY_PATH('biserici'))).toBe(true);
        expect(store.state.categoryDeletion).toMatchObject({ phase: 'confirm' });
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.refused.offline');
    });

    it('badPath_aNewCategoryIsNeverDeleted', async () => {
        const { store } = open(['categories', '_new']);
        await store.intents.askDeleteCategory();
        store.intents.setDeleteTarget('x');
        expect(store.state.categoryDeletion).toEqual({ phase: 'idle' });
    });
});

describe('a revoked admin', () => {
    it('badPath_aReadOnlyPageTakesNoEditOfTheCityACategoryOrTheOverlays', () => {
        const city = open(['area'], cityDoc(), () => true, true);
        city.store.intents.editCity({ zoom: 14 });
        expect(city.store.state.citySection.draft.dirty).toEqual([]);

        const category = open(['categories', '_new'], cityDoc(), () => true, true);
        category.store.intents.setCategoryLabel('ro', 'Fântâni');
        expect(category.store.state.category?.value?.label.ro).toBe('');

        const overlays = open(['overlays'], cityDoc(), () => true, true);
        overlays.store.intents.setOverlayOpacity('raster', 'corona', 40);
        overlays.store.intents.setShownAtStart('corona', true);
        expect(overlays.store.state.overlays.changes).toBe(0);
        expect(overlays.preview.calls.filter((call) => call[0] === 'preview')).toEqual([]);
    });
});

describe('the overlays section', () => {
    it('happyPath_everyDefaultPreviewsAndOneSaveWritesEachChangedDocument', async () => {
        const { store, world, preview } = open(['overlays']);
        expect(store.state.overlays.rows.map((row) => [row.id, row.toggleable])).toEqual([
            ['corona', true],
            ['photos', false],
            ['cladiri', false],
            ['biserici', false],
        ]);

        store.intents.setOverlayOpacity('raster', 'corona', 40);
        store.intents.setShownAtStart('corona', true);
        store.intents.setOverlayOpacity('photos', 'photos', 60);
        store.intents.setOverlayOpacity('poi', 'cladiri', 30);
        expect(preview.calls).toContainEqual(['preview', { kind: 'photos-overlay', opacity: 0.6 }]);
        expect(store.state.overlays.changes).toBe(3);
        await store.intents.saveOverlays();

        expect(world.store.writes).toEqual([
            {
                kind: 'batch',
                writes: [
                    { kind: 'update', path: LAYER_PATH('corona'), fields: { opacity: 0.4, defaultVisible: true } },
                    { kind: 'update', path: CITY_PATH, fields: { photosOverlay: { defaultOpacity: 0.6 } } },
                    { kind: 'update', path: CATEGORY_PATH('cladiri'), fields: { defaultOpacity: 0.3 } },
                ],
            },
        ]);
        expect(store.state.overlays.changes).toBe(0);
    });

    it('badPath_discardAndLeavingWriteNothingAndTakeTheMapBack', async () => {
        const { store, world, preview } = open(['overlays']);
        store.intents.setOverlayOpacity('raster', 'corona', 40);
        store.intents.discardOverlays();
        expect(preview.calls.at(-1)?.[0]).toBe('restore');
        expect(await store.intents.saveOverlays()).toBeNull();

        store.intents.setOverlayOpacity('poi', 'biserici', 10);
        expect(store.hasUnsavedChanges()).toBe(true);
        store.open(['theme']);
        expect(store.hasUnsavedChanges()).toBe(false);
        expect(world.store.writes).toEqual([]);
    });
});

describe('the helpers', () => {
    it('happyPath_reportSaysSavedOrWhyAndNothingForNothing', () => {
        const world = contentWorld();
        reportOutcome(world.services, null);
        reportOutcome(world.services, { ok: true });
        reportOutcome(world.services, { ok: false, reason: 'gone' });
        expect(world.notices.map((notice) => notice.key)).toEqual(['adminContent.settings.saved', 'adminContent.settings.refused.gone']);
        expect(world.denials.count).toBe(0);
    });

    it('badPath_aCategoryConflictIsResolvedAndANewCategorySavesOnce', async () => {
        const { store, world } = open(['categories', 'cladiri']);
        store.intents.setCategoryOpacity(30);
        world.store.put(
            CATEGORY_PATH('cladiri'),
            categoryDoc({ defaultOpacity: 0.9, updatedBy: 'other', updatedAt: { seconds: 1_791_000_000, nanoseconds: 0 } }),
        );
        expect(store.state.category?.conflict?.fields).toEqual(['defaultOpacity']);
        store.intents.takeTheirs();
        expect(store.state.category?.value?.defaultOpacity).toBeCloseTo(0.9, 10);
        store.intents.setCategoryOpacity(20);
        world.store.put(
            CATEGORY_PATH('cladiri'),
            categoryDoc({ defaultOpacity: 0.8, updatedAt: { seconds: 1_792_000_000, nanoseconds: 0 } }),
        );
        store.intents.keepMine();
        expect(store.state.category?.value?.defaultOpacity).toBeCloseTo(0.2, 10);

        store.open(['categories', '_new']);
        store.intents.setCategoryLabel('ro', 'Poduri');
        const [first, second] = await Promise.all([store.intents.saveCategory(), store.intents.saveCategory()]);
        expect([first, second]).toEqual(['poduri', null]);
        store.intents.useProposedColor();
    });

    it('badPath_overlaysSaveOnceAtATime', async () => {
        const { store, world } = open(['overlays']);
        store.intents.setOverlayOpacity('raster', 'corona', 40);
        const [first, second] = await Promise.all([store.intents.saveOverlays(), store.intents.saveOverlays()]);
        expect([first, second]).toEqual([{ ok: true }, null]);
        expect(world.store.writes).toHaveLength(1);
    });

    it('badPath_aRefusalForAccessAsksTheSessionAgain', () => {
        const world = contentWorld();
        reportOutcome(world.services, { ok: false, reason: 'denied' });
        expect(world.denials.count).toBe(1);
    });

    it('badPath_aRefusedOverlaysBatchKeepsTheEdits', async () => {
        const { store, world } = open(['overlays']);
        store.intents.setOverlayOpacity('poi', 'biserici', 50);
        world.store.outcomes.push({ ok: false, reason: 'conflict' });

        expect(await store.intents.saveOverlays()).toEqual({ ok: false, reason: 'conflict' });
        expect(store.state.overlays.changes).toBe(1);
        expect(world.notices.at(-1)?.key).toBe('adminContent.settings.refused.conflict');
    });

    it('badPath_aNewCategoryHasNoDocumentToLoad', () => {
        const world = contentWorld();
        const states: unknown[] = [];
        const editor = new CategoryEditor('_new', {
            services: world.services,
            preview: new PreviewLayer(),
            changed: (state) => states.push(state),
            taken: () => [],
            categories: () => [],
        });
        editor.load(null);
        editor.keepMine();
        editor.takeTheirs();
        expect(states).toEqual([]);
        expect(editor.state.notFound).toBe(false);
    });
});

describe('the imagery section', () => {
    it('happyPath_theImagerySettingsAreSavedOnTheirOwn', async () => {
        const { store, world } = open(['imagery']);

        store.intents.editCity({ imagery: { autoPublish: false, rmseThresholdM: 9, targetYears: [1966, 1977] } });
        await store.intents.saveSection();

        expect(city(world)).toMatchObject({ imagery: { autoPublish: false, rmseThresholdM: 9, targetYears: [1966, 1977] } });
        expect(world.store.writes.map((write) => (write.kind === 'update' ? Object.keys(write.fields) : write.kind))).toEqual([
            ['imagery'],
        ]);
    });

    it('badPath_aThresholdOutOfRangeOrRepeatedYearsAreSaidAndNothingIsWritten', async () => {
        const { store, world } = open(['imagery']);

        store.intents.editCity({ imagery: { rmseThresholdM: 500, targetYears: [1966, 1966] } });
        const outcome = await store.intents.saveSection();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect(store.state.citySection.draft.issues.map((issue) => issue.path)).toEqual(['imagery.rmseThresholdM', 'imagery.targetYears']);
        expect(world.store.writes).toEqual([]);
    });
});

describe('the publishing section (M5, DECISIONS-for-review.md §63a)', () => {
    it('happyPath_aNewCityIsPublishedWithItsFlagAlone', async () => {
        const { store, world } = open(['publish'], cityDoc({ published: false }));

        store.intents.editCity({ published: true });
        const outcome = await store.intents.saveSection();

        expect(outcome).toMatchObject({ ok: true });
        expect(store.state.citySection.section).toBe('publish');
        expect(city(world)).toMatchObject({ published: true });
        expect(world.store.writes.map((write) => (write.kind === 'update' ? Object.keys(write.fields) : write.kind))).toEqual([
            ['published'],
        ]);
    });

    it('badPath_aRevokedAdminPublishesNothing', async () => {
        const { store, world } = open(['publish'], cityDoc({ published: false }), () => true, true);

        store.intents.editCity({ published: true });
        await store.intents.saveSection();

        expect(world.store.writes).toEqual([]);
        expect(city(world)).toMatchObject({ published: false });
    });
});
