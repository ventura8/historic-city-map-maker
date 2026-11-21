/**
 * A file Mapbox refuses as too large (`apiError.imagery.sourceTooLarge`, CR-M3-47): the publish is not a failure the admin
 * can only retry (every retry would stream the same file again), it goes back to the admin with the one way out that
 * works, the free Mapbox Studio upload of the smaller copy (`output.studioPath`). In one transaction the version returns to
 * `approved` with the guard's verdict `too-large`, its job waits for the choice (`compute-units`), and the month's
 * reservation is released. A version without a Studio copy fails as before.
 */
import {
    FIRESTORE_PATHS,
    availableComputeUnits,
    jobDocSchema,
    layerVersionDocSchema,
    timestampFromDate,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    type JobDoc,
    type LayerVersionDoc,
    type PublishTask,
    type UsageDoc,
} from '@hcm/shared';

import type { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, appendJobLog, countersOf, stampOf, versionIdOf } from './records.js';

type StudioDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

interface Held {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly versionId: string;
    readonly usagePath: string;
    readonly usage: UsageDoc | undefined;
}

/** The job at Mapbox's door, its version publishing with a Studio copy, and the counter holding its reservation. */
function atMapbox(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'mts_processing';
}

/** A version on its way to Mapbox whose render made the smaller Studio copy. */
function withStudioCopy(version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    return version?.state === 'publishing' && version.output?.studioPath !== undefined;
}

/** The month whose counter holds the version's reservation: where its guard ran, else now. */
function reservationMonth(version: LayerVersionDoc, now: Date): string {
    const checkedAt = version.guard?.checkedAt;
    return usageMonth(checkedAt === undefined ? now : timestampToDate(checkedAt));
}

async function readHeld(transaction: DocumentTransaction, task: PublishTask, now: Date): Promise<Held | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(task.cityId, task.jobId), jobDocSchema);
    const versionId = versionIdOf(task.jobId, job ?? {});
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(task.cityId, versionId), layerVersionDocSchema);
    if (!atMapbox(job) || !withStudioCopy(version)) {
        return undefined;
    }
    const usagePath = FIRESTORE_PATHS.usage(reservationMonth(version, now));
    return { job, version, versionId, usagePath, usage: await transaction.get(usagePath, usageDocSchema) };
}

/** The counter without this version's reservation. */
function released(usage: UsageDoc, versionId: string, now: Date): UsageDoc {
    const reservations = Object.fromEntries(Object.entries(usage.reservations ?? {}).filter(([id]) => id !== versionId));
    return { ...usage, reservations, ...stampOf(IMAGERY_WRITER, now) };
}

async function sendBack(transaction: DocumentTransaction, task: PublishTask, held: Held, now: Date): Promise<void> {
    const stamp = stampOf(IMAGERY_WRITER, now);
    const usage = held.usage === undefined ? undefined : released(held.usage, held.versionId, now);
    if (usage !== undefined) {
        await transaction.set(held.usagePath, usageDocSchema, usage);
    }
    const available = availableComputeUnits(usage === undefined ? undefined : countersOf(usage), held.versionId);
    await transaction.set(FIRESTORE_PATHS.layerVersion(task.cityId, held.versionId), layerVersionDocSchema, {
        ...omit(held.version, ['guard', 'error']),
        state: 'approved',
        guard: { verdict: 'too-large', available, checkedAt: timestampFromDate(now) },
        ...stamp,
    });
    const steps = omit(held.job.steps ?? {}, ['upload', 'publish']);
    await transaction.set(FIRESTORE_PATHS.job(task.cityId, task.jobId), jobDocSchema, {
        ...omit(held.job, ['mapboxJobId', 'steps']),
        steps,
        status: 'awaiting_approval',
        waitReason: 'compute-units',
        ...stamp,
    });
}

/** Sends the publish back to the admin with the Studio way; false when it cannot (no Studio copy, or it moved on). */
export async function tooLargeForMts(deps: StudioDeps, task: PublishTask, failure: ApiError): Promise<boolean> {
    const now = deps.clock.now();
    const sent = await deps.documents.transaction(async (transaction) => {
        const held = await readHeld(transaction, task, now);
        if (held !== undefined) {
            await sendBack(transaction, task, held, now);
        }
        return held !== undefined;
    });
    if (sent) {
        const megabytes = failure.params?.['megabytes'] ?? '?';
        await appendJobLog(deps, task.cityId, task.jobId, {
            level: 'warn',
            step: 'upload',
            message: `Mapbox refused the ${megabytes} MB file as too large; the free Studio upload is offered instead.`,
        });
        deps.log.warn('publish sent back for the studio upload', { cityId: task.cityId, jobId: task.jobId });
    }
    return sent;
}
