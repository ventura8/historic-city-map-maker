/**
 * The place editor's assists (`packages/admin/src/pois/assists.ts`; `docs/research/M4-interfaces.md` §4.1, CR-M4-4)
 * through the places area: a point drawn on an untitled place asks for title suggestions by itself, Suggest a title
 * asks for the place's first position, a draft fills the other language of a text, and nothing is written before Save.
 */
import { NOMINATIM_ATTRIBUTION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { POIS_MODULE } from '../../src/pois/pois.js';
import { firstPlace, placeAssists } from '../../src/pois/assists.js';
import { AREA, CONTAINER, POINT, SQUARE, seededWorld, settle, type PoisWorld } from './world.js';

function opened(world: PoisWorld, params: readonly string[]) {
    const store = POIS_MODULE.create(world.services);
    store.open(params);
    return store;
}

describe('the place editor assists', () => {
    it('happyPath_aPointDrawnOnAnUntitledPlaceAsksForTitlesAndOneFillsTheDraft', async () => {
        const world = seededWorld();
        world.callables.answer('assist.suggestTitle', () => ({
            state: 'ready',
            key: 'n4443_e261',
            suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }],
            attribution: NOMINATIM_ATTRIBUTION,
        }));
        const store = opened(world, []);
        store.intents.attachMap(CONTAINER);
        await settle();
        const id = store.intents.add('point');
        store.open([id]);

        world.maps.draw.emitChange([{ id, geometry: POINT }]);
        await settle();
        store.intents.useTitle(0);

        expect(world.callables.calls.map((call) => call.request)).toEqual([{ cityId: 'bucharest', location: { lat: 44.43, lng: 26.1 } }]);
        expect(store.state.editor?.draft?.value.title).toEqual({ ro: 'Ateneul Român', en: 'Romanian Athenaeum' });
        expect(world.store.writes).toEqual([]);
    });

    it('happyPath_suggestATitleAndADraftWorkOnAnOpenPlace', async () => {
        const world = seededWorld();
        world.callables.answer('assist.suggestTitle', () => ({ state: 'ready', key: 'k', suggestions: [], attribution: 'a' }));
        world.callables.answer('assist.translateDraft', (request) => {
            const { text, to } = request as { readonly text: string; readonly to: string };
            return { draft: `${text} [${to}]`, truncated: false, model: 'gemini-3.5-flash-lite' };
        });
        const store = opened(world, ['stavropoleos']);
        store.intents.edit({ description: { ro: 'Biserica.' } });

        store.intents.suggestTitle();
        store.intents.draftText('description', 'en');
        store.intents.draftText('label', 'en');
        await settle();

        expect(world.callables.named('assist.suggestTitle')).toBe(1);
        expect(store.state.editor?.draft?.value.description).toEqual({ ro: 'Biserica.', en: 'Biserica. [en]' });
        expect(store.state.assist.drafts['description.en']).toMatchObject({ status: 'done' });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_anAreaOrATitledPlaceAsksNothingByItselfAndAnotherPlaceForgetsIt', async () => {
        const world = seededWorld();
        world.callables.answer('assist.suggestTitle', () => ({ state: 'ready', key: 'k', suggestions: [{ ro: 'X' }], attribution: 'a' }));
        const store = opened(world, []);
        store.intents.attachMap(CONTAINER);
        await settle();
        const id = store.intents.add('polygon');
        store.open([id]);
        world.maps.draw.emitChange([{ id, geometry: AREA }]);
        store.open(['stavropoleos']);
        world.maps.draw.emitChange([{ id: 'stavropoleos', geometry: POINT }]);
        await settle();
        expect(world.callables.calls).toEqual([]);

        store.intents.suggestTitle();
        await settle();
        expect(store.state.assist.titles.status).toBe('ready');
        store.open(['cismigiu']);

        expect(store.state.assist.titles.status).toBe('idle');
    });

    it('badPath_withNoPlaceOpenNothingIsAsked', async () => {
        const world = seededWorld();
        const assists = placeAssists({ services: world.services, value: () => null, edit: () => undefined, changed: () => undefined });

        assists.intents.suggestTitle();
        assists.placeSet({ lat: 44.43, lng: 26.1 });
        assists.intents.draftText('title', 'en');
        await settle();

        expect(world.callables.calls).toEqual([]);
    });

    it('happyPath_thePlaceOfEachShapeIsItsFirstPosition', () => {
        expect([
            firstPlace(null),
            firstPlace(POINT),
            firstPlace({
                type: 'LineString',
                coordinates: [
                    [26.2, 44.4],
                    [26.3, 44.5],
                ],
            }),
            firstPlace(AREA),
            firstPlace({ type: 'Polygon', coordinates: [] }),
            firstPlace({ type: 'LineString', coordinates: [] }),
        ]).toEqual([null, { lat: 44.43, lng: 26.1 }, { lat: 44.4, lng: 26.2 }, { lat: SQUARE[0]?.[1], lng: SQUARE[0]?.[0] }, null, null]);
    });
});
