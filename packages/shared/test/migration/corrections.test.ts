import { describe, expect, it } from 'vitest';

import { conePolygon } from '../../src/geo/cone.js';
import type { LngLat } from '../../src/geo/math.js';
import {
    applyLegacyCorrections,
    correctedPhoto,
    deriveLegacyCorrections,
    legacyCorrectionsSchema,
} from '../../src/migration/corrections.js';
import { migrateLegacyPhotos, type MigratedPhoto } from '../../src/migration/legacy-photos.js';

const OLD = 'https://old.example/photos/';
const LIVE = 'https://live.example/photos/';

function point(url: string, coordinates: LngLat): Record<string, unknown> {
    return { type: 'Feature', geometry: { type: 'Point', coordinates }, properties: { title: 'T', photo: url } };
}

function cone(url: string, apex: LngLat, bearing: number, fov: number): Record<string, unknown> {
    return {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [conePolygon(apex, { bearing, fov, distanceM: 40 }, 1)] },
        properties: { title: 'T', photo: url },
    };
}

function collection(features: readonly unknown[]): unknown {
    return { type: 'FeatureCollection', features };
}

const PARC: LngLat = [26.139544, 44.448214];
const PARC_LATER: LngLat = [26.139431, 44.448183];
const UNIRII: LngLat = [26.1025, 44.4268];
const OBOR: LngLat = [26.1258, 44.4493];

/** Ours as migrated: Parc Ferdinand without a cone, Unirii with one, Obor without one, Gone no longer on the old site. */
const OURS: readonly MigratedPhoto[] = migrateLegacyPhotos(
    collection([
        point(`${OLD}parcul ferdinand 1930.jpg`, PARC),
        point(`${OLD}Unirii.jpg`, UNIRII),
        cone(`${OLD}Unirii.jpg`, UNIRII, 46.8, 51),
        point(`${OLD}obor.jpg`, OBOR),
        point(`${OLD}gone.jpg`, OBOR),
    ]),
).photos;

/** The old site today: Parc Ferdinand moved and given a cone, its URL encoded, on another host. */
const LATER = collection([
    point(`${LIVE}parcul%20ferdinand%201930.jpg`, PARC_LATER),
    cone(`${LIVE}parcul ferdinand 1930.jpg`, PARC_LATER, 219.1, 50),
    point(`${LIVE}Unirii.jpg`, UNIRII),
    cone(`${LIVE}Unirii.jpg`, UNIRII, 46.8, 51),
    point(`${LIVE}obor.jpg`, OBOR),
]);

describe('deriveLegacyCorrections', () => {
    it('happyPath_reportsEveryPhotoAndCorrectsTheOneTheOldSiteChanged', () => {
        const { corrections, report } = deriveLegacyCorrections(OURS, LATER);

        expect(report).toEqual([
            { id: 'parcul-ferdinand-1930', status: 'corrected' },
            { id: 'unirii', status: 'had' },
            { id: 'obor', status: 'noCone' },
            { id: 'gone', status: 'gone' },
        ]);
        expect(corrections).toEqual({
            'parcul-ferdinand-1930': {
                location: { lat: PARC_LATER[1], lng: PARC_LATER[0] },
                bearing: 219.1,
                fov: 50,
                migrated: { location: { lat: PARC[1], lng: PARC[0] } },
                source: `${LIVE}parcul%20ferdinand%201930.jpg`,
            },
        });
        expect(legacyCorrectionsSchema.safeParse(corrections).success).toBe(true);
    });

    it('happyPath_aChangedConeKeepsTheMigratedDirectionToCompare', () => {
        const later = collection([point(`${LIVE}Unirii.jpg`, UNIRII), cone(`${LIVE}Unirii.jpg`, UNIRII, 90, 40)]);

        const { corrections } = deriveLegacyCorrections(OURS, later);

        expect(corrections['unirii']).toMatchObject({ bearing: 90, fov: 40, migrated: { bearing: 46.8, fov: 51 } });
    });

    it('happyPath_oneFileShownFromTwoPlacesMatchesEachPlace', () => {
        const near: LngLat = [UNIRII[0] + 0.0004, UNIRII[1]];
        const ours = migrateLegacyPhotos(collection([point(`${OLD}a.jpg`, UNIRII), point(`${OLD}a.jpg`, near)])).photos;
        const later = collection([point(`${LIVE}a.jpg`, near), cone(`${LIVE}a.jpg`, near, 10, 40), point(`${LIVE}a.jpg`, UNIRII)]);

        const { report, corrections } = deriveLegacyCorrections(ours, later);

        expect(report).toEqual([
            { id: 'a', status: 'noCone' },
            { id: 'a-2', status: 'corrected' },
        ]);
        expect(Object.keys(corrections)).toEqual(['a-2']);
    });

    it('badPath_notACollectionReportsEveryPhotoGone', () => {
        const { corrections, report } = deriveLegacyCorrections(OURS, { type: 'nothing' });

        expect(corrections).toEqual({});
        expect(report.every((row) => row.status === 'gone')).toBe(true);
        expect(deriveLegacyCorrections(OURS, null).report).toHaveLength(OURS.length);
        expect(deriveLegacyCorrections(OURS, collection([null, { properties: { photo: 'https://live.example/' } }])).corrections).toEqual(
            {},
        );
    });
});

describe('correctedPhoto and applyLegacyCorrections', () => {
    const { corrections } = deriveLegacyCorrections(OURS, LATER);

    it('happyPath_aPhotoStillAsMigratedTakesTheOldSitesPlaceAndDirection', () => {
        const [parc, unirii] = applyLegacyCorrections(OURS, corrections);

        expect(parc?.photo).toMatchObject({ location: { lat: PARC_LATER[1], lng: PARC_LATER[0] }, bearing: 219.1, fov: 50 });
        expect(unirii).toBe(OURS[1]);
    });

    it('badPath_aPhotoMovedSinceKeepsItsPlace', () => {
        const parc = { id: 'parcul-ferdinand-1930', location: { lat: PARC[1], lng: PARC[0] } };
        const moved = { ...parc, location: { lat: 44.5, lng: 26.1 } };

        expect(correctedPhoto(moved, corrections)).toBe(moved);
        expect(correctedPhoto({ ...parc, bearing: 10, fov: 30 }, corrections)).toMatchObject({ bearing: 10, fov: 30 });
    });
});
