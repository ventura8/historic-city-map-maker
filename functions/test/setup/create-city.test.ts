/**
 * `setup.createCity` (docs/research/M2b-interfaces.md §3.3 d2, CR-M2b-1): right after the owner claim the Setup
 * Assistant creates the city from the bundled seed, once; the server sets the fields a client may not.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createCity } from '../../src/setup/create-city.js';
import { ADMIN, CITY, NOW, cityDoc, createWorld } from './world.js';

const CREATED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };

/** The bundled seed's fields, as `legacyCityFields` of the admin hands them over. */
const SEED = {
    name: { ro: 'București dispărut', en: 'Lost Bucharest' },
    bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
    center: { lng: 26.085298, lat: 44.427037 },
    zoom: 14.5,
    minZoom: 10,
    maxZoom: 20,
    basemap: { style: 'mapbox://styles/mapbox/standard-satellite' },
} as const;

describe('setup.createCity', () => {
    it('happyPath_createsTheCityPublishedWithTheServersFields', async () => {
        const world = createWorld({ city: false });

        const response = await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(response).toEqual({ created: true });
        expect(world.documents.peek(FIRESTORE_PATHS.city(CITY))).toEqual({
            ...SEED,
            id: CITY,
            published: true,
            createdAt: CREATED,
            updatedBy: ADMIN.uid,
            updatedAt: CREATED,
        });
        expect(world.logged()).toContain('city created');
    });

    it('happyPath_theProjectsOwnerBecomesTheCitysOwnerKeepingTheirOtherCities', async () => {
        const world = createWorld({ city: false });
        const stamp = { createdAt: CREATED, updatedBy: ADMIN.uid, updatedAt: CREATED };
        world.documents.seed(FIRESTORE_PATHS.admin(ADMIN.uid), { role: 'owner', cities: { cluj: 'editor' }, ...stamp });
        world.documents.seed(FIRESTORE_PATHS.city('cluj'), cityDoc());

        await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(world.documents.peek(FIRESTORE_PATHS.admin(ADMIN.uid))).toMatchObject({ cities: { cluj: 'editor', [CITY]: 'owner' } });
    });

    it('happyPath_anOwnerFromBeforeM5GetsEveryCityAndTheNewOne', async () => {
        const world = createWorld({ city: false });
        world.documents.seed(FIRESTORE_PATHS.admin(ADMIN.uid), {
            role: 'owner',
            createdAt: CREATED,
            updatedBy: ADMIN.uid,
            updatedAt: CREATED,
        });
        world.documents.seed(FIRESTORE_PATHS.city('cluj'), cityDoc());

        await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(world.documents.peek(FIRESTORE_PATHS.admin(ADMIN.uid))).toMatchObject({ cities: { cluj: 'owner', [CITY]: 'owner' } });
    });

    it('badPath_anExistingCityIsLeftAsItIs', async () => {
        const world = createWorld();
        const before = world.documents.peek(FIRESTORE_PATHS.city(CITY));

        const response = await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(response).toEqual({ created: false });
        expect(world.documents.peek(FIRESTORE_PATHS.city(CITY))).toEqual(before);
        expect(world.documents.writes).toEqual([]);
    });

    it('badPath_aContendedTransactionCreatesTheCityOnce', async () => {
        const world = createWorld({ city: false });
        world.documents.contend(2);

        await expect(createCity(world.deps, ADMIN, { cityId: CITY, city: SEED })).resolves.toEqual({ created: true });

        expect(world.documents.writes.filter((write) => write.kind === 'create' && write.path === FIRESTORE_PATHS.city(CITY))).toHaveLength(
            1,
        );
        expect(world.documents.writes.filter((write) => write.path.startsWith(FIRESTORE_PATHS.poiCategories(CITY)))).toHaveLength(5);
    });

    it('happyPath_theBundledCityStartsWithTheFiveStarterCategoriesStampedAsItIs @S-A39-HAPPY-STARTER-CATEGORIES', async () => {
        const world = createWorld({ city: false });

        await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        const stamp = { createdAt: CREATED, updatedBy: ADMIN.uid, updatedAt: CREATED };
        expect(world.documents.peek(FIRESTORE_PATHS.poiCategory(CITY, 'cladire'))).toEqual({
            label: { ro: 'Clădire', en: 'Building' },
            icon: 'domain',
            color: '#8b5e3c',
            defaultOpacity: 1,
            order: 0,
            ...stamp,
        });
        expect(world.documents.peek(FIRESTORE_PATHS.poiCategory(CITY, 'monument'))).toMatchObject({ icon: 'account_balance', order: 4 });
    });

    it('badPath_anExistingCityGetsNoStarterCategory @S-A39-BAD-STARTER-CATEGORIES-EXISTING-CITY', async () => {
        const world = createWorld();

        await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(world.documents.peek(FIRESTORE_PATHS.poiCategory(CITY, 'cladire'))).toBeUndefined();
    });
});
