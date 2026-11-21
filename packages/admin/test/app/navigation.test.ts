import { describe, expect, it, vi } from 'vitest';

import { Navigation } from '../../src/app/navigation.js';
import { PageRegistry } from '../../src/routing/pages.js';
import { RETURN_TO_KEY } from '../../src/routing/router.js';
import type { ShellState } from '../../src/state/state.js';
import { FakeLocation, MemoryStore, shellStateAccess } from './fakes.js';

function navigation(hash: string, pages: readonly ('admins' | 'photos' | 'home')[] = ['admins']) {
    const location = new FakeLocation(hash);
    const session = new MemoryStore();
    const shell = shellStateAccess();
    const registry = new PageRegistry();
    for (const page of pages) {
        registry.register(page, () => Promise.resolve(`hcm-${page}-page`));
    }
    const track = vi.fn();
    const nav = new Navigation({ shell, location, session, pages: registry, track });
    const change = (patch: Partial<ShellState>): void => {
        shell.update(patch);
        nav.stateChanged(shell.get());
    };
    return { location, session, shell, track, nav, change };
}

describe('Navigation', () => {
    it('badPath_aSignedOutDeepLinkIsKeptAndOpenedAfterSignIn', () => {
        const n = navigation('#/admins');

        n.change({ auth: 'signedOut', mode: 'normal' });
        expect(n.session.get(RETURN_TO_KEY)).toBe('#/admins');
        n.location.current = '';
        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get().route).toEqual({ id: 'admins', params: [] });
        expect(n.session.get(RETURN_TO_KEY)).toBeNull();
        expect(n.location.writes).toEqual([{ hash: '#/admins', replace: true }]);
        expect(n.track).toHaveBeenCalledWith({ name: 'page_view', route: 'admins' });
    });

    it('badPath_anItemsAddressOpenedDirectlyPutsItsListUnderItSoBackStaysInTheAdmin', () => {
        const n = navigation('#/photos/p1', ['photos']);

        n.change({ auth: 'admin', mode: 'normal' });
        const first = [...n.location.writes];
        const route = n.shell.get().route;
        // Signed out and in again on the same page: the history is not seeded twice.
        n.change({ auth: 'signedOut' });
        n.change({ auth: 'admin' });

        expect(first).toEqual([
            { hash: '#/photos', replace: true },
            { hash: '#/photos/p1', replace: false },
        ]);
        expect(route).toEqual({ id: 'photos', params: ['p1'] });
        expect(n.location.writes.filter((write) => write.hash === '#/photos')).toHaveLength(1);
    });

    it('happyPath_aLinkOpensItsPageAndEachRouteIsOnePageView', () => {
        const n = navigation('');
        n.change({ auth: 'admin', mode: 'normal' });

        n.location.visit('#/admins');
        n.location.visit('#/admins');
        n.nav.navigate({ id: 'setup', params: [] });

        expect(n.shell.get().route.id).toBe('setup');
        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup', 'admins']);
        expect(n.track.mock.calls.map(([event]) => (event as { route: string }).route)).toEqual(['setup', 'admins', 'setup']);
    });

    it('badPath_anUnknownAddressOpensSetupWithAMessage', () => {
        const n = navigation('#/nowhere');

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get()).toMatchObject({ route: { id: 'setup' }, notice: { key: 'adminShell.route.notFound' } });
        expect(n.location.writes).toEqual([{ hash: '#/setup', replace: true }]);
    });

    it('badPath_aServerPageInStartUpModeOpensSetupAndTheSwitchKeepsNavigating', () => {
        const n = navigation('#/admins');
        n.change({ auth: 'bootstrap', mode: 'bootstrap' });
        expect(n.shell.get()).toMatchObject({ route: { id: 'setup' }, notice: { key: 'adminShell.route.needsBackend' } });
        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup']);

        n.change({ auth: 'admin', mode: 'normal' });

        expect(n.shell.get().destinations.map((destination) => destination.id)).toEqual(['setup', 'admins']);
    });

    it('badPath_somethingThatIsNotARouteHashIsNotKept', () => {
        const n = navigation('#photo=abc');

        n.change({ auth: 'signedOut', mode: 'normal' });
        n.location.visit('#/setup?x=1');

        expect(n.session.get(RETURN_TO_KEY)).toBeNull();
    });

    it('happyPath_aStateChangeThatKeepsShellAndModeChangesNothing', () => {
        const n = navigation('');
        n.change({ auth: 'admin', mode: 'normal' });

        n.change({ busy: true });
        n.nav.stop();
        n.location.visit('#/admins');

        expect(n.track).toHaveBeenCalledTimes(1);
        expect(n.shell.get().route.id).toBe('setup');
    });
});

