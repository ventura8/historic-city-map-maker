/**
 * The crash-spike check of `ops.tick`'s `health` step (`docs/research/M4-interfaces.md` §5.1, CR-M4-8; S-A46-HAPPY-
 * PRODUCERS): the summed counts of the last 24 hours' Error Reporting groups against the baseline of the current hour
 * (`ops/crashes`); `CRASH_SPIKE_THRESHOLD` new reports within the hour emit `crash.spike`, at most one a day (the event's
 * id is the day). Crash reporting is optional, so a failure here (Error Reporting off, no role) is logged and skipped:
 * it never fails the step.
 */
import {
    CRASH_SPIKE_THRESHOLD,
    OPS_CRASHES_PATH,
    crashCounterDocSchema,
    systemWriter,
    timestampFromDate,
    timestampToDate,
    type CrashCounterDoc,
} from '@hcm/shared';

import { emitNotification } from '../api/notification-event.js';
import type { Ports } from '../ports/index.js';

export type CrashSpikeDeps = Pick<Ports, 'log' | 'clock' | 'documents' | 'errors'>;

const HOUR_MS = 3_600_000;
/** The groups one check sums (the API's page limit); a spike shows in the busiest groups first. */
const GROUPS_PER_CHECK = 50;

async function totalOfLastDay(deps: CrashSpikeDeps): Promise<number> {
    const page = await deps.errors.listGroups({ hours: 24, pageSize: GROUPS_PER_CHECK });
    return page.groups.reduce((sum, group) => sum + group.count, 0);
}

/** The baseline after this check: kept within its hour, renewed once the hour has passed (or when there is none). */
function nextCounter(current: CrashCounterDoc | undefined, total: number, now: Date): CrashCounterDoc {
    const stamp = { updatedBy: systemWriter('ops'), updatedAt: timestampFromDate(now) };
    const fresh = current !== undefined && now.getTime() - timestampToDate(current.baselineAt).getTime() < HOUR_MS;
    return fresh
        ? { ...current, lastTotal: total, ...stamp }
        : { baseline: total, baselineAt: timestampFromDate(now), lastTotal: total, ...stamp };
}

/** Checks for a spike; returns the new reports counted within the hour (0 when crash reporting could not be read). */
export async function checkCrashSpike(deps: CrashSpikeDeps, now: Date): Promise<number> {
    let total: number;
    try {
        total = await totalOfLastDay(deps);
    } catch (error) {
        deps.log.info('crash-spike check skipped', { error: String(error) });
        return 0;
    }
    const current = await deps.documents.get(OPS_CRASHES_PATH, crashCounterDocSchema).catch(() => undefined);
    const next = nextCounter(current, total, now);
    await deps.documents.set(OPS_CRASHES_PATH, crashCounterDocSchema, next);
    const added = Math.max(0, total - next.baseline);
    if (added >= CRASH_SPIKE_THRESHOLD) {
        const day = now.toISOString().slice(0, 10);
        await emitNotification(deps, 'ops', { kind: 'crash.spike', parts: [day], params: { count: String(added) }, link: '#/crashes' });
    }
    return added;
}
