/**
 * Whether Hosting still serves this admin (finding 29 of `docs/research/manual-test-2026-10-25.md`, live test 2026-10-31):
 * a tab left open across a redeploy keeps running the old release's chunks, and its install builds would name the old
 * release's install bundle, which the redeploy removed. The watch reads `runtime.json` again (no-store, a few hundred
 * bytes): when the tab becomes visible again (at most once a minute), every five minutes while it is visible, and on
 * demand before an install build is submitted (`check`). Once a release other than its own is served it says so once
 * (`onNewer`: the shell's Reload banner) and reads nothing more. A build without a release (`dev`, the unit tests, the e2e
 * world's own) watches nothing. The clock and the visibility are injected, so no test waits on the wall clock.
 */
import { RELEASE_PATTERN, type Logger } from '@hcm/shared';

import { loadRuntime } from './config.js';
import type { Clock, PageVisibility, Unsubscribe } from './ports.js';

/** How often a visible tab reads `runtime.json`. */
export const RELEASE_LOOK_MS = 5 * 60_000;
/** A tab that becomes visible again reads it only when the last read is at least this old. */
export const RELEASE_REVISIT_MS = 60_000;

export interface ReleaseWatchDeps {
    readonly fetch: (url: string, init?: RequestInit) => Promise<Response>;
    readonly clock: Clock;
    readonly visibility: PageVisibility;
    /** This admin's own release (`runtime.json` at boot). */
    readonly release: string;
    readonly log: Logger;
}

export interface ReleaseWatch {
    /** The release Hosting serves instead of this one, once seen; null while none is. */
    newer(): string | null;
    /**
     * Reads `runtime.json` now: the release Hosting serves instead of this one, or null while it still serves this admin
     * (or cannot say: an unreadable file is no news).
     */
    check(): Promise<string | null>;
    /** Hears the newer release once it is seen (at once when it already is). */
    onNewer(listener: (release: string) => void): Unsubscribe;
    stop(): void;
}

class Watch implements ReleaseWatch {
    readonly #deps: ReleaseWatchDeps;
    readonly #listeners = new Set<(release: string) => void>();
    #newer: string | null = null;
    #lastLook = Number.NEGATIVE_INFINITY;
    #looking: Promise<void> | null = null;
    #timer: unknown = null;
    #stopVisibility: Unsubscribe | null = null;

    constructor(deps: ReleaseWatchDeps) {
        this.#deps = deps;
        this.#lastLook = deps.clock.now();
        this.#stopVisibility = deps.visibility.onChange((visible) => {
            this.#visibilityChanged(visible);
        });
        if (deps.visibility.visible()) {
            this.#schedule();
        }
    }

    newer(): string | null {
        return this.#newer;
    }

    async check(): Promise<string | null> {
        await this.#look();
        return this.#newer;
    }

    onNewer(listener: (release: string) => void): Unsubscribe {
        if (this.#newer !== null) {
            listener(this.#newer);
        }
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    stop(): void {
        this.#unschedule();
        this.#stopVisibility?.();
        this.#stopVisibility = null;
    }

    #visibilityChanged(visible: boolean): void {
        this.#unschedule();
        if (!visible) {
            return;
        }
        if (this.#deps.clock.now() - this.#lastLook >= RELEASE_REVISIT_MS) {
            void this.#look();
        }
        this.#schedule();
    }

    #schedule(): void {
        this.#timer = this.#deps.clock.setTimeout(() => {
            this.#timer = null;
            void this.#look().then(() => {
                this.#scheduleIfVisible();
            });
        }, RELEASE_LOOK_MS);
    }

    #scheduleIfVisible(): void {
        if (this.#newer === null && this.#timer === null && this.#stopVisibility !== null && this.#deps.visibility.visible()) {
            this.#schedule();
        }
    }

    #unschedule(): void {
        if (this.#timer !== null) {
            this.#deps.clock.clearTimeout(this.#timer);
            this.#timer = null;
        }
    }

    /** One read at a time; none once a newer release is known. */
    #look(): Promise<void> {
        if (this.#newer !== null) {
            return Promise.resolve();
        }
        this.#looking ??= this.#read().finally(() => {
            this.#looking = null;
        });
        return this.#looking;
    }

    async #read(): Promise<void> {
        this.#lastLook = this.#deps.clock.now();
        const { release } = await loadRuntime(this.#deps.fetch);
        if (release !== this.#deps.release && RELEASE_PATTERN.test(release)) {
            this.#found(release);
        }
    }

    #found(release: string): void {
        this.#newer = release;
        this.#deps.log.info('a newer admin is served', { release, running: this.#deps.release });
        this.stop();
        for (const listener of [...this.#listeners]) {
            listener(release);
        }
    }
}

/** A watch that never looks: a build without a release of its own has nothing to compare. */
const NO_WATCH: ReleaseWatch = {
    newer: () => null,
    check: () => Promise.resolve(null),
    onNewer: () => () => undefined,
    stop: () => undefined,
};

/** The watch of `deps.release`, started (inert for a build without a release). */
export function watchRelease(deps: ReleaseWatchDeps): ReleaseWatch {
    return RELEASE_PATTERN.test(deps.release) ? new Watch(deps) : NO_WATCH;
}
