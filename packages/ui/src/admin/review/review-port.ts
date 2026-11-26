/** The review page as it reads its store (M13, `docs/research/M13-roles.md` §8), mirroring `packages/admin/src/review/`. */
import type { RequestableRole, SuggestionKind, SuggestionProposal, SuggestionStatus } from '@hcm/shared';

import type { ListStatePort } from '../area-port.js';
import type { AdminOutcomePort } from '../notice-port.js';
import type { MapStatusPort } from '../pois/pois-port.js';

/** A photo or a place an uploader added. */
export interface ReviewItemPort {
    readonly entity: 'photo' | 'poi' | 'story';
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    /** The private path of a held picture, read with the admin's credentials. */
    readonly thumbPath: string | null;
    readonly credit: string | null;
    /** What an approval would publish besides the title and the picture. */
    readonly description: { readonly ro: string; readonly en?: string | undefined } | null;
    readonly links: readonly { readonly url: string; readonly label: string }[];
    readonly seenAt: string;
}

export interface ReviewBlockedPort {
    readonly uid: string;
    readonly about: string | null;
}

interface ReviewVoicePort {
    readonly uid: string;
    readonly reason: string | null;
    readonly sourceUrl: string | null;
    readonly credit: string | null;
}

export interface ReviewSuggestionPort {
    readonly id: string;
    readonly photoId: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly thumb: string;
    readonly kind: SuggestionKind;
    readonly status: SuggestionStatus;
    readonly proposal: SuggestionProposal;
    readonly count: number;
    readonly voices: readonly ReviewVoicePort[];
    readonly decidedBy: string | null;
}

export interface ReviewRequestPort {
    readonly uid: string;
    readonly role: RequestableRole;
    readonly reason: string;
    readonly credit: string | null;
    readonly name: string;
    readonly email: string;
}

export interface ReviewViewState {
    readonly photos: ListStatePort<ReviewItemPort>;
    readonly places: ListStatePort<ReviewItemPort>;
    readonly stories: ListStatePort<ReviewItemPort>;
    readonly suggestions: ListStatePort<ReviewSuggestionPort>;
    readonly decided: ListStatePort<ReviewSuggestionPort>;
    readonly requests: ListStatePort<ReviewRequestPort> | null;
    readonly blocked: ListStatePort<ReviewBlockedPort>;
    /** The account the reviewer asked to block, until they confirm or cancel. */
    readonly confirmBlock: { readonly uid: string; readonly about: string | null } | null;
    /** Each held picture's `blob:` address, by its path. */
    readonly pictures: Readonly<Record<string, string>>;
    /** The suggestion on the map, what the photo says now, and the reviewer's own values while adjusting. */
    readonly selected: string | null;
    readonly current: SuggestionProposal | null;
    readonly adjusted: SuggestionProposal | null;
    readonly map: MapStatusPort | 'unavailable';
    readonly busy: boolean;
}

export interface ReviewIntentsPort {
    retry(): void;
    decideItem(item: ReviewItemPort, decision: 'approve' | 'refuse', note: string): Promise<AdminOutcomePort<unknown>>;
    select(suggestionId: string): void;
    startAdjusting(): void;
    /** The reviewer's own value of a field; an emptied one is absent. */
    editAdjusted(patch: SuggestionProposal): void;
    decideSuggestion(id: string, decision: 'approve' | 'adjust' | 'reject', note: string): Promise<AdminOutcomePort<unknown>>;
    askBlock(uid: string, about: string | null): void;
    cancelBlock(): void;
    confirmBlock(): Promise<void>;
    unblock(uid: string): Promise<AdminOutcomePort<unknown>>;
    revert(suggestion: ReviewSuggestionPort): Promise<AdminOutcomePort<unknown>>;
    decideRequest(uid: string, decision: 'approve' | 'refuse', note: string): Promise<AdminOutcomePort<unknown>>;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
}
