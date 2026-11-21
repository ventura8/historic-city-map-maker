/**
 * The address and the shell's page (`docs/research/M2b-interfaces.md` §1.1): while the shell shows (start-up or normal
 * mode) every hash change resolves to a route; before that the address asked for is kept in `sessionStorage` and opened
 * once the shell shows (a deep link while signed out leads to sign-in, then to the page). A redirect rewrites the address
 * without a history entry and shows why in the snackbar. Every route shown is one GA4 page view (behind consent).
 */
import { showsShell } from '../auth/auth-state.js';
import type { PageRegistry } from '../routing/pages.js';
import { isBlankAddress, navigationDestinations, resolveAdminRoute, RETURN_TO_KEY, type RouteContext } from '../routing/router.js';
import { ADMIN_ROUTE_SPECS, adminRouteHash, parseAdminRoute, type AdminRoute, type RouteStanding } from '../routing/routes.js';
import type { NoticeInput, ShellState, ShellStateAccess } from '../state/state.js';
import { cityName } from './current-city.js';
import type { HashLocation, KeyValueStore, Unsubscribe } from './ports.js';
import type { AdminEvent } from './telemetry.js';

export interface NavigationDeps {
    readonly shell: ShellStateAccess;
    readonly location: HashLocation;
    readonly session: KeyValueStore;
    readonly pages: PageRegistry;
    readonly track: (event: AdminEvent) => void;
    /** Whether an editor area holds an edit leaving would lose (`docs/research/M2c-interfaces.md` §2.4). */
    readonly unsaved?: () => boolean;
    /** M5: opens another of the admin's cities (a page load, `./current-city.ts` → `switchTo`). */
    readonly switchCity?: (cityId: string) => void;
}

/** M13 §8: who the shell shows pages to: a visitor, a limited role of the open city, or staff. */
function standingOf(state: Pick<ShellState, 'auth' | 'cities' | 'cityId'>): RouteStanding {
    if (state.auth === 'visitor') {
        return 'visitor';
    }
    const role = state.cities.find((city) => city.id === state.cityId)?.role;
    return role === 'uploader' || role === 'moderator' ? role : 'staff';
}

/** M5 (`docs/research/M5-interfaces.md` §1.5): what an address naming a city means for the open one. */
type OtherCity = 'switch' | 'refused' | null;

/** A route without the city its address named (the shell's routes are the current city's). */
function bare(route: AdminRoute): AdminRoute {
    return { id: route.id, params: route.params };
}

export class Navigation {
    readonly #deps: NavigationDeps;
    readonly #stop: Unsubscribe;
    #shown = false;
    #mode: ShellState['mode'] = null;
    /** Setup complete as last seen (`ShellState.setupReady`; null: not known yet). */
    #ready: boolean | null = null;
    /** An empty address was opened before Setup's readiness was known: its first answer decides the first screen. */
    #awaitingReadiness = false;
    /** Set by Discard: the address change it makes is not questioned again. */
    #allowNext = false;
    /** The address of the last page view (one per route shown). */
    #tracked: string | null = null;
    /** The first address the shell showed has been looked at (an item's: its list put under it). */
    #seeded = false;

