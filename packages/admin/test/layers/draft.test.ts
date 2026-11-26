import { layerDocSchema, type LayerDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { Stored } from '../../src/content/services.js';
import { changedFields, EditDraft, sameValue, type DraftState } from '../../src/layers/draft.js';
import { contentWorld } from '../content/world.js';
import { LAYER_PATH, layerDoc } from './fixtures.js';

const EDITABLE = ['label', 'description', 'opacity', 'adjustments', 'published'] as const;

function stored(data: LayerDoc, version = '2026-10-01T08:00:00.000Z'): Stored<LayerDoc> {
    return { id: 'corona', path: LAYER_PATH('corona'), data, version, pending: false };
}

function draftOf(check?: (value: LayerDoc) => { path: string; code: 'validation.value' }[]) {
    const world = contentWorld();
    const states: DraftState<LayerDoc>[] = [];
    const spec = { path: LAYER_PATH('corona'), schema: layerDocSchema, editable: EDITABLE };
    const draft = new EditDraft<LayerDoc>(check === undefined ? spec : { ...spec, check }, {
        store: world.services.store,
        changed: (state) => states.push(state),
    });
    return { world, draft, states };
}

describe('an edit draft: a revoked admin', () => {
    it('badPath_aLockedDraftTakesNoEdit', () => {
        const world = contentWorld();
        let locked = false;
        const draft = new EditDraft<LayerDoc>(
            { path: LAYER_PATH('corona'), schema: layerDocSchema, editable: EDITABLE },
            { store: world.services.store, changed: () => undefined, locked: () => locked },
        );
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.5 });
        locked = true;
        draft.edit({ opacity: 0.2 });

        expect(draft.state.value?.opacity).toBe(0.5);
    });
});

describe('value comparison', () => {
    it('happyPath_objectsWithTheSameFieldsInAnotherOrderAreTheSame', () => {
        expect(sameValue({ ro: 'a', en: 'b' }, { en: 'b', ro: 'a' })).toBe(true);
        expect(sameValue([1, 2], [2, 1])).toBe(false);
        expect(sameValue(undefined, undefined)).toBe(true);
        expect(sameValue(undefined, null)).toBe(false);
    });

    it('happyPath_onlyTheEditableFieldsThatDifferAreChanged', () => {
        const base = layerDoc();
        expect(changedFields(EDITABLE, base, { ...base, opacity: 0.5, year: 1970 })).toEqual(['opacity']);
    });
});

describe('EditDraft', () => {
    it('happyPath_theFirstSnapshotStartsAnEditThatOnlyTheDraftHolds', () => {
        const { draft, world } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4 });

        expect(draft.state.dirty).toEqual(['opacity']);
        expect(draft.unsaved).toBe(true);
        expect(draft.path).toBe(LAYER_PATH('corona'));
        expect(world.store.writes).toEqual([]);
    });

    it('happyPath_saveWritesTheChangedFieldsGuardedByTheVersionRead', async () => {
        const { draft, world } = draftOf();
        world.store.docs.set(LAYER_PATH('corona'), layerDoc());
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4, adjustments: undefined });

        const outcome = await draft.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.writes).toEqual([
            { kind: 'update', path: LAYER_PATH('corona'), fields: { opacity: 0.4 }, expected: '2026-10-01T08:00:00.000Z' },
        ]);
        expect(draft.state.saving).toBe(false);
    });

    it('badPath_nothingToSaveSendsNothing', async () => {
        const { draft, world } = draftOf();
        expect(await draft.save()).toBeNull();
        draft.edit({ opacity: 0.2 });
        draft.load(stored(layerDoc()));
        expect(await draft.save()).toBeNull();
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_anInvalidDocumentIsNamedAsItIsTypedAndRefusedBeforeAnythingLeaves', async () => {
        const { draft, world } = draftOf((value) =>
            value.published && value.status !== 'ready' ? [{ path: 'published', code: 'validation.value' }] : [],
        );
        draft.load(stored(layerDoc({ status: 'processing', published: false })));
        draft.edit({ label: { ro: ' ' }, published: true });
        expect(draft.state.issues.map((issue) => issue.path)).toEqual(['label.ro', 'published']);

        const outcome = await draft.save();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        draft.edit({ label: { ro: 'Corona' } });
        expect(draft.state.issues.map((issue) => issue.path)).toEqual(['published']);
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_aConflictingSaveKeepsTheDraftAndItsIssues', async () => {
        const { draft, world } = draftOf();
        world.store.docs.set(LAYER_PATH('corona'), layerDoc());
        world.store.outcomes.push({ ok: false, reason: 'conflict' });
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.3 });

        expect(await draft.save()).toEqual({ ok: false, reason: 'conflict' });
        expect(draft.state.dirty).toEqual(['opacity']);
    });

    it('happyPath_aSnapshotOfOtherFieldsMergesIntoTheDraft', () => {
        const { draft } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4 });
        draft.load(stored(layerDoc({ label: { ro: 'Corona nouă' }, updatedBy: 'other' }), '2026-10-02T08:00:00.000Z'));

        expect(draft.state.value).toMatchObject({ opacity: 0.4, label: { ro: 'Corona nouă' } });
        expect(draft.state.base?.version).toBe('2026-10-02T08:00:00.000Z');
        expect(draft.state.conflict).toBeNull();
    });

    it('happyPath_theSnapshotOfOwnSaveIsNoConflict', () => {
        const { draft } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4 });
        draft.load(stored(layerDoc({ opacity: 0.4 }), '2026-10-02T08:00:00.000Z'));

        expect(draft.state.conflict).toBeNull();
        expect(draft.state.dirty).toEqual([]);
    });
});

