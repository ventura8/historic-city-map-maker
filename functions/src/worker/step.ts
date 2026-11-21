import '../global-options.js';

import {
    cityDocSchema,
    imageryPassDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    validate,
    type CallableRequest,
    type CallableResponse,
    type JobLogDoc,
    type Schema,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { guardIsRed, versionIdOf } from '../imagery/records.js';
import { InvalidDocumentError, UpstreamError } from '../ports/errors.js';
import type { DocumentTransaction, VersionedDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { documentTarget, isCityVersions, isJobLog, logLineOf, type DocumentTarget, type JobScope } from './allow-list.js';
import { storable, toWire } from './fields.js';
import { PIPELINE_WRITER, at, requireHeld, type WorkerCall } from './holder.js';
import { paired } from './pairing.js';
import { updateDocument } from './step-update.js';

export type StepDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.step'>;
type Response = CallableResponse<'worker.step'>;
type Op = Request['request'];

/** At most this many log lines per job (`jobLogDocSchema`, the pipeline's `MAX_JOB_LOGS`). */
const MAX_LOG_LINES = 500;

/** The schema of each document a run reads. */
const SCHEMAS: Readonly<Record<DocumentTarget, Schema<unknown>>> = {
    city: cityDocSchema,
    job: jobDocSchema,
    version: layerVersionDocSchema,
    base: layerVersionDocSchema,
    layer: layerDocSchema,
    scene: usgsSceneDocSchema,
    pass: imageryPassDocSchema,
    held: layerVersionDocSchema,
};

function refused(): ApiError {
    return new ApiError('apiError.worker.refused');
}

function callOf(caller: VerifiedCaller, request: Request): WorkerCall {
    return { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
}

/** The job the worker holds, with its allow-list's ids. */
async function heldScope(deps: StepDeps, call: WorkerCall, jobId: string): Promise<JobScope> {
    const job = await requireHeld(deps.documents, call, jobId, deps.clock.now());
    return { cityId: call.cityId, jobId, job, versionId: versionIdOf(jobId, job) };
}

/** The field the log names for an issue of the whole document (a path of ''), never an empty one. */
const WHOLE_DOCUMENT = '(document)';

/** The top field an issue is about, or `WHOLE_DOCUMENT` for the document itself. */
function fieldOf(path: string): string {
    return path === '' ? WHOLE_DOCUMENT : (path.split(/[.[]/u)[0] ?? path);
}

/** What the log says of a stored version that fails its schema: where, and the fields (never their values). */
function skipped(deps: StepDeps, path: string, issues: InvalidDocumentError['issues']): void {
    const fields = [...new Set(issues.map((issue) => fieldOf(issue.path)))];
    deps.log.warn('worker skipped an invalid version', { path, fields, codes: [...new Set(issues.map((issue) => issue.code))] });
}

/**
 * Another version of the city (`held`, M15): one that fails its schema (written past it by an earlier pipeline) is no partner, so it
 * reads as missing; the frame being joined is fitted with the others. Its own job's documents still fail loudly.
 */
async function heldRead(deps: StepDeps, transaction: DocumentTransaction, path: string): Promise<VersionedDocument<unknown> | undefined> {
    try {
        return await transaction.getVersioned(path, layerVersionDocSchema);
    } catch (error) {
        if (error instanceof InvalidDocumentError) {
            skipped(deps, path, error.issues);
            return undefined;
        }
        throw error;
    }
}

/** `get {path}`: one document of the allow-list with its update time (both null when it does not exist). */
async function getDocument(deps: StepDeps, call: WorkerCall, jobId: string, path: string): Promise<Response> {
    return deps.documents.transaction(async (transaction) => {
        const job = await requireHeld(transaction, call, jobId, deps.clock.now());
        const target = documentTarget({ cityId: call.cityId, jobId, job, versionId: versionIdOf(jobId, job) }, path);
        if (target === undefined) {
            throw refused();
        }
        const read = target === 'held' ? await heldRead(deps, transaction, path) : await transaction.getVersioned(path, SCHEMAS[target]);
        return read === undefined
            ? { data: null, updateTime: null }
            : { data: toWire(read.data) as Record<string, unknown>, updateTime: read.updateTime };
    });
}

function sortedIds(lines: readonly { readonly id: string }[]): Response {
    return { ids: lines.map((line) => line.id).sort((a, b) => a.localeCompare(b)) };
}

/** The ids of a collection's documents, in order. */
async function idsOf(deps: StepDeps, collection: string, schema: Schema<unknown>): Promise<Response> {
    const found = await deps.documents.query(collection, schema);
    return sortedIds([...found.documents, ...found.invalid]);
}

/**
 * The ids of the city's versions that pass their schema, in order: one that fails it is never a partner (M15). `skipped` counts those
 * left out, so the pipeline says so in the owner's job log (the server log names them).
 */
async function versionIds(deps: StepDeps, collection: string): Promise<Response> {
    const found = await deps.documents.query(collection, layerVersionDocSchema);
    for (const line of found.invalid) {
        skipped(deps, line.path, line.issues);
    }
    return { ...sortedIds(found.documents), skipped: found.invalid.length };
}

/**
 * `list {collection}`: the ids of the job's log lines (the pipeline counts them to number the next one), or of its city's versions (M15:
 * a frame being joined looks for the accepted frames it may be held to).
 */
async function listIds(deps: StepDeps, call: WorkerCall, jobId: string, collection: string): Promise<Response> {
    const scope = await heldScope(deps, call, jobId);
    if (isJobLog(scope, collection)) {
        return idsOf(deps, collection, jobLogDocSchema);
    }
    if (isCityVersions(scope, collection)) {
        return versionIds(deps, collection);
    }
    throw refused();
}

/** The sequence number of a log line the job may still write: its id's, under the cap, the same in its data. */
function lineSeq(scope: JobScope, path: string, data: Readonly<Record<string, unknown>>): number {
    const seq = logLineOf(scope, path) ?? MAX_LOG_LINES;
    if (seq >= MAX_LOG_LINES || data['seq'] !== seq) {
        throw refused();
    }
    return seq;
}

/** A log line of the job, numbered by its id, stamped `system:pipeline` at the server's time. */
function logLine(scope: JobScope, path: string, data: Readonly<Record<string, unknown>>, now: Date): JobLogDoc {
    lineSeq(scope, path, data);
    if (!storable(data)) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'data', code: 'validation.value' }]);
    }
    const result = validate(jobLogDocSchema, { ...data, updatedBy: PIPELINE_WRITER, updatedAt: at(now) });
    if (!result.ok) {
        throw new ApiError('apiError.invalidRequest', undefined, result.issues);
    }
    return result.value;
}

