/**
 * A page whose chunk no longer exists (live, 2026-11-24): a tab left open across a redeploy asks Hosting for the old
 * release's lazy chunk (`imagery-<hash>.js`), which the deploy removed, and Hosting's `/admin/**` rewrite answers it with
 * the admin's `index.html`, so the import fails and the shell said "The page did not load" until the owner reloaded by hand.
 * Now a page that does not load asks the release watch (`./release-watch.ts`) whether Hosting serves a newer admin; when it
 * does, the tab reloads into it once. It never loops: the release it reloads for is written into the tab's
 * `sessionStorage` first (the key `release-reload.ts` uses too), and a tab that already reloaded for that release, or
 * cannot remember it, gets the failure as before (the shell's message and Try again).
 */
import type { Logger } from '@hcm/shared';

import type { HashLocation, KeyValueStore } from './ports.js';
import { RELOADED_FOR_KEY } from './release-reload.js';
import type { ReleaseWatch } from './release-watch.js';

export interface StaleChunkDeps {
    /** Finding 29's watch; none (a build without a release): the failure is passed on as it is. */
    readonly releases?: Partial<Pick<ReleaseWatch, 'check' | 'onNewer'>> | undefined;
    readonly session: Pick<KeyValueStore, 'get' | 'set'>;
    readonly location: Pick<HashLocation, 'reload'>;
    readonly log: Pick<Logger, 'info' | 'warn'>;
}

/** Writes `release` as the one this tab reloads for; false when it already did, or the storage forgets the write. */
function claim(session: StaleChunkDeps['session'], release: string): boolean {
    if (session.get(RELOADED_FOR_KEY) === release) {
        return false;
    }
    session.set(RELOADED_FOR_KEY, release);
    return session.get(RELOADED_FOR_KEY) === release;
}

/** The release Hosting serves instead of this tab's, or null (none, no watch, or the read failed). */
async function newerRelease(releases: StaleChunkDeps['releases']): Promise<string | null> {
    const check = releases?.check;
    return check === undefined ? null : check.call(releases).catch(() => null);
}

/** `load`, which reloads the tab once into a newer admin when a page's chunk fails because of a redeploy. */
export function reloadOnStaleChunk<Id extends string>(
    load: (id: Id) => Promise<string | null>,
    deps: StaleChunkDeps,
): (id: Id) => Promise<string | null> {
    return async (id) => {
        try {
            return await load(id);
        } catch (error: unknown) {
            const release = await newerRelease(deps.releases);
            if (release === null || !claim(deps.session, release)) {
                deps.log.warn('a page did not load and no reload can help', { page: id, release, error: String(error) });
                throw error;
            }
            deps.log.info('a page chunk of the older admin is gone: the tab reloads into the newer release', { page: id, release });
            deps.location.reload();
            return new Promise<string | null>(() => undefined);
        }
    };
}
