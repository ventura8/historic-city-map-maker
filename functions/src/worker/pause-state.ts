/**
 * Pause this computer (the owner's request of 2026-11-13; `docs/research/M7-local-worker.md` → *Pause*): the pause a worker's
 * document holds (`paused`, `{by, at, until?}`), set from the admin (`imagery.pause` with a worker) or from the computer's own page
 * (the `pause` command a worker sends with `worker.claim` or `worker.end`). A paused worker claims nothing; a pause with `until`
 * ends on its own once that time passed (the next claim drops it).
 */
import { PAUSED_BY_COMPUTER, timestampToDate, type JobDoc, type TimestampLike, type WorkerDoc, type WorkerPauseCommand } from '@hcm/shared';

import { omit } from '../api/objects.js';
import { at } from './holder.js';

/** The worker's pause as recorded; W5's list (household) recorded only when, and the account that owns the worker stands for who. */
function pauseOf(worker: WorkerDoc): WorkerDoc['paused'] {
    return worker.paused ?? (worker.pausedAt === undefined ? undefined : { by: worker.uid, at: worker.pausedAt });
}

/** The worker's pause while it lasts; undefined when it has none or its `until` passed. */
export function activePause(worker: WorkerDoc, now: Date): WorkerDoc['paused'] {
    const paused = pauseOf(worker);
    if (paused?.until !== undefined && timestampToDate(paused.until) <= now) {
        return undefined;
    }
    return paused;
}

/** The worker paused by `by` (an account, or the computer itself), until `until` when given. */
export function pausedWorker(worker: WorkerDoc, by: string, now: Date, until?: Date): WorkerDoc {
    const end = until === undefined ? {} : { until: at(until) };
    // `pausedAt` too: W5's list and its claim rule (`household.ts`) read it.
    return { ...worker, paused: { by, at: at(now), ...end }, pausedAt: at(now) };
}

/** The worker with no pause. */
export function resumedWorker(worker: WorkerDoc): WorkerDoc {
    return omit(worker, ['paused', 'pausedAt']);
}

/** The worker after the computer's own page's command (none: as it was), with an expired pause dropped either way. */
export function afterCommand(worker: WorkerDoc, command: WorkerPauseCommand | undefined, now: Date): WorkerDoc {
    const current = activePause(worker, now) === undefined ? resumedWorker(worker) : worker;
    if (command === undefined) {
        return current;
    }
    if (command.action === 'resume') {
        return resumedWorker(current);
    }
    return pausedWorker(current, PAUSED_BY_COMPUTER, now, command.until === undefined ? undefined : new Date(command.until));
}

/** A timestamp as the wire's ISO text. */
function isoOf(time: TimestampLike): string {
    return timestampToDate(time).toISOString();
}

/** The pause as `worker.claim` answers it. */
export function pauseAnswer(paused: NonNullable<WorkerDoc['paused']>): { by: string; at: string; until?: string } {
    const until = paused.until === undefined ? {} : { until: isoOf(paused.until) };
    return { by: paused.by, at: isoOf(paused.at), ...until };
}

/**
 * The job a paused computer handed back (`worker.end` `released`): queued again where it stopped, the attempt its claim counted given
 * back when `giveBack`, no lease, worker or wait, and the computer's request dropped.
 */
export function releasedJob(job: JobDoc, by: string, now: Date, giveBack: boolean): JobDoc {
    const attempt = job.attempt ?? 0;
    return {
        ...omit(job, ['lease', 'worker', 'retryAt', 'releaseRequested', 'waitReason']),
        status: 'queued',
        attempt: giveBack ? Math.max(0, attempt - 1) : attempt,
        updatedBy: by,
        updatedAt: at(now),
    };
}
