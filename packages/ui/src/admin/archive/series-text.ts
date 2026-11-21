/**
 * What M20's report says of a series (`docs/research/M20-import-local.md` §8.2, §8.4, §8.5): what will happen to it, its chance to
 * calibrate itself, its rights, its estimate, and, once imported, where it stands (waiting for its day, at work, waiting for points
 * and why, waiting for approval with its error against its threshold, published), each in the page's language.
 */
import { yearSchema, type ArchiveSeries, type UiLocale } from '@hcm/shared';
import type { AdminArchiveKey } from '@hcm/shared/admin-archive';

import type { SeriesEditPort, SeriesProgressPort } from './archive-port.js';
import { archiveText, count, sizeText } from './archive-element.js';

/** A year a layer can show (1800–2100), as typed. */
export function yearShown(text: string): boolean {
    return /^\d{4}$/.test(text.trim()) && yearSchema.safeParse(Number(text)).success;
}

/** "Place 4,545 sheets from their names on the city's grid", or "Skipped: …". */
export function actionText(locale: UiLocale, series: ArchiveSeries): string {
    if (series.action === 'skip' && series.reason !== undefined) {
        return archiveText(locale, 'adminArchive.action.skip', { reason: archiveText(locale, `adminArchive.reason.${series.reason}`) });
    }
    return archiveText(locale, `adminArchive.action.${series.class}`, { files: count(locale, series.files) });
}

export function estimateText(locale: UiLocale, series: ArchiveSeries): string {
    const { maxzoom, tilesBytes, minutes } = series.estimate;
    return archiveText(locale, 'adminArchive.estimate', {
        ...{ zoom: String(maxzoom), size: sizeText(locale, tilesBytes) },
        minutes: count(locale, Math.max(1, minutes)),
    });
}

/**
 * The chosen series' total: how many and their tiles' bytes. Every series starts at once on the owner's computer: a local-only
 * job is outside the daily share of new layers (2026-11-09), so the total no longer counts days.
 */
export function totalText(locale: UiLocale, chosen: readonly ArchiveSeries[]): string {
    if (chosen.length === 0) {
        return archiveText(locale, 'adminArchive.totalNone');
    }
    const bytes = chosen.reduce((sum, series) => sum + series.estimate.tilesBytes, 0);
    return archiveText(locale, 'adminArchive.total', { jobs: count(locale, chosen.length), size: sizeText(locale, bytes) });
}

/** The series the owner keeps. */
export function chosenOf(series: readonly ArchiveSeries[], edits: Readonly<Record<string, SeriesEditPort>>): ArchiveSeries[] {
    return series.filter((each) => edits[each.seriesId]?.include === true);
}

type Line = (locale: UiLocale, progress: SeriesProgressPort) => string;

function metres(locale: UiLocale, value: number | null): string {
    return value === null ? '?' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** A job the computer has taken. */
const AT_WORK: ReadonlySet<SeriesProgressPort['jobStatus']> = new Set<SeriesProgressPort['jobStatus']>(['starting', 'running']);

function processing(locale: UiLocale, progress: SeriesProgressPort): string {
    if (progress.waitReason === 'daily') {
        return archiveText(locale, 'adminArchive.state.daily');
    }
    if (!AT_WORK.has(progress.jobStatus)) {
        return archiveText(locale, 'adminArchive.state.queued');
    }
    const percent = String(Math.round((progress.progress ?? 0) * 100));
    return archiveText(locale, 'adminArchive.state.running', { step: progress.step ?? '…', percent });
}

function points(locale: UiLocale, progress: SeriesProgressPort): string {
    const reason = progress.help === null ? 'low-confidence' : progress.help.reason;
    return archiveText(locale, 'adminArchive.state.points', { note: archiveText(locale, `adminArchive.help.${reason}`) });
}

function approval(locale: UiLocale, progress: SeriesProgressPort): string {
    const error = metres(locale, progress.errorM);
    if (progress.thresholdM === null) {
        return archiveText(locale, 'adminArchive.state.approvalNoScale', { error });
    }
    return archiveText(locale, 'adminArchive.state.approval', { error, threshold: metres(locale, progress.thresholdM) });
}

const said =
    (key: AdminArchiveKey): Line =>
    (locale) =>
        archiveText(locale, key);

const LINES: Readonly<Partial<Record<NonNullable<SeriesProgressPort['state']>, Line>>> = {
    needs_gcps: points,
    awaiting_approval: approval,
    approved: said('adminArchive.state.publishing'),
    publishing: said('adminArchive.state.publishing'),
    published: said('adminArchive.state.published'),
    failed: said('adminArchive.state.failed'),
    cancelled: said('adminArchive.state.cancelled'),
    rejected: said('adminArchive.state.cancelled'),
};

/** Where an imported series stands, in one line. */
export function stateText(locale: UiLocale, progress: SeriesProgressPort): string {
    const line = progress.state === null ? undefined : LINES[progress.state];
    return (line ?? processing)(locale, progress);
}

/** Batch 4: how far a series' processing went, 0 to 1: its job's share while its version is processing, else all of it (it ended or waits for a person). */
function doneShare(progress: SeriesProgressPort): number {
    return progress.state === 'processing' || progress.state === null ? (progress.progress ?? 0) : 1;
}

/** Batch 4: every imported series' processing together, in whole percent (the owner, 2026-11-09: progress per series and overall). */
export function overallPercent(progresses: readonly SeriesProgressPort[]): number {
    if (progresses.length === 0) {
        return 0;
    }
    return Math.round((progresses.reduce((sum, each) => sum + doneShare(each), 0) / progresses.length) * 100);
}
