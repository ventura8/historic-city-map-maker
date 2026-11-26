import { describe, expect, it } from 'vitest';

import { PageRegistry } from '../../src/routing/pages.js';
import { destinationOf, navigationDestinations, resolveAdminRoute, type RouteContext } from '../../src/routing/router.js';
import { ADMIN_ROUTES } from '../../src/routing/routes.js';

const NORMAL: RouteContext = { mode: 'normal', hasPage: (id) => id === 'admins' || id === 'photos' || id === 'history' };
const BOOTSTRAP: RouteContext = { mode: 'bootstrap', hasPage: () => true };

describe('resolveAdminRoute', () => {
    it('happyPath_aKnownRouteWithAPageOpens', () => {
        expect(resolveAdminRoute('#/photos/coltul-strada-fonteriei', NORMAL)).toEqual({
            route: { id: 'photos', params: ['coltul-strada-fonteriei'] },
            notice: null,
        });
        expect(resolveAdminRoute('#/setup/usgs', BOOTSTRAP)).toEqual({ route: { id: 'setup', params: ['usgs'] }, notice: null });
    });

    it('happyPath_noRouteIsSetupWithoutAMessage', () => {
        for (const hash of ['', '#', '#/']) {
            expect(resolveAdminRoute(hash, NORMAL)).toEqual({ route: { id: 'setup', params: [] }, notice: null });
        }
    });

    it('happyPath_onceSetupIsCompleteNoRouteIsTheDashboard', () => {
        const done: RouteContext = { mode: 'normal', hasPage: () => true, setupReady: true };

        for (const hash of ['', '#', '#/']) {
            expect(resolveAdminRoute(hash, done)).toEqual({ route: { id: 'home', params: [] }, notice: null });
        }
        // Setup still opens by its own address, and an unknown address still lands on it.
        expect(resolveAdminRoute('#/setup', done).route.id).toBe('setup');
        expect(resolveAdminRoute('#/billing', done)).toEqual({ route: { id: 'setup', params: [] }, notice: 'adminShell.route.notFound' });
    });

    it('badPath_setupNotCompleteOrUnknownOrWithoutTheDashboardOrInStartUpKeepsSetupFirst', () => {
        expect(resolveAdminRoute('', { mode: 'normal', hasPage: () => true, setupReady: false }).route.id).toBe('setup');
        expect(resolveAdminRoute('', { mode: 'normal', hasPage: () => true }).route.id).toBe('setup');
        expect(resolveAdminRoute('', { mode: 'normal', hasPage: (id) => id !== 'home', setupReady: true }).route.id).toBe('setup');
        expect(resolveAdminRoute('', { mode: 'bootstrap', hasPage: () => true, setupReady: true }).route.id).toBe('setup');
    });

    it('badPath_anUnknownAddressOrAPageNotBuiltOpensSetupWithNotFound', () => {
        expect(resolveAdminRoute('#/billing', NORMAL).notice).toBe('adminShell.route.notFound');
        expect(resolveAdminRoute('#/jobs', NORMAL)).toEqual({ route: { id: 'setup', params: [] }, notice: 'adminShell.route.notFound' });
    });

    it('badPath_aServerPageInStartUpModeOpensSetupWithNeedsBackend', () => {
        expect(resolveAdminRoute('#/admins', BOOTSTRAP)).toEqual({
            route: { id: 'setup', params: [] },
            notice: 'adminShell.route.needsBackend',
        });
        expect(resolveAdminRoute('#/admins', { mode: null, hasPage: () => true }).notice).toBe('adminShell.route.needsBackend');
    });
});

describe('navigationDestinations', () => {
    it('happyPath_normalModeListsSetupAndEveryBuiltPageHistoryIncluded', () => {
        expect(navigationDestinations(NORMAL).map((destination) => destination.id)).toEqual(['setup', 'photos', 'admins', 'history']);
        expect(navigationDestinations({ mode: 'normal', hasPage: () => true }).map((destination) => destination.id)).toEqual(
            ADMIN_ROUTES.filter((id) => id !== 'georef' && id !== 'cities' && id !== 'contribute' && id !== 'help'),
        );
        expect(destinationOf('home')).toEqual({ id: 'home', icon: 'home', compact: false });
    });

    it('happyPath_onceSetupIsCompleteTheDashboardTakesSetupsPlaceOnTheCompactBar', () => {
        const compact = (context: RouteContext): string[] =>
            navigationDestinations(context)
                .filter((destination) => destination.compact)
                .map((destination) => destination.id);

        expect(compact({ mode: 'normal', hasPage: () => true })).toEqual(['setup', 'photos', 'pois', 'layers']);
        expect(compact({ mode: 'normal', hasPage: () => true, setupReady: true })).toEqual(['home', 'photos', 'pois', 'layers']);
        expect(destinationOf('setup', true)).toEqual({ id: 'setup', icon: 'checklist', compact: false });
        expect(destinationOf('home', true)).toEqual({ id: 'home', icon: 'home', compact: true });
    });

    it('badPath_startUpModeListsSetupAlone', () => {
        expect(navigationDestinations(BOOTSTRAP)).toEqual([{ id: 'setup', icon: 'checklist', compact: true }]);
    });

    it('happyPath_aDestinationCarriesItsIconAndBarPlace', () => {
        expect(destinationOf('jobs')).toEqual({ id: 'jobs', icon: 'pending_actions', compact: false });
    });
});