/** `create {path, data}`: one of the job's log lines, never over an existing one (`created: false`). */
async function createLine(deps: StepDeps, call: WorkerCall, jobId: string, op: Extract<Op, { op: 'create' }>): Promise<Response> {
    const line = logLine(await heldScope(deps, call, jobId), op.path, op.data, deps.clock.now());
    try {
        await deps.documents.create(op.path, jobLogDocSchema, line);
        return { created: true };
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'conflict') {
            return { created: false };
        }
        throw error;
    }
}

/**
 * `worker.step` (`docs/research/M7-local-worker.md` §2.4, §2.5; S-A62-BAD-NOT-HOLDER): the pipeline's `DocumentStore` for
 * a local run, one operation a call, on the allow-list of the job the caller's worker holds. Reads and log lines go on
 * while the budget guard is red, and so do the writes that end the run (`step-update.ts`); every other write waits.
 */
async function workerStep(deps: StepDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const call = callOf(caller, request);
    const op = request.request;
    switch (op.op) {
        case 'get':
            return getDocument(deps, call, request.jobId, op.path);
        case 'list':
            return listIds(deps, call, request.jobId, op.collection);
        case 'create':
            return createLine(deps, call, request.jobId, op);
        case 'update': {
            const context = { call, jobId: request.jobId, now: deps.clock.now(), red: await guardIsRed(deps.documents) };
            return updateDocument(deps.documents, context, op);
        }
    }
}

/** The `worker-step` callable. */
export function stepFunction(getDeps: () => StepDeps & CallableDeps) {
    return defineCallable('worker.step', paired(workerStep), getDeps);
}
