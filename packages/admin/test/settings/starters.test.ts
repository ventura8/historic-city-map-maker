import { FIRESTORE_PATHS, MAX_POI_CATEGORIES, type PoiCategoryDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { reportOutcome } from '../../src/settings/report.js';
import { settingsModule } from '../../src/settings/settings.js';
import { settle } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { CATEGORY_PATH, CITY_PATH, categoryDoc, cityDoc, LAYER_PATH, layerDoc } from '../layers/fixtures.js';

type Label = PoiCategoryDoc['label'];

/** Settings, Place categories over a city whose categories carry `labels` (ids `c0`, `c1`, ...) and a layer `cladire`. */
function open(labels: readonly Label[], options: { readonly readOnly?: boolean } = {}) {
    const world = contentWorld({ readOnly: () => options.readOnly === true });
    world.store.docs.set(CITY_PATH, cityDoc());
    world.store.docs.set(LAYER_PATH('cladire'), layerDoc({ order: 1 }));
    labels.forEach((label, index) => {
        world.store.docs.set(CATEGORY_PATH(`c${String(index)}`), categoryDoc({ label, order: index * 2 }));
    });
    const store = settingsModule({ passes: () => true }).create(world.services);
    store.open(['categories']);
    return { world, store };
}

function categoryPaths(world: ReturnType<typeof contentWorld>): string[] {
    return [...world.store.docs.keys()].filter((path) => path.includes('/poiCategories/'));
}

describe('Add the starter categories', () => {
    it('happyPath_oneClickAddsTheMissingStartersInOneBatchClearOfEveryIdAndSaysHowMany', async () => {
        const { world, store } = open([{ ro: 'Biserică' }, { ro: 'Porturi', en: 'Ports' }]);
        expect(store.state.startersMissing).toBe(4);

        const adding = store.intents.addStarterCategories();
        expect(store.state.addingStarters).toBe(true);
        await expect(store.intents.addStarterCategories()).resolves.toBeNull();
        await expect(adding).resolves.toEqual({ ok: true });
        await settle();

        expect(world.store.writes.filter((write) => write.kind === 'batch')).toHaveLength(1);
        expect(store.state.categories.items.map((category) => [category.id, category.order])).toEqual([
            ['c0', 0],
            ['c1', 2],
            ['cladire-2', 3],
            ['strada', 4],
            ['piata', 5],
            ['monument', 6],
        ]);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.settings.startersAdded', params: { count: '4' } });
        expect(store.state.startersMissing).toBe(0);
        expect(store.state.addingStarters).toBe(false);
        await expect(store.intents.addStarterCategories()).resolves.toBeNull();
    });

    it('badPath_everyStarterNamedCaseDiacriticsAndSpacingAsideLeavesNothingToAdd', async () => {
        const { world, store } = open([
            { ro: 'BISERICA' },
            { ro: 'Străzi', en: '  street ' },
            { ro: 'clădire' },
            { ro: 'Piata' },
            { ro: 'Monumente', en: 'MONUMENT' },
        ]);

        expect(store.state.startersMissing).toBe(0);
        await expect(store.intents.addStarterCategories()).resolves.toBeNull();
        expect(world.store.writes).toEqual([]);
        expect(world.notices).toEqual([]);
    });

    it('badPath_aCloseNameIsNotTheStarterSoClădiriLeavesClădireToAdd', () => {
        const { store } = open([
            { ro: 'Clădiri', en: 'Buildings' },
            { ro: 'Stradă' },
            { ro: 'Piață' },
            { ro: 'Biserică' },
            { ro: 'Monument' },
        ]);

        expect(store.state.startersMissing).toBe(1);
    });

    it('badPath_aReadOnlyPageWritesNoStarter', async () => {
        const { world, store } = open([{ ro: 'Porturi' }], { readOnly: true });

        await expect(store.intents.addStarterCategories()).resolves.toBeNull();
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_offlineNothingIsWrittenAndTheSnackbarSaysWhy', async () => {
        const { world, store } = open([{ ro: 'Porturi' }]);
        world.store.setOffline(true);

        await expect(store.intents.addStarterCategories()).resolves.toEqual({ ok: false, reason: 'offline' });

        expect(categoryPaths(world)).toHaveLength(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.settings.refused.offline' });
        expect(store.state.addingStarters).toBe(false);
    });

    it('badPath_categoriesNotListedOfferNoStarter', () => {
        const { world, store } = open([{ ro: 'Porturi' }]);
        world.store.fail(FIRESTORE_PATHS.poiCategories(CITY), { kind: 'failed', code: 'internal' });

        expect(store.state.categories.status).toBe('error');
        expect(store.state.startersMissing).toBe(0);
    });

    it('badPath_nearTheLimitOnlyTheStartersThatFitAreAdded', async () => {
        const labels = Array.from({ length: MAX_POI_CATEGORIES - 2 }, (_item, index) => ({ ro: `Categoria ${String(index)}` }));
        const { world, store } = open(labels);
        expect(store.state.startersMissing).toBe(2);

        await store.intents.addStarterCategories();
        await settle();

        expect(categoryPaths(world)).toHaveLength(MAX_POI_CATEGORIES);
        expect(store.state.categories.items.slice(-2).map((category) => category.id)).toEqual(['cladire-2', 'strada']);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.settings.startersAdded', params: { count: '2' } });
        expect(store.state.canAddCategory).toBe(false);
    });

    it('happyPath_aSuccessCarriesItsParamsAndARefusalIgnoresThem', () => {
        const world = contentWorld();
        reportOutcome(world.services, { ok: true }, 'adminContent.settings.startersAdded', { count: '3' });
        reportOutcome(world.services, { ok: false, reason: 'denied' }, 'adminContent.settings.startersAdded', { count: '3' });
        expect(world.notices).toEqual([
            { key: 'adminContent.settings.startersAdded', params: { count: '3' } },
            { key: 'adminContent.settings.refused.denied' },
        ]);
        expect(world.denials.count).toBe(1);
    });
});
