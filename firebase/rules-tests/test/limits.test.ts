/**
 * Firestore evaluates at most 1000 rule expressions per request and denies the request past that (found by these
 * tests: validating a whole photo with five links went over it). The heaviest legitimate writes, every client field
 * at its largest list, must still be allowed: a create of a photo and of a POI, an update that changes every editable
 * field of a city (but its imagery settings, saved on their own), a photo, a layer and a POI at once, and the imagery
 * settings with their twenty target years.
 */
import { FIRESTORE_PATHS, MAX_GEOMETRY_VERTICES, MAX_POI_PHOTOS, MAX_POLYGON_RINGS } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EDITS, closedRing, cityDoc, layerDoc, links, newPhoto, newPoi, photoDoc, poiDoc } from './support/documents.js';
import { createWorld, stampedBy, verdict, type Data, type World } from './support/world.js';

const CITY_ID = 'rules-limits';

let world: World;

beforeAll(async () => {
    world = await createWorld('limits');
    await world.seed(FIRESTORE_PATHS.city(CITY_ID), cityDoc(CITY_ID));
});

afterAll(async () => {
    await world.close();
});

describe('creates', () => {
    it('happyPath_aPhotoWithEveryFieldAndFiveLinksIsWithinTheLimit', async () => {
        const photo = { ...newPhoto(world.uid('admin')), links: links(5) };

        expect(await verdict(world.db('admin').doc(FIRESTORE_PATHS.photo(CITY_ID, 'heaviest')).set(photo))).toBe('allow');
    });

    it('happyPath_aPoiWithTheLargestPolygonLinksAndPhotosIsWithinTheLimit', async () => {
        const ring = closedRing(Math.floor(MAX_GEOMETRY_VERTICES / MAX_POLYGON_RINGS));
        const poi: Data = {
            ...newPoi(world.uid('admin')),
            geometry: { type: 'Polygon', rings: Array.from({ length: MAX_POLYGON_RINGS }, () => ({ points: ring })) },
            links: links(5),
            photoIds: Array.from({ length: MAX_POI_PHOTOS }, (_, index) => `p${String(index)}`),
        };

        expect(await verdict(world.db('admin').doc(FIRESTORE_PATHS.poi(CITY_ID, 'heaviest')).set(poi))).toBe('allow');
    });
});

/** The city's settings but its imagery ones, which are saved and checked on their own (M3, CR-M3-2). */
const CITY_SETTINGS: Data = Object.fromEntries(Object.entries(EDITS.city).filter(([field]) => field !== 'imagery' && field !== 'sources'));

describe('updates of every editable field at once', () => {
    it.each([
        ['city', FIRESTORE_PATHS.city(`${CITY_ID}-edit`), () => cityDoc(CITY_ID), CITY_SETTINGS],
        [
            'city imagery',
            FIRESTORE_PATHS.city(`${CITY_ID}-imagery`),
            () => cityDoc(CITY_ID),
            { imagery: { autoPublish: false, rmseThresholdM: 200, targetYears: Array.from({ length: 20 }, (_, index) => 2000 + index) } },
        ],
        ['photo', FIRESTORE_PATHS.photo(CITY_ID, 'edit'), () => photoDoc(CITY_ID, 'edit', world.uid('admin')), EDITS.photo],
        ['layer', FIRESTORE_PATHS.layer(CITY_ID, 'edit'), layerDoc, EDITS.layer],
        ['poi', FIRESTORE_PATHS.poi(CITY_ID, 'edit'), () => poiDoc(world.uid('admin')), EDITS.poi],
    ] as const)('happyPath_a%sSettingsSaveIsWithinTheLimit', async (_entity, path, seed, edits) => {
        await world.seed(path, seed());

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...edits, ...stampedBy(world.uid('admin')) }),
            ),
        ).toBe('allow');
    });
});
