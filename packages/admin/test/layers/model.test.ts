import { describe, expect, it } from 'vitest';

import { layerItemOf, moved, moveTarget, opacityFromPercent, orderChanges, topFirst, type LayerItem } from '../../src/layers/model.js';
import { PreviewLayer } from '../../src/layers/preview.js';
import { LAYER_PATH, layerDoc, RecordingPreview } from './fixtures.js';

function item(id: string, order: number, year = 1968): LayerItem {
    return { ...layerItemOf({ id, path: LAYER_PATH(id), data: layerDoc({ order, year }), version: `v-${id}`, pending: false }) };
}

describe('the layer list', () => {
    it('happyPath_anItemSaysWhetherItWasLinked', () => {
        const linked = layerItemOf({
            id: 'plan',
            path: LAYER_PATH('plan'),
            data: layerDoc({ mapbox: undefined }),
            version: 'v',
            pending: false,
        });
        expect([item('corona', 1).linked, linked.linked, linked.sourceType]).toEqual([false, true, 'mapbox']);
    });

    it('badPath_aLayerOnItsOwnTilesIsNeverLinked', () => {
        const own = layerItemOf({
            id: 'kh9',
            path: LAYER_PATH('kh9'),
            data: layerDoc({
                mapbox: undefined,
                source: { type: 'pmtiles', url: 'https://storage.googleapis.com/b/tiles/c/kh9/v.pmtiles' },
                currentVersion: 'v',
            }),
            version: 'v',
            pending: false,
        });
        expect([own.linked, own.sourceType]).toEqual([false, 'pmtiles']);
    });

    it('happyPath_topFirstByOrderThenYearThenId', () => {
        const items = [item('a', 1, 1970), item('b', 3), item('c', 1, 1980), item('d', 1, 1980)];
        expect(topFirst(items).map((layer) => layer.id)).toEqual(['b', 'c', 'd', 'a']);
    });

    it('happyPath_aSliderPercentIsAStoredOpacity', () => {
        expect([opacityFromPercent(40), opacityFromPercent(40.4), opacityFromPercent(140), opacityFromPercent(Number.NaN)]).toEqual([
            0.4, 0.4, 1, 1,
        ]);
    });
});

describe('reordering', () => {
    const list = [item('top', 9), item('middle', 5), item('bottom', 2)];

    it('happyPath_moveUpAndDownStopAtTheEnds', () => {
        expect([moveTarget(list, 'middle', 'up'), moveTarget(list, 'middle', 'down')]).toEqual([0, 2]);
        expect([moveTarget(list, 'top', 'up'), moveTarget(list, 'bottom', 'down')]).toEqual([0, 2]);
    });

    it('happyPath_movingHandsTheHeldValuesOutAgainAndWritesOnlyTheMovedLayers', () => {
        const after = moved(list, 'bottom', 0);

        expect(after.map((layer) => layer.id)).toEqual(['bottom', 'top', 'middle']);
        expect(orderChanges(list, after)).toEqual([
            { id: 'bottom', order: 9, version: 'v-bottom' },
            { id: 'top', order: 5, version: 'v-top' },
            { id: 'middle', order: 2, version: 'v-middle' },
        ]);
        expect(orderChanges(list, moved(list, 'middle', 0))).toEqual([
            { id: 'middle', order: 9, version: 'v-middle' },
            { id: 'top', order: 5, version: 'v-top' },
        ]);
    });

    it('badPath_sharedValuesAreNumberedAgainAndAnUnknownIdMovesNothing', () => {
        const tied = [item('a', 1), item('b', 1), item('c', 0)];
        expect(orderChanges(tied, moved(tied, 'c', 0))).toEqual([
            { id: 'c', order: 2, version: 'v-c' },
            { id: 'b', order: 0, version: 'v-b' },
        ]);
        expect(moved(list, 'nope', 0)).toEqual(list);
        expect(orderChanges(list, moved(list, 'top', -5))).toEqual([]);
    });
});

describe('the preview layer', () => {
    it('happyPath_showsChangesAndShowsThemAgainOnAMapAttachedLater', () => {
        const preview = new PreviewLayer();
        preview.show({ kind: 'layer', id: 'corona', opacity: 0.5 });
        preview.show({ kind: 'layer', id: 'corona', opacity: 0.4 });
        preview.show({ kind: 'photos-overlay', opacity: 0.6 });
        const map = new RecordingPreview();

        preview.attach(map);

        expect(map.calls).toEqual([
            ['preview', { kind: 'layer', id: 'corona', opacity: 0.4 }],
            ['preview', { kind: 'photos-overlay', opacity: 0.6 }],
        ]);
        expect(preview.changes).toHaveLength(2);
    });

    it('badPath_clearTakesEveryOverlayBackAndWorksWithoutAMap', () => {
        const preview = new PreviewLayer();
        preview.show({ kind: 'poi-category', id: 'cladiri', opacity: 0.2 });
        preview.clear();
        const map = new RecordingPreview();
        preview.attach(map);
        preview.show({ kind: 'photos-overlay', opacity: 0.3 });
        preview.clear();

        expect(map.calls).toEqual([
            ['preview', { kind: 'photos-overlay', opacity: 0.3 }],
            ['restore', { kind: 'photos-overlay' }],
        ]);
        expect(preview.changes).toEqual([]);
    });
});
