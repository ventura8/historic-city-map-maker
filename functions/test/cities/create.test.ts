/**
 * `cities.create` (`functions/src/cities/create.ts`, M5-interfaces §1.6) through its callable's `.run()` on the
 * Firestore emulator: the project's owner creates a city from a name, a rectangle and a seed; everything else is derived.
 */
import {
    DEFAULT_NEW_CITY_LIMITS,
    FIRESTORE_PATHS,
    MAX_CITIES,
    adminDocSchema,
    cityDocSchema,
    inviteDocSchema,
    poiCategoryDocSchema,
    startViewForBounds,
    timestampFromDate,
    type CallableRequest,
} from '@hcm/shared';
import { afterAll, describe, expect, it } from 'vitest';

import { createFunction } from '../../src/cities/create.js';
import { aboutText, markdownLiteral } from '../../src/cities/texts.js';
import { fakeAdmins } from '../support/fakes.js';
import { callableRequest, failureOf, openEmulators, type World } from '../admin/world.js';
import { CLUJ_BOUNDS, THEME, adminCaller, seedAdmin, seedCity } from './world.js';

const emulators = openEmulators('fn-cities-create');

afterAll(async () => {
    await emulators.close();
});

const OWNER = 'u-project-owner';
const REQUEST: CallableRequest<'cities.create'> = { cityId: 'cluj', name: { ro: 'Cluj-Napoca' }, bounds: CLUJ_BOUNDS, theme: THEME };

function create(world: World, data: unknown = REQUEST, uid = OWNER) {
    return createFunction(() => world).run(callableRequest(data, adminCaller(uid)));
}

async function ownerWorld(): Promise<World> {
    const world = emulators.newWorld();
    await seedAdmin(world, OWNER, 'owner', { bucharest: 'owner' });
    await seedCity(world, 'bucharest', { analytics: { measurementId: 'G-E2ETEST01' } });
    return world;
}

