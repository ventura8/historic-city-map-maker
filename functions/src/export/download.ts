import '../global-options.js';

import {
    EXPORT_LIMITS,
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityExportDocSchema,
    exportFileName,
    opsGuardDocSchema,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type CityExportDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type ExportDownloadDeps = Pick<Ports, 'documents' | 'signer' | 'clock' | 'log'>;

type Request = CallableRequest<'export.download'>;

const MINUTE_MS = 60_000;

/** Whether a ready export's time is up (its object is gone or about to go with the bucket's lifecycle). */
function pastExpiry(record: CityExportDoc, now: Date): boolean {
    return record.expiresAt !== undefined && timestampToDate(record.expiresAt).getTime() <= now.getTime();
}

function isExpired(record: CityExportDoc, now: Date): boolean {
    return record.state === 'expired' || (record.state === 'ready' && pastExpiry(record, now));
}

/** The record, ready and in time: `apiError.notFound`, `apiError.export.expired` or `apiError.export.notReady` otherwise. */
function readyRecord(record: CityExportDoc | undefined, now: Date): CityExportDoc {
    if (record === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (isExpired(record, now)) {
        throw new ApiError('apiError.export.expired');
    }
    if (record.state !== 'ready') {
        throw new ApiError('apiError.export.notReady');
    }
    return record;
}

/** The UTC day of `now`, `YYYY-MM-DD`. */
function dayOf(now: Date): string {
    return now.toISOString().slice(0, 10);
}

/**
 * In one transaction: the ready record, and one more of today's signings counted on it; the day's
 * `EXPORT_LIMITS.downloadsPerDay` used up → `apiError.export.downloadLimit {limit}`. Returns the record and the count.
 */
async function countedRecord(transaction: DocumentTransaction, path: string, now: Date): Promise<{ record: CityExportDoc; count: number }> {
    const record = readyRecord(await transaction.get(path, cityExportDocSchema), now);
    const day = dayOf(now);
    const count = (record.downloads?.day === day ? record.downloads.count : 0) + 1;
    if (count > EXPORT_LIMITS.downloadsPerDay) {
        throw new ApiError('apiError.export.downloadLimit', { limit: String(EXPORT_LIMITS.downloadsPerDay) });
    }
    await transaction.set(path, cityExportDocSchema, { ...record, downloads: { day, count } });
    return { record, count };
}

/** `apiError.guardPaused` while the budget guard is red: the project pays a download's egress (`docs/LESSONS.md` 246). */
async function refuseRedGuard(deps: ExportDownloadDeps): Promise<void> {
    if ((await deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema))?.state === 'red') {
        throw new ApiError('apiError.guardPaused');
    }
}

/**
 * `export.download` (a city's owners; `docs/research/M5-interfaces.md` §5.5; S-A53-BAD-DOWNLOAD-LIMIT): a signed
 * address of the ready zip that lives `EXPORT_LIMITS.downloadUrlMinutes`, saved as `<city>-<YYYY-MM-DD>.zip`, at most
 * `EXPORT_LIMITS.downloadsPerDay` a day per export and none while the budget guard is red. The address is never
 * logged; the day's count is.
 */
async function exportDownload(
    deps: ExportDownloadDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'export.download'>> {
    const now = deps.clock.now();
    await refuseRedGuard(deps);
    const path = FIRESTORE_PATHS.cityExport(request.cityId, request.exportId);
    const { record, count } = await deps.documents.transaction((transaction) => countedRecord(transaction, path, now));
    const expiresAt = new Date(now.getTime() + EXPORT_LIMITS.downloadUrlMinutes * MINUTE_MS);
    const fileName = exportFileName(request.cityId, timestampToDate(record.createdAt));
    const url = await deps.signer.signedDownload('private', {
        path: STORAGE_PATHS.cityExport(request.cityId, request.exportId),
        expiresAt,
        fileName,
    });
    deps.log.info('export download signed', { uid: caller.uid, cityId: request.cityId, exportId: request.exportId, today: count });
    return { url, expiresAt: expiresAt.toISOString(), fileName };
}

/** The `export-download` callable. */
export function exportDownloadFunction(getDeps: () => ExportDownloadDeps & CallableDeps) {
    return defineCallable('export.download', exportDownload, getDeps);
}
