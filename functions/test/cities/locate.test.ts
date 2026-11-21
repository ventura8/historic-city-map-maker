/**
 * `cities.locate` (`functions/src/cities/locate.ts`; the M5 UX review: New city in two inputs) through its callable's
 * `.run()` on the Firestore emulator, with the shared fake Nominatim: the named city's box as a rectangle that can be a
 * city; nothing found, a refusal (which starts the shared cool-down), a cool-down and a failure each answer no
 * rectangle, so the admin draws it.
 */
import { CITY_SPAN_LIMITS, FIRESTORE_PATHS, assistStateDocSchema, cityAreaAround, cityBoundsProblem, timestampFromDate } from '@hcm/shared';
import { createUpstreamFakes } from '@hcm/test-support/fakes';
import { afterAll, describe, expect, it } from 'vitest';

import { createNominatim } from '../../src/adapters/nominatim.js';
import { locateFunction } from '../../src/cities/locate.js';
import type { Geocoder } from '../../src/ports/geocoder.js';
import { callableRequest, failureOf, openEmulators, type World } from '../admin/world.js';
import { adminCaller, seedAdmin } from './world.js';

const emulators = openEmulators('fn-cities-locate');

afterAll(async () => {
    await emulators.close();
});

const OWNER = 'u-locate-owner';

async function ownerWorld(geocoder?: Geocoder) {
    const world = emulators.newWorld();
    const fakes = createUpstreamFakes();
    await seedAdmin(world, OWNER, 'owner', { bucharest: 'owner' });
    return { world, fakes, deps: { ...world, geocoder: geocoder ?? createNominatim({ fetch: fakes.fetch }) } };
}

function locate(deps: World & { readonly geocoder: Geocoder }, name: string, uid = OWNER) {
    return locateFunction(() => deps).run(callableRequest({ name }, adminCaller(uid)));
}

describe('cities.locate', () => {
    it('happyPath_aKnownCityIsARectangleThatCanBeACity @S-A50-HAPPY', async () => {
        const { deps, fakes } = await ownerWorld();

        const response = await locate(deps, 'Cluj-Napoca');

        expect(response).toEqual({
            bounds: { west: 23.4846, south: 46.7181, east: 23.6919, north: 46.8167 },
            place: 'Cluj-Napoca, Cluj, România',
        });
        expect(cityBoundsProblem(response.bounds ?? { west: 0, south: 0, east: 0, north: 0 })).toBeNull();
        expect(fakes.callsTo('nominatim.search')).toHaveLength(1);
        expect(JSON.stringify(deps.recording.records)).not.toContain('Cluj-Napoca');
    });

    it('badPath_aNameNothingHasIsNoRectangle @S-A50-BAD-NOT-FOUND', async () => {
        const { deps } = await ownerWorld();

        await expect(locate(deps, 'Turda E2E')).resolves.toEqual({ bounds: null });
    });

    it('badPath_aRefusalStartsTheSharedCoolDownAndNothingIsAskedDuringIt', async () => {
        const { deps, fakes } = await ownerWorld();
        fakes.fail('nominatim', 'rateLimited');

        await expect(locate(deps, 'Cluj')).resolves.toEqual({ bounds: null });
        fakes.fail('nominatim', null);
        await expect(locate(deps, 'Cluj')).resolves.toEqual({ bounds: null });

        expect(fakes.callsTo('nominatim.search')).toHaveLength(1);
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toMatchObject({
            nominatimCoolUntil: timestampFromDate(new Date(deps.clock.now().getTime() + 10 * 60_000)),
            updatedBy: 'system:cities',
        });
    });

    it('happyPath_anExpiredCoolDownAsksAgain', async () => {
        const { deps } = await ownerWorld();
        const past = timestampFromDate(new Date(deps.clock.now().getTime() - 1));
        await deps.documents.set(FIRESTORE_PATHS.assistState, assistStateDocSchema, {
            nominatimCoolUntil: past,
            updatedBy: 'system:assist',
            updatedAt: past,
        });

        await expect(locate(deps, 'cluj')).resolves.toMatchObject({ place: 'Cluj-Napoca, Cluj, România' });
    });

    it('badPath_aFailureIsNoRectangleAndAnythingElseThrows', async () => {
        const { deps, fakes } = await ownerWorld();
        fakes.fail('nominatim', 'unavailable');
        await expect(locate(deps, 'Cluj')).resolves.toEqual({ bounds: null });
        await expect(deps.documents.get(FIRESTORE_PATHS.assistState, assistStateDocSchema)).resolves.toBeUndefined();

        const broken = await ownerWorld({ reverse: () => Promise.resolve(undefined), search: () => Promise.reject(new TypeError('bug')) });
        await expect(failureOf(locate(broken.deps, 'Cluj'))).resolves.toMatchObject({ details: { code: 'apiError.internal' } });
    });

    it('badPath_onlyTheProjectsOwnerLocates', async () => {
        const { deps } = await ownerWorld();
        await seedAdmin(deps, 'u-city-owner', 'admin', { bucharest: 'owner' });

        await expect(failureOf(locate(deps, 'Cluj', 'u-city-owner'))).resolves.toMatchObject({
            details: { code: 'apiError.city.notProjectOwner' },
        });
    });
});

describe('cityAreaAround', () => {
    it('happyPath_aPlacesBoxWidenedToADistrictOrNarrowedToTheLimit', () => {
        expect(cityAreaAround({ west: 26.09995, south: 44.42995, east: 26.10005, north: 44.43005 })).toEqual({
            west: 26.09,
            south: 44.42,
            east: 26.11,
            north: 44.44,
        });
        const huge = cityAreaAround({ west: 20, south: 40, east: 30, north: 50 });
        expect([huge.east - huge.west, huge.north - huge.south]).toEqual([CITY_SPAN_LIMITS.maxDeg, CITY_SPAN_LIMITS.maxDeg]);
        expect(cityBoundsProblem(huge)).toBeNull();
    });
});
