/**
 * The admin wears its city's colours (`docs/research/M2b-interfaces.md` §1.2, PLAN: "seed colour with live M3
 * preview"): while the admin is signed in (normal mode) the shell watches `cities/{city}` and takes its precomputed
 * `theme.tokens`; Settings previews a new seed with `previewTheme` before saving it. The watch is also an admin read, so a
 * `permission-denied` (the admin was removed) asks the server again who this is (§1.5).
 */
import { FIRESTORE_PATHS, themeSchema, type ThemeTokens } from '@hcm/shared';

import type { DocumentData, DocumentsPort } from '../firebase/ports.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import type { Unsubscribe } from './ports.js';

/** The city document's theme tokens, or null when it has none or they fail their schema. */
export function cityThemeOf(data: DocumentData | null): ThemeTokens | null {
    const parsed = themeSchema.safeParse(data?.['theme']);
    return parsed.success ? parsed.data.tokens : null;
}

export interface CityThemeDeps {
    readonly documents: DocumentsPort;
    readonly shell: ShellStateAccess;
    /** The city the admin edits before the session names the current one (`infra/project.json`'s first), or null. */
    readonly cityId: string | null;
    /** An admin read was denied. */
    readonly denied: () => void;
}

export class CityTheme {
    readonly #deps: CityThemeDeps;
    #stop: Unsubscribe | null = null;

    constructor(deps: CityThemeDeps) {
        this.#deps = deps;
    }

    /** Starts the watch of the current city (M5: the shell's, else `deps.cityId`) when the admin is signed in, stops it otherwise. */
    stateChanged(state: ShellState): void {
        const cityId = state.auth === 'admin' ? (state.cityId ?? this.#deps.cityId) : null;
        if ((cityId !== null) === (this.#stop !== null)) {
            return;
        }
        if (cityId === null) {
            this.stop();
        } else {
            this.#start(FIRESTORE_PATHS.city(cityId));
        }
    }

    stop(): void {
        this.#stop?.();
        this.#stop = null;
    }

    /**
     * The watch is marked started before it is asked for: a store that answers at once (in the call itself) updates the
     * shell's theme, whose listeners ask this again, and an unmarked watch was started again without end (the M5 tests'
     * stack overflow: the first snapshot of the Firebase SDK comes later, so only a synchronous store showed it).
     */
    #start(path: string): void {
        let stop: Unsubscribe | null = null;
        this.#stop = () => {
            stop?.();
        };
        stop = this.#deps.documents.watch(
            path,
            (data) => {
                const city = cityThemeOf(data);
                this.#deps.shell.update({ theme: { ...this.#deps.shell.get().theme, city } });
            },
            (code) => {
                this.#stop = null;
                if (code === 'permission-denied') {
                    this.#deps.denied();
                }
            },
        );
    }
}
