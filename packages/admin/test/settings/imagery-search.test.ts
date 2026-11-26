// M8 (docs/research/M8-join-interfaces.md §5): saved target years rank nothing until a search does, so the imagery section's
// Save starts one.
import { describe, expect, it } from 'vitest';

import { IMAGERY_SEARCH_TIMEOUT_MS } from '../../src/imagery/search-timeout.js';
import { settingsModule } from '../../src/settings/settings.js';
import { settle } from '../app/fakes.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc } from '../layers/fixtures.js';

const SEARCH = { found: 1, added: 0, updated: 0, failedDatasets: [], searchedAt: '2026-11-06T10:00:00.000Z' };

function open(section: string) {
    const world = contentWorld();
    world.store.docs.set(CITY_PATH, cityDoc());
    const store = settingsModule({ passes: () => true }).create(world.services);
    store.open([section]);
    return { world, store };
}

function searches(world: ContentWorld) {
    return world.callables.calls.filter((call) => call.name === 'imagery.search');
}

describe('the search after saving the imagery section', () => {
    it('happyPath_savingTheTargetYearsSearchesAgain', async () => {
        const { store, world } = open('imagery');
        world.callables.answer('imagery.search', () => SEARCH);

        store.intents.editCity({ imagery: { targetYears: [1972] } });
        await store.intents.saveSection();
        await settle();

        expect(world.store.docs.get(CITY_PATH)).toMatchObject({ imagery: { targetYears: [1972] } });
        expect(searches(world)).toEqual([{ name: 'imagery.search', request: { cityId: CITY }, timeoutMs: IMAGERY_SEARCH_TIMEOUT_MS }]);
    });

    it('badPath_aSearchThatFailsDoesNotUnsayTheSave', async () => {
        const { store, world } = open('imagery');
        world.callables.fail('imagery.search', new Error('USGS is down'));

        store.intents.editCity({ imagery: { targetYears: [1972] } });
        const outcome = await store.intents.saveSection();
        await settle();

        expect(outcome).toEqual({ ok: true });
        expect(searches(world)).toHaveLength(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.settings.saved' });
    });

    it('badPath_anotherSectionsSaveAndARefusedSaveSearchNothing', async () => {
        const area = open('area');
        area.store.intents.editCity({ minZoom: 10 });
        await area.store.intents.saveSection();
        const refused = open('imagery');
        refused.world.store.outcomes.push({ ok: false, reason: 'conflict' });
        refused.store.intents.editCity({ imagery: { targetYears: [1972] } });
        await refused.store.intents.saveSection();
        await settle();

        expect(searches(area.world)).toEqual([]);
        expect(searches(refused.world)).toEqual([]);
    });
});
