import '../global-options.js';

import {
    FIRESTORE_PATHS,
    archiveDocSchema,
    archiveIssueSchema,
    type ArchiveDoc,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { at, requireWorker, type WorkerCall } from './holder.js';
import { paired } from './pairing.js';

export type ArchiveReportDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.archiveReport'>;

/** An issue's id: its place in the sample, zero-padded so the list reads in order. */
function issueId(index: number): string {
    return String(index).padStart(3, '0');
}

/** Every series id once (the report's rows are the import's keys). */
function refuseRepeatedSeries(request: Request): void {
    if (new Set(request.series.map((series) => series.seriesId)).size !== request.series.length) {
        throw new ApiError('apiError.invalidRequest', undefined, [{ path: 'series', code: 'validation.value' }]);
    }
}

/** The archive's report as the worker sends it; the one who first reported it stays its creator. */
function reportOf(request: Request, call: WorkerCall, before: ArchiveDoc | undefined, now: Date): ArchiveDoc {
    return {
        name: request.name,
        source: request.source,
        fileCount: request.fileCount,
        bytes: request.bytes,
        scannedAt: at(now),
        workerId: request.workerId,
        series: request.series,
        skipped: request.skipped,
        createdBy: before?.createdBy ?? call.uid,
        updatedBy: call.uid,
        updatedAt: at(now),
    };
}

/** The report, in one transaction with the worker's and the archive's checks: an imported archive is never reported again. */
async function writeReport(transaction: DocumentTransaction, request: Request, call: WorkerCall, now: Date): Promise<void> {
    await requireWorker(transaction, call);
    const path = FIRESTORE_PATHS.archive(request.cityId, request.archiveId);
    const before = await transaction.get(path, archiveDocSchema);
    if (before?.jobs !== undefined) {
        throw new ApiError('apiError.imagery.archiveImported');
    }
    await transaction.set(path, archiveDocSchema, reportOf(request, call, before, now));
}

/** The sample of skipped paths, after the report: the last scan's rows beyond this one's are removed (a sample, not a record). */
async function writeIssues(documents: Ports['documents'], request: Request): Promise<void> {
    const issues = FIRESTORE_PATHS.archiveIssues(request.cityId, request.archiveId);
    for (const [index, issue] of request.issues.entries()) {
        await documents.set(`${issues}/${issueId(index)}`, archiveIssueSchema, issue);
    }
    const kept = new Set(request.issues.map((_, index) => issueId(index)));
    const before = await documents.query(issues, archiveIssueSchema);
    for (const stale of [...before.documents, ...before.invalid].filter((issue) => !kept.has(issue.id))) {
        await documents.delete(stale.path);
    }
}

/**
 * `worker.archiveReport` (`docs/research/M20-import-local.md` §2.4; S-A120-HAPPY-REPORT): the owner's worker reports what its scan of a
 * local archive found: `cities/{city}/archives/{archive}` with at most 200 series and the skipped counts, and up to 500 skipped files'
 * relative paths in `archives/{archive}/issues`. Only relative paths reach it (the schemas refuse nothing else of the host: the worker
 * never sends one). The scan is free: no daily count, no budget guard; a report of an archive already imported is refused.
 */
async function workerArchiveReport(
    deps: ArchiveReportDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'worker.archiveReport'>> {
    refuseRepeatedSeries(request);
    const call: WorkerCall = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = deps.clock.now();
    await deps.documents.transaction((transaction) => writeReport(transaction, request, call, now));
    await writeIssues(deps.documents, request);
    deps.log.info('archive reported', { cityId: request.cityId, archiveId: request.archiveId, series: request.series.length });
    return { archiveId: request.archiveId, series: request.series.length };
}

/** The `worker-archiveReport` callable. */
export function archiveReportFunction(getDeps: () => ArchiveReportDeps & CallableDeps) {
    return defineCallable('worker.archiveReport', paired(workerArchiveReport), getDeps);
}
