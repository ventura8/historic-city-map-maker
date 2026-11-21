import {
    FIRESTORE_PATHS,
    geometryToDoc,
    MAX_GEOMETRY_VERTICES,
    MAX_POLYGON_RINGS,
    poiDocSchema,
    type BBox,
    type PoiDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { Stored } from '../../src/content/services.js';
import { changedFields, draftIssues, PoiDraft, type PoiContext, type PoiDraftState } from '../../src/pois/draft.js';
import type { PoiValue } from '../../src/pois/model.js';
import { AREA, CITY, placeDoc, POINT, poisWorld, settle, type PoisWorld } from './world.js';

const LIMITS: BBox = [
    [25.5, 43.8],
    [26.8, 45.05],
];

const CONTEXT: PoiContext = {
    limits: { limits: LIMITS, maxVertices: MAX_GEOMETRY_VERTICES, maxRings: MAX_POLYGON_RINGS },
    categories: new Set(['biserici', 'parcuri']),
};

const FRESH: PoiValue = {
    category: 'biserici',
    geometry: POINT,
    title: { ro: 'Loc nou' },
    yearStart: 1890,
    links: [],
    photoIds: [],
    published: true,
};

const PATH = FIRESTORE_PATHS.poi(CITY, 'stavropoleos');

function stored(world: PoisWorld): Stored<PoiDoc> {
    const data = world.store.docs.get(PATH);
    const parsed = poiDocSchema.parse(data);
    const at = parsed.updatedAt;
    return { id: 'stavropoleos', path: PATH, data: parsed, version: new Date(at.seconds * 1000).toISOString(), pending: false };
}

function draftOf(
    world: PoisWorld,
    start: { readonly base: Stored<PoiDoc> } | { readonly value: PoiValue },
    context = CONTEXT,
): { readonly draft: PoiDraft; readonly states: PoiDraftState[] } {
    const states: PoiDraftState[] = [];
    const draft = new PoiDraft('stavropoleos', start, {
        store: world.store,
        cityId: CITY,
        context: () => context,
        changed: (state) => states.push(state),
    });
    return { draft, states };
}

describe('a place draft: a revoked admin', () => {
    it('badPath_aLockedDraftTakesNoEdit', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        let locked = false;
        const draft = new PoiDraft(
            'stavropoleos',
            { base: stored(world) },
            {
                store: world.store,
                cityId: CITY,
                context: () => CONTEXT,
                changed: () => undefined,
                locked: () => locked,
            },
        );
        draft.edit({ yearStart: 1724 });
        locked = true;
        draft.edit({ yearStart: 1800 });

        expect(draft.state.value.yearStart).toBe(1724);
        expect(draft.state.dirty).toEqual(['yearStart']);
    });
});

describe('a place draft: checks', () => {
    it('happyPath_aValidPlaceHasNoIssues', () => {
        expect(draftIssues(FRESH, CONTEXT)).toEqual([]);
        expect(draftIssues(FRESH, { limits: null, categories: null })).toEqual([]);
        expect(changedFields(FRESH, { ...FRESH, published: false })).toEqual(['published']);
        expect(changedFields(FRESH, null)).toHaveLength(11);
    });

    it('badPath_aMissingShapeTitleOrCategoryAndAShapeOutsideTheCityAreIssues', () => {
        const outside: PoiValue = { ...FRESH, geometry: { type: 'Point', coordinates: [28, 44] } };
        const crossed: PoiValue = {
            ...FRESH,
            geometry: {
                type: 'Polygon',
                coordinates: [
                    [
                        [26.0, 44.4],
                        [26.1, 44.5],
                        [26.1, 44.4],
                        [26.0, 44.45],
                        [26.0, 44.4],
                    ],
                ],
            },
        };

        expect(draftIssues({ ...FRESH, geometry: null, title: { ro: '' }, category: 'necunoscuta' }, CONTEXT)).toEqual([
            { path: 'geometry', code: 'validation.required' },
            { path: 'title.ro', code: 'validation.tooSmall' },
            { path: 'category', code: 'validation.reference' },
        ]);
        expect(draftIssues(outside, CONTEXT)).toEqual([{ path: 'geometry', code: 'validation.outsideCity' }]);
        expect(draftIssues(crossed, CONTEXT)).toEqual([{ path: 'geometry', code: 'validation.invalid' }]);
        expect(draftIssues({ ...FRESH, yearStart: 1900, yearEnd: 1850 }, CONTEXT)).toEqual([
            { path: 'yearEnd', code: 'validation.yearRange' },
        ]);
    });
});

