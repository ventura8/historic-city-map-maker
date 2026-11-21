/**
 * M20's Import local files, the pure part (`docs/research/M20-import-local.md` §8): an archive's row in the Upload view, its
 * report as the page shows it, the owner's first edits of each series (only what the scan proposes to import, and only years a
 * layer can show), the request the one Import click sends, and each imported series' progress from its version and its job.
 */
import {
    imagerySettingsOf,
    mapThresholdM,
    yearSchema,
    type ArchiveDoc,
    type ArchiveReport,
    type ArchiveSeries,
    type CityDoc,
    type HelpItem,
    type ImageryArchiveImportRequest,
    type JobDoc,
    type JobStatus,
    type JobWaitReason,
    type LayerVersionDoc,
    type LayerVersionState,
    type Rights,
} from '@hcm/shared';

import type { Stored } from '../content/services.js';

export interface ArchiveRow {
    readonly id: string;
    readonly name: string;
    readonly files: number;
    readonly bytes: number;
    readonly series: number;
    readonly imported: boolean;
}

export interface SeriesEdit {
    readonly include: boolean;
    readonly title: string;
    readonly year: string;
    readonly confirmedBy: string | null;
}

export interface SeriesProgress {
    readonly versionId: string | null;
    readonly state: LayerVersionState | null;
    readonly jobStatus: JobStatus | null;
    readonly waitReason: JobWaitReason | null;
    readonly step: string | null;
    readonly progress: number | null;
    readonly help: Pick<HelpItem, 'reason' | 'note'> | null;
    readonly errorM: number | null;
    readonly thresholdM: number | null;
}

export function rowOf(doc: Stored<ArchiveDoc>): ArchiveRow {
    const { name, fileCount, bytes, series, jobs } = doc.data;
    return { id: doc.id, name, files: fileCount, bytes, series: series.length, imported: jobs !== undefined };
}

/** The report's skipped files by reason, most first. */
export function skippedOf(archive: ArchiveDoc): (readonly [string, number])[] {
    return Object.entries(archive.skipped).sort((a, b) => b[1] - a[1]);
}

/** A layer can show the year (1800–2100): a series dated earlier is left out until the timeline goes further back. */
function yearShown(text: string): boolean {
    return /^\d{4}$/.test(text.trim()) && yearSchema.safeParse(Number(text)).success;
}

/** The year label of a series the scan could not date: this year stands in, and the server refuses it until the owner types one. */
const UNDATED = '?';

/** The first edit of a series: imported when the scan proposes it and a layer can show its year (an undated one waits for it). */
function firstEdit(series: ArchiveSeries): SeriesEdit {
    const year = series.yearLabel === UNDATED ? '' : String(series.year);
    return { include: series.action === 'import' && yearShown(year), title: series.title, year, confirmedBy: null };
}

/** A series' edit: the owner's, else the first; never chosen again once its job exists (`imagery.archiveImport` refuses it). */
function editOf(series: ArchiveSeries, kept: SeriesEdit | undefined, imported: boolean): SeriesEdit {
    const edit = kept ?? firstEdit(series);
    return imported ? { ...edit, include: false } : edit;
}

/**
 * The edits of a newly read report, keeping those the owner already made. A series the record names is imported; one it no longer
 * names (its version deleted to start it over) is the owner's to choose again.
 */
export function editsOf(archive: ArchiveDoc, kept: Readonly<Record<string, SeriesEdit>>): Record<string, SeriesEdit> {
    const jobs = archive.jobs ?? {};
    return Object.fromEntries(
        archive.series.map((series) => [series.seriesId, editOf(series, kept[series.seriesId], series.seriesId in jobs)]),
    );
}

/** The rights the owner confirmed: a permission from whom they typed, clear to publish. */
function rightsOf(series: ArchiveSeries, edit: SeriesEdit): Rights | undefined {
    if (edit.confirmedBy === null) {
        return undefined;
    }
    return { ...series.rights, licence: 'permission', state: 'clear', confirmedBy: edit.confirmedBy };
}

/** The year the request sends: one the owner changed, and always one they typed for an undated series. */
function yearSent(series: ArchiveSeries, edit: SeriesEdit): { year?: number } {
    const kept = Number(edit.year) === series.year && series.yearLabel !== UNDATED;
    return kept ? {} : { year: Number(edit.year) };
}

