import { describe, expect, it } from 'vitest';

import { PLACE_MEDIA_CATEGORY, placeMedia, placeMediaKinds, withPlaceMedia } from '../../src/overlays/place-media.js';
import { manifestSchema, type Layer, type Photo } from '../../src/schemas/manifest.js';
import { validLayer, validManifest, validPhoto } from '../fixtures/manifest.js';

const layer = (id: string, year: number, placeIds?: string[]): Layer => ({ ...validLayer(), id, year, date: undefined, placeIds }) as Layer;
const photo = (id: string, kind: string | undefined, year: number, placeIds?: string[]): Photo =>
    ({ ...validPhoto(), id, kind, year, yearEnd: undefined, placeIds }) as Photo;

describe('placeMedia', () => {
    it('happyPath_sortsTheMediaOfAPlaceByKind', () => {
        const media = placeMedia(
            { id: 'parcul-carol', photoIds: ['listed'] },
            {
                layers: [layer('plan-1906', 1906, ['parcul-carol']), layer('other', 1900), layer('plan-1900', 1900, ['parcul-carol'])],
                photos: [
                    photo('late', undefined, 1950, ['parcul-carol']),
                    photo('early', undefined, 1910, ['parcul-carol']),
                    photo('listed', undefined, 1990),
                    photo('sky', 'aerial', 1960, ['parcul-carol']),
                    photo('hall', 'interior', 1906, ['parcul-carol']),
                    photo('elsewhere', 'interior', 1906, ['cismigiu']),
                ],
            },
        );
        expect(media.maps.map((item) => item.id)).toEqual(['plan-1900', 'plan-1906']);
        expect(media.ground.map((item) => item.id)).toEqual(['listed', 'early', 'late']);
        expect(media.aerial.map((item) => item.id)).toEqual(['sky']);
        expect(media.interior.map((item) => item.id)).toEqual(['hall']);
        expect(placeMediaKinds(media)).toEqual(['maps', 'aerial', 'ground', 'interior']);
    });

    it('badPath_unknownIdsAndUndatedItemsDoNotBreakTheList', () => {
        const undated = { ...photo('undated', undefined, 1900, ['p']), year: undefined } as Photo;
        const media = placeMedia(
            { id: 'p', photoIds: ['missing', 'twice'] },
            { layers: [], photos: [undated, photo('twice', undefined, 1900, ['p'])] },
        );
        expect(media.ground.map((item) => item.id)).toEqual(['twice', 'undated']);
        expect(placeMediaKinds(placeMedia({ id: 'none' }, { layers: [], photos: [] }))).toEqual([]);
    });
});

describe('manifest placeIds', () => {
    it('happyPath_aPhotoAndALayerNameAPlaceOfTheManifest', () => {
        const manifest = validManifest() as { layers: Record<string, unknown>[]; photos: Record<string, unknown>[] };
        manifest.layers[0] = { ...manifest.layers[0], placeIds: ['casa-uranus'] };
        manifest.photos[0] = { ...manifest.photos[0], kind: 'interior', placeIds: ['casa-uranus'] };
        expect(manifestSchema.safeParse(manifest).success).toBe(true);
    });

    it('badPath_anUnknownOrRepeatedPlaceIsRefused', () => {
        const manifest = validManifest() as { layers: Record<string, unknown>[]; photos: Record<string, unknown>[] };
        manifest.layers[0] = { ...manifest.layers[0], placeIds: ['nowhere'] };
        manifest.photos[0] = { ...manifest.photos[0], placeIds: ['casa-uranus', 'casa-uranus'] };
        const result = manifestSchema.safeParse(manifest);
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('photos.0.placeIds');
        const unknown = manifestSchema.safeParse({ ...manifest, photos: [validPhoto()] });
        expect(unknown.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['layers.0.placeIds.0']);
    });
});

describe('placeMedia: plans by level (M17 §14)', () => {
    it('happyPath_plansGroupByLevelWithTheirInteriorPhotos @S-V82-HAPPY-LEVELS', () => {
        const plan = (id: string, order: number, label: string): Layer => ({
            ...layer(id, 1934, ['dunarea']),
            level: { order, label: { ro: label } },
        });
        const room: Photo = { ...photo('hall', 'interior', 1940, ['dunarea']), level: 0 };
        const media = placeMedia(
            { id: 'dunarea' },
            {
                layers: [
                    plan('etaj-1', 1, 'Etaj 1'),
                    plan('parter', 0, 'Parter'),
                    plan('parter-b', 0, 'Parter (2)'),
                    layer('site', 1930, ['dunarea']),
                ],
                photos: [room],
            },
        );
        expect(media.maps.map((item) => item.id)).toEqual(['site']);
        expect(media.plans.map((level) => [level.order, level.label.ro, level.layers.length, level.photos.length])).toEqual([
            [0, 'Parter', 2, 1],
            [1, 'Etaj 1', 1, 0],
        ]);
        expect(placeMediaKinds(media)).toEqual(['maps', 'plans', 'interior']);
    });

    it('badPath_aPhotoOnALevelWithNoPlanIsOnlyAnInteriorPhoto @S-V82-BAD-LEVELS', () => {
        const media = placeMedia({ id: 'p' }, { layers: [], photos: [{ ...photo('x', 'interior', 1940, ['p']), level: 3 }] });
        expect(media.plans).toEqual([]);
        expect(media.interior.map((item) => item.id)).toEqual(['x']);
    });
});

describe('withPlaceMedia (M17 §15)', () => {
    it('happyPath_placesWithMediaJoinThePlaceMediaCategoryOncePerKind @S-V83-HAPPY-PLACE-MEDIA-LAYER', () => {
        const raw = validManifest() as { layers: Record<string, unknown>[]; photos: Record<string, unknown>[] };
        raw.layers[0] = { ...raw.layers[0], placeIds: ['casa-uranus'] };
        raw.photos[0] = { ...raw.photos[0], kind: 'interior', placeIds: ['casa-uranus'] };
        const manifest = manifestSchema.parse(raw);
        const shown = withPlaceMedia(manifest);

        expect(shown.poiCategories?.at(-1)).toMatchObject({ id: PLACE_MEDIA_CATEGORY, defaultVisible: false });
        const entries = (shown.pois ?? []).filter((poi) => poi.category === PLACE_MEDIA_CATEGORY);
        expect(entries.map((poi) => [poi.id, poi.group, poi.geometry.type])).toEqual([
            ['casa-uranus', 'media:maps', 'Polygon'],
            ['casa-uranus', 'media:interior', 'Point'],
        ]);
        expect(withPlaceMedia(shown)).toBe(shown);
    });

    it('badPath_aCityWithoutMediaKeepsItsManifest @S-V83-BAD-NO-MEDIA', () => {
        const raw = validManifest() as { pois: Record<string, unknown>[] };
        raw.pois[0] = { ...raw.pois[0], photoIds: [] };
        const manifest = manifestSchema.parse(raw);
        expect(withPlaceMedia(manifest)).toBe(manifest);
    });
});
