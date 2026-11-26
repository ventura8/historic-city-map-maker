import { FIRESTORE_PATHS, systemWriter, wikipediaStateDocSchema } from '@hcm/shared';

import { requestManifestBuild, type RequestDeps } from '../publish/request.js';
import { fetchDue } from './refresh.js';

/**
 * The Wikipedia overlay's schedule (`docs/research/M31-wikipedia.md` §2), a part of the imagery tick: a city whose overlay is on
 * and whose fetch is due (older than `WIKIPEDIA_REFRESH_DAYS`, or asked for) gets a manifest build, which fetches. Nothing
 * else: the build is the only place that asks Wikipedia.
 */
export async function wikipediaDue(deps: RequestDeps, cityId: string, now: Date): Promise<void> {
    const state = await deps.documents.get(FIRESTORE_PATHS.wikipedia(cityId), wikipediaStateDocSchema);
    if (fetchDue(state, now)) {
        await requestManifestBuild(deps, { cityId, full: true, updatedBy: systemWriter('publish') });
    }
}