/** One series as the request sends it: only what the owner changed. */
function choiceOf(series: ArchiveSeries, edit: SeriesEdit): ImageryArchiveImportRequest['series'][number] {
    const title = edit.title.trim();
    const rights = rightsOf(series, edit);
    return {
        seriesId: series.seriesId,
        include: true,
        ...(title !== '' && title !== series.title ? { title } : {}),
        ...yearSent(series, edit),
        ...(rights === undefined ? {} : { rights }),
    };
}

/** The series to import, or null when none is chosen or a chosen one's year cannot be shown. */
export function choicesOf(archive: ArchiveDoc, edits: Readonly<Record<string, SeriesEdit>>): ImageryArchiveImportRequest['series'] | null {
    const chosen = archive.series.flatMap((series) => {
        const edit = edits[series.seriesId];
        return edit?.include === true ? [{ series, edit }] : [];
    });
    if (chosen.length === 0 || chosen.some(({ edit }) => !yearShown(edit.year))) {
        return null;
    }
    return chosen.map(({ series, edit }) => choiceOf(series, edit));
}

/** The worker's import page on this computer, with the city's latitude (the scan's ground resolution). */
/** The city's latitude (its centre, else its bounds' middle) for the scan's ground scale; null before the city is read. */
export function latitudeOf(city: CityDoc | undefined): number | null {
    return city === undefined ? null : (city.center?.lat ?? (city.bounds.south + city.bounds.north) / 2);
}

export function importUrlOf(port: number, city: CityDoc | undefined): string {
    const page = `http://127.0.0.1:${String(port)}/import`;
    const lat = latitudeOf(city);
    return lat === null ? page : `${page}?lat=${lat.toFixed(4)}`;
}

const NO_PROGRESS: SeriesProgress = {
    ...{ versionId: null, state: null, jobStatus: null, waitReason: null, step: null, progress: null },
    ...{ help: null, errorM: null, thresholdM: null },
};

function seriesOfVersion(version: LayerVersionDoc): string | null {
    const source = version.source;
    return source?.kind === 'archive' ? source.seriesId : null;
}

function seriesOfJob(job: JobDoc): string | null {
    const seriesId = (job.params as Readonly<Record<string, unknown>>)['seriesId'];
    return typeof seriesId === 'string' ? seriesId : null;
}

/** The placement's error and the threshold its scale earns (§5), or nulls when nothing was measured. */
function measuredOf(report: ArchiveReport | undefined, city: CityDoc | undefined): Pick<SeriesProgress, 'errorM' | 'thresholdM'> {
    if (report === undefined) {
        return { errorM: null, thresholdM: null };
    }
    const settings = imagerySettingsOf(city?.imagery);
    const thresholdM = mapThresholdM(settings.rmseThresholdM, report.scaleDenominator, settings.mapThresholdMaxM);
    return { errorM: report.checkpointRmseM ?? null, thresholdM: thresholdM ?? null };
}

/** What the version says: its state, why it waits, its error and the threshold its scale earns. */
function fromVersion(doc: Stored<LayerVersionDoc>, city: CityDoc | undefined): Partial<SeriesProgress> {
    const help = doc.data.help;
    return {
        versionId: doc.id,
        state: doc.data.state,
        help: help === undefined ? null : { reason: help.reason, note: help.note },
        ...measuredOf(doc.data.archive, city),
    };
}

function fromJob(doc: Stored<JobDoc>): Partial<SeriesProgress> {
    const job = doc.data;
    return { jobStatus: job.status, waitReason: job.waitReason ?? null, step: job.step ?? null, progress: job.progress ?? null };
}

/** Each imported series' progress, by series id, from the archive's versions and jobs. */
export function progressOf(
    versions: readonly Stored<LayerVersionDoc>[],
    jobs: readonly Stored<JobDoc>[],
    city: CityDoc | undefined,
): Record<string, SeriesProgress> {
    const progress: Record<string, SeriesProgress> = {};
    const merge = (seriesId: string | null, part: Partial<SeriesProgress>): void => {
        if (seriesId !== null) {
            progress[seriesId] = { ...(progress[seriesId] ?? NO_PROGRESS), ...part };
        }
    };
    for (const job of jobs) {
        merge(seriesOfJob(job.data), fromJob(job));
    }
    for (const version of versions) {
        merge(seriesOfVersion(version.data), fromVersion(version, city));
    }
    return progress;
}
