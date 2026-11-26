import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PHOTOS_OPACITY,
    findOverlay,
    hashOverlayOpacity,
    opacityPercent,
    overlayLabel,
    overlaysFromManifest,
    resetOverlays,
    withHashOpacity,
    withOverlayOpacity,
    withOverlayVisibility,
    type Overlay,
} from '../../src/overlays/model.js';
import { decodeHash, encodeHash } from '../../src/url/hash.js';
import { validateManifest } from '../../src/schemas/validation.js';
import type { Manifest } from '../../src/schemas/manifest.js';
import { validLayer, validManifest, validPoiCategory } from '../fixtures/manifest.js';

function manifestWith(patch: Record<string, unknown>): Manifest {
    const result = validateManifest({ ...validManifest(), ...patch });
    if (!result.ok) {
        throw new Error(JSON.stringify(result.issues));
    }
    return result.value;
}

/** Three layers (two in one year), the photos and two POI categories. */
function sample(): readonly Overlay[] {
    return overlaysFromManifest(
        manifestWith({
            layers: [
                { ...validLayer(), id: 'kh9-1980', year: 1980, date: '1980-07-16', order: 1, defaultVisible: false, opacity: 0.5 },
                { ...validLayer(), id: 'kh4-1966-b', order: 1 },
                { ...validLayer(), id: 'kh4-1966-a', order: 3 },
            ],
            poiCategories: [validPoiCategory(), { ...validPoiCategory(), id: 'strazi', defaultOpacity: 0.6 }],
        }),
    );
}

describe('overlaysFromManifest', () => {
    it('happyPath_layersByYearThenTopFirst_thenPhotos_thenCategories', () => {
        expect(sample().map((overlay) => [overlay.id, overlay.kind])).toEqual([
            ['kh4-1966-a', 'raster'],
            ['kh4-1966-b', 'raster'],
            ['kh9-1980', 'raster'],
            ['photos', 'photos'],
            ['cladiri', 'poi'],
            ['strazi', 'poi'],
        ]);
    });

    it('happyPath_aCategoryHiddenAtStartStartsHiddenAndResetsHidden (M27)', () => {
        const overlays = overlaysFromManifest(
            manifestWith({ poiCategories: [{ ...validPoiCategory(), defaultVisible: false, pinned: true }] }),
        );
        const category = overlays.find((overlay) => overlay.kind === 'poi');

        expect(category).toMatchObject({ visible: false, defaultVisible: false });
        expect(
            resetOverlays(withOverlayVisibility(overlays, category?.id ?? '', true)).find((overlay) => overlay.kind === 'poi')?.visible,
        ).toBe(false);
    });

    it('happyPath_defaultsComeFromTheManifest', () => {
        const overlays = sample();

        expect(findOverlay(overlays, 'kh9-1980')).toMatchObject({
            visible: false,
            opacity: 0.5,
            defaultVisible: false,
            defaultOpacity: 0.5,
        });
        expect(findOverlay(overlays, 'photos')).toMatchObject({ visible: true, opacity: 0.8 });
        expect(findOverlay(overlays, 'strazi')).toMatchObject({ visible: true, opacity: 0.6, defaultOpacity: 0.6 });
    });

    it('happyPath_labelsInBothLanguages', () => {
        const overlays = sample();
        const photos = findOverlay(overlays, 'photos');
        const category = findOverlay(overlays, 'cladiri');

        expect(photos && [overlayLabel(photos, 'ro'), overlayLabel(photos, 'en')]).toEqual(['Fotografii', 'Photos']);
        expect(category && overlayLabel(category, 'en')).toBe('Vanished buildings');
    });

    it('badPath_noPhotosOverlayOrCategoriesInTheManifest', () => {
        const manifest = validManifest();
        for (const key of ['photosOverlay', 'poiCategories', 'pois']) {
            Reflect.deleteProperty(manifest, key);
        }
        const result = validateManifest(manifest);
        const overlays = result.ok ? overlaysFromManifest(result.value) : [];

        expect(overlays.map((overlay) => overlay.id)).toEqual(['kh4-1966', 'photos']);
        expect(findOverlay(overlays, 'photos')?.opacity).toBe(DEFAULT_PHOTOS_OPACITY);
    });

    it('badPath_findOverlayOfAnUnknownId', () => {
        expect(findOverlay(sample(), 'nope')).toBeUndefined();
    });
});

