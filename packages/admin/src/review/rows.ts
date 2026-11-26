/** The review queue's rows from its documents (M13, `docs/research/M13-roles.md` §8), pure. */
import {
    contentLocale,
    timestampToDate,
    type ContributorDoc,
    type UiLocale,
    type PhotoDoc,
    type PoiDoc,
    type RoleRequestDoc,
    type StoryDoc,
    type SuggestionDoc,
    type SuggestionProposal,
} from '@hcm/shared';

import type { Stored } from '../content/services.js';
import type { MapPhoto } from '../photos/map.js';

export interface ReviewItem {
    readonly entity: 'photo' | 'poi' | 'story';
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly thumbPath: string | null;
    readonly credit: string | null;
    /** What an approval would publish besides the title and the picture. */
    readonly description: { readonly ro: string; readonly en?: string | undefined } | null;
    readonly links: readonly { readonly url: string; readonly label: string }[];
    /** The document's `updatedAt` as this row read it: `review.decide` refuses an approval of anything newer. */
    readonly seenAt: string;
}

export interface ReviewBlocked {
    readonly uid: string;
    readonly about: string | null;
}

export interface ReviewSuggestion {
    readonly id: string;
    readonly photoId: string;
    readonly title: SuggestionDoc['photoTitle'];
    readonly thumb: string;
    readonly kind: SuggestionDoc['kind'];
    readonly status: SuggestionDoc['status'];
    readonly proposal: SuggestionProposal;
    readonly count: number;
    readonly voices: readonly {
        readonly uid: string;
        readonly reason: string | null;
        readonly sourceUrl: string | null;
        readonly credit: string | null;
    }[];
    readonly decidedBy: string | null;
}

export interface ReviewRequest {
    readonly uid: string;
    readonly role: RoleRequestDoc['role'];
    readonly reason: string;
    readonly credit: string | null;
    readonly name: string;
    readonly email: string;
}

function shownOf(
    data: Pick<PhotoDoc, 'credit' | 'description' | 'links' | 'updatedAt'>,
): Pick<ReviewItem, 'credit' | 'description' | 'links' | 'seenAt'> {
    return {
        credit: data.credit ?? null,
        description: data.description ?? null,
        links: data.links ?? [],
        seenAt: timestampToDate(data.updatedAt).toISOString(),
    };
}

export function photoItem(stored: Stored<PhotoDoc>): ReviewItem {
    const { data, id } = stored;
    return { entity: 'photo', id, title: data.title, thumbPath: data.heldImage?.thumb ?? null, ...shownOf(data) };
}

export function poiItem(stored: Stored<PoiDoc>): ReviewItem {
    const { data, id } = stored;
    return { entity: 'poi', id, title: data.title, thumbPath: null, ...shownOf(data) };
}

/** M17: an uploader's story; what an approval publishes is its title and its text. */
export function storyItem(stored: Stored<StoryDoc>): ReviewItem {
    const { data, id } = stored;
    return { ...shownOf({ ...data, description: data.body }), entity: 'story', id, title: data.title, thumbPath: null };
}

export function suggestionRow(stored: Stored<SuggestionDoc>): ReviewSuggestion {
    const { data, id } = stored;
    return {
        id,
        photoId: data.photoId,
        title: data.photoTitle,
        thumb: data.photoThumb,
        kind: data.kind,
        status: data.status,
        proposal: data.proposal,
        count: data.count,
        voices: data.voices.map((voice) => ({
            uid: voice.uid,
            reason: voice.reason ?? null,
            sourceUrl: voice.sourceUrl ?? null,
            credit: voice.credit ?? null,
        })),
        decidedBy: data.decidedBy ?? null,
    };
}

export function requestRow(stored: Stored<RoleRequestDoc>): ReviewRequest {
    const { data, id } = stored;
    return {
        uid: id,
        role: data.role,
        reason: data.reason,
        credit: data.credit ?? null,
        name: data.displayName ?? '',
        email: data.email ?? '',
    };
}

export function blockedRow(stored: Stored<ContributorDoc>): ReviewBlocked {
    return { uid: stored.id, about: stored.data.blockedFor ?? null };
}

function filled(value: unknown): boolean {
    return value !== undefined && value !== '';
}

/** The reviewer's values with one more edit: an emptied field is absent, and a date text says the language it was typed in. */
export function adjustedWith(adjusted: SuggestionProposal, patch: SuggestionProposal, locale: UiLocale): SuggestionProposal {
    const typed = patch.dateText === undefined ? {} : { dateLocale: contentLocale(locale) };
    const merged: SuggestionProposal = { ...adjusted, ...patch, ...typed };
    const hasText = filled(merged.dateText);
    return Object.fromEntries(Object.entries(merged).filter(([key, value]) => filled(value) && (key !== 'dateLocale' || hasText)));
}

/** Adjusted to nothing new is the proposal itself: the record says what happened. */
export function decisionOf<D extends 'approve' | 'adjust' | 'reject'>(
    asked: D,
    adjusted: SuggestionProposal | null,
    row: ReviewSuggestion | undefined,
): D | 'approve' {
    const same = row !== undefined && JSON.stringify(adjusted ?? {}) === JSON.stringify(row.proposal);
    return asked === 'adjust' && same ? 'approve' : asked;
}

/** What the photo says now, in a proposal's words. */
export function currentOf(photo: PhotoDoc): SuggestionProposal {
    const { location, bearing, year, yearEnd, dateText } = photo;
    const fields = { location, bearing, year, yearEnd, dateText: dateText?.ro };
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function currentMarker(id: string, current: SuggestionProposal | null): readonly MapPhoto[] {
    if (current?.location === undefined) {
        return [];
    }
    return [{ id, title: '', year: current.year ?? null, location: current.location, bearing: current.bearing ?? null, fov: null }];
}