describe('PageRegistry', () => {
    it('happyPath_aRegisteredPageNamesItsElement', async () => {
        const pages = new PageRegistry();
        pages.register('admins', () => Promise.resolve('hcm-admins-page'));

        expect(pages.has('admins')).toBe(true);
        await expect(pages.load('admins')).resolves.toBe('hcm-admins-page');
    });

    it('badPath_noPageOrAForeignTagIsNone', async () => {
        const pages = new PageRegistry();
        pages.register('jobs', () => Promise.resolve('script'));
        pages.register('pois', () => Promise.resolve('hcm-'));

        expect(pages.has('layers')).toBe(false);
        await expect(pages.load('layers')).resolves.toBeNull();
        await expect(pages.load('jobs')).resolves.toBeNull();
        await expect(pages.load('pois')).resolves.toBeNull();
    });

    it('badPath_aChunkThatDoesNotLoadRejectsSoTheShellOffersRetry', async () => {
        const pages = new PageRegistry();
        let attempts = 0;
        pages.register('photos', () => {
            attempts += 1;
            return attempts === 1
                ? Promise.reject(new Error('Failed to fetch dynamically imported module'))
                : Promise.resolve('hcm-photos-page');
        });

        await expect(pages.load('photos')).rejects.toThrow('Failed to fetch dynamically imported module');
        await expect(pages.load('photos')).resolves.toBe('hcm-photos-page');
    });
});

describe('M13: who opens which route (docs/research/M13-roles.md §8)', () => {
    const everything = { mode: 'normal', hasPage: () => true, setupReady: true } as const;

    it('happyPath_aModeratorSeesPhotosPlacesReviewAndNotifications @S-A91-HAPPY-NAV', () => {
        const destinations = navigationDestinations({ ...everything, standing: 'moderator' }).map((item) => item.id);
        expect(destinations).toEqual(['photos', 'pois', 'stories', 'inbox', 'review']);
    });

    it('happyPath_anUploaderSeesNoReview', () => {
        const destinations = navigationDestinations({ ...everything, standing: 'uploader' }).map((item) => item.id);
        expect(destinations).toEqual(['photos', 'pois', 'stories', 'inbox']);
    });

    it.each(['setup', 'settings', 'imagery', 'admins', 'jobs', 'layers', 'history', 'crashes', 'home', 'cities'])(
        'badPath_aModeratorIsKeptFrom_%s @S-A91-BAD-NOT-ALLOWED',
        (route) => {
            expect(resolveAdminRoute(`#/${route}`, { ...everything, standing: 'moderator' })).toEqual({
                route: { id: 'photos', params: [] },
                notice: 'adminShell.route.notAllowed',
            });
        },
    );

    it('badPath_anUploaderIsKeptFromReview', () => {
        expect(resolveAdminRoute('#/review', { ...everything, standing: 'uploader' }).notice).toBe('adminShell.route.notAllowed');
    });

    it('happyPath_aLimitedAccountsFirstScreenIsPhotos', () => {
        expect(resolveAdminRoute('', { ...everything, standing: 'uploader' })).toEqual({
            route: { id: 'photos', params: [] },
            notice: null,
        });
    });

    it('happyPath_aVisitorOpensTheContributePageAndNothingElse', () => {
        const visitor = { ...everything, standing: 'visitor' } as const;
        expect(resolveAdminRoute('#/contribute/bucharest/p1', visitor)).toEqual({
            route: { id: 'contribute', params: ['bucharest', 'p1'] },
            notice: null,
        });
        expect(resolveAdminRoute('#/photos', visitor).route.id).toBe('contribute');
        expect(navigationDestinations(visitor)).toEqual([]);
    });

    it('badPath_aRefusedAddressOfALimitedAccountNeverOpensSetup', () => {
        expect(resolveAdminRoute('#/nosuch', { ...everything, standing: 'uploader' }).route.id).toBe('photos');
    });

    it('happyPath_staffOpenEverything', () => {
        expect(resolveAdminRoute('#/review', everything).route.id).toBe('review');
    });
});
