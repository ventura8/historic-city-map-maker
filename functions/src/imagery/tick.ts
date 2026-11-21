import '../global-options.js';

import { BACKGROUND_FUNCTIONS } from '@hcm/shared';
import { onSchedule } from 'firebase-functions/scheduler';

import { runAs } from '../global-options.js';
import type { Ports } from '../ports/index.js';
import { cityIds } from './limits.js';
import { backfillCloudUsage } from './cloud-usage-backfill.js';
import { importLandsat } from './landsat-auto.js';
import { guardIsRed } from './records.js';
import { watchOrders } from './orders/watch.js';
import { ensureDatePlan } from './join-plan.js';
import { cancelAsked, dispatchDue, pendingApprovals, pollStale, recoverLost } from './tick-jobs.js';
import { cleanOwnTiles } from './own-tiles-clean.js';
import { sweepOwnTiles } from './own-tiles-sweep.js';
import { monthlyHarvest, publishDeferred, runDeletions, sweepEnded } from './tick-maintenance.js';
import { offerCloud } from './tick-worker.js';
import { releaseScenes } from './release-scene.js';
import { relocateParked } from './relocate.js';

/**
 * `imagery.tick` (every 15 minutes, `IMAGERY_TICK_SCHEDULE`, one instance; `docs/research/M3-interfaces.md` §4.6): the raster
 * work's clock. For every city, each part on its own (a failure is logged and the next part runs): dispatch, lost executions, the
 * cancellations and approvals a lost event left, MTS polls gone missing, deferred publishes, due layer deletions, the
 * files of long-ended versions, the monthly harvest, (M25) the Landsat imports and (M4) the order watch. While the budget guard is red only the
 * parts that end or recover work run (lost executions, cancellations) and the order watch, which asks USGS and reminds
 * but imports nothing; nothing new starts, and the public site is never touched. Finding 64 of 2026-11-02: first, once a
 * month, the cloud runs that ended before they were counted are added to Cloud Run's free-tier meter (`backfill`).
 */
export type TickDeps = Pick<
    Ports,
    'documents' | 'clock' | 'log' | 'jobs' | 'tasks' | 'secrets' | 'setup' | 'tilesets' | 'blobs' | 'usgs' | 'scenes' | 'remote' | 'images'
>;

type Part = (deps: TickDeps, cityId: string, now: Date) => Promise<void>;

/** The parts in order, and whether each runs while the guard is red. */
const PARTS: readonly (readonly [name: string, part: Part, whileRed: boolean])[] = [
    ['dispatch', dispatchDue, false],
    ['lost', recoverLost, true],
    // Finding 68 (docs/research/M7-local-worker.md §3.1): a local job no computer came for offers the cloud, once.
    ['noWorker', offerCloud, false],
    // M18 item 3 (docs/research/M18-improvements.md): a frame parked for points under an older pipeline searches again, free.
    ['relocate', (deps, cityId) => relocateParked(deps, cityId), false],
    ['cancel', cancelAsked, true],
    ['approval', pendingApprovals, false],
    ['mapbox', pollStale, false],
    ['deferred', publishDeferred, false],
    // M12 (docs/research/M12-own-tiles.md): one version a tick to its own tiles; a superseded archive past its grace goes.
    ['ownTiles', sweepOwnTiles, false],
    ['ownTilesClean', cleanOwnTiles, false],
    ['deletions', runDeletions, false],
    ['sweep', sweepEnded, false],
    ['harvest', monthlyHarvest, false],
    // M25 (docs/research/M25-landsat.md §4): the best Landsat scene of a wanted year, imported on its own within the daily cap.
    ['landsat', importLandsat, false],
    // M4 (docs/research/M4-interfaces.md §1.5): the order watch asks USGS and reminds while the guard is red; its import waits.
    ['orders', watchOrders, true],
    // Finding 85: a scene an ended import left reserved can be imported again.
    ['scenes', (deps, cityId) => releaseScenes(deps, cityId), true],
    // M8: a city with no plan of its whole-city dates gets one, as a deploy finds frames waiting and no job moves.
    ['plan', (deps, cityId) => ensureDatePlan(deps, cityId), true],
];

/** One tick over every city; returns the parts that failed (`<city>:<part>`). */
export async function runImageryTick(deps: TickDeps): Promise<string[]> {
    const now = deps.clock.now();
    const red = await guardIsRed(deps.documents);
    const failed: string[] = [];
    await backfillCloudUsage(deps, now).catch((error: unknown) => {
        deps.log.error('imagery tick part failed', { part: 'backfill', error: String(error) });
        failed.push('backfill');
    });
    for (const cityId of await cityIds(deps.documents)) {
        for (const [name, part] of PARTS.filter(([, , whileRed]) => whileRed || !red)) {
            await part(deps, cityId, now).catch((error: unknown) => {
                deps.log.error('imagery tick part failed', { cityId, part: name, error: String(error) });
                failed.push(`${cityId}:${name}`);
            });
        }
    }
    deps.log.info('imagery tick finished', { guard: red ? 'red' : 'green', failed: failed.length });
    return failed;
}

/** The `imagery-tick` schedule (`IMAGERY_TICK_SCHEDULE`, UTC): one instance, so ticks never overlap; no retry (the next tick). */
export function tickFunction(getDeps: () => TickDeps) {
    const options = {
        schedule: BACKGROUND_FUNCTIONS['imagery.tick'].source,
        timeZone: 'UTC',
        retryCount: 0,
        maxInstances: 1,
        timeoutSeconds: 540,
        memory: '512MiB',
        ...runAs('imagery.tick'),
    } as const;
    return onSchedule(options, async () => {
        await runImageryTick(getDeps());
    });
}
