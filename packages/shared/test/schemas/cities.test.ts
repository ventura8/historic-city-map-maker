/** Many cities in one project (M5; docs/research/M5-interfaces.md §1): roles, ids, bounds, start views, budgets, links. */
import { isContributorOnly, isReviewRole, isStaffRole, strongerRole } from '../../src/schemas/city-roles.js';
import { describe, expect, it } from 'vitest';

import {
    ADMIN_CITY_SEGMENT,
    adminCityLink,
    CITY_SPAN_LIMITS,
    cityBoundsProblem,
    cityComputeUnitsAvailable,
    cityIdsOf,
    cityLimitsSchema,
    cityRoleOf,
    cityRolesSchema,
    cityUsageDocSchema,
    DEFAULT_NEW_CITY_LIMITS,
    hasCityRole,
    isUsableCityId,
    legacyCityRoles,
    MAX_CITIES,
    MAX_CITY_ID_LENGTH,
    NEW_CITY_SEEDS,
    RESERVED_CITY_IDS,
    startViewForBounds,
    suggestCityId,
    type CityRoles,
} from '../../src/schemas/cities.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { adminDocSchema, inviteDocSchema, OPS_STEPS } from '../../src/schemas/firestore-ops.js';
import { cityDocSchema } from '../../src/schemas/firestore.js';
import { ADMIN_LINK_PATTERN } from '../../src/schemas/notifications.js';
import { CITY_ID_PATTERN } from '../../src/schemas/paths.js';
import { hexColorSchema } from '../../src/schemas/primitives.js';
import { validate } from '../../src/schemas/validation.js';

const AT = timestampFromDate(new Date('2026-11-02T10:00:00Z'));
const BUCHAREST = { west: 25.93, south: 44.33, east: 26.25, north: 44.55 };

describe('city roles', () => {
    it('happyPath_anAdminBelongsToCitiesWithARoleEach', () => {
        expect(validate(cityRolesSchema, { bucharest: 'owner', cluj: 'editor' }).ok).toBe(true);
    });

    it.each([
        ['an unknown role', { cluj: 'viewer' }],
        ['a city id with capitals', { Cluj: 'editor' }],
        [
            'more cities than a project may have',
            Object.fromEntries(Array.from({ length: MAX_CITIES + 1 }, (_, n) => [`c${String(n)}x`, 'editor'])),
        ],
    ])('badPath_%s_isRefused', (_name, roles) => {
        expect(validate(cityRolesSchema, roles).ok).toBe(false);
    });

    it('happyPath_theRoleOfACityIsReadFromOwnKeysOnly', () => {
        const roles: CityRoles = { bucharest: 'owner', cluj: 'editor' };

        expect([cityRoleOf(roles, 'bucharest'), cityRoleOf(roles, 'cluj'), cityRoleOf(roles, 'bacau')]).toEqual(['owner', 'editor', null]);
        expect([cityRoleOf(roles, 'constructor'), cityRoleOf(roles, '__proto__'), cityRoleOf(undefined, 'cluj')]).toEqual([
            null,
            null,
            null,
        ]);
    });

    it('badPath_aKeyWithoutARoleIsNoRole', () => {
        expect(cityRoleOf({ cluj: undefined } as unknown as CityRoles, 'cluj')).toBeNull();
    });

    it.each([
        ['owner', 'editor', true],
        ['owner', 'owner', true],
        ['editor', 'editor', true],
        ['editor', 'owner', false],
    ] as const)('happyPath_a %s may act as %s: %s', (role, needed, allowed) => {
        expect(hasCityRole({ cluj: role }, 'cluj', needed)).toBe(allowed);
    });

    it('badPath_noRoleInTheCityAllowsNothing', () => {
        expect(hasCityRole({ bucharest: 'owner' }, 'cluj', 'editor')).toBe(false);
        expect(hasCityRole(undefined, 'cluj', 'editor')).toBe(false);
    });

    it('happyPath_theCitiesOfAnAdminAreSorted', () => {
        expect(cityIdsOf({ bacau: 'editor', bucharest: 'owner', cluj: 'editor' })).toEqual(['bacau', 'bucharest', 'cluj']);
        expect(cityIdsOf(undefined)).toEqual([]);
    });

    it('happyPath_aPreM5AdminKeepsEveryCity', () => {
        expect(legacyCityRoles('owner', ['bucharest', 'cluj'])).toEqual({ bucharest: 'owner', cluj: 'owner' });
        expect(legacyCityRoles('admin', ['bucharest'])).toEqual({ bucharest: 'editor' });
        expect(legacyCityRoles('admin', [])).toEqual({});
    });
});

