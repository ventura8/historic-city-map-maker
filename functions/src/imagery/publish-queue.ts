/**
 * Queues work for the publisher (`imagery.publish`, `docs/research/M3-interfaces.md` §7.3): a start after an approval,
 * a choice or a deferral, and the polls of an MTS job. Each task has an id named after its reason, so a redelivered
 * trigger or a retried callable never queues the same publish twice (Cloud Tasks refuses a known id). The tick's
 * recoveries name theirs after the job's last write (`stale-<ms>`, `resumed-<ms>`): a job that stays stale is queued once,
 * not once per tick (CR-M3-47).
 */
import { IMAGERY_PUBLISH_QUEUE, type PublishTask } from '@hcm/shared';

import type { Ports } from '../ports/index.js';

/** Why a publish task is queued; part of its task id. */
export type PublishReason =
    | 'auto'
    | 'approved'
    | 'paid'
    | 'republish'
    | `deferred-${string}`
    | `retry-${string}`
    | `own-${string}`
    | `poll-${string}`
    | `stale-${string}`
    | `resumed-${string}`;

export async function enqueuePublish(
    tasks: Ports['tasks'],
    task: Pick<PublishTask, 'cityId' | 'jobId'> & { readonly phase?: PublishTask['phase']; readonly poll?: number },
    reason: PublishReason,
    delaySeconds?: number,
): Promise<boolean> {
    const payload: PublishTask = { cityId: task.cityId, jobId: task.jobId, phase: task.phase ?? 'start', poll: task.poll ?? 0 };
    const options = { id: `${task.cityId}-${task.jobId}-${reason}`, ...(delaySeconds === undefined ? {} : { delaySeconds }) };
    return tasks.enqueue(IMAGERY_PUBLISH_QUEUE, payload, options);
}
