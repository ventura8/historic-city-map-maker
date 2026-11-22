import { describe, expect, it } from 'vitest';

import { placeMedia, placeMediaKinds } from '../../src/overlays/place-media.js';
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
        const media = placeMedia({ id: 'p', photoIds: ['missing', 'twice'] }, { layers: [], photos: [undated, photo('twice', undefined, 1900, ['p'])] });
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