describe('cities.create', () => {
    it('happyPath_aNameARectangleAndASeedMakeAnUnpublishedCityItsCreatorOwns @S-A50-HAPPY', async () => {
        const world = await ownerWorld();

        await expect(create(world)).resolves.toEqual({ created: true, cityId: 'cluj' });

        const city = await world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema);
        expect(city).toMatchObject({
            id: 'cluj',
            name: { ro: 'Cluj-Napoca' },
            bounds: CLUJ_BOUNDS,
            ...startViewForBounds(CLUJ_BOUNDS),
            theme: THEME,
            basemap: { style: 'mapbox://styles/mapbox/standard' },
            limits: DEFAULT_NEW_CITY_LIMITS,
            analytics: { measurementId: 'G-E2ETEST01' },
            published: false,
            imagery: {},
            updatedBy: OWNER,
        });
        expect(city?.about?.en).toBe(
            '**Cluj-Napoca** on a historical map: old photos, places and historical layers, made with Historic City Map Maker.',
        );
        expect(city?.privacy?.ro).toContain('Mapbox');
        await expect(world.documents.get(FIRESTORE_PATHS.admin(OWNER), adminDocSchema)).resolves.toMatchObject({
            cities: { bucharest: 'owner', cluj: 'owner' },
        });
        // The first USGS harvest needs no call: the city's harvest state is due at once, and the next imagery.tick harvests
        // the city (S-A50-HAPPY-HARVEST, functions/test/cities/harvest.test.ts).
        expect((await world.db.doc('ops/harvest-cluj').get()).data()).toMatchObject({ outcome: 'empty', failures: 0 });
    });

    it('happyPath_aRetriedCreateAnswersThatTheCityExistsAndWritesNothing @S-A50-HAPPY-RETRY', async () => {
        const world = await ownerWorld();
        await create(world);
        world.clock.set('2026-10-12T09:00:00.000Z');

        await expect(create(world, { ...REQUEST, name: { ro: 'Altceva' } })).resolves.toEqual({ created: false, cityId: 'cluj' });
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.toMatchObject({
            name: { ro: 'Cluj-Napoca' },
        });
    });

    it('badPath_anIdAnotherCityUsesIsRefusedWithAFreeOne @S-A50-BAD-ID-TAKEN', async () => {
        const world = await ownerWorld();
        await seedCity(world, 'cluj-napoca');

        const failure = await failureOf(create(world, { ...REQUEST, cityId: 'cluj-napoca' }));

        expect(failure).toMatchObject({
            code: 'already-exists',
            details: { code: 'apiError.city.idTaken', params: { cityId: 'cluj-napoca', suggestion: 'cluj-napoca-2' } },
        });
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj-napoca'), cityDocSchema)).resolves.toMatchObject({ published: true });
    });

    it('badPath_anAdminWhoIsNotTheProjectsOwnerCreatesNothing @S-A50-BAD-NOT-PROJECT-OWNER', async () => {
        const world = await ownerWorld();
        await seedAdmin(world, 'u-city-owner', 'admin', { bucharest: 'owner' });

        const failure = await failureOf(create(world, REQUEST, 'u-city-owner'));

        expect(failure).toMatchObject({ code: 'permission-denied', details: { code: 'apiError.city.notProjectOwner' } });
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.toBeUndefined();
    });

    it('badPath_theTwentyFirstCityIsRefused @S-A50-BAD-TOO-MANY', async () => {
        const world = await ownerWorld();
        for (let index = 1; index < MAX_CITIES; index += 1) {
            await seedCity(world, `city-${String(index)}`);
        }

        await expect(failureOf(create(world))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.city.tooMany', params: { max: '20' } },
        });
    });

    it.each([
        ['a reserved id', { cityId: 'engine' }, 'cityId', 'validation.value'],
        ['a rectangle over two degrees', { bounds: { west: 23, south: 46, east: 25.5, north: 46.5 } }, 'bounds', 'validation.tooBig'],
        [
            'a rectangle under a hundredth of a degree',
            { bounds: { west: 23.5, south: 46.7, east: 23.505, north: 46.8 } },
            'bounds',
            'validation.tooSmall',
        ],
    ])('badPath_%s_isAFieldIssue @S-A50-BAD-RESERVED', async (_name, change, path, code) => {
        const world = await ownerWorld();

        await expect(failureOf(create(world, { ...REQUEST, ...change }))).resolves.toMatchObject({
            code: 'invalid-argument',
            details: { code: 'apiError.invalidRequest', issues: [{ path, code }] },
        });
    });

    it('happyPath_aProjectWithoutAnalyticsAndAPreM5OwnerStillCreate', async () => {
        const world = emulators.newWorld();
        await seedAdmin(world, OWNER, 'owner');
        await seedCity(world, 'bucharest');
        await world.db.doc(FIRESTORE_PATHS.city('broken')).set({ name: 42 });

        await expect(create(world)).resolves.toEqual({ created: true, cityId: 'cluj' });

        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.not.toHaveProperty('analytics');
        await expect(world.documents.get(FIRESTORE_PATHS.admin(OWNER), adminDocSchema)).resolves.toMatchObject({
            cities: { bucharest: 'owner', broken: 'owner', cluj: 'owner' },
        });
    });

    it('badPath_aCityMadeMeanwhileOrACallerRemovedMeanwhileWritesNothing', async () => {
        const world = emulators.newWorld();
        const deps = { ...world, admins: fakeAdmins([OWNER]) };
        const run = (data: unknown) => createFunction(() => deps).run(callableRequest(data, adminCaller(OWNER)));

        const removed = await failureOf(run(REQUEST));
        await seedCity(world, 'cluj');
        const unlisted = { ...deps, documents: { ...world.documents, query: () => Promise.resolve({ documents: [], invalid: [] }) } };
        const raced = await failureOf(createFunction(() => unlisted).run(callableRequest(REQUEST, adminCaller(OWNER))));

        expect([removed, raced]).toMatchObject([
            { code: 'permission-denied', details: { code: 'apiError.notAdmin' } },
            { code: 'already-exists', details: { code: 'apiError.city.idTaken', params: { cityId: 'cluj', suggestion: 'cluj-napoca' } } },
        ]);
        await expect(world.documents.get(FIRESTORE_PATHS.city('cluj'), cityDocSchema)).resolves.toMatchObject({ published: true });
    });

    it('badPath_aCityReadThatFailsFailsTheCreate', async () => {
        const world = await ownerWorld();
        const failing = {
            ...world,
            documents: {
                ...world.documents,
                get: () => Promise.reject(new Error('firestore down')),
            },
        };

        await expect(failureOf(createFunction(() => failing).run(callableRequest(REQUEST, adminCaller(OWNER))))).resolves.toMatchObject({
            code: 'internal',
        });
    });
});