    constructor(deps: NavigationDeps) {
        this.#deps = deps;
        this.#stop = deps.location.onHashChange((hash) => {
            this.#apply(hash);
        });
    }

    /**
     * Called on every state change: the shell appearing, or the mode changing, resolves the address again; Setup becoming
     * complete (or not) changes the destinations, and an empty address opened before it was known follows its first answer
     * (Setup, or the dashboard, §34i). Later changes never move the admin: finishing Setup's last required step leaves the
     * admin on Setup, where the optional steps wait.
     */
    stateChanged(state: ShellState): void {
        const readyChanged = state.setupReady !== this.#ready;
        this.#ready = state.setupReady;
        if (!this.#shellChanged(state) && readyChanged && this.#shown) {
            this.#readinessChanged();
        }
    }

    /** The shell appeared or went, or its mode changed: the address is resolved again (or kept). False when nothing did. */
    #shellChanged(state: ShellState): boolean {
        const shown = showsShell(state.auth);
        if (shown === this.#shown && state.mode === this.#mode) {
            return false;
        }
        this.#shown = shown;
        this.#mode = state.mode;
        if (shown) {
            this.#shellShown();
        } else {
            this.#keep(this.#deps.location.hash());
        }
        return true;
    }

    /** Setup's readiness changed while the shell shows: the bar follows; an empty address waiting for it opens its first screen. */
    #readinessChanged(): void {
        const hash = this.#deps.location.hash();
        if (this.#awaitingReadiness && isBlankAddress(hash)) {
            this.#apply(hash);
        } else {
            this.#deps.shell.update({ destinations: navigationDestinations(this.#context()) });
        }
        this.#awaitingReadiness = false;
    }

    /** The shell appears (or its mode changes): no page holds an edit yet, so nothing is asked. */
    #shellShown(): void {
        this.#allowNext = true;
        const hash = this.#returnTo() ?? this.#deps.location.hash();
        if (!this.#seedHistory(hash)) {
            this.#apply(hash);
        }
    }

    /** Opens `route`; with an unsaved edit on screen the shell asks first (`leaving`) and goes nowhere yet. */
    navigate(route: AdminRoute): void {
        if (this.#guarded(route)) {
            return;
        }
        this.#deps.location.setHash(this.#address(route), false);
    }

    /** Discard: the next address change goes through unasked (the page then closes its store, which forgets the edit). */
    leave(): void {
        const leaving = this.#deps.shell.get().leaving;
        this.#deps.shell.update({ leaving: null });
        if (leaving?.kind === 'route') {
            this.#allowNext = true;
            this.#deps.location.setHash(this.#address(leaving.route), false);
        }
    }

    /** Keep editing: the question goes away and nothing moves. */
    stay(): void {
        this.#deps.shell.update({ leaving: null });
    }

    stop(): void {
        this.#stop();
    }

    #context(): RouteContext {
        const state = this.#deps.shell.get();
        return {
            mode: state.mode,
            hasPage: (id) => this.#deps.pages.has(id),
            setupReady: state.setupReady === true,
            standing: standingOf(state),
        };
    }

    /** The kept address (removed once read); it replaces the current one. */
    #returnTo(): string | null {
        const kept = this.#deps.session.get(RETURN_TO_KEY);
        this.#deps.session.remove(RETURN_TO_KEY);
        if (kept !== null) {
            this.#deps.location.setHash(kept, true);
        }
        return kept;
    }

    /**
     * An item's address opened directly (a link, a bookmark, a reload): its list goes under it in the history, so Back shows
     * the list (on a phone the editor is all there is, `docs/research/M2c-interfaces.md` §1.2) and never the site the admin
     * came from. Once per page; true when the item's address was pushed (its page then opened through the push).
     */
    #seedHistory(hash: string): boolean {
        if (this.#seeded) {
            return false;
        }
        this.#seeded = true;
        const route = resolveAdminRoute(hash, this.#context()).route;
        if (route.params.length === 0 || this.#otherCity(route) !== null) {
            return false;
        }
        this.#deps.location.setHash(this.#address({ id: route.id, params: [] }), true);
        this.#deps.location.setHash(this.#address(route), false);
        return true;
    }

    /** Keeps a route hash for after sign-in (anything else is not kept). */
    #keep(hash: string): void {
        if (/^#\/[\w/-]{1,200}$/.test(hash)) {
            this.#deps.session.set(RETURN_TO_KEY, hash);
        }
    }

    /** True when leaving the current page for `route` would lose an edit: the shell then asks (`leaving`). */
    #guarded(route: AdminRoute): boolean {
        const current = this.#deps.shell.get().route;
        const unsaved = this.#deps.unsaved?.() ?? false;
        if (!unsaved || adminRouteHash(bare(route)) === adminRouteHash(bare(current))) {
            return false;
        }
        this.#deps.shell.update({ leaving: { kind: 'route', route: bare(route) } });
        return true;
    }

    /**
     * An address typed or a Back with an unsaved edit: a hash change cannot be cancelled, so the editor's address is put
     * back (without a history entry) and the shell asks; Discard then opens the address asked for.
     */
    #heldBack(hash: string, context: RouteContext): boolean {
        if (this.#allowNext) {
            this.#allowNext = false;
            return false;
        }
        const route = resolveAdminRoute(hash, context).route;
        if (!this.#guarded(route)) {
            return false;
        }
        this.#deps.location.setHash(this.#address(this.#deps.shell.get().route), true);
        return true;
    }

    /** An empty address opened before Setup's readiness is known waits for its first answer (`#readinessChanged`). */
    #awaitReadiness(hash: string): void {
        this.#awaitingReadiness = isBlankAddress(hash) && this.#deps.shell.get().setupReady === null;
    }

    /**
     * M5: an address naming another city on a city page. One of the admin's opens with a page load; one they do not
     * administer is refused (the page opens in the current city, nothing of the other is read: S-A49-BAD-NOT-MEMBER).
     */
    #otherCity(route: AdminRoute): OtherCity {
        const state = this.#deps.shell.get();
        if (route.cityId === undefined || route.cityId === state.cityId || ADMIN_ROUTE_SPECS[route.id].scope !== 'city') {
            return null;
        }
        return state.cities.some((city) => city.id === route.cityId) ? 'switch' : 'refused';
    }

    /** Whether the admin's addresses name their city: an admin of two cities or more, on a city page (S-A49-HAPPY). */
    #prefixed(route: AdminRoute): boolean {
        const state = this.#deps.shell.get();
        return state.cityId !== null && state.cities.length >= 2 && ADMIN_ROUTE_SPECS[route.id].scope === 'city';
    }

    /** The address of `route` as the admin's cities write it (`#/c/<city>/...` or `#/...`, S-A49-HAPPY-ONE-CITY). */
    #address(route: AdminRoute): string {
        const cityId = this.#deps.shell.get().cityId;
        const base = { id: route.id, params: route.params };
        return adminRouteHash(cityId !== null && this.#prefixed(route) ? { ...base, cityId } : base);
    }

    /** Why the address is not opened as asked: the route's own reason, or (M5) a city the admin does not administer. */
    #noticeOf(resolved: ReturnType<typeof resolveAdminRoute>, asked: AdminRoute | null): NoticeInput | null {
        if (resolved.notice !== null) {
            return { key: resolved.notice };
        }
        return asked === null ? null : this.#refusedCity(asked);
    }

    /** An address of a city the admin does not belong to opens the current city's page instead, saying why (S-A49-BAD). */
    #refusedCity(asked: AdminRoute): NoticeInput | null {
        const state = this.#deps.shell.get();
        const open = state.cities.find((city) => city.id === state.cityId);
        if (this.#otherCity(asked) !== 'refused' || open === undefined) {
            return null;
        }
        return { key: 'adminShell.city.notMember', params: { cityId: asked.cityId ?? '', city: cityName(open, state.locale) } };
    }

    /**
     * The address is rewritten (no history entry) when the page opened is not the one it names, or when its city prefix
     * is not the one the admin's cities write. An empty address stays empty unless the page it opens names a city (a city
     * page of an admin of two cities or more): Setup, opened before its readiness is known, keeps it empty, so the first
     * answer can still open the dashboard (§34i; `docs/LESSONS.md` 257).
     */
    #rewrites(hash: string, route: AdminRoute, address: string, notice: NoticeInput | null): boolean {
        if (notice !== null) {
            return true;
        }
        return isBlankAddress(hash) ? this.#prefixed(route) : address !== hash;
    }

    #apply(hash: string): void {
        if (!showsShell(this.#deps.shell.get().auth)) {
            this.#keep(hash);
            return;
        }
        const context = this.#context();
        if (this.#heldBack(hash, context) || this.#switched(hash)) {
            return;
        }
        const resolved = resolveAdminRoute(hash, context);
        this.#awaitReadiness(hash);
        this.#show(hash, bare(resolved.route), this.#noticeOf(resolved, parseAdminRoute(hash)));
    }

    /** An address of another of the admin's cities opens that city (a page load, `switchCity`); true when it did. */
    #switched(hash: string): boolean {
        const asked = parseAdminRoute(hash);
        if (asked === null || this.#otherCity(asked) !== 'switch') {
            return false;
        }
        this.#deps.switchCity?.(asked.cityId ?? '');
        return true;
    }

    /** Shows `route` (its address rewritten when it must be) and counts one page view per address. */
    #show(hash: string, route: AdminRoute, notice: NoticeInput | null): void {
        const context = this.#context();
        const address = this.#address(route);
        if (this.#rewrites(hash, route, address, notice)) {
            this.#deps.location.setHash(address, true);
        }
        if (notice !== null) {
            this.#deps.shell.update({ notice: this.#deps.shell.notice(notice) });
        }
        this.#deps.shell.update({ route, destinations: navigationDestinations(context) });
        if (address !== this.#tracked) {
            this.#tracked = address;
            this.#deps.track({ name: 'page_view', route: route.id });
        }
    }
}
