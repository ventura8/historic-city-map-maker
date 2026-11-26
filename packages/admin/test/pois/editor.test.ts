import { FIRESTORE_PATHS, geometryToDoc, MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { PoiContext } from '../../src/pois/draft.js';
import { PlaceEditor, type FreshPlace, type PlaceEditorState } from '../../src/pois/editor.js';
import { AREA, CITY, placeDoc, POINT, poisWorld, settle, SQUARE, type PoisWorld } from './world.js';

const CONTEXT: PoiContext = {
    limits: {
        limits: [
            [25.5, 43.8],
            [26.8, 45.05],
        ],
        maxVertices: MAX_GEOMETRY_VERTICES,
        maxRings: MAX_POLYGON_RINGS,
    },
    categories: new Set(['biserici']),
};

const PATH = FIRESTORE_PATHS.poi(CITY, 'loc');

function editorOf(
    world: PoisWorld,
    fresh: FreshPlace | null,
    context: PoiContext = CONTEXT,
): { readonly editor: PlaceEditor; readonly states: PlaceEditorState[] } {
    const states: PlaceEditorState[] = [];
    const editor = new PlaceEditor('loc', fresh, {
        store: world.store,
        clock: world.clock,
        cityId: CITY,
        denied: world.services.denied,
        context: () => context,
        changed: (state) => states.push(state),
    });
    return { editor, states };
}

function fresh(shape: FreshPlace['shape']): FreshPlace {
    return {
        shape,
        value: { category: 'biserici', geometry: null, title: { ro: 'Loc' }, yearStart: 1890, links: [], photoIds: [], published: true },
    };
}

describe('a place editor: what counts as unsaved', () => {
    it('happyPath_anUntouchedNewPlaceIsNotUnsavedAndAPlacedPositionIs', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('polygon'));

        // Finding 42 of 2026-11-01: nothing typed, nothing drawn, the category its default.
        editor.prefill({ category: 'biserici' });
        expect(editor.unsaved).toBe(false);

        expect(editor.addAt([26.1, 44.43])).toBe(true);
        expect(editor.state.draft?.value.geometry).toBeNull();
        expect(editor.unsaved).toBe(true);
    });

    it('badPath_aRedrawWithNothingDrawnIsNoEdit', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('point'));

        editor.redraw('polygon');

        expect(editor.unsaved).toBe(false);
    });
});

describe('a place editor: opening', () => {
    it('happyPath_aStoredPlaceOpensWithItsShape', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world, { geometry: geometryToDoc(AREA) }));

        const { editor } = editorOf(world, null);

        expect(editor.state).toMatchObject({ id: 'loc', status: 'ready', shape: 'polygon' });
        expect(editor.positions).toEqual(SQUARE.slice(0, -1));
        expect(editor.unsaved).toBe(false);
    });

    it('badPath_anIdWithoutADocumentIsNotFound', () => {
        const world = poisWorld();

        const { editor } = editorOf(world, null);

        expect(editor.state.status).toBe('not-found');
        expect(editor.unsaved).toBe(false);
    });

    it('badPath_aListenerThatFailsShowsTheErrorAndTryAgainReads', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, null);
        world.store.fail(PATH, { kind: 'failed', code: 'internal' });
        expect(editor.state).toMatchObject({ status: 'error', failure: { kind: 'failed' } });
        world.store.put(PATH, placeDoc(world));

        editor.retry();

        expect(editor.state.status).toBe('ready');
    });

    it('badPath_aFailureOfAnOpenPlaceKeepsTheEditorAndReconnects', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { editor } = editorOf(world, null);

        world.store.fail(PATH, { kind: 'unavailable', code: 'unavailable' });
        expect(editor.state).toMatchObject({ status: 'ready', reconnecting: true });
        world.store.fail(PATH, { kind: 'failed', code: 'internal' });
        world.clock.advance(1000);

        expect(editor.state).toMatchObject({ status: 'ready', reconnecting: false });
    });
});

