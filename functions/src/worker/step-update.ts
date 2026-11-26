/**
 * `worker.step`'s `update` (`docs/research/M7-local-worker.md` §2.4, §2.5): the pipeline's `DocumentStore.update` for a
 * local run, on its job and its version only. In one transaction: the worker must hold the job; every field must be one
 * the pipeline writes; the stored document is read with its update time (`ifUpdateTime` is the compare-and-set of the
 * pipeline's `transact`: a mismatch answers `ok: false` and writes nothing); the fields are merged as Firestore's
 * `update` does, stamped `system:pipeline` at the server's time, and the merged document must pass its schema; then the
 * job's status, the version's state and the lease must be ones a run sets. While the budget guard is red only a write
 * that ends the run is stored. M12: tiles it records lie in its version's own folder, and a side job changes only its version's tiles.
 */
import { isDeepStrictEqual } from 'node:util';

import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    LEASE_SECONDS,
    isDeclinedCode,
    isOwnTiles,
    isSideJob,
    jobDocSchema,
    layerVersionDocSchema,
    validate,
    workerDocSchema,
    type JobDoc,
    type LayerVersionDoc,
    type LayerVersionState,
    type Schema,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import { versionIdOf } from '../imagery/records.js';
import type { DocumentStore, DocumentTransaction, VersionedDocument } from '../ports/documents.js';
import {
    WORKER_JOB_FIELDS,
    WORKER_JOB_STATUSES,
    WORKER_VERSION_FIELDS,
    WORKER_VERSION_STATES,
    documentTarget,
    type JobScope,
} from './allow-list.js';
import { applyFields, changesOf, storableChange, toWire, type FieldChange } from './fields.js';
import { IN_RUN, PIPELINE_WRITER, at, leaseOwnerOf, requireHeld, type WorkerCall } from './holder.js';

const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);
/** The version states a run's ending writes after its job's (`runner.py`: failed, cancelled). */
const ENDINGS: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['failed', 'cancelled']);

export interface UpdateRequest {
    readonly path: string;
    readonly fields: Readonly<Record<string, unknown>>;
    readonly ifUpdateTime?: string | undefined;
}

/** What one update needs besides its request: the worker, the job, the clock and the guard. */
export interface UpdateContext {
    readonly call: WorkerCall;
    readonly jobId: string;
    readonly now: Date;
    readonly red: boolean;
}

/** How one document may be written: its schema, its fields, the rule its merged form must pass, whether it ends the run. */
interface Writable<T> {
    readonly schema: Schema<T>;
    readonly fields: ReadonlySet<string>;
    readonly allowed: (current: T, merged: T) => boolean;
    readonly ends: (current: T, merged: T) => boolean;
}

/** M12: a side job ends on its own: no approval follows it. */
function sideJobDone(current: JobDoc, merged: JobDoc): boolean {
    return merged.status === 'succeeded' && isSideJob(current.type);
}

/** M16 (`docs/research/M16-recalibrate.md` §3): a refine that renders nothing ends cancelled on its own, with its reason. */
function declined(current: JobDoc, merged: JobDoc): boolean {
    return current.type === 'regeoref' && isDeclinedCode(merged.error?.code);
}

function cancelAllowed(current: JobDoc, merged: JobDoc): boolean {
    return merged.status !== 'cancelled' || current.cancelRequested === true || declined(current, merged);
}

function jobStatusAllowed(current: JobDoc, merged: JobDoc): boolean {
    if (merged.status === current.status || sideJobDone(current, merged)) {
        return true;
    }
    return WORKER_JOB_STATUSES.has(merged.status) && cancelAllowed(current, merged);
}

function ownLease(merged: JobDoc, call: WorkerCall): boolean {
    return merged.lease === undefined || merged.lease.owner === leaseOwnerOf(call.workerId);
}

function jobWritable(call: WorkerCall): Writable<JobDoc> {
    return {
        schema: jobDocSchema,
        fields: WORKER_JOB_FIELDS,
        allowed: (current, merged) => IN_RUN.has(current.status) && jobStatusAllowed(current, merged) && ownLease(merged, call),
        // A status other than `running` ends the run (waits, the approval, a hand-over, a failure, a cancellation).
        ends: (current, merged) => merged.status !== current.status && merged.status !== 'running',
    };
}

/** A version write after its job ended: the run's own ending (`failed`, `cancelled`) carried to the version. */
function endsWithJob(job: JobDoc, current: LayerVersionDoc, merged: LayerVersionDoc): boolean {
    const ending = merged.state === job.status && ENDINGS.has(merged.state);
    return ending && (!ENDED.has(current.state) || current.state === merged.state);
}