describe('city ids', () => {
    it('happyPath_reservedIdsAreWellFormedButUnusable', () => {
        expect(RESERVED_CITY_IDS.every((id) => CITY_ID_PATTERN.test(id))).toBe(true);
        expect([isUsableCityId('cluj'), isUsableCityId('engine'), isUsableCityId('Cluj'), isUsableCityId('x')]).toEqual([
            true,
            false,
            false,
            false,
        ]);
        // M6: the Hosting site's generic city page and the admin are folders of the site's root, and on that one origin
        // the admin's storage keys are `hcm:admin:*` beside a city viewer's `hcm:<cityId>:*`: no city may be `admin`.
        expect([isUsableCityId('city'), isUsableCityId('admin')]).toEqual([false, false]);
    });

    it.each([
        ['Cluj-Napoca', [], 'cluj-napoca'],
        ['Bacău', [], 'bacau'],
        ['  Târgu Mureș  ', [], 'targu-mures'],
        ['Cluj', ['cluj'], 'cluj-2'],
        ['Cluj', ['cluj', 'cluj-2'], 'cluj-3'],
        ['Engine', [], 'engine-2'],
        ['!!!', [], 'my-city'],
        ['A', [], 'my-city'],
        ['A', ['my-city'], 'my-city-2'],
        ['City', [], 'city-2'],
    ])('happyPath_%s_with %j taken_suggests %s', (name, taken, expected) => {
        expect(suggestCityId(name, taken)).toBe(expected);
    });

    it('happyPath_aLongNameIsCutAtAWordAndKeepsRoomForItsSuffix', () => {
        const name = 'Municipiul Drobeta Turnu Severin din Mehedinți';
        const first = suggestCityId(name);
        const second = suggestCityId(name, [first]);

        expect(first).toBe('municipiul-drobeta-turnu-severin');
        expect(second).toBe('municipiul-drobeta-turnu-2');
        expect([first, second].every((id) => id.length <= MAX_CITY_ID_LENGTH && CITY_ID_PATTERN.test(id))).toBe(true);
    });
});

describe('city bounds and start view', () => {
    it.each([
        ['Bucharest', BUCHAREST, null],
        ['an inverted rectangle', { west: 26.25, south: 44.33, east: 25.93, north: 44.55 }, 'validation.bounds'],
        ['a rectangle of no height', { ...BUCHAREST, north: BUCHAREST.south }, 'validation.bounds'],
        ['not a number', { ...BUCHAREST, east: Number.NaN }, 'validation.bounds'],
        ['a street corner', { west: 26.1, south: 44.43, east: 26.105, north: 44.45 }, 'validation.tooSmall'],
        ['a whole region', { west: 23, south: 44, east: 26.5, north: 45 }, 'validation.tooBig'],
    ])('cityBoundsProblem_%s_is_%s', (_name, bounds, problem) => {
        expect(cityBoundsProblem(bounds)).toBe(problem);
    });

    it('happyPath_theLimitsAreTheContracts', () => {
        expect(CITY_SPAN_LIMITS).toEqual({ minDeg: 0.01, maxDeg: 2 });
    });

    it('happyPath_aCityStartsCentredOnItsRectangleAtTheZoomThatFitsIt', () => {
        const view = startViewForBounds(BUCHAREST);

        expect(view).toMatchObject({ zoom: 10.5, minZoom: 7, maxZoom: 20 });
        expect(view.center.lat).toBeCloseTo(44.44, 9);
        expect(view.center.lng).toBeCloseTo(26.09, 9);
    });

    it('happyPath_aVeryWideAreaStartsZoomedOutAndATinyOneAtMostAt20', () => {
        expect(startViewForBounds({ west: -180, south: -80, east: 180, north: 80 })).toMatchObject({ zoom: 0.5, minZoom: 0 });
        expect(startViewForBounds({ west: 26.1, south: 44.43, east: 26.1001, north: 44.4301 })).toMatchObject({ zoom: 20, minZoom: 17 });
    });
});

