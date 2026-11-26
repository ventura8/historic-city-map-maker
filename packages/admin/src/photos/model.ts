/**
 * The photo list's model (`docs/research/M2c-interfaces.md` §6.1, §6.5): the filters and their Firestore queries (one
 * composite index each, `firebase/firestore.indexes.json`), the row each photo becomes, the search over the loaded page
 * (title in both languages and author, a year range) and why a photo cannot be published yet. Pure functions.
 */
import type { ApiErrorCode, PhotoDoc } from '@hcm/shared';

import type { ContentQuery, Stored } from '../content/services.js';

/** The filters of the list: all photos, or one query over an indexed field. */
export type PhotoFilter = 'all' | 'published' | 'unpublished' | 'processing' | 'failed' | 'rightsReview';

const WHERE: Readonly<Record<PhotoFilter, NonNullable<ContentQuery['where']>>> = {
    all: [],
    published: [['published', '==', true]],
    unpublished: [['published', '==', false]],
    processing: [['processing', '==', 'pending']],
    failed: [['processing', '==', 'failed']],
    rightsReview: [['rightsReview', '==', true]],
};

/** The query of a filter, newest change first (the page size and More are the live list's). */
export function photoQuery(filter: PhotoFilter, ownerOnly: string | null = null): ContentQuery {
    // M13 §1: an uploader reads their own photos only, and the rules read the query: it must ask for exactly those.
    const where = ownerOnly === null ? WHERE[filter] : [['createdBy', '==', ownerOnly] as const];
    return { where, orderBy: [['updatedAt', 'desc']] };
}

/** Why a photo cannot be published now (the rules' publish gate, §6.5, plus a place still to check, §6.2). */
export type PublishBlock = 'processing' | 'failed' | 'license' | 'place';

/** The first reason the photo cannot be published, or null when it can. An English title is never required (CR-1). */
export function publishBlock(photo: Pick<PhotoDoc, 'processing' | 'image' | 'license'>, checkPlace: boolean): PublishBlock | null {
    const blocks: readonly (readonly [boolean, PublishBlock])[] = [
        [photo.processing === 'pending', 'processing'],
        [photo.processing === 'failed' || photo.image === undefined, 'failed'],
        [photo.license === 'unknown', 'license'],
        [checkPlace, 'place'],
    ];
    return blocks.find(([blocked]) => blocked)?.[1] ?? null;
}

/** `value`, or null when absent (Firestore's optional fields as the page's nullable ones). */
export function nullable<T>(value: T | undefined): T | null {
    return value ?? null;
}

/** One photo of the list as the page shows it (texts in both languages: the page picks the admin's). */
export interface PhotoRow {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number | null;
    readonly yearEnd: number | null;
    readonly author: string | null;
    /** The thumbnail's https URL; null while processing or after a failure. */
    readonly thumb: string | null;
    readonly published: boolean;
    readonly processing: PhotoDoc['processing'];
    /** The processing's refusal (`apiError.photo.*`), shown on the item as text. */
    readonly error: ApiErrorCode | null;
    /** The photo this one repeats (`apiError.photo.duplicate`), linked from the item. */
    readonly duplicateOf: string | null;
    readonly rightsReview: boolean;
    /** Left at the fallback pin: the place is to be checked before it is published (§6.2). */
    readonly checkPlace: boolean;
    /** M13: where it stands in the review queue, and what the reviewer said. */
    readonly reviewStatus: NonNullable<PhotoDoc['reviewStatus']> | null;
    readonly reviewNote: string | null;
    readonly block: PublishBlock | null;
}

/** The row of a stored photo. */
export function photoRow(stored: Stored<PhotoDoc>, checkPlace: boolean): PhotoRow {
    const photo = stored.data;
    return {
        id: stored.id,
        title: photo.title,
        year: nullable(photo.year),
        yearEnd: nullable(photo.yearEnd),
        author: nullable(photo.author),
        thumb: nullable(photo.image?.thumb),
        published: photo.published,
        processing: photo.processing,
        error: nullable(photo.processingError),
        duplicateOf: nullable(photo.duplicateOf),
        rightsReview: photo.rightsReview === true,
        checkPlace,
        reviewStatus: photo.reviewStatus ?? null,
        reviewNote: nullable(photo.reviewNote),
        block: publishBlock(photo, checkPlace),
    };
}

/** What the search narrows the loaded page to: text in a title or the author, and a span of years. */
export interface PhotoSearch {
    readonly text: string;
    readonly yearFrom: number | null;
    readonly yearTo: number | null;
}

export const NO_SEARCH: PhotoSearch = { text: '', yearFrom: null, yearTo: null };

/** Lower case without diacritics, so `bucuresti` finds `București`. */
export function folded(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function textMatches(row: PhotoRow, needle: string): boolean {
    if (needle === '') {
        return true;
    }
    return [row.title.ro, row.title.en ?? '', row.author ?? ''].some((text) => folded(text).includes(needle));
}

/** The photo's `[year, yearEnd]`, or null for an undated photo. */
function spanOf(row: PhotoRow): readonly [number, number] | null {
    return row.year === null ? null : [row.year, row.yearEnd ?? row.year];
}

const atOrAfter = (year: number, from: number | null): boolean => from === null || year >= from;
const atOrBefore = (year: number, to: number | null): boolean => to === null || year <= to;

/** Whether the photo's years meet the searched span; an undated photo matches only an open span. */
function yearsMatch(row: PhotoRow, search: PhotoSearch): boolean {
    if (search.yearFrom === null && search.yearTo === null) {
        return true;
    }
    const span = spanOf(row);
    return span !== null && atOrAfter(span[1], search.yearFrom) && atOrBefore(span[0], search.yearTo);
}

/** The rows the search keeps, in their order. */
export function searchRows(rows: readonly PhotoRow[], search: PhotoSearch): readonly PhotoRow[] {
    const needle = folded(search.text);
    return rows.filter((row) => textMatches(row, needle) && yearsMatch(row, search));
}