/** M12: a side job may add to its version (`output.tiles`) and never moves its state, approved or waiting. */
function versionStateAllowed(job: JobDoc, current: LayerVersionDoc, merged: LayerVersionDoc): boolean {
    const moves = WORKER_VERSION_STATES.has(merged.state) && !isSideJob(job.type);
    return !ENDED.has(current.state) && (merged.state === current.state || moves);
}

/** A version's output with its tiles left out: what a side job must leave as it was. */
function besidesTiles(output: LayerVersionDoc['output']): object {
    return output === undefined ? {} : omit(output, ['tiles']);
}

/**
 * M12: tiles a run records are its version's own files (`isOwnTiles`: the server later copies, signs and deletes that path), and a side job
 * changes nothing of its version's output but its tiles (the bounds, COG and preview the owner approved stay theirs).
 */
function outputAllowed(scope: JobScope, current: LayerVersionDoc, merged: LayerVersionDoc): boolean {
    const tiles = merged.output?.tiles;
    if (tiles !== undefined && !isOwnTiles(scope.cityId, merged.layerId, scope.versionId, tiles)) {
        return false;
    }
    return !isSideJob(scope.job.type) || isDeepStrictEqual(besidesTiles(current.output), besidesTiles(merged.output));
}

/** M16: what the server wrote of a recalibration (how it was asked for, the version it replaces, the rough points); undefined for none. */
function serverRecalibration(version: LayerVersionDoc): readonly unknown[] | undefined {
    const recalibration = version.recalibration;
    return recalibration === undefined ? undefined : [recalibration.route, recalibration.replaces, recalibration.points];
}

/**
 * M16 (`docs/research/M16-recalibrate.md` §1): a run adds what it measured to its version's `recalibration` (`before`, `after`, `tiles`,
 * `proposed`) and never writes the server's part: a `replaces` it named would cancel another version once this one is rendered.
 */
function recalibrationAllowed(current: LayerVersionDoc, merged: LayerVersionDoc): boolean {
    return isDeepStrictEqual(serverRecalibration(current), serverRecalibration(merged));
}

/** The part of a version's `source` the server wrote: all of it, but an archive series' counts of placed and skipped sheets. */
function serverSource(version: LayerVersionDoc): unknown {
    const source = version.source;
    if (source?.kind !== 'archive') {
        return source;
    }
    return Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'placedCount' && key !== 'skipped'));
}

/**
 * M20 (`docs/research/M20-import-local.md` §4): a run of an archive series writes what became of its sheets (`source.placedCount`,
 * `source.skipped`) and nothing else of its source; any other job's source stays the server's.
 */
function sourceAllowed(current: LayerVersionDoc, merged: LayerVersionDoc): boolean {
    return isDeepStrictEqual(serverSource(current), serverSource(merged));
}

function versionWritable(scope: JobScope): Writable<LayerVersionDoc> {
    const { job } = scope;
    return {
        schema: layerVersionDocSchema,
        fields: WORKER_VERSION_FIELDS,
        allowed: (current, merged) =>
            outputAllowed(scope, current, merged) &&
            recalibrationAllowed(current, merged) &&
            sourceAllowed(current, merged) &&
            (IN_RUN.has(job.status) ? versionStateAllowed(job, current, merged) : endsWithJob(job, current, merged)),
        ends: (current, merged) => merged.state !== current.state && ENDINGS.has(merged.state),
    };
}

/** The fields the server sets on every write: the pipeline's stamp at its own time; a written lease lasts `LEASE_SECONDS`. */
function stamped(merged: Readonly<Record<string, unknown>>, changes: readonly FieldChange[], now: Date): Record<string, unknown> {
    const lease = merged['lease'];
    const leaseWritten = changes.some(([[head]]) => head === 'lease') && typeof lease === 'object' && lease !== null;
    const renewed = leaseWritten ? { lease: { ...lease, until: at(new Date(now.getTime() + LEASE_SECONDS * 1000)) } } : {};
    return { ...merged, ...renewed, updatedBy: PIPELINE_WRITER, updatedAt: at(now) };
}

function refused(): ApiError {
    return new ApiError('apiError.worker.refused');
}

/** The merged document, checked against its schema (`apiError.invalidRequest` with the issues). */
function checked<T>(schema: Schema<T>, data: unknown): T {
    const result = validate(schema, data);
    if (!result.ok) {
        throw new ApiError('apiError.invalidRequest', undefined, result.issues);
    }
    return result.value;
}

