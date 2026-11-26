/**
 * Which city the admin opens and how another opens (`packages/admin/src/app/current-city.ts`, M5-interfaces §1.5;
 * S-A49-HAPPY-REMEMBERED): the address's, the `e2e` build's, the one chosen last in this browser, the first by name.
 */
import type { Locale } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import {
    CITIES_REFRESH_MS,
    chooseCity,
    cityMemoryKey,
    cityName,
    cityRefresher,
    sortedCities,
    switchTo,
} from '../../src/app/current-city.js';
import { RETURN_TO_KEY } from '../../src/routing/router.js';
import type { AdminCity } from '../../src/state/state.js';
import { failure, FakeCallables, FakeClock, FakeLocation, MemoryStore, shellStateAccess, testLog } from './fakes.js';

const BUCHAREST: AdminCity = { id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } };
const CLUJ: AdminCity = { id: 'cluj', role: 'editor', name: { ro: 'Cluj-Napoca' } };
const ARAD: AdminCity = { id: 'arad', role: 'editor', name: { ro: 'Arad' } };

function deps(hash = '', options: { readonly preferred?: string | null; readonly uid?: string | null; readonly locale?: Locale } = {}) {
    const local = new MemoryStore();
    const session = new MemoryStore();
    const location = new FakeLocation(hash);
    return {
        location,
        local,
        session,
        preferred: options.preferred ?? null,
        uid: () => (options.uid === undefined ? 'u-ana' : options.uid),
        locale: () => options.locale ?? 'ro',
    };
}

describe('the current city', () => {
    it('happyPath_theCitiesAreByNameInTheAdminsLanguage', () => {
        expect(sortedCities([CLUJ, BUCHAREST, ARAD], 'ro').map((city) => city.id)).toEqual(['arad', 'bucharest', 'cluj']);
        expect([cityName(BUCHAREST, 'en'), cityName(CLUJ, 'en'), cityName(BUCHAREST, 'ro')]).toEqual([
            'Bucharest',
            'Cluj-Napoca',
            'București',
        ]);
        expect(sortedCities([{ ...ARAD, id: 'z' }, ARAD], 'en').map((city) => city.id)).toEqual(['arad', 'z']);
    });

    it('happyPath_theAddressesCityOpensAndIsRemembered', () => {
        const d = deps('#/c/cluj/photos');

        expect(chooseCity({ cities: [BUCHAREST, CLUJ], projectOwner: true }, d)).toEqual({
            cities: [BUCHAREST, CLUJ],
            cityId: 'cluj',
            projectOwner: true,
        });
        expect(d.local.get(cityMemoryKey('u-ana'))).toBe('cluj');
    });

    it('happyPath_theCityChosenLastOpensElseTheFirstByName @S-A49-HAPPY-REMEMBERED', () => {
        const remembered = deps();
        remembered.local.set(cityMemoryKey('u-ana'), 'cluj');
        const fresh = deps('', { locale: 'en' });

        expect(chooseCity({ cities: [CLUJ, BUCHAREST], projectOwner: false }, remembered).cityId).toBe('cluj');
        expect(chooseCity({ cities: [CLUJ, BUCHAREST], projectOwner: false }, fresh).cityId).toBe('bucharest');
    });

    it('happyPath_aDeepLinkKeptWhileSignedOutAndTheE2eBuildsCityAreFollowed', () => {
        const kept = deps('');
        kept.session.set(RETURN_TO_KEY, '#/c/cluj/photos/p1');

        expect(chooseCity({ cities: [BUCHAREST, CLUJ], projectOwner: false }, kept).cityId).toBe('cluj');
        expect(chooseCity({ cities: [BUCHAREST, CLUJ], projectOwner: false }, deps('', { preferred: 'cluj' })).cityId).toBe('cluj');
    });

    it.each([
        ['a city the admin does not administer', '#/c/bacau/photos', 'bucharest'],
        ['a remembered city the admin left', '', 'bucharest'],
    ])('badPath_%s_opensTheFirstOfTheirs @S-A49-BAD-NOT-MEMBER', (_name, hash, opened) => {
        const d = deps(hash);
        d.local.set(cityMemoryKey('u-ana'), 'timisoara');

        expect(chooseCity({ cities: [CLUJ, BUCHAREST], projectOwner: false }, d).cityId).toBe(opened);
    });

    it('badPath_anAdminOfNoCityAndAnUnknownAccountRememberNothing', () => {
        const none = deps();
        const anonymous = deps('', { uid: null });

        expect(chooseCity({ cities: [], projectOwner: true }, none)).toEqual({ cities: [], cityId: null, projectOwner: true });
        expect(chooseCity({ cities: [CLUJ], projectOwner: false }, anonymous).cityId).toBe('cluj');
        expect([none.local.keys(), anonymous.local.keys()]).toEqual([[], []]);
    });
});

describe('opening another city', () => {
    it('happyPath_aPageLoadAtItsHomeOrTheGivenPageRemembersIt', () => {
        const location = new FakeLocation('#/c/bucharest/photos');
        const local = new MemoryStore();

        switchTo(location, local, { uid: 'u-ana', cityId: 'cluj' });
        switchTo(location, local, { uid: null, cityId: 'bacau', route: { id: 'photos', params: [] } });

        expect(location.writes.map((write) => write.hash)).toEqual(['#/c/cluj/home', '#/c/bacau/photos']);
        expect(location.reloads).toBe(2);
        expect(local.get(cityMemoryKey('u-ana'))).toBe('cluj');
    });
});

describe('asking the cities again', () => {
    it('happyPath_atMostOnceAMinuteKeepingTheOpenCity', async () => {
        const callables = new FakeCallables();
        const shell = shellStateAccess({ cities: [BUCHAREST], cityId: 'bucharest', locale: 'ro' });
        const clock = new FakeClock();
        callables.answer('admin.session', () => ({
            admin: true,
            role: 'admin',
            claim: true,
            refreshToken: false,
            ownerClaimed: true,
            invitePending: false,
            cities: [CLUJ, BUCHAREST],
            projectOwner: false,
        }));
        const refresh = cityRefresher({ callables, shell, clock, log: testLog().log });

        await refresh();
        await refresh();
        clock.advance(CITIES_REFRESH_MS);
        await refresh();

        expect(callables.named('admin.session')).toBe(2);
        expect(shell.get()).toMatchObject({ cities: [BUCHAREST, CLUJ], cityId: 'bucharest', projectOwner: false });
    });

    it('badPath_aFailedAskKeepsTheCitiesAndIsLogged', async () => {
        const callables = new FakeCallables();
        callables.fail('admin.session', failure('unavailable', 'apiError.unavailable'));
        const shell = shellStateAccess({ cities: [BUCHAREST], cityId: 'bucharest' });
        const { log, recording } = testLog();

        await cityRefresher({ callables, shell, clock: new FakeClock(), log })();

        expect(shell.get().cities).toEqual([BUCHAREST]);
        expect(recording.records.map((record) => record.message)).toContain('the cities could not be asked again');
    });
});
