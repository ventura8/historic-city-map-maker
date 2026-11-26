/**
 * M5's addresses of a city (`docs/research/M5-interfaces.md` §1.5; behaviour A49): the `#/c/<city>/` prefix, written for
 * an admin of two cities or more and never for an admin of one, another of the admin's cities opened with a page load,
 * and a city the admin does not administer refused with the current one opened.
 */
import { describe, expect, it, vi } from 'vitest';

import { Navigation } from '../../src/app/navigation.js';
import { PageRegistry } from '../../src/routing/pages.js';
import { RETURN_TO_KEY } from '../../src/routing/router.js';
import { ADMIN_ROUTE_SPECS, adminRouteHash, parseAdminRoute } from '../../src/routing/routes.js';
import type { AdminCity, ShellState } from '../../src/state/state.js';
import { FakeLocation, MemoryStore, shellStateAccess } from './fakes.js';

const BUCHAREST: AdminCity = { id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } };
const CLUJ: AdminCity = { id: 'cluj', role: 'editor', name: { ro: 'Cluj-Napoca' } };

function navigation(hash: string, cities: readonly AdminCity[]) {
    const location = new FakeLocation(hash);
    const session = new MemoryStore();
    const shell = shellStateAccess({ cities, cityId: 'bucharest' });
    const registry = new PageRegistry();
    for (const page of ['photos', 'home', 'crashes'] as const) {
        registry.register(page, () => Promise.resolve(`hcm-${page}-page`));
    }
    const switchCity = vi.fn();
    const nav = new Navigation({ shell, location, session, pages: registry, track: vi.fn(), switchCity });
    const change = (patch: Partial<ShellState>): void => {
        shell.update(patch);
        nav.stateChanged(shell.get());
    };
    return { location, session, shell, nav, change, switchCity };
}

describe('the city prefix of an address', () => {
    it('happyPath_aRouteNamesItsCityAndBack', () => {
        expect(parseAdminRoute('#/c/cluj/photos/p1')).toEqual({ id: 'photos', params: ['p1'], cityId: 'cluj' });
        expect(adminRouteHash({ id: 'photos', params: ['p1'], cityId: 'cluj' })).toBe('#/c/cluj/photos/p1');
        expect(parseAdminRoute('#/c/cluj/imagery/version/v1')).toEqual({ id: 'imagery', params: ['version', 'v1'], cityId: 'cluj' });
        expect(parseAdminRoute('#/cities/new')).toEqual({ id: 'cities', params: ['new'] });
        expect([ADMIN_ROUTE_SPECS.cities.scope, ADMIN_ROUTE_SPECS.photos.scope, ADMIN_ROUTE_SPECS.inbox.scope]).toEqual([
            'project',
            'city',
            'project',
        ]);
    });

    it.each([
        ['a city id with capitals', '#/c/Cluj/photos'],
        ['no city at all', '#/c'],
        ['a prefix without a page', '#/c/cluj'],
        ['an unknown page of a city', '#/c/cluj/nowhere'],
    ])('badPath_%s_isNoRoute', (_name, hash) => {
        expect(parseAdminRoute(hash)).toBeNull();
    });
});

