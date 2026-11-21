import '../global-options.js';

import {
    FIRESTORE_PATHS,
    archiveDocSchema,
    timestampFromDate,
    yearSchema,
    type ArchiveDoc,
    type ArchiveSeries,
    type ArchiveSeriesParams,
    type CallableRequest,
    type CallableResponse,
    type Rights,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { passTurnstile, refuseWhileGuardRed } from './limits.js';
import { requireCity, stampOf } from './records.js';
import { createWork, jobIdFor, reserveLayerIds, type NewWork } from './versions.js';

/**
 * `imagery.archiveImport` (a city editor; `docs/research/M20-import-local.md` §1.3, §8; S-A120-*): one click imports the series the
 * owner kept of a scanned archive. Each becomes one `archive-series` job and its version, under a layer id reserved from its title,
 * pinned to the owner's computer (`runOn: 'local'`, `localOnly`), in the archive's order (the reference ladder). Every series starts
 * at once: a local-only job is outside the daily cap of new layers (the owner, 2026-11-09; it once let today's share start and held
 * the rest `daily`); the import is only paused by the budget guard. Everything, the archive's record of
 * its jobs included, is written in one transaction, so a second click finds the series imported (`apiError.imagery.archiveImported`).
 * A series the record no longer names (its version deleted by `imagery.deleteVersion`: the owner starts it over) is taken again,
 * its job added to the others.
 */
export type ArchiveImportDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.archiveImport'>;
type Choice = Request['series'][number];

/** The year label of a series the scan could not date (`report.py`): this year stands in until the owner types one. */
const UNDATED = '?';

/** A series the owner kept, as the report found it and as they edited it. */
interface Kept {
    readonly series: ArchiveSeries;
    readonly title: string;
    readonly year: number;
    readonly rights: Rights;
}

/** A skipped series may be imported only when it was skipped as too small (the owner insists: it is imported at the zoom it supports). */
function importable(series: ArchiveSeries): boolean {
    return series.action === 'import' || series.reason === 'too-small';
}

/** The report's series, or `apiError.invalidRequest` when it has none of that id or proposed to skip it. */
function seriesOf(archive: ArchiveDoc, seriesId: string): ArchiveSeries {
    const series = archive.series.find((each) => each.seriesId === seriesId);
    if (series === undefined || !importable(series)) {
        throw new ApiError('apiError.invalidRequest');
    }
    return series;
}

/**
 * The layer's year, or `apiError.imagery.archiveYear` for one a layer cannot show yet: a series the scan could not date (`?`) until
 * the owner types its year, and one before 1800 (the report knows 1770, a layer's year does not; it waits until layers go further back).
 */
function yearOf(choice: Choice, series: ArchiveSeries): number {
    const undated = choice.year === undefined && series.yearLabel === UNDATED;
    const year = choice.year ?? series.year;
    if (undated || !yearSchema.safeParse(year).success) {
        throw new ApiError('apiError.imagery.archiveYear');
    }
    return year;
}

/** Who imports, and when: only the city's owner may confirm a series' rights (§8.6). */
interface Importer {
    readonly owner: boolean;
    readonly cityId: string;
    readonly now: Date;
}

/**
 * §8.6: the rights are the stored report's, never the browser's. Rights sent with a series are the owner's confirmation: only the
 * city's owner may send them, with who granted them; the server takes their licence, state and words over the report's and stamps
 * `confirmedAt` by its own clock.
 */
function confirmedRights(series: ArchiveSeries, choice: Choice, importer: Importer): Rights {
    const sent = choice.rights;
    if (sent === undefined) {
        return series.rights;
    }
    if (!importer.owner) {
        throw new ApiError('apiError.city.notOwner', { cityId: importer.cityId });
    }
    if (sent.confirmedBy === undefined || series.rights.state === 'do-not-publish') {
        throw new ApiError('apiError.imagery.rightsUnconfirmed');
    }
    const confirmedAt = timestampFromDate(importer.now);
    return { ...series.rights, licence: sent.licence, state: sent.state, confirmedBy: sent.confirmedBy, confirmedAt };
}

/** The series as kept: the report's, with the owner's title and year (the rights' printed year follows a year they typed). */
function keptOf(archive: ArchiveDoc, choice: Choice, importer: Importer): Kept {
    const series = seriesOf(archive, choice.seriesId);
    const year = yearOf(choice, series);
    const rights = confirmedRights(series, choice, importer);
    return {
        series,
        title: choice.title ?? series.title,
        year,
        rights: choice.year === undefined ? rights : { ...rights, year: String(year) },
    };
}

/** The kept series in the archive's order (the reference ladder, then the report's own order). */
function keptInOrder(archive: ArchiveDoc, request: Request, importer: Importer): Kept[] {
    const kept = request.series.filter((choice) => choice.include).map((choice) => keptOf(archive, choice, importer));
    if (kept.length === 0) {
        throw new ApiError('apiError.invalidRequest');
    }
    return kept.sort((a, b) => a.series.order - b.series.order);
}

/** The series an import asks for. */
function asked(request: Request): string[] {
    return request.series.filter((choice) => choice.include).map((choice) => choice.seriesId);
}

/**
 * The archive, none of the asked series imported yet, or `apiError.notFound` / `apiError.imagery.archiveImported` (a series the
 * record no longer names, its version deleted to start it over, is taken again).
 */
async function requireFresh(reader: Pick<Ports['documents'], 'get'>, request: Request): Promise<ArchiveDoc> {
    const archive = await reader.get(FIRESTORE_PATHS.archive(request.cityId, request.archiveId), archiveDocSchema);
    if (archive === undefined) {
        throw new ApiError('apiError.notFound');
    }
    const jobs = archive.jobs ?? {};
    if (asked(request).some((seriesId) => seriesId in jobs)) {
        throw new ApiError('apiError.imagery.archiveImported');
    }
    return archive;
}

function paramsOf(archiveId: string, series: ArchiveSeries): ArchiveSeriesParams {
    return {
        archiveId,
        seriesId: series.seriesId,
        class: series.class,
        sheets: series.files,
        encoding: series.encoding,
        order: series.order,
        maxzoom: series.estimate.maxzoom,
        referenceLayerIds: [],
        ...(series.edition === undefined ? {} : { edition: series.edition }),
        ...(series.scaleDenominator === undefined ? {} : { scaleDenominator: series.scaleDenominator }),
    };
}

/** What one series' job is: where it runs, and whether it starts today (it counts now) or waits for a later day's share. */
interface Planned {
    readonly kept: Kept;
    readonly work: NewWork;
    readonly waiting: boolean;
}

/** Who imports, by the server's clock. */
interface Start {
    readonly uid: string;
    readonly now: Date;
}

/**
 * Every series starts at once (2026-11-09): a local-only job runs free on the owner's computer, so the daily cap of new
 * layers, which guards the Cloud Run spend, neither counts nor holds it; the worker still runs them one at a time.
 */
function planOf(request: Request, kept: readonly Kept[], start: Start) {
    return (layerIdFor: (label: string) => string): Planned[] =>
        kept.map((each) => {
            const work: NewWork = {
                cityId: request.cityId,
                jobId: jobIdFor('ar', start.now, each.series.seriesId),
                type: 'archive-series',
                params: paramsOf(request.archiveId, each.series),
                layerId: layerIdFor(each.title),
                createdBy: start.uid,
                now: start.now,
                runOn: 'local',
                localOnly: true,
                waitReason: 'worker',
            };
            return { kept: each, work, waiting: false };
        });
}

/**
 * Everything in one transaction: the archive still unimported, today's room counted behind the turnstile (`ops/daily`, so a
 * concurrent import or daily release never spends the same room), the jobs and versions, and the archive's record of its jobs.
 */
async function writeAll(deps: ArchiveImportDeps, request: Request, kept: readonly Kept[], start: Start): Promise<Planned[]> {
    return deps.documents.transaction(async (transaction) => {
        const archive = await requireFresh(transaction, request);
        const planned = planOf(request, kept, start)(await reserveLayerIds(deps.documents, request.cityId));
        for (const { kept: each, work } of planned) {
            await createWork(transaction, work, {
                origin: 'archive',
                source: { kind: 'archive', archiveId: request.archiveId, seriesId: each.series.seriesId, sheetCount: each.series.files },
                label: { ro: each.title },
                year: each.year,
                rights: each.rights,
            });
        }
        const added = Object.fromEntries(planned.map(({ kept: each, work }) => [each.series.seriesId, work.jobId]));
        await transaction.set(FIRESTORE_PATHS.archive(request.cityId, request.archiveId), archiveDocSchema, {
            ...archive,
            jobs: { ...archive.jobs, ...added },
            importedBy: start.uid,
            importedAt: timestampFromDate(start.now),
            ...stampOf(start.uid, start.now),
        });
        await passTurnstile(transaction, start.now);
        return planned;
    });
}

async function archiveImport(
    deps: ArchiveImportDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.archiveImport'>> {
    await requireCity(deps.documents, request.cityId);
    const start = { uid: caller.uid, now: deps.clock.now() };
    const importer = { owner: caller.membership?.roleIn(request.cityId) === 'owner', cityId: request.cityId, now: start.now };
    const kept = keptInOrder(await requireFresh(deps.documents, request), request, importer);
    await refuseWhileGuardRed(deps.documents);
    const planned = await writeAll(deps, request, kept, start);
    const waiting = planned.filter((each) => each.waiting).length;
    deps.log.info('archive imported', {
        uid: caller.uid,
        cityId: request.cityId,
        archiveId: request.archiveId,
        today: planned.length - waiting,
        waiting,
    });
    return {
        jobs: planned.map(({ kept: each, work, waiting: later }) => ({
            seriesId: each.series.seriesId,
            jobId: work.jobId,
            layerId: work.layerId,
            waiting: later,
        })),
        today: planned.length - waiting,
        waiting,
    };
}

/** The `imagery-archiveImport` callable. */
export function archiveImportFunction(getDeps: () => ArchiveImportDeps & CallableDeps) {
    return defineCallable('imagery.archiveImport', archiveImport, getDeps);
}
