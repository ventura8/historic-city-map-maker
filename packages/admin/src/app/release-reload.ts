/**
 * What the shell does once Hosting serves a newer admin (finding 29 of 2026-10-31; M18 item 1,
 * `docs/research/M18-improvements.md`): the tab used to keep the release it booted with until the owner reloaded, so
 * Home's and Setup's Update the map, which compare the installed release with the admin's own, stayed hidden after a
 * deploy. Now the tab reloads by itself when no one is looking at it or the owner has just come back to it (the newer
 * release seen within `RETURN_WINDOW_MS` of the tab becoming visible, or on any later return), and only when no edit
 * would be lost; otherwise the Reload banner stays up as before. The sign-in lives in the tab's `sessionStorage`, so it
 * survives the reload.
 *
 * The installed app keeps itself up to date (the owner, 2026-11-14; `docs/ENGINE_API.md` → *Installable app* →
 * *Updates*): a tab in use also reloads by itself once nobody has touched it for a minute (`idle`, `./activity.ts`),
 * trying again every `RELOAD_RETRY_MS` while the banner is up; an unsaved edit or an upload still holds it. It never loops:
 * the release it reloads for is written into the tab's `sessionStorage` first, and a tab that comes back still running the
 * older admin (a cache between it and Hosting, lesson 707) only offers Reload; without that storage it never reloads by
 * itself.
 */
import type { Logger } from '@hcm/shared';

import type { ShellStateAccess } from '../state/state.js';
import type { Clock, HashLocation, KeyValueStore, PageVisibility } from './ports.js';
import type { ReleaseWatch } from './release-watch.js';

/** A newer release seen this long after the tab became visible again is the owner's return, not work under way. */
export const RETURN_WINDOW_MS = 10_000;
/** While the banner is up, how often the tab tries the reload again. */
export const RELOAD_RETRY_MS = 15_000;
/** The tab's `sessionStorage` key of the release it last reloaded for. */
export const RELOADED_FOR_KEY = 'hcm-admin-reloaded-for';

export interface ReleaseFollowDeps {
    /** Finding 29: a newer admin served; none: nothing is watched. */
    readonly releases?: Pick<ReleaseWatch, 'onNewer' | 'stop'> | undefined;
    readonly visibility: PageVisibility;
    readonly clock: Pick<Clock, 'now' | 'setTimeout' | 'clearTimeout'>;
    readonly location: Pick<HashLocation, 'reload'>;
    /** An edit on screen, or an upload still being sent, that a reload would lose. */
    readonly unsaved: () => boolean;
    /** True while nobody uses the visible tab (`./activity.ts`); none: a visible tab is always in use. */
    readonly idle?: (() => boolean) | undefined;
    /** The tab's `sessionStorage`, which remembers the release it reloaded for (no loop); none: not remembered. */
    readonly session?: Pick<KeyValueStore, 'get' | 'set'> | undefined;
    readonly log: Pick<Logger, 'info'>;
}

/** What one try came to: reloaded, not a safe moment yet, or this tab already reloaded for that release. */
type Attempt = 'reloaded' | 'wait' | 'stuck';

/** Records the reload for `release`; false when this tab already reloaded for it or cannot remember it. */
function remember(session: ReleaseFollowDeps['session'], release: string): boolean {
    if (session === undefined) {
        return true;
    }
    if (session.get(RELOADED_FOR_KEY) === release) {
        return false;
    }
    session.set(RELOADED_FOR_KEY, release);
    return session.get(RELOADED_FOR_KEY) === release;
}

/** Follows the watch: a reload by itself when it is safe, else the shell's Reload banner. The returned call ends it. */
export function followReleases(deps: ReleaseFollowDeps, shell: ShellStateAccess): () => void {
    const releases = deps.releases;
    if (releases === undefined) {
        return () => undefined;
    }
    let returnedAt = Number.NEGATIVE_INFINITY;
    let newer: string | null = null;
    let timer: unknown = null;
    const moment = (): boolean => !deps.visibility.visible() || deps.clock.now() - returnedAt <= RETURN_WINDOW_MS || deps.idle?.() === true;
    const attempt = (release: string): Attempt => {
        if (deps.unsaved() || !moment()) {
            return 'wait';
        }
        if (!remember(deps.session, release)) {
            deps.log.info('the tab already reloaded for the newer release and still runs the older one: Reload stays offered', { release });
            return 'stuck';
        }
        deps.log.info('the admin reloads itself into the newer release', { release });
        deps.location.reload();
        return 'reloaded';
    };
    const retry = (release: string): void => {
        timer ??= deps.clock.setTimeout(() => {
            timer = null;
            if (attempt(release) === 'wait') {
                retry(release);
            }
        }, RELOAD_RETRY_MS);
    };
    const stopVisibility = deps.visibility.onChange((visible) => {
        if (!visible) {
            return;
        }
        returnedAt = deps.clock.now();
        if (newer !== null) {
            attempt(newer);
        }
    });
    const stopNewer = releases.onNewer((release) => {
        newer = release;
        const outcome = attempt(release);
        if (outcome !== 'reloaded') {
            shell.update({ newRelease: release });
        }
        if (outcome === 'wait') {
            retry(release);
        }
    });
    return () => {
        if (timer !== null) {
            deps.clock.clearTimeout(timer);
        }
        stopNewer();
        stopVisibility();
        releases.stop();
    };
}