describe('Navigation: many cities', () => {
    it('happyPath_anAdminOfTwoCitiesGetsTheCityInTheAddress @S-A49-HAPPY', () => {
        const n = navigation('#/photos', [BUCHAREST, CLUJ]);

        n.change({ auth: 'admin', mode: 'normal' });
        n.nav.navigate({ id: 'home', params: [] });
        n.nav.navigate({ id: 'crashes', params: [] });

        expect(n.location.writes).toEqual([
            { hash: '#/c/bucharest/photos', replace: true },
            { hash: '#/c/bucharest/home', replace: false },
            { hash: '#/crashes', replace: false },
        ]);
        expect(n.shell.get().route).toEqual({ id: 'crashes', params: [] });
    });

    it('happyPath_anAdminOfOneCityNeverSeesThePrefix @S-A49-HAPPY-ONE-CITY', () => {
        const n = navigation('', [BUCHAREST]);
        n.change({ auth: 'admin', mode: 'normal' });

        n.location.visit('#/c/bucharest/photos');
        n.nav.navigate({ id: 'home', params: [] });

        expect(n.location.writes).toEqual([
            { hash: '#/photos', replace: true },
            { hash: '#/home', replace: false },
        ]);
        expect(n.switchCity).not.toHaveBeenCalled();
    });

    it('happyPath_aLinkToAnotherOfTheAdminsCitiesOpensItWithAPageLoad', () => {
        const n = navigation('#/c/bucharest/home', [BUCHAREST, CLUJ]);
        n.change({ auth: 'admin', mode: 'normal' });

        n.location.visit('#/c/cluj/photos');

        expect(n.switchCity).toHaveBeenCalledWith('cluj');
        expect(n.shell.get().route).toEqual({ id: 'home', params: [] });
    });

    it('badPath_aCityTheAdminDoesNotAdministerOpensTheirOwn @S-A49-BAD-NOT-MEMBER', () => {
        const n = navigation('#/c/bacau/photos/p1', [BUCHAREST, CLUJ]);

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get()).toMatchObject({
            route: { id: 'photos', params: ['p1'] },
            notice: { key: 'adminShell.city.notMember', params: { cityId: 'bacau', city: 'Bucharest' } },
        });
        expect(n.location.writes).toEqual([{ hash: '#/c/bucharest/photos/p1', replace: true }]);
        expect(n.switchCity).not.toHaveBeenCalled();
    });

    it('badPath_aProjectPageNamingACityKeepsTheOpenOneAndDropsThePrefix', () => {
        const n = navigation('#/c/cluj/crashes', [BUCHAREST, CLUJ]);

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.location.writes).toEqual([{ hash: '#/crashes', replace: true }]);
        expect(n.switchCity).not.toHaveBeenCalled();
    });

    it('badPath_anEditBeforeAnotherCityAsksFirstAndKeepsTheAddress @S-A49-BAD-UNSAVED', () => {
        const location = new FakeLocation('#/c/bucharest/photos');
        const shell = shellStateAccess({ cities: [BUCHAREST, CLUJ], cityId: 'bucharest' });
        const registry = new PageRegistry();
        registry.register('photos', () => Promise.resolve('hcm-photos-page'));
        registry.register('home', () => Promise.resolve('hcm-home-page'));
        const nav = new Navigation({ shell, location, session: new MemoryStore(), pages: registry, track: vi.fn(), unsaved: () => true });
        shell.update({ auth: 'admin', mode: 'normal' });
        nav.stateChanged(shell.get());

        location.visit('#/c/bucharest/home');

        expect(shell.get().leaving).toEqual({ kind: 'route', route: { id: 'home', params: [] } });
        expect(location.current).toBe('#/c/bucharest/photos');
        nav.leave();
        expect(location.writes.at(-1)).toEqual({ hash: '#/c/bucharest/home', replace: false });
    });

    it('badPath_aSignedOutDeepLinkToAnotherCityIsNotSeededIntoTheHistory', () => {
        const n = navigation('', [BUCHAREST]);
        n.session.set(RETURN_TO_KEY, '#/c/bacau/photos/p1');

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get().notice?.key).toBe('adminShell.city.notMember');
        expect(n.location.writes.filter((write) => !write.replace)).toEqual([]);
    });
});

describe('Navigation: the first screen of an admin of many cities', () => {
    it('happyPath_anEmptyAddressWaitsForSetupsReadinessThenOpensTheCitysDashboard @S-A49-HAPPY-FIRST-SCREEN', () => {
        // docs/LESSONS.md 257: the empty address became #/setup before Setup answered, so the dashboard never opened.
        const n = navigation('', [BUCHAREST, CLUJ]);
        n.change({ auth: 'admin', mode: 'normal' });
        expect(n.shell.get().route.id).toBe('setup');
        expect(n.location.writes).toEqual([]);

        n.change({ setupReady: true });

        expect(n.shell.get().route.id).toBe('home');
        expect(n.location.writes).toEqual([{ hash: '#/c/bucharest/home', replace: true }]);
    });

    it('badPath_whileSetupIsNotCompleteTheEmptyAddressOpensSetupAndStaysEmpty @S-A49-BAD-FIRST-SCREEN-INCOMPLETE', () => {
        const n = navigation('', [BUCHAREST, CLUJ]);
        n.change({ auth: 'admin', mode: 'normal' });

        n.change({ setupReady: false });

        expect(n.shell.get().route.id).toBe('setup');
        expect(n.location.writes).toEqual([]);
    });
});
