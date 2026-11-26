import { FIRESTORE_PATHS, type LayerDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { layersModule } from '../../src/layers/layers.js';
import { publishCheck, type LayersState } from '../../src/layers/state.js';
import { failure, settle } from '../app/fakes.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc, LAYER_PATH, layerDoc, RecordingPreview } from './fixtures.js';

function open(seed: Readonly<Record<string, LayerDoc>> = { corona: layerDoc() }, params: readonly string[] = []) {
    const world = contentWorld();
    for (const [id, doc] of Object.entries(seed)) {
        world.store.docs.set(LAYER_PATH(id), doc);
    }
    world.store.docs.set(CITY_PATH, cityDoc());
    const store = layersModule.create(world.services);
    const states: LayersState[] = [];
    store.subscribe((state) => states.push(state));
    const preview = new RecordingPreview();
    store.intents.attachPreview(preview);
    store.open(params);
    return { world, store, states, preview };
}

function stored(world: ContentWorld, id: string): Record<string, unknown> | undefined {
    return world.store.docs.get(LAYER_PATH(id));
}

describe('the layers list', () => {
    it('happyPath_layersAreListedTopFirstLive', () => {
        const { store, world } = open({ low: layerDoc({ order: 1 }), high: layerDoc({ order: 5 }) });

        expect(store.state.list.items.map((layer) => layer.id)).toEqual(['high', 'low']);
        world.store.put(LAYER_PATH('new'), layerDoc({ order: 9 }));
        expect(store.state.list.items[0]?.id).toBe('new');
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_moveUpWritesTheOrderOfTheMovedLayersInOneBatch', async () => {
        const { store, world } = open({ top: layerDoc({ order: 5 }), bottom: layerDoc({ order: 1 }) });

        const outcome = await store.intents.move('bottom', 'up');

        expect(outcome).toEqual({ ok: true });
        expect(world.store.writes).toEqual([
            {
                kind: 'batch',
                writes: [
                    { kind: 'update', path: LAYER_PATH('bottom'), fields: { order: 5 } },
                    { kind: 'update', path: LAYER_PATH('top'), fields: { order: 1 } },
                ],
            },
        ]);
        expect(store.state.list.items.map((layer) => layer.id)).toEqual(['bottom', 'top']);
        expect(world.notices.at(-1)?.key).toBe('adminContent.layers.reordered');
        expect(store.state.reordering).toBe(false);
    });

    it('badPath_aMoveThatChangesNothingWritesNothing', async () => {
        const { store, world } = open({ top: layerDoc({ order: 5 }), bottom: layerDoc({ order: 1 }) });

        expect(await store.intents.move('top', 'up')).toBeNull();
        expect(await store.intents.moveTo('bottom', 1)).toBeNull();
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_aRefusedReorderSaysWhyAndAskedForTheSessionAgainWhenDenied', async () => {
        const { store, world } = open({ top: layerDoc({ order: 5 }), bottom: layerDoc({ order: 1 }) });
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        await store.intents.moveTo('bottom', 0);

        expect(world.notices.at(-1)?.key).toBe('adminContent.layers.refused.denied');
        expect(world.denials.count).toBe(1);
    });

    it('badPath_aFailedListenerShowsTheErrorAndTryAgainReadsAgain', () => {
        const { store, world } = open();
        world.store.fail(FIRESTORE_PATHS.layers(CITY), { kind: 'failed', code: 'internal' });
        expect(store.state.list.status).toBe('error');

        store.intents.retry();

        expect(store.state.list.status).toBe('ready');
    });
});

describe('the layer editor', () => {
    it('happyPath_slidersPreviewLiveAndSaveWritesOnlyTheChangedFields', async () => {
        const { store, world, preview } = open(undefined, ['corona']);

        store.intents.setOpacity(40);
        store.intents.setAdjustment('contrast', 20);
        store.intents.setAdjustment('saturation', -30);

        expect(preview.last).toEqual({
            kind: 'layer',
            id: 'corona',
            opacity: 0.4,
            visible: true,
            adjustments: { contrast: 0.2, saturation: -0.3 },
        });
        expect(world.store.writes).toEqual([]);
        expect(store.hasUnsavedChanges()).toBe(true);

        await store.intents.save();

        expect(stored(world, 'corona')).toMatchObject({ opacity: 0.4, adjustments: { contrast: 0.2, saturation: -0.3 } });
        expect(world.notices.at(-1)?.key).toBe('adminContent.layers.saved');
        expect(store.state.editor?.draft.dirty).toEqual([]);
    });

    it('badPath_theBlackLevelStopsAtTheWhiteLevel', () => {
        const { store } = open(undefined, ['corona']);

        store.intents.setAdjustment('brightnessMax', 60);
        store.intents.setAdjustment('brightnessMin', 90);

        expect(store.state.editor?.draft.value?.adjustments).toEqual({ brightnessMin: 0.6, brightnessMax: 0.6 });
    });

    it('happyPath_resetReturnsEveryAdjustmentToNeutral', async () => {
        const { store, world, preview } = open({ corona: layerDoc({ adjustments: { contrast: 0.5 } }) }, ['corona']);

        store.intents.resetAdjustments();

        expect(preview.last).toMatchObject({ adjustments: {} });
        await store.intents.save();
        expect(stored(world, 'corona')?.['adjustments']).toBeUndefined();
    });

    it('badPath_discardTakesTheMapBackAndWritesNothing', () => {
        const { store, world, preview } = open(undefined, ['corona']);
        store.intents.setAdjustment('contrast', 40);

        store.intents.discard();

        expect(preview.last).toMatchObject({ opacity: 1, adjustments: {} });
        expect(world.store.writes).toEqual([]);
        store.open([]);
        expect(preview.calls.at(-1)).toEqual(['restore', { kind: 'layer', id: 'corona' }]);
    });

    it('happyPath_textsAndSwitchesAreEditedAndSaved', async () => {
        const { store, world } = open(undefined, ['corona']);

        store.intents.edit({ label: { ro: 'Corona', en: 'Corona' }, defaultVisible: true, attribution: 'USGS' });
        await store.intents.save();

        expect(stored(world, 'corona')).toMatchObject({ label: { ro: 'Corona', en: 'Corona' }, defaultVisible: true, attribution: 'USGS' });
    });

    it('badPath_aLayerThatIsNotReadyCannotBePublished', async () => {
        const { store, world } = open({ corona: layerDoc({ status: 'processing', published: false }) }, ['corona']);

        store.intents.edit({ published: true });
        const outcome = await store.intents.save();

        expect(outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect(world.notices.at(-1)?.key).toBe('adminContent.layers.refused.invalid');
        expect(publishCheck(layerDoc())).toEqual([]);
    });

    it('badPath_aConflictIsResolvedByTheAdmin', async () => {
        const { store, world } = open(undefined, ['corona']);
        store.intents.setOpacity(40);
        world.store.put(
            LAYER_PATH('corona'),
            layerDoc({ opacity: 0.9, updatedBy: 'other', updatedAt: { seconds: 1_791_000_000, nanoseconds: 0 } }),
        );
        expect(store.state.editor?.draft.conflict?.fields).toEqual(['opacity']);
        expect(await store.intents.save()).toBeNull();

        store.intents.takeTheirs();
        expect(store.state.editor?.draft.value?.opacity).toBeCloseTo(0.9, 10);
        store.intents.setOpacity(30);
        world.store.put(LAYER_PATH('corona'), layerDoc({ opacity: 0.8, updatedAt: { seconds: 1_792_000_000, nanoseconds: 0 } }));
        store.intents.keepMine();

        expect(store.state.editor?.draft.value?.opacity).toBeCloseTo(0.3, 10);
        await store.intents.save();
        expect(stored(world, 'corona')?.['opacity']).toBeCloseTo(0.3, 10);
    });

    it('badPath_anUnknownLayerIsNotFoundAndADeletedOneIsGone', () => {
        const { store, world } = open(undefined, ['missing']);
        expect(store.state.editor).toMatchObject({ id: 'missing', notFound: true });

        store.open(['corona']);
        world.store.drop(LAYER_PATH('corona'));

        expect(store.state.editor).toMatchObject({ notFound: false, draft: { gone: true } });
    });

    it('badPath_aFailedDocumentListenerShowsTheErrorUntilTryAgain', () => {
        const { store, world } = open(undefined, ['corona']);
        world.store.fail(LAYER_PATH('corona'), { kind: 'failed', code: 'internal' });
        expect(store.state.editor?.doc.status).toBe('error');

        store.intents.retry();

        expect(store.state.editor?.doc.status).toBe('ready');
    });

    it('badPath_intentsWithoutAnOpenLayerDoNothing', async () => {
        const { store, world } = open();
        store.intents.edit({ published: false });
        store.intents.setOpacity(10);
        store.intents.setAdjustment('contrast', 10);
        store.intents.resetAdjustments();
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.askDelete();

        expect(await store.intents.save()).toBeNull();
        expect(store.state.deletion).toEqual({ phase: 'idle' });
        expect(world.store.writes).toEqual([]);
    });
});

describe('the layer editor fields', () => {
    it('happyPath_typedTextsBecomeTheirFields', async () => {
        const { store, world } = open(undefined, ['corona']);

        store.intents.setField('label.ro', 'Corona KH-4B');
        store.intents.setField('label.en', 'Corona KH-4B');
        store.intents.setField('description.ro', 'Imagine declasificată');
        store.intents.setField('attribution', ' USGS EROS ');
        store.intents.setField('year', '1969');
        store.intents.setField('date', '1969-05-12');
        await store.intents.save();

        expect(stored(world, 'corona')).toMatchObject({
            label: { ro: 'Corona KH-4B', en: 'Corona KH-4B' },
            description: { ro: 'Imagine declasificată' },
            attribution: 'USGS EROS',
            year: 1969,
            date: '1969-05-12',
        });
    });

    it('badPath_anEmptyOptionalTextIsRemovedAndABrokenYearIsNamed', async () => {
        const { store } = open({ corona: layerDoc({ attribution: 'USGS', description: { ro: 'x', en: 'y' } }) }, ['corona']);

        store.intents.setField('attribution', ' ');
        store.intents.setField('description.en', '');
        store.intents.setField('description.ro', '');
        store.intents.setField('year', '19x9');
        const outcome = await store.intents.save();

        expect(store.state.editor?.draft.value).toMatchObject({ attribution: undefined, description: undefined });
        expect(outcome).toMatchObject({ ok: false, reason: 'invalid', issues: [{ path: 'year' }] });
        store.close();
        store.intents.setField('year', '1970');
    });
});

describe('deleting a layer', () => {
    it('happyPath_askThenLayersDeleteQueuesTheTilesetDeletion', async () => {
        const { store, world } = open(undefined, ['corona']);
        world.callables.answer('layers.delete', () => ({ jobId: 'ld-1', runsAt: '2026-10-24T08:30:00.000Z' }));

        store.intents.askDelete();
        expect(store.state.deletion).toEqual({ phase: 'confirm', id: 'corona', label: 'Corona 1968', graceDays: 7 });
        const deleted = await store.intents.confirmDelete();

        expect(deleted).toBe(true);
        expect(world.callables.calls).toEqual([{ name: 'layers.delete', request: { cityId: CITY, layerId: 'corona' } }]);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.layers.deleted', params: { name: 'Corona 1968', date: '2026-10-24' } });
        expect(store.state.deletion).toEqual({ phase: 'idle' });
    });

    it('badPath_cancelKeepsTheLayerAndARefusalIsShown', async () => {
        const { store, world } = open(undefined, ['corona']);
        world.callables.fail('layers.delete', failure('failed-precondition', 'apiError.layers.busy'));

        store.intents.askDelete();
        store.intents.cancelDelete();
        expect(await store.intents.confirmDelete()).toBe(false);
        expect(world.callables.calls).toEqual([]);

        store.intents.askDelete();
        expect(await store.intents.confirmDelete()).toBe(false);
        expect(world.notices.at(-1)?.key).toBe('apiError.layers.busy');

        world.callables.fail('layers.delete', new Error('network'));
        store.intents.askDelete();
        await store.intents.confirmDelete();
        expect(world.notices.at(-1)?.key).toBe('apiError.unavailable');
    });
});

describe('linking a layer', () => {
    it('happyPath_theCitysTilesetIsLinkedAndItsIdReturned', async () => {
        const { store, world } = open();
        world.callables.answer('layers.link', () => ({ layerId: 'planul-1911' }));

        store.intents.openLink();
        store.intents.openLink();
        store.intents.editLink({ address: 'e2e-user.plan-1911', labelRo: 'Planul 1911', year: '1911' });
        const id = await store.intents.submitLink();

        expect(id).toBe('planul-1911');
        expect(world.callables.calls[0]?.request).toMatchObject({ source: { type: 'mapbox', tilesetId: 'e2e-user.plan-1911' } });
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.layers.linked', params: { name: 'Planul 1911' } });
        expect(store.state.link).toBeNull();
        expect(world.store.listeners(CITY_PATH)).toBe(1);
    });

    it('badPath_issuesShowOnlyOnceTheAdminTriedAndAForeignTilesetAtOnce', async () => {
        const { store, world } = open();
        store.intents.openLink();
        store.intents.editLink({ address: 'bad' });
        expect(store.state.link?.issues).toEqual([]);

        expect(await store.intents.submitLink()).toBeNull();
        expect(store.state.link?.issues.map((issue) => issue.path)).toContain('address');

        store.intents.editLink({ address: 'mapbox.satellite', labelRo: 'Satelit', year: '2020' });
        expect(store.state.link?.refusal).toEqual({ code: 'apiError.layers.foreignTileset', params: { owner: 'mapbox' } });
        world.store.put(CITY_PATH, cityDoc({ mapbox: { user: 'mapbox' } }));
        expect(store.state.link?.refusal).toBeNull();
        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_theServersRefusalStaysInTheDialog', async () => {
        const { store, world } = open();
        world.callables.fail('layers.link', failure('already-exists', 'apiError.layers.alreadyLinked', { layer: 'Plan' }));
        store.intents.openLink();
        store.intents.editLink({ address: 'https://tiles.example.test/{z}/{x}/{y}.png', labelRo: 'Plan', year: '1911', tileSize: 512 });
        expect(store.state.link?.origins).toEqual(['https://tiles.example.test']);

        expect(await store.intents.submitLink()).toBeNull();

        expect(store.state.link).toMatchObject({ sending: false, refusal: { code: 'apiError.layers.alreadyLinked' } });
        store.intents.closeLink();
        expect(await store.intents.submitLink()).toBeNull();
        store.intents.editLink({ address: 'x' });
        expect(store.state.link).toBeNull();
    });
});

describe('linking a layer: Check (M3, imagery.probeTiles)', () => {
    const XYZ = 'https://tiles.example.test/{z}/{x}/{y}.png';

    it('happyPath_checkAsksOneTileAndANewAddressForgetsTheAnswer', async () => {
        const { store, world } = open();
        world.callables.answer('imagery.probeTiles', () => ({ contentType: 'image/png', tile: { z: 12, x: 2337, y: 1489 } }));
        store.intents.openLink();
        store.intents.editLink({ address: XYZ, tileSize: 512 });

        const checking = store.intents.checkLink();
        const during = store.state.link?.probe;
        await store.intents.checkLink();
        await checking;

        expect(during).toEqual({ status: 'checking' });
        expect(world.callables.calls.map((call) => [call.name, call.request])).toEqual([
            ['imagery.probeTiles', { cityId: CITY, source: { type: 'xyz', tiles: [XYZ], tileSize: 512 } }],
        ]);
        expect(store.state.link?.probe).toEqual({ status: 'ok', contentType: 'image/png' });
        store.intents.editLink({ labelRo: 'Plan' });
        expect(store.state.link?.probe.status).toBe('ok');
        store.intents.editLink({ tileSize: 256 });
        expect(store.state.link?.probe).toEqual({ status: 'idle' });
    });

    it('badPath_aFailedCheckKeepsLinkOffUntilTheAddressChanges', async () => {
        const { store, world } = open();
        world.callables.fail('imagery.probeTiles', failure('failed-precondition', 'apiError.imagery.tilesNotImage'));
        world.callables.answer('layers.link', () => ({ layerId: 'plan' }));
        store.intents.openLink();
        store.intents.editLink({ address: XYZ, labelRo: 'Plan', year: '1911' });

        await store.intents.checkLink();
        const refused = store.state.link?.probe;
        const linked = await store.intents.submitLink();
        world.callables.fail('imagery.probeTiles', failure('unavailable', 'apiError.imagery.tilesUnreachable', { status: '503' }));
        await store.intents.checkLink();
        const unreachable = store.state.link?.probe;
        world.callables.fail('imagery.probeTiles', new Error('network'));
        await store.intents.checkLink();

        expect(refused).toEqual({ status: 'failed', refusal: { code: 'apiError.imagery.tilesNotImage' } });
        expect(linked).toBeNull();
        expect(unreachable).toEqual({
            status: 'failed',
            refusal: { code: 'apiError.imagery.tilesUnreachable', params: { status: '503' } },
        });
        expect(store.state.link?.probe).toEqual({ status: 'failed', refusal: { code: 'apiError.unavailable' } });
        expect(world.callables.calls.map((call) => call.name)).not.toContain('layers.link');
        store.intents.editLink({ address: `${XYZ}?v=2` });
        expect(await store.intents.submitLink()).toBe('plan');
    });

    it('badPath_anAddressItsOwnChecksRefuseIsNeverAsked', async () => {
        const { store, world } = open();
        store.intents.openLink();
        store.intents.editLink({ address: 'http://tiles.example.test/{z}/{x}/{y}.png' });
        await store.intents.checkLink();
        const invalid = store.state.link;
        store.intents.editLink({ address: 'mapbox.satellite' });
        await store.intents.checkLink();
        const foreign = store.state.link?.probe;
        store.intents.closeLink();
        await store.intents.checkLink();

        expect(invalid?.probe).toEqual({ status: 'idle' });
        expect(invalid?.issues.map((issue) => issue.path)).toContain('address');
        expect(foreign).toEqual({ status: 'failed', refusal: { code: 'apiError.layers.foreignTileset', params: { owner: 'mapbox' } } });
        expect(world.callables.calls).toEqual([]);
    });

    it('badPath_anAnswerForAnAddressChangedMeanwhileIsDropped', async () => {
        const { store, world } = open();
        const pending: { resolve?: (value: { contentType: 'image/png'; tile: { z: number; x: number; y: number } }) => void } = {};
        world.callables.answer(
            'imagery.probeTiles',
            () =>
                new Promise((done) => {
                    pending.resolve = done;
                }),
        );
        store.intents.openLink();
        store.intents.editLink({ address: XYZ });
        const checking = store.intents.checkLink();
        store.intents.editLink({ address: `${XYZ}?v=2` });
        pending.resolve?.({ contentType: 'image/png', tile: { z: 12, x: 1, y: 1 } });
        await checking;

        expect(store.state.link?.probe).toEqual({ status: 'idle' });
    });
});

describe('the area store', () => {
    it('happyPath_closeDetachesEveryListenerAndDestroyLeavesTheMap', async () => {
        const { store, world, preview } = open(undefined, ['corona']);
        store.intents.openLink();
        store.intents.setOpacity(10);
        store.close();
        await settle();

        expect(world.store.listeners()).toBe(0);
        expect(store.state.editor).toBeNull();
        store.destroy();
        expect(preview.calls.at(-1)).toEqual(['restore', { kind: 'layer', id: 'corona' }]);
    });
});
