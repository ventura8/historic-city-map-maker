/**
 * What the shell watches while an admin is signed in (`docs/research/M2b-interfaces.md` §1.7): the city's theme, whether
 * Setup is complete (`setup-readiness.ts`) and, since M4, the admin's unread notifications for the Notifications item's
 * badge (`../inbox/badge.ts`), and (finding 29 of 2026-10-31) whether Hosting serves a newer admin (`./release-watch.ts`).
 * Each follows the shell's state and stops with the app. Finding 72 of 2026-11-02: this computer's worker, paired while the
 * admin is open in a browser that set the computer up (`./local-watch.ts`, a listener of the shell's state of its own). M13
 * §3: the Contribute page's welcome follows the address (`./welcome.ts`).
 */
import type { ContentStore } from '../content/services.js';
import type { DocumentsPort } from '../firebase/ports.js';
import { InboxBadge } from '../inbox/badge.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import { CityTheme } from './city-theme.js';
import { watchComputer, type ComputerWatchDeps, type JobsStores, type ShellStates } from './local-watch.js';
import type { HashLocation, KeyValueStore } from './ports.js';
import { followReleases, type ReleaseFollowDeps } from './release-reload.js';
import { SetupReadiness } from './setup-readiness.js';
import { followWelcome } from './welcome.js';

export interface ShellWatchSources {
    readonly firebase: { readonly documents: DocumentsPort };
    readonly project: { readonly cities: readonly string[] };
    readonly config: { readonly projectId: string };
    readonly local: KeyValueStore;
    /** The `e2e` build's own city (`ContentDeps.cityId`), else null. */
    readonly content?: { readonly cityId: string | null } | undefined;
    /** The editors' Firestore, for the badge's query; null without the editors. */
    readonly store: ContentStore | null;
    /**
     * Finding 29 of 2026-10-31: a newer admin served; M18 item 1: the tab reloads by itself when it is safe, else the shell's
     * Reload banner (`./release-reload.ts`); none: nothing is watched.
     */
    readonly releases?: ReleaseFollowDeps['releases'];
    readonly visibility: ReleaseFollowDeps['visibility'];
    readonly clock: ReleaseFollowDeps['clock'];
    /** The address: the release's reload, and (M13 §3) the Contribute page's welcome while it is open. */
    readonly location: ReleaseFollowDeps['location'] & HashLocation;
    readonly unsaved: ReleaseFollowDeps['unsaved'];
    /** The installed app updates itself (2026-11-14): whether nobody uses the tab (`./activity.ts`); none: never idle. */
    readonly idle?: ReleaseFollowDeps['idle'];
    /** The tab's `sessionStorage`: the release it reloaded for, so a reload never loops. */
    readonly session?: ReleaseFollowDeps['session'];
    /** Finding 72: the shell's state, the areas' stores, the pages and the log, for this computer's worker. */
    readonly states: ShellStates;
    readonly stores: JobsStores;
    readonly log: ComputerWatchDeps['log'];
    readonly pages: ComputerWatchDeps['pages'];
}

export interface ShellWatches {
    stateChanged(state: ShellState): void;
    stop(): void;
}

export function shellWatches(sources: ShellWatchSources, shell: ShellStateAccess, denied: () => void): ShellWatches {
    const documents = sources.firebase.documents;
    // The city the editors edit: the `e2e` build's own city when the address names one (CR-M2c-7), so the shell wears its theme.
    const ownCity = sources.content?.cityId ?? null;
    const cityId = ownCity ?? sources.project.cities[0] ?? null;
    // M5: the shell's current city once the session chose it (`./current-city.ts`); the fallback before.
    const cityTheme = new CityTheme({ documents, shell, cityId, denied });
    const readiness = new SetupReadiness({
        ...{ documents, shell, local: sources.local, projectId: sources.config.projectId, denied },
        watch: ownCity === null,
    });
    const badge = new InboxBadge({ store: sources.store, shell, denied });
    const releases = followReleases(sources, shell);
    const computer = watchComputer(sources, sources.states, sources.stores);
    const welcome = followWelcome(sources.location, sources.project.cities, (next) => {
        shell.update({ welcome: next });
    });
    return {
        stateChanged: (state) => {
            readiness.stateChanged(state);
            cityTheme.stateChanged(state);
            badge.stateChanged(state);
        },
        stop: () => {
            cityTheme.stop();
            readiness.stop();
            badge.stop();
            releases();
            computer();
            welcome();
        },
    };
}