describe('opacity and visibility updates', () => {
    it('happyPath_setsOneOverlayAndKeepsTheOthers', () => {
        const overlays = sample();
        const next = withOverlayOpacity(overlays, 'strazi', 0.25);

        expect(findOverlay(next, 'strazi')?.opacity).toBe(0.25);
        expect(next.filter((overlay) => !overlays.includes(overlay)).map((overlay) => overlay.id)).toEqual(['strazi']);
        expect(findOverlay(overlays, 'strazi')).toMatchObject({ opacity: 0.6 });
    });

    it.each([
        [1.7, 1],
        [-0.3, 0],
    ])('badPath_opacity_%s_isClampedTo_%s', (value, expected) => {
        expect(findOverlay(withOverlayOpacity(sample(), 'photos', value), 'photos')?.opacity).toBe(expected);
    });

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('badPath_aNonFiniteOpacity_%s_changesNothing', (value) => {
        const overlays = sample();

        expect(withOverlayOpacity(overlays, 'photos', value)).toBe(overlays);
    });

    it('badPath_unknownIdOrSameValueReturnsTheSameList', () => {
        const overlays = sample();

        expect(withOverlayOpacity(overlays, 'nope', 0.5)).toBe(overlays);
        expect(withOverlayOpacity(overlays, 'photos', 0.8)).toBe(overlays);
        expect(withOverlayVisibility(overlays, 'nope')).toBe(overlays);
        expect(withOverlayVisibility(overlays, 'photos', true)).toBe(overlays);
    });

    it('happyPath_visibilityTogglesOrIsSet', () => {
        const hidden = withOverlayVisibility(sample(), 'cladiri');

        expect(findOverlay(hidden, 'cladiri')?.visible).toBe(false);
        expect(findOverlay(withOverlayVisibility(hidden, 'cladiri'), 'cladiri')?.visible).toBe(true);
        expect(findOverlay(withOverlayVisibility(hidden, 'kh9-1980', true), 'kh9-1980')?.visible).toBe(true);
    });

    it('happyPath_resetRestoresTheDefaults', () => {
        const changed = withOverlayVisibility(withOverlayOpacity(sample(), 'kh9-1980', 0.1), 'photos', false);

        expect(resetOverlays(changed)).toEqual(sample());
    });

    it.each([
        [0.374, 37],
        [0.375, 38],
        [2, 100],
        [-1, 0],
    ])('happyPath_opacityPercent_%s_is_%s', (opacity, percent) => {
        expect(opacityPercent(opacity)).toBe(percent);
    });
});

describe('URL hash opacities', () => {
    it('happyPath_opacityAppliesToTheVisibleRastersAndOpEntriesWin', () => {
        const next = withHashOpacity(sample(), { opacity: 0.3, overlayOpacity: { 'kh9-1980': 0.9, photos: 0.5 } });

        expect(next.map((overlay) => [overlay.id, overlay.opacity])).toEqual([
            ['kh4-1966-a', 0.3],
            ['kh4-1966-b', 0.3],
            ['kh9-1980', 0.9],
            ['photos', 0.5],
            ['cladiri', 0.9],
            ['strazi', 0.6],
        ]);
    });

    it('badPath_opacityLeavesHiddenRastersAtTheirOwnOpacity', () => {
        // S-V05-BAD-HASH-OUT-OF-RANGE found it: `#layers=a&opacity=0` also faded every hidden layer, and the rewritten
        // hash then carried an `op=` entry for each of them.
        const hidden = withOverlayVisibility(sample(), 'kh4-1966-b', false);

        const next = withHashOpacity(hidden, { opacity: 7 });

        expect(next.map((overlay) => [overlay.id, overlay.opacity])).toEqual([
            ['kh4-1966-a', 1],
            ['kh4-1966-b', 0.9],
            ['kh9-1980', 0.5],
            ['photos', 0.8],
            ['cladiri', 0.9],
            ['strazi', 0.6],
        ]);
        expect(hashOverlayOpacity(next)).toEqual({ 'kh4-1966-a': 1 });
    });

    it('badPath_unknownIdsAreIgnoredAndValuesClamped', () => {
        const next = withHashOpacity(sample(), { overlayOpacity: { ghost: 0.2, strazi: 7 } });

        expect(findOverlay(next, 'strazi')?.opacity).toBe(1);
        expect(next.map((overlay) => overlay.id)).not.toContain('ghost');
    });

    it('badPath_aHashWithoutOpacitiesChangesNothing', () => {
        const overlays = sample();

        expect(withHashOpacity(overlays, {})).toBe(overlays);
    });

    it('happyPath_onlyChangedOverlaysAreRecorded', () => {
        const changed = withOverlayOpacity(withOverlayOpacity(sample(), 'cladiri', 0.333), 'photos', 0.802);

        expect(hashOverlayOpacity(changed)).toEqual({ cladiri: 0.33 });
    });

    it('badPath_untouchedOverlaysWriteNoOp', () => {
        expect(hashOverlayOpacity(sample())).toBeUndefined();
    });

    it('happyPath_aReloadRestoresTheOpacities', () => {
        const changed = withOverlayOpacity(withOverlayOpacity(sample(), 'kh4-1966-b', 0.4), 'strazi', 0.2);
        const hash = encodeHash({ overlayOpacity: hashOverlayOpacity(changed) ?? {} });
        const known = new Set(sample().map((overlay) => overlay.id));

        expect(hash).toBe('#op=kh4-1966-b:40,strazi:20');
        expect(withHashOpacity(sample(), decodeHash(hash, { minZoom: 0, maxZoom: 22, overlayIds: known }))).toEqual(changed);
    });
});