interface Write<T> {
    readonly transaction: DocumentTransaction;
    readonly path: string;
    readonly writable: Writable<T>;
    readonly changes: readonly FieldChange[];
}

/** The stored document with its update time (`apiError.notFound` when there is none: an update needs one). */
async function readCurrent<T>(transaction: DocumentTransaction, path: string, schema: Schema<T>): Promise<VersionedDocument<T>> {
    const current = await transaction.getVersioned(path, schema);
    if (current === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return current;
}

/** The merged document must be one a run writes (`refused`), and while the guard is red one that ends the run. */
function requireAllowed<T>(context: UpdateContext, writable: Writable<T>, current: T, merged: T): void {
    if (!writable.allowed(current, merged)) {
        throw refused();
    }
    if (context.red && !writable.ends(current, merged)) {
        throw new ApiError('apiError.guardPaused');
    }
}

/** The rules of one write, in the order the worker is told about them; false when the compare-and-set failed. */
async function writeChecked<T>(context: UpdateContext, write: Write<T>, ifUpdateTime: string | undefined): Promise<boolean> {
    const { transaction, path, writable, changes } = write;
    if (!changes.every(([[head]]) => writable.fields.has(head))) {
        throw refused();
    }
    const current = await readCurrent(transaction, path, writable.schema);
    if (ifUpdateTime !== undefined && ifUpdateTime !== current.updateTime) {
        return false;
    }
    const merged = checked(
        writable.schema,
        stamped(applyFields(toWire(current.data) as Record<string, unknown>, changes), changes, context.now),
    );
    requireAllowed(context, writable, current.data, merged);
    await transaction.set(path, writable.schema, merged);
    return true;
}

/** The update's fields as changes: plain dotted paths (`apiError.worker.refused`) with storable values (`invalidRequest`). */
function changesFor(request: UpdateRequest): FieldChange[] {
    const changes = changesOf(request.fields);
    if (changes === undefined) {
        throw refused();
    }
    const unstorable = changes.filter(([, value]) => !storableChange(value));
    if (unstorable.length > 0) {
        // The field named, never its value (a worker's write is the owner's data): the worker's log and the job's error say which.
        throw new ApiError(
            'apiError.invalidRequest',
            undefined,
            unstorable.map(([path]) => ({ path: path.join('.'), code: 'validation.value' as const })),
        );
    }
    return changes;
}

/**
 * A heartbeat (`lease.until`) also says the worker is alive: its `lastSeenAt` follows, or the admin showed "No computer connected"
 * and sent new jobs to the cloud while a long step ran (live 2026-11-12: an hour in `locate`, then a 60-sheet `place`). The worker
 * document is read before any write of the transaction (Firestore's rule) and written only once the job's update was.
 */
async function jobUpdate(context: UpdateContext, write: Write<JobDoc>, ifUpdateTime: string | undefined): Promise<boolean> {
    const { call, now } = context;
    const beat = write.changes.some(([[head]]) => head === 'lease');
    const path = FIRESTORE_PATHS.worker(call.cityId, call.workerId);
    const worker = beat ? await write.transaction.get(path, workerDocSchema) : undefined;
    const ok = await writeChecked(context, write, ifUpdateTime);
    if (ok && worker !== undefined) {
        await write.transaction.set(path, workerDocSchema, { ...worker, lastSeenAt: at(now) });
    }
    return ok;
}

/** `update {path, fields, ifUpdateTime?}`: `{ok: true}` once written, `{ok: false}` when the update time no longer matches. */
export async function updateDocument(
    documents: Pick<DocumentStore, 'transaction'>,
    context: UpdateContext,
    request: UpdateRequest,
): Promise<{ ok: boolean }> {
    const changes = changesFor(request);
    const { call, jobId, now } = context;
    const ok = await documents.transaction(async (transaction) => {
        const job = await requireHeld(transaction, call, jobId, now);
        const scope: JobScope = { cityId: call.cityId, jobId, job, versionId: versionIdOf(jobId, job) };
        const target = documentTarget(scope, request.path);
        if (target === 'job') {
            return jobUpdate(context, { transaction, path: request.path, writable: jobWritable(call), changes }, request.ifUpdateTime);
        }
        if (target === 'version') {
            return writeChecked(
                context,
                { transaction, path: request.path, writable: versionWritable(scope), changes },
                request.ifUpdateTime,
            );
        }
        throw refused();
    });
    return { ok };
}