describe('city limits and usage', () => {
    it('happyPath_theNewCityDefaultsAreValidLimits', () => {
        expect(validate(cityLimitsSchema, DEFAULT_NEW_CITY_LIMITS).ok).toBe(true);
        expect(DEFAULT_NEW_CITY_LIMITS.computeUnitsPerMonth).toBe(5);
    });

    it.each([
        ['more daily jobs than the project allows', { rasterJobsPerDay: 11 }],
        ['more AI requests than the monthly cap', { aiRequestsPerMonth: 501 }],
        ['more title suggestions than the daily cap', { geocodeCellsPerDay: 301 }],
        ['more exports than the most a day', { exportsPerDay: 11 }],
        ['negative compute units', { computeUnitsPerMonth: -1 }],
        ['an unknown limit', { photosPerDay: 3 }],
    ])('badPath_%s_isRefused', (_name, change) => {
        expect(validate(cityLimitsSchema, { ...DEFAULT_NEW_CITY_LIMITS, ...change }).ok).toBe(false);
    });

    const usage = {
        month: '2026-11',
        computeUnits: 2,
        reservations: { v1: { computeUnits: 1, at: AT }, v2: { computeUnits: 0.5, at: AT } },
        aiRequests: 4,
        geocodeDay: '2026-11-02',
        geocodeToday: 7,
        updatedBy: 'system:cities',
        updatedAt: AT,
    };

    it('happyPath_aCitysMonthCountsItsOwnSpending', () => {
        expect(validate(cityUsageDocSchema, usage).ok).toBe(true);
    });

    it.each([
        ['a month 13', { month: '2026-13' }],
        [
            'more than fifty reservations',
            { reservations: Object.fromEntries(Array.from({ length: 51 }, (_, n) => [`v${String(n)}`, { computeUnits: 1, at: AT }])) },
        ],
        ['a negative count', { aiRequests: -1 }],
    ])('badPath_%s_isRefused', (_name, change) => {
        expect(validate(cityUsageDocSchema, { ...usage, ...change }).ok).toBe(false);
    });

    it('happyPath_whatACityMayStillSpendExcludesTheVersionsOwnReservation', () => {
        const limits = { computeUnitsPerMonth: 5 };

        expect(cityComputeUnitsAvailable(limits, usage, 'v3')).toBe(1.5);
        expect(cityComputeUnitsAvailable(limits, usage, 'v1')).toBe(2.5);
        expect(cityComputeUnitsAvailable(limits, { computeUnits: 1 }, 'v1')).toBe(4);
        expect(cityComputeUnitsAvailable(limits, undefined, 'v1')).toBe(5);
    });

    it('happyPath_aCityWithoutLimitsIsHeldByTheProjectOnly', () => {
        expect(cityComputeUnitsAvailable(undefined, usage, 'v1')).toBe(Number.POSITIVE_INFINITY);
    });
});

describe('the new city flow and the admin links', () => {
    it('happyPath_theOfferedSeedsAreColours', () => {
        expect(NEW_CITY_SEEDS.every((seed) => hexColorSchema.safeParse(seed).success)).toBe(true);
    });

    it('happyPath_aCityLinkIsAnInboxLink', () => {
        const link = adminCityLink('cluj', 'imagery/version/v1');

        expect(link).toBe(`#/${ADMIN_CITY_SEGMENT}/cluj/imagery/version/v1`);
        expect(ADMIN_LINK_PATTERN.test(link)).toBe(true);
        expect(adminCityLink('cluj', 'home')).toBe('#/c/cluj/home');
    });

    it.each([
        ['a city id with capitals', 'Cluj', 'home'],
        ['a route that climbs up', 'cluj', '../home'],
        ['a route of four segments', 'cluj', 'a/b/c/d'],
        ['an empty route', 'cluj', ''],
    ])('badPath_%s_throws', (_name, cityId, route) => {
        expect(() => adminCityLink(cityId, route)).toThrow(RangeError);
    });
});