describe('the texts of a new city', () => {
    it('happyPath_theNamesMarkdownMarkersStayLiteral', () => {
        expect(markdownLiteral('*Bacău* [x]_\\')).toBe('\\*Bacău\\* \\[x\\]\\_\\\\');
        expect(aboutText({ ro: 'Bacău', en: 'Bacau' }).en).toMatch(/^\*\*Bacau\*\* /);
        expect(aboutText({ ro: 'Bacău' }).en).toMatch(/^\*\*Bacău\*\* /);
    });
});

describe('cities.create: invitations from before M5', () => {
    it('happyPath_aPendingInvitationFromBeforeM5GetsTheCitiesOfNowNeverTheNewOne @S-A51-HAPPY-LEGACY-INVITE', async () => {
        // docs/LESSONS.md 245: an invitation without cities would make its account an editor of every city at its first
        // session, a city made after it too; the owners could neither see nor revoke it.
        const world = await ownerWorld();
        const at = timestampFromDate(new Date('2026-10-01T08:00:00.000Z'));
        const legacy = { role: 'admin', invitedBy: OWNER, createdAt: at, expiresAt: at, updatedBy: OWNER, updatedAt: at } as const;
        await world.documents.set(FIRESTORE_PATHS.invite('a'.repeat(64)), inviteDocSchema, legacy);

        await expect(create(world)).resolves.toEqual({ created: true, cityId: 'cluj' });

        await expect(world.documents.get(FIRESTORE_PATHS.invite('a'.repeat(64)), inviteDocSchema)).resolves.toMatchObject({
            cities: { bucharest: 'editor' },
            updatedBy: 'system:cities',
        });
    });
});

describe('cities.create: the starter categories (finding 35 of 2026-11-01)', () => {
    it('happyPath_theNewCityStartsWithTheFiveStarterCategories @S-A39-HAPPY-STARTER-CATEGORIES', async () => {
        const world = await ownerWorld();

        await create(world);

        const categories = await world.documents.query(FIRESTORE_PATHS.poiCategories('cluj'), poiCategoryDocSchema);
        const labels = categories.documents.toSorted((a, b) => a.data.order - b.data.order).map(({ id, data }) => [id, data.label.en]);
        expect(labels).toEqual([
            ['cladire', 'Building'],
            ['strada', 'Street'],
            ['piata', 'Square'],
            ['biserica', 'Church'],
            ['monument', 'Monument'],
        ]);
        expect(categories.documents[0]?.data).toMatchObject({ defaultOpacity: 1, updatedBy: OWNER });
    });

    it('badPath_aRetriedCreateAddsNoSecondSetOfCategories @S-A39-BAD-STARTER-CATEGORIES-EXISTING-CITY', async () => {
        const world = await ownerWorld();
        await create(world);
        await world.documents.delete(FIRESTORE_PATHS.poiCategory('cluj', 'strada'));

        await create(world);

        const categories = await world.documents.query(FIRESTORE_PATHS.poiCategories('cluj'), poiCategoryDocSchema);
        expect(categories.documents.map(({ id }) => id).toSorted((a, b) => a.localeCompare(b))).toEqual([
            'biserica',
            'cladire',
            'monument',
            'piata',
        ]);
    });
});
