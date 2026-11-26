/**
 * The Imagery area's words (`docs/research/M3-interfaces.md` §3.3, §10.2): a scene's ranking reasons in plain words, a
 * version's state, why an unfinished job waits, a dataset's name, and the numbers the screens show (metres, percents,
 * compute units, dollars) in the admin's language.
 */
import type { JobWaitReason, LayerVersionState, UiLocale, RankReasonEntry, UsgsDataset } from '@hcm/shared';

import { contentText } from '../shell/text.js';
import type { JobProgressPort, VersionItemPort } from './imagery-port.js';

const VERSION_STATES = {
    processing: 'adminContent.imagery.version.processing',
    needs_gcps: 'adminContent.imagery.version.needsGcps',
    awaiting_approval: 'adminContent.imagery.version.awaitingApproval',
    approved: 'adminContent.imagery.version.approved',
    publishing: 'adminContent.imagery.version.publishing',
    published: 'adminContent.imagery.version.published',
    rejected: 'adminContent.imagery.version.rejected',
    superseded: 'adminContent.imagery.version.superseded',
    failed: 'adminContent.imagery.version.failed',
    cancelled: 'adminContent.imagery.version.cancelled',
    joined: 'adminContent.imagery.version.joined',
} as const satisfies Readonly<Record<LayerVersionState, string>>;

const WAITS = {
    'usgs-preparing': 'adminContent.imagery.wait.usgsPreparing',
    'usgs-maintenance': 'adminContent.imagery.wait.usgsMaintenance',
    'rate-limited': 'adminContent.imagery.wait.rateLimited',
    capacity: 'adminContent.imagery.wait.capacity',
    guard: 'adminContent.imagery.wait.guard',
    gcps: 'adminContent.imagery.wait.gcps',
    approval: 'adminContent.imagery.wait.approval',
    'compute-units': 'adminContent.imagery.wait.computeUnits',
    deferred: 'adminContent.imagery.wait.deferred',
    mapbox: 'adminContent.imagery.wait.mapbox',
    parts: 'adminContent.imagery.wait.parts',
    daily: 'adminContent.imagery.wait.daily',
    'archive-copy': 'adminContent.imagery.wait.archiveCopy',
    'film-copy': 'adminContent.imagery.wait.filmCopy',
} as const satisfies Readonly<Record<WordedWait, string>>;

/**
 * M7 (`docs/research/M7-local-worker.md` §7): a job waiting for the owner's computer or for the OK past Cloud Run's free
 * tier says so in `<hcm-run-place>` (the lazy `worker` chunk, with its switch), not in a line of its own.
 */
type WordedWait = Exclude<JobWaitReason, 'worker' | 'free-tier'>;

/** The reason a job waits when a line says it, else null. */
export function wordedWait(reason: JobWaitReason | null): WordedWait | null {
    return reason === null || reason === 'worker' || reason === 'free-tier' ? null : reason;
}

export function versionStateText(locale: UiLocale, state: LayerVersionState): string {
    return contentText(locale, VERSION_STATES[state]);
}

export function datasetText(locale: UiLocale, dataset: UsgsDataset): string {
    // Every dataset has its key (`adminContent.imagery.dataset.<dataset>`; the type checks each one exists in the catalogue).
    return contentText(locale, `adminContent.imagery.dataset.${dataset}`);
}

/** A day in the admin's language. */
export function dayText(locale: UiLocale, iso: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso));
}

/** A number in the admin's language with at most `digits` decimals. */
export function numberText(locale: UiLocale, value: number, digits = 1): string {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** Why a job waits, in words (the deferral and the retries with their date). */
export function waitText(locale: UiLocale, reason: WordedWait, at: string | null): string {
    return contentText(locale, WAITS[reason], { date: at === null ? '' : dayText(locale, at) });
}

/** The plural form the catalogues spell out for `count` (`one`, `few`: Romanian's 2–19; `other`). */
export function pluralOf(locale: UiLocale, count: number): 'one' | 'few' | 'other' {
    const rule = new Intl.PluralRules(locale).select(count);
    return rule === 'one' || rule === 'few' ? rule : 'other';
}

/** A reason's catalogue key: the years to the nearest layer take their plural form ("1 year", "2 ani", "20 de ani"). */
function reasonKey(locale: UiLocale, reason: RankReasonEntry) {
    if (reason.code !== 'newYear') {
        return `adminContent.imagery.reason.${reason.code}` as const;
    }
    return `adminContent.imagery.reason.newYear.${pluralOf(locale, Number(reason.params?.['years'] ?? 0))}` as const;
}

/** A ranking reason in plain words; its numbers in the admin's language. */
export function reasonText(locale: UiLocale, reason: RankReasonEntry): string {
    const params = Object.fromEntries(
        Object.entries(reason.params ?? {}).map(([name, value]) => {
            const number = Number(value);
            return [name, name === 'year' || Number.isNaN(number) ? value : numberText(locale, number)];
        }),
    );
    return contentText(locale, reasonKey(locale, reason), params);
}

/** The label in the admin's language (English falls back to Romanian). */
export function labelText(label: { readonly ro: string; readonly en?: string | undefined }, locale: UiLocale): string {
    return locale === 'en' ? (label.en ?? label.ro) : label.ro;
}

/** A version row's second line: its state, and its job's progress or wait. */
export function versionDetail(locale: UiLocale, version: VersionItemPort, job: JobProgressPort | undefined): string {
    const state = versionStateText(locale, version.state);
    if (job === undefined) {
        return state;
    }
    const wait = wordedWait(job.waitReason);
    if (wait !== null) {
        return `${state} · ${waitText(locale, wait, job.retryAt)}`;
    }
    return job.progress === null
        ? state
        : contentText(locale, 'adminContent.imagery.progress', { state, percent: String(Math.round(job.progress * 100)) });
}