describe('a place draft: years', () => {
    const DATED: PoiContext = { ...CONTEXT, latestYear: 2027 };
    const UNDATED: PoiValue = { category: 'biserici', geometry: POINT, title: { ro: 'Loc nou' }, links: [], photoIds: [], published: true };

    it('happyPath_oneYearAnOpenEndOrASpanSaves', () => {
        expect(draftIssues({ ...FRESH, yearStart: 2027 }, DATED)).toEqual([]);
        expect(draftIssues({ ...UNDATED, yearEnd: 1977 }, DATED)).toEqual([]);
        expect(draftIssues({ ...FRESH, yearStart: 1850, yearEnd: 1977 }, DATED)).toEqual([]);
    });

    it('badPath_aPlaceWithoutAYearOrAfterNextYearIsAnIssue', () => {
        expect(draftIssues(UNDATED, DATED)).toEqual([{ path: 'yearStart', code: 'validation.required' }]);
        expect(draftIssues({ ...FRESH, yearStart: 2028 }, DATED)).toEqual([{ path: 'yearStart', code: 'validation.tooBig' }]);
        expect(draftIssues({ ...FRESH, yearStart: 2028 }, CONTEXT)).toEqual([]);
    });

    it('happyPath_aStoredPlaceWithoutAYearOpensAndSavesOnceItHasOne', async () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world, { yearStart: undefined }));
        const { draft } = draftOf(world, { base: stored(world) }, DATED);

        expect(draft.state.issues).toEqual([{ path: 'yearStart', code: 'validation.required' }]);
        draft.edit({ title: { ro: 'Stavropoleos (1724)' } });
        expect(await draft.save()).toMatchObject({ ok: false, reason: 'invalid' });
        expect(world.store.writes).toEqual([]);

        draft.edit({ yearStart: 1900 });
        expect(await draft.save()).toEqual({ ok: true });
        expect(world.store.writes.at(-1)).toMatchObject({
            kind: 'update',
            fields: { title: { ro: 'Stavropoleos (1724)' }, yearStart: 1900 },
        });
    });
});

describe('a place draft: new places', () => {
    it('happyPath_aNewPlaceIsCreatedPublishedWithItsCreator', async () => {
        const world = poisWorld();
        const { draft } = draftOf(world, { value: FRESH });

        expect(draft.state.isNew).toBe(true);
        expect(draft.unsaved).toBe(false);
        const outcome = await draft.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.writes).toEqual([{ kind: 'create', path: PATH, data: { ...placeFields(FRESH) } }]);
        expect(world.store.docs.get(PATH)).toMatchObject({ published: true, createdBy: 'admin-uid' });
        expect(draft.state).toMatchObject({ isNew: false, dirty: [], saving: false });
    });

    it('badPath_anInvalidDraftWritesNothingAndDiscardReturnsToTheStart', async () => {
        const world = poisWorld();
        const { draft } = draftOf(world, { value: FRESH });
        draft.edit({ title: { ro: '' } });

        const outcome = await draft.save();
        draft.discard();

        expect(outcome).toEqual({ ok: false, reason: 'invalid', issues: [{ path: 'title.ro', code: 'validation.tooSmall' }] });
        expect(world.store.writes).toEqual([]);
        expect(draft.state.value).toEqual(FRESH);
    });

    it('happyPath_aNewPlaceIsUnsavedOnlyOnceTheAdminChangedIt', () => {
        const world = poisWorld();
        const blank: PoiValue = { category: '', geometry: null, title: { ro: '' }, links: [], photoIds: [], published: true };
        const { draft } = draftOf(world, { value: blank });

        // Finding 42 of 2026-11-01: the category filled in once the categories are listed is a default.
        draft.prefill({ category: 'biserici' });
        expect(draft.state.value.category).toBe('biserici');
        expect(draft.unsaved).toBe(false);

        draft.edit({ title: { ro: 'Loc' } });
        expect(draft.unsaved).toBe(true);
        draft.edit({ title: { ro: '' } });
        expect(draft.unsaved).toBe(false);
        draft.edit({ geometry: POINT });
        expect(draft.unsaved).toBe(true);
        draft.discard();
        expect(draft.state.value).toEqual({ ...blank, category: 'biserici' });
        expect(draft.unsaved).toBe(false);
    });

    it('badPath_aCategoryChosenBeforeTheDefaultArrivesStaysAnEdit', () => {
        const world = poisWorld();
        const blank: PoiValue = { category: '', geometry: null, title: { ro: '' }, links: [], photoIds: [], published: true };
        const { draft } = draftOf(world, { value: blank });
        draft.edit({ title: { ro: 'Loc' } });

        draft.prefill({ category: 'biserici' });
        draft.edit({ category: 'parcuri' });

        expect(draft.unsaved).toBe(true);
        draft.edit({ title: { ro: '' }, category: 'biserici' });
        expect(draft.unsaved).toBe(false);
    });

    it('badPath_aStoredPlaceTakesNoPrefill', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { draft } = draftOf(world, { base: stored(world) });
        const before = draft.state.value;

        draft.prefill({ category: 'parcuri' });

        expect(draft.state.value).toEqual(before);
        expect(draft.unsaved).toBe(false);
    });

    it('badPath_aNewPlaceStaysNewWhileItsDocumentDoesNotExist', () => {
        const world = poisWorld();
        const { draft } = draftOf(world, { value: FRESH });

        draft.rebase(null);

        expect(draft.state.gone).toBe(false);
        expect(draft.state.isNew).toBe(true);
    });
});