describe('EditDraft with another admin', () => {
    it('badPath_anotherAdminsChangeOfTheSameFieldRaisesTheConflict', () => {
        const { draft } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4, published: false });
        draft.load(stored(layerDoc({ opacity: 0.9, updatedBy: 'other-uid' }), '2026-10-02T08:00:00.000Z'));

        expect(draft.state.conflict).toEqual({ by: 'other-uid', at: '2026-10-02T08:00:00.000Z', fields: ['opacity'] });
    });

    it('happyPath_keepMineRebasesWithEveryOwnEdit', async () => {
        const { draft, world } = draftOf();
        world.store.docs.set(LAYER_PATH('corona'), layerDoc({ opacity: 0.9, updatedAt: { seconds: 1_791_000_000, nanoseconds: 0 } }));
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4, published: false });
        draft.load(stored(layerDoc({ opacity: 0.9 }), '2026-10-02T08:00:00.000Z'));
        expect(await draft.save()).toBeNull();

        draft.keepMine();

        expect(draft.state.conflict).toBeNull();
        expect(draft.state.value).toMatchObject({ opacity: 0.4, published: false });
        expect(draft.state.base?.version).toBe('2026-10-02T08:00:00.000Z');
    });

    it('happyPath_takeTheirsKeepsOnlyTheEditsThatDoNotClash', () => {
        const { draft } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4, published: false });
        draft.load(stored(layerDoc({ opacity: 0.9 }), '2026-10-02T08:00:00.000Z'));

        draft.takeTheirs();

        expect(draft.state.value).toMatchObject({ opacity: 0.9, published: false });
        expect(draft.state.dirty).toEqual(['published']);
    });

    it('badPath_resolvingWithoutAConflictChangesNothing', () => {
        const { draft, states } = draftOf();
        draft.keepMine();
        draft.takeTheirs();
        expect(states).toEqual([]);
    });

    it('badPath_aDocumentDeletedWhileOpenIsGoneAndCannotBeSaved', async () => {
        const { draft } = draftOf();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4 });
        draft.load(null);

        expect(draft.state.gone).toBe(true);
        expect(await draft.save()).toBeNull();
    });

    it('badPath_aMissingDocumentIsNotGone', () => {
        const { draft } = draftOf();
        draft.load(null);
        expect(draft.state).toMatchObject({ gone: false, base: null, value: null });
    });

    it('happyPath_rightAfterASaveNothingIsUnsavedUntilTheNextEdit', async () => {
        const { draft, world } = draftOf();
        world.store.docs.set(LAYER_PATH('corona'), layerDoc());
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.4 });

        // Saved, its snapshot not here yet: leaving loses nothing.
        await expect(draft.save()).resolves.toEqual({ ok: true });
        expect(draft.state.dirty).toEqual(['opacity']);
        expect(draft.unsaved).toBe(false);

        // The next edit is unsaved again.
        draft.edit({ opacity: 0.6 });
        expect(draft.unsaved).toBe(true);
    });

    it('happyPath_discardReturnsToTheDocumentAsRead', () => {
        const { draft } = draftOf();
        draft.discard();
        expect(draft.state.value).toBeNull();
        draft.load(stored(layerDoc()));
        draft.edit({ opacity: 0.1 });
        draft.discard();
        expect(draft.state.value?.opacity).toBe(1);
        expect(draft.unsaved).toBe(false);
    });
});