describe('a place editor: the vertex list', () => {
    it('happyPath_anAreaIsTypedPositionByPositionFromItsSketch', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('polygon'));

        expect(editor.addAt([26.1, 44.43])).toBe(true);
        expect(editor.addAt([26.11, 44.43])).toBe(true);
        expect(editor.state.sketch).toEqual([
            [26.1, 44.43],
            [26.11, 44.43],
        ]);
        expect(editor.state.draft?.value.geometry).toBeNull();
        expect(editor.addAt([26.11, 44.440000001])).toBe(true);

        expect(editor.state.draft?.value.geometry).toEqual({
            type: 'Polygon',
            coordinates: [
                [
                    [26.1, 44.43],
                    [26.11, 44.43],
                    [26.11, 44.44],
                    [26.1, 44.43],
                ],
            ],
        });
        expect(editor.state).toMatchObject({ sketch: [], vertex: 2, refusal: null });
    });

    it('happyPath_vertexEditsSelectMoveAndRemove', () => {
        const world = poisWorld();
        const line = {
            type: 'LineString',
            coordinates: [
                [26.1, 44.43],
                [26.11, 44.43],
                [26.12, 44.43],
            ],
        } as const;
        world.store.put(
            PATH,
            placeDoc(world, {
                geometry: geometryToDoc({ type: 'LineString', coordinates: line.coordinates.map(([lng, lat]) => [lng, lat]) }),
            }),
        );
        const { editor } = editorOf(world, null);

        editor.selectVertex(1);
        expect(editor.editVertex({ kind: 'set', index: 1, position: [26.11, 44.435] })).toBe(true);
        expect(editor.state.vertex).toBe(1);
        expect(editor.editVertex({ kind: 'move', index: 1, by: 1 })).toBe(true);
        expect(editor.state.vertex).toBe(2);
        expect(editor.editVertex({ kind: 'remove', index: 2 })).toBe(true);
        expect(editor.state.vertex).toBe(1);
        editor.selectVertex(null);
        expect(editor.undoLastVertex()).toBe(false);
        expect(editor.editVertex({ kind: 'add', index: 0, position: [26.105, 44.425] })).toBe(true);
        expect(editor.undoLastVertex()).toBe(true);

        expect(editor.state.vertex).toBe(1);
        expect(editor.positions).toHaveLength(2);
        expect(editor.unsaved).toBe(true);
    });

    it('badPath_editsThatLeaveTooFewPositionsOrLeaveTheCityAreRefused', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { editor } = editorOf(world, null);

        expect(editor.undoLastVertex()).toBe(false);
        expect(editor.editVertex({ kind: 'set', index: 0, position: [28, 44] })).toBe(false);
        expect(editor.state.refusal).toBe('outside');
        editor.redraw('linestring');
        expect(editor.addAt([28, 44])).toBe(false);
        expect(editor.state.refusal).toBe('outside');
        expect(editor.addAt([26.1, 44.43])).toBe(true);
        expect(editor.state.refusal).toBeNull();
    });

    it('happyPath_withoutTheCityYetNoLimitIsChecked', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('linestring'), { limits: null, categories: null });

        editor.addAt([28, 44]);
        editor.addAt([28.1, 44]);

        expect(editor.state.draft?.value.geometry).toEqual({
            type: 'LineString',
            coordinates: [
                [28, 44],
                [28.1, 44],
            ],
        });
    });

    it('happyPath_aRemovedVertexTurnsTheShapeBackIntoASketch', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('linestring'));
        editor.addAt([26.1, 44.43]);
        editor.addAt([26.11, 44.43]);
        editor.redraw('polygon');
        editor.addAt([26.1, 44.43]);
        editor.addAt([26.11, 44.43]);

        expect(editor.editVertex({ kind: 'remove', index: 1 })).toBe(true);

        expect(editor.state.sketch).toEqual([[26.1, 44.43]]);
        expect(editor.state.draft?.value.geometry).toBeNull();
    });
});

describe('a place editor: drawing, saving, discarding', () => {
    it('happyPath_aShapeFromTheMapGoesToTheDraftAndSaves', async () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('point'));

        editor.refused('outside');
        editor.setGeometry({ type: 'Point', coordinates: [26.123456789, 44.43] });
        const outcome = await editor.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.docs.get(PATH)).toMatchObject({ geometry: { type: 'Point', point: { lat: 44.43, lng: 26.1234568 } } });
        await settle();
        expect(editor.state.draft?.isNew).toBe(false);
        expect(editor.state.refusal).toBeNull();
    });

    it('happyPath_discardReturnsToTheSavedShapeAndConflictsResolve', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world, { geometry: geometryToDoc(AREA) }));
        const { editor } = editorOf(world, null);
        editor.redraw('point');
        editor.addAt([26.1, 44.43]);

        editor.discard();
        expect(editor.state).toMatchObject({ shape: 'polygon', sketch: [], vertex: null });
        editor.edit({ title: { ro: 'Al meu' } });
        world.store.now += 5000;
        world.store.put(PATH, placeDoc(world, { geometry: geometryToDoc(AREA), title: { ro: 'Al lor' } }));
        expect(editor.state.draft?.conflict?.fields).toEqual(['title']);
        editor.keepMine();
        editor.takeTheirs();

        expect(editor.state.draft?.conflict).toBeNull();
    });

    it('badPath_aNewPlaceWithoutShapeDiscardsToNothingAndAClosedEditorStopsListening', () => {
        const world = poisWorld();
        const { editor } = editorOf(world, fresh('polygon'));
        editor.addAt([26.1, 44.43]);

        editor.discard();
        editor.recheck();
        editor.close();

        expect(editor.state).toMatchObject({ shape: 'polygon', sketch: [] });
        expect(world.store.listeners(PATH)).toBe(0);
    });

    it('badPath_anEditorWithoutADraftSavesNothing', async () => {
        const world = poisWorld();
        const { editor } = editorOf(world, null);

        editor.edit({ title: { ro: 'x' } });
        editor.setGeometry(POINT);
        editor.discard();
        editor.keepMine();
        editor.takeTheirs();
        editor.recheck();
        editor.redraw('point');

        expect(await editor.save()).toEqual({ ok: false, reason: 'gone' });
        expect(editor.addAt([26.1, 44.43])).toBe(true);
        editor.redraw('linestring');
        expect(editor.addAt([26.1, 44.43])).toBe(true);
        expect(editor.state.sketch).toEqual([[26.1, 44.43]]);
        expect(editor.state.draft).toBeNull();
    });
});