describe('Navigation: the unsaved-changes question', () => {
    function guarded(unsaved: { value: boolean }) {
        const location = new FakeLocation('#/admins');
        const shell = shellStateAccess();
        const registry = new PageRegistry();
        registry.register('admins', () => Promise.resolve('hcm-admins-page'));
        registry.register('photos', () => Promise.resolve('hcm-photos-page'));
        const nav = new Navigation({
            shell,
            location,
            session: new MemoryStore(),
            pages: registry,
            track: vi.fn(),
            unsaved: () => unsaved.value,
        });
        shell.update({ auth: 'admin', mode: 'normal' });
        nav.stateChanged(shell.get());
        return { location, shell, nav };
    }

    it('badPath_aLinkWithAnUnsavedEditAsksFirstAndKeepEditingStays', () => {
        const unsaved = { value: true };
        const n = guarded(unsaved);

        n.nav.navigate({ id: 'photos', params: [] });
        const asked = n.shell.get().leaving;
        n.nav.stay();

        expect(asked).toEqual({ kind: 'route', route: { id: 'photos', params: [] } });
        expect(n.shell.get()).toMatchObject({ leaving: null, route: { id: 'admins' } });
        expect(n.location.current).toBe('#/admins');
    });

    it('happyPath_discardOpensTheAddressAskedFor', () => {
        const unsaved = { value: true };
        const n = guarded(unsaved);
        n.nav.navigate({ id: 'photos', params: [] });

        n.nav.leave();

        expect(n.shell.get()).toMatchObject({ leaving: null, route: { id: 'photos' } });
    });

    it('badPath_anAddressTypedOrBackPutsTheEditorBackAndAsks', () => {
        const unsaved = { value: true };
        const n = guarded(unsaved);

        n.location.visit('#/photos');
        const back = n.location.writes.at(-1);
        n.nav.leave();

        expect(back).toEqual({ hash: '#/admins', replace: true });
        expect(n.shell.get().route.id).toBe('photos');
    });

    it('happyPath_nothingIsAskedWithoutAnEditTheSameAddressOrAfterASignOutQuestion', () => {
        const unsaved = { value: false };
        const n = guarded(unsaved);
        n.nav.navigate({ id: 'photos', params: [] });
        unsaved.value = true;
        n.nav.navigate({ id: 'photos', params: [] });
        n.shell.update({ leaving: { kind: 'signOut' } });
        n.nav.leave();

        expect(n.shell.get()).toMatchObject({ leaving: null, route: { id: 'photos' } });
    });
});

describe('Navigation: the first screen once Setup is complete (DECISIONS-for-review.md §34i)', () => {
    it('happyPath_anEmptyAddressFollowsSetupsReadinessAndTheBarFollowsIt', () => {
        const n = navigation('', ['admins', 'home']);
        n.change({ auth: 'admin', mode: 'normal' });
        expect(n.shell.get().route.id).toBe('setup');

        n.change({ setupReady: true });
        expect(n.shell.get().route.id).toBe('home');
        expect(
            n.shell
                .get()
                .destinations.filter((destination) => destination.compact)
                .map((destination) => destination.id),
        ).toEqual(['home']);
        // A later change moves nobody: only the bar follows.
        n.change({ setupReady: false });

        expect(n.shell.get().route.id).toBe('home');
        expect(n.shell.get().destinations.find((destination) => destination.id === 'setup')?.compact).toBe(true);
        expect(n.track.mock.calls.map(([event]) => (event as { route: string }).route)).toEqual(['setup', 'home']);
        expect(n.location.writes).toEqual([]);
    });

    it('badPath_finishingSetupsLastStepLeavesTheAdminOnSetup', () => {
        const n = navigation('', ['admins', 'home']);
        n.change({ auth: 'admin', mode: 'normal' });
        n.change({ setupReady: false });

        n.change({ setupReady: true });

        expect(n.shell.get().route.id).toBe('setup');
        expect(n.shell.get().destinations.find((destination) => destination.id === 'home')?.compact).toBe(true);
    });

    it('happyPath_aBrowserThatRemembersItOpensTheDashboardAtOnce', () => {
        const n = navigation('', ['home']);

        n.change({ auth: 'admin', mode: 'normal', setupReady: true });

        expect(n.shell.get().route.id).toBe('home');
        expect(n.track).toHaveBeenCalledTimes(1);
    });

    it('badPath_anAddressThatNamesAPageStaysWhenSetupBecomesComplete', () => {
        const n = navigation('#/admins', ['admins', 'home']);
        n.change({ auth: 'admin', mode: 'normal' });

        n.change({ setupReady: true });
        n.change({ setupReady: true, busy: true });

        expect(n.shell.get().route.id).toBe('admins');
        expect(n.shell.get().destinations.find((destination) => destination.id === 'home')?.compact).toBe(true);
        expect(n.track).toHaveBeenCalledTimes(1);
    });

    it('badPath_readinessWhileSignedOutChangesNothingUntilTheShellShows', () => {
        const n = navigation('', ['home']);
        n.change({ auth: 'signedOut', mode: 'normal' });

        n.change({ setupReady: true });

        expect(n.shell.get().route.id).toBe('setup');
        expect(n.track).not.toHaveBeenCalled();
    });
});