function placeFields(value: PoiValue): Record<string, unknown> {
    return {
        category: value.category,
        geometry: geometryToDoc(POINT),
        title: value.title,
        yearStart: value.yearStart,
        links: [],
        photoIds: [],
        published: true,
    };
}

describe('a place draft: stored places', () => {
    it('happyPath_onlyTheChangedFieldsAreWrittenAgainstTheReadVersion', async () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const base = stored(world);
        const { draft } = draftOf(world, { base });

        draft.edit({ yearStart: 1900, description: { ro: 'Text' } });
        expect(draft.state.dirty).toEqual(['description', 'yearStart']);
        const outcome = await draft.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.writes).toEqual([
            { kind: 'update', path: PATH, fields: { description: { ro: 'Text' }, yearStart: 1900 }, expected: base.version },
        ]);
        expect(draft.unsaved).toBe(false);
    });

    it('happyPath_aClearedYearIsWrittenAsAbsent', async () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world, { yearEnd: 1990 }));
        const { draft } = draftOf(world, { base: stored(world) });

        draft.edit({ yearEnd: undefined });
        await draft.save();

        expect(world.store.writes.at(-1)).toMatchObject({ kind: 'update', fields: { yearEnd: undefined } });
    });

    it('badPath_aSaveTheStoreRefusesKeepsTheDraft', async () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { draft } = draftOf(world, { base: stored(world) });
        draft.edit({ published: false });
        world.store.outcomes.push({ ok: false, reason: 'conflict' });

        const outcome = await draft.save();

        expect(outcome).toEqual({ ok: false, reason: 'conflict' });
        expect(draft.state).toMatchObject({ saving: false, dirty: ['published'] });
    });

    it('happyPath_aSnapshotMergesTheFieldsTheDraftDoesNotChange', async () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { draft } = draftOf(world, { base: stored(world) });
        draft.edit({ yearStart: 1724 });
        world.store.now += 5000;
        world.store.put(PATH, placeDoc(world, { title: { ro: 'Mănăstirea Stavropoleos' } }));

        draft.rebase(stored(world));
        draft.rebase(stored(world));
        await settle();

        expect(draft.state.value).toMatchObject({ title: { ro: 'Mănăstirea Stavropoleos' }, yearStart: 1724 });
        expect(draft.state.dirty).toEqual(['yearStart']);
        expect(draft.state.conflict).toBeNull();
    });

    it('badPath_aSnapshotThatChangedTheSameFieldIsAConflictTheAdminResolves', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { draft } = draftOf(world, { base: stored(world) });
        draft.edit({ title: { ro: 'Al meu' } });
        world.store.now += 5000;
        world.store.put(PATH, placeDoc(world, { title: { ro: 'Al lor' }, updatedBy: 'other-uid' }));
        draft.rebase(stored(world));

        expect(draft.state.conflict).toEqual({ by: 'other-uid', at: '2026-10-17T12:00:05.000Z', fields: ['title'] });
        draft.keepMine();
        expect(draft.state).toMatchObject({ conflict: null, value: { title: { ro: 'Al meu' } }, dirty: ['title'] });

        world.store.now += 5000;
        world.store.put(PATH, placeDoc(world, { title: { ro: 'Iar al lor' }, updatedBy: 'other-uid' }));
        draft.rebase(stored(world));
        draft.takeTheirs();
        expect(draft.state).toMatchObject({ conflict: null, value: { title: { ro: 'Iar al lor' } }, dirty: [] });
        draft.takeTheirs();
        expect(draft.state.conflict).toBeNull();
    });

    it('badPath_aPlaceDeletedWhileOpenIsGone', () => {
        const world = poisWorld();
        world.store.put(PATH, placeDoc(world));
        const { draft, states } = draftOf(world, { base: stored(world) });

        draft.rebase(null);
        draft.discard();
        draft.recheck();

        expect(draft.state.gone).toBe(true);
        expect(draft.unsaved).toBe(false);
        expect(states).toHaveLength(3);
    });

    it('happyPath_aNewPlacesFirstSnapshotEndsItsNewness', () => {
        const world = poisWorld();
        const { draft } = draftOf(world, { value: { ...FRESH, geometry: AREA } });
        world.store.put(PATH, placeDoc(world, { geometry: geometryToDoc(AREA), title: FRESH.title }));

        draft.rebase(stored(world));

        expect(draft.state).toMatchObject({ isNew: false, dirty: [], conflict: null });
    });
});