describe('the documents that hold memberships and limits (CR-M5-4)', () => {
    const stamp = { updatedBy: 'system:cities', updatedAt: AT };
    const admin = { role: 'admin', email: 'ana@example.test', createdAt: AT, ...stamp };
    const invite = { role: 'admin', invitedBy: 'u-owner', createdAt: AT, expiresAt: AT, ...stamp };
    const city = { name: { ro: 'Cluj-Napoca' }, bounds: BUCHAREST, published: false, ...stamp };

    it('happyPath_anAdminDocumentAndAnInvitationNameTheirCities', () => {
        expect(validate(adminDocSchema, { ...admin, cities: { bucharest: 'owner', cluj: 'editor' } }).ok).toBe(true);
        expect(validate(inviteDocSchema, { ...invite, cities: { cluj: 'editor' } }).ok).toBe(true);
    });

    it('happyPath_documentsFromBeforeM5HaveNoCities', () => {
        expect(validate(adminDocSchema, admin).ok).toBe(true);
        expect(validate(inviteDocSchema, invite).ok).toBe(true);
    });

    it('badPath_aMembershipWithAnUnknownRoleIsRefused', () => {
        expect(validate(adminDocSchema, { ...admin, cities: { cluj: 'viewer' } }).ok).toBe(false);
        expect(validate(inviteDocSchema, { ...invite, cities: { Cluj: 'editor' } }).ok).toBe(false);
    });

    it('happyPath_aCityStoresTheLimitsTheCallableAccepts', () => {
        const stored = cityDocSchema.shape.limits.unwrap();

        expect(validate(cityDocSchema, { ...city, limits: DEFAULT_NEW_CITY_LIMITS }).ok).toBe(true);
        expect(new Set(Object.keys(stored.shape))).toEqual(new Set(Object.keys(cityLimitsSchema.shape)));
    });

    it('badPath_aStoredLimitBelowZeroOrUnknownIsRefused', () => {
        expect(validate(cityDocSchema, { ...city, limits: { ...DEFAULT_NEW_CITY_LIMITS, exportsPerDay: -1 } }).ok).toBe(false);
        expect(validate(cityDocSchema, { ...city, limits: { ...DEFAULT_NEW_CITY_LIMITS, photosPerDay: 1 } }).ok).toBe(false);
    });

    it('happyPath_theTickMigratesMembershipsAfterTheAccountsSteps', () => {
        expect(OPS_STEPS.indexOf('memberships')).toBeGreaterThan(OPS_STEPS.indexOf('users'));
    });
});

describe('M13: the roles (docs/research/M13-roles.md §1)', () => {
    it('happyPath_eachRoleCoversTheOnesBelowIt', () => {
        expect(hasCityRole({ c: 'moderator' }, 'c', 'uploader')).toBe(true);
        expect(hasCityRole({ c: 'moderator' }, 'c', 'moderator')).toBe(true);
        expect(hasCityRole({ c: 'moderator' }, 'c', 'editor')).toBe(false);
        expect(hasCityRole({ c: 'uploader' }, 'c', 'moderator')).toBe(false);
    });

    it('happyPath_theStrongerRoleWins', () => {
        expect(strongerRole('owner', 'uploader')).toBe('owner');
        expect(strongerRole('uploader', 'moderator')).toBe('moderator');
        expect(strongerRole(null, 'uploader')).toBe('uploader');
    });

    it('badPath_anAccountWithCitiesAndNoneAsStaffIsContributorOnly', () => {
        expect(isContributorOnly({ a: 'uploader', b: 'moderator' })).toBe(true);
        expect(isContributorOnly({ a: 'uploader', b: 'editor' })).toBe(false);
        expect(isContributorOnly({})).toBe(false);
        expect(isContributorOnly(undefined)).toBe(false);
    });

    it.each([
        ['owner', true, true],
        ['editor', true, true],
        ['moderator', false, true],
        ['uploader', false, false],
        [null, false, false],
    ] as const)('%s is staff %s, reviewer %s', (role, staff, reviewer) => {
        expect(isStaffRole(role)).toBe(staff);
        expect(isReviewRole(role)).toBe(reviewer);
    });
});
