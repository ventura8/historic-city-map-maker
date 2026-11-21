/**
 * The photos page's texts (`docs/research/M2c-interfaces.md` §10.1): every word comes from the editors' catalogue
 * (`adminContent.photos.*`), the API's error codes (`apiError.*`) or the viewer's validation messages (`validation.*`);
 * the page receives no free text from the app. Titles, names and EXIF values are data, shown as text only.
 */
import type { AdminContentKey, FirestoreLicense, UiLocale, ValidationIssue } from '@hcm/shared';

import { issueText } from '../editing/issue-text.js';
import { contentText, noticeText } from '../shell/text.js';
import type {
    BulkKindPort,
    LocalizedPort,
    PhotoFilterPort,
    PhotoMessageKey,
    PublishBlockPort,
    StickyPort,
    UploadItemPort,
    UploadPhasePort,
} from './photos-port.js';

type Params = Readonly<Record<string, string>>;

/** The address of a photo's editor. */
export function photoHref(photoId: string): string {
    return ['#', 'photos', photoId].join('/');
}

/** The address of a photo's history. */
export function historyHref(photoId: string): string {
    return ['#', 'history', 'photo', photoId].join('/');
}

/** The id of a field's hint, error or other part. */
export function partId(id: string, part: string): string {
    return [id, part].join('-');
}

/** An `adminContent.photos.*` text. */
export function photoText(locale: UiLocale, key: AdminContentKey, params?: Params): string {
    return contentText(locale, key, params);
}

/** A message of the area: an editor text or an API error code. */
export function messageText(locale: UiLocale, key: PhotoMessageKey, params?: Params | null): string {
    return noticeText(locale, key, params ?? undefined);
}

/** A localized text in the admin's language, Romanian when English is missing (as the viewer does). */
export function localized(locale: UiLocale, text: LocalizedPort): string {
    return locale === 'en' ? (text.en ?? text.ro) : text.ro;
}

export const FILTER_ORDER: readonly PhotoFilterPort[] = ['all', 'published', 'unpublished', 'processing', 'failed', 'rightsReview'];

const FILTER_KEYS: Readonly<Record<PhotoFilterPort, AdminContentKey>> = {
    all: 'adminContent.photos.filter.all',
    published: 'adminContent.photos.filter.published',
    unpublished: 'adminContent.photos.filter.unpublished',
    processing: 'adminContent.photos.filter.processing',
    failed: 'adminContent.photos.filter.failed',
    rightsReview: 'adminContent.photos.filter.rightsReview',
};

export function filterText(locale: UiLocale, filter: PhotoFilterPort): string {
    return contentText(locale, FILTER_KEYS[filter]);
}

export const LICENSE_ORDER: readonly FirestoreLicense[] = [
    'CC0',
    'CC-BY-4.0',
    'CC-BY-SA-4.0',
    'PD',
    'permission',
    'permission-legacy',
    'unknown',
];

export function licenseText(locale: UiLocale, license: FirestoreLicense): string {
    return contentText(locale, `adminContent.photos.license.${license}`);
}

const BLOCK_KEYS: Readonly<Record<PublishBlockPort, AdminContentKey>> = {
    processing: 'adminContent.photos.block.processing',
    failed: 'adminContent.photos.block.failed',
    license: 'adminContent.photos.block.license',
    place: 'adminContent.photos.block.place',
};

/** Why Published cannot be switched on. */
export function blockText(locale: UiLocale, block: PublishBlockPort): string {
    return contentText(locale, BLOCK_KEYS[block]);
}

const REASON_KEYS: Readonly<Record<string, AdminContentKey>> = {
    processing: 'adminContent.photos.reason.processing',
    failed: 'adminContent.photos.reason.failed',
    license: 'adminContent.photos.reason.license',
    place: 'adminContent.photos.reason.place',
    sourceUrl: 'adminContent.photos.reason.sourceUrl',
    invalid: 'adminContent.photos.reason.invalid',
    conflict: 'adminContent.photos.reason.conflict',
    gone: 'adminContent.photos.reason.gone',
    denied: 'adminContent.photos.reason.denied',
    offline: 'adminContent.photos.reason.offline',
};

/** One skipped photo of a bulk action: its title and why it was left alone. */
export function skipText(locale: UiLocale, skip: { readonly title: string; readonly reason: string }): string {
    const reason = contentText(locale, REASON_KEYS[skip.reason] ?? 'adminContent.photos.reason.invalid');
    return contentText(locale, 'adminContent.photos.reason.line', { title: skip.title, reason });
}

const BULK_KEYS: Readonly<Record<Exclude<BulkKindPort, 'delete'>, AdminContentKey>> = {
    publish: 'adminContent.photos.bulk.publishAction',
    unpublish: 'adminContent.photos.bulk.unpublishAction',
    confirmRights: 'adminContent.photos.bulk.confirmRightsAction',
    setFields: 'adminContent.photos.bulk.setFieldsAction',
};

export function bulkActionText(locale: UiLocale, kind: Exclude<BulkKindPort, 'delete'>): string {
    return contentText(locale, BULK_KEYS[kind]);
}

const PHASE_KEYS: Readonly<Record<Exclude<UploadPhasePort, 'uploading'>, AdminContentKey>> = {
    refused: 'adminContent.photos.upload.refused',
    queued: 'adminContent.photos.upload.queued',
    processing: 'adminContent.photos.upload.processing',
    done: 'adminContent.photos.upload.done',
    failed: 'adminContent.photos.upload.failed',
    interrupted: 'adminContent.photos.upload.interrupted',
    cancelled: 'adminContent.photos.upload.cancelled',
};

/** Where an upload stands, as text. */
export function phaseText(locale: UiLocale, item: UploadItemPort): string {
    return item.phase === 'uploading'
        ? contentText(locale, 'adminContent.photos.upload.uploading', { percent: String(item.percent) })
        : contentText(locale, PHASE_KEYS[item.phase]);
}

/** The sticky fields a new photo gets, as one line (none chosen yet: the hint to set them on the first photo). */
export function stickyText(locale: UiLocale, sticky: StickyPort): string {
    const values = [
        sticky.author,
        sticky.sourceLabel,
        sticky.license === undefined ? undefined : licenseText(locale, sticky.license),
        sticky.rightsHolder,
    ];
    const shown = values.filter((value): value is string => value !== undefined);
    return shown.length === 0
        ? contentText(locale, 'adminContent.photos.uploads.noSticky')
        : contentText(locale, 'adminContent.photos.uploads.sticky', { values: shown.join(', ') });
}

/** The years of a photo (`1936`, `1936–1940`, or "No year"). */
export function yearsText(locale: UiLocale, year: number | null, yearEnd: number | null): string {
    if (year === null) {
        return contentText(locale, 'adminContent.photos.undated');
    }
    return yearEnd === null || yearEnd === year
        ? String(year)
        : contentText(locale, 'adminContent.photos.years', { from: String(year), to: String(yearEnd) });
}

/** The first validation message of a field (its issue path starts with the field's name), or null. */
export function fieldIssue(locale: UiLocale, issues: readonly ValidationIssue[], field: string): string | null {
    const issue = issues.find(
        (candidate) => candidate.path === field || candidate.path.startsWith(`${field}.`) || candidate.path.startsWith(`${field}[`),
    );
    return issue === undefined ? null : issueText(locale, issue);
}
