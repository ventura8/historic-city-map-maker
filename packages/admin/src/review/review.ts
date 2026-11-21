/**
 * The review queue's store (M13, `docs/research/M13-roles.md` §§2 to 4, §8; behaviours A90, A92, A93): what uploaders added,
 * the public's suggestions and, for the city's owners, requests for a role, each live; approve, adjust, reject, refuse, block
 * and one-click revert through the callables. The rules let the reviewers read these and the server alone write them.
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    photoDocSchema,
    bboxFromRecord,
    bboxCenter,
    type CallableRequest,
    type CallableResponse,
    type BBox,
    type SuggestionProposal,
} from '@hcm/shared';

import { outcomeOf, type Outcome } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import { PhotoMapSession, type MapStatus } from '../photos/map.js';
import { Store } from '../state/store.js';
import { reviewLists, type ReviewLists } from './lists.js';
import {
    adjustedWith,
    decisionOf,
    currentMarker,
    currentOf,
    type ReviewBlocked,
    type ReviewItem,
    type ReviewRequest,
    type ReviewSuggestion,
} from './rows.js';

export interface ReviewState {
    readonly photos: ListState<ReviewItem>;
    readonly places: ListState<ReviewItem>;
    /** M17: the uploaders' stories waiting. */
    readonly stories: ListState<ReviewItem>;
    readonly suggestions: ListState<ReviewSuggestion>;
    readonly decided: ListState<ReviewSuggestion>;
    readonly requests: ListState<ReviewRequest> | null;
    readonly blocked: ListState<ReviewBlocked>;
    /** The account the reviewer asked to block, until they confirm or cancel. */
    readonly confirmBlock: { readonly uid: string; readonly about: string | null } | null;
    readonly pictures: Readonly<Record<string, string>>;
    readonly selected: string | null;
    readonly current: SuggestionProposal | null;
    readonly adjusted: SuggestionProposal | null;
    readonly map: MapStatus;
    readonly busy: boolean;
}

export interface ReviewIntents {
    retry(): void;
    decideItem(item: ReviewItem, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>>;
    select(suggestionId: string): void;
    startAdjusting(): void;
    /** The reviewer's own value of a field; an emptied one is absent. */
    editAdjusted(patch: SuggestionProposal): void;
    decideSuggestion(id: string, decision: 'approve' | 'adjust' | 'reject', note: string): Promise<Outcome<unknown>>;
    askBlock(uid: string, about: string | null): void;
    cancelBlock(): void;
    confirmBlock(): Promise<void>;
    unblock(uid: string): Promise<Outcome<unknown>>;
    revert(suggestion: ReviewSuggestion): Promise<Outcome<unknown>>;
    decideRequest(uid: string, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>>;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
}

const ZOOM = 14;

class ReviewStore implements AreaStore<ReviewState, ReviewIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<ReviewState>;
    readonly #lists: ReviewLists;
    #map: PhotoMapSession | null = null;
    #stopPhoto: (() => void) | null = null;
    #stopCity: (() => void) | null = null;
    #bounds: BBox | null = null;
    #container: HTMLElement | null = null;
    readonly intents: ReviewIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<ReviewState>(
            {
                photos: LOADING_LIST,
                places: LOADING_LIST,
                stories: LOADING_LIST,
                suggestions: LOADING_LIST,
                decided: LOADING_LIST,
                requests: services.cityRole() === 'owner' ? LOADING_LIST : null,
                blocked: LOADING_LIST,
                confirmBlock: null,
                pictures: {},
                selected: null,
                current: null,
                adjusted: null,
                map: 'none',
                busy: false,
            },
            services.log,
        );
        this.#lists = reviewLists(services, services.cityRole() === 'owner', (patch) => {
            this.#cell.update(patch);
            if (patch.photos !== undefined) {
                void this.#readPictures(patch.photos.items);
            }
        });
        this.intents = this.#makeIntents();
    }

    #makeIntents(): ReviewIntents {
        return {
            retry: () => {
                this.#lists.retry();
            },
            decideItem: (item, decision, note) => this.#decideItem(item, decision, note),
            select: (id) => {
                this.#select(id);
            },
            startAdjusting: () => {
                this.#startAdjusting();
            },
            editAdjusted: (patch) => {
                this.#editAdjusted(patch);
            },
            decideSuggestion: (id, decision, note) => this.#decideSuggestion(id, decision, note),
            askBlock: (uid, about) => {
                this.#cell.update({ confirmBlock: { uid, about } });
            },
            cancelBlock: () => {
                this.#cell.update({ confirmBlock: null });
            },
            confirmBlock: () => this.#block(),
            unblock: (uid) =>
                this.#call(
                    'contributors.setBlocked',
                    { cityId: this.#services.cityId, uid, blocked: false },
                    'adminContent.review.unblocked',
                ),
            revert: (suggestion) => this.#revert(suggestion),
            decideRequest: (uid, decision, note) => this.#decideRequest(uid, decision, note),
            attachMap: (container) => {
                this.#container = container;
                this.#attach();
            },
            zoomBy: (delta) => {
                this.#map?.zoomBy(delta);
            },
        };
    }

    get state(): ReviewState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ReviewState) => void) {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        this.#lists.show();
        this.#stopCity = this.#services.store.watchDoc(
            FIRESTORE_PATHS.city(this.#services.cityId),
            cityDocSchema,
            (doc) => {
                this.#bounds = doc === null ? null : bboxFromRecord(doc.data.bounds);
                this.#attach();
            },
            () => undefined,
        );
    }

    close(): void {
        this.#lists.stop();
        this.#stopPhoto?.();
        this.#stopPhoto = null;
        this.#stopCity?.();
        this.#stopCity = null;
        this.#map?.detach();
        this.#map = null;
        this.#container = null;
        this.#cell.update({ map: 'none', selected: null, current: null, adjusted: null });
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        for (const url of Object.values(this.#cell.state.pictures)) {
            this.#services.files?.release(url);
        }
    }

    /** A held picture has no public address: its bytes come through the Storage rules, as a `blob:` address. */
    async #readPictures(items: readonly ReviewItem[]): Promise<void> {
        const paths = items.flatMap((item) => (item.thumbPath === null ? [] : [item.thumbPath]));
        for (const path of paths.filter((held) => this.#cell.state.pictures[held] === undefined)) {
            await this.#readPicture(path);
        }
    }

    async #readPicture(path: string): Promise<void> {
        const url = await this.#services.files?.url(path);
        if (url !== null && url !== undefined) {
            this.#cell.update({ pictures: { ...this.#cell.state.pictures, [path]: url } });
        }
    }

    async #call<N extends 'review.decide' | 'suggestions.decide' | 'contributors.setBlocked' | 'contribute.decide'>(
        name: N,
        request: CallableRequest<N>,
        done: 'adminContent.review.done' | 'adminContent.review.blocked' | 'adminContent.review.unblocked' | 'adminContent.review.reverted',
    ): Promise<Outcome<CallableResponse<N>>> {
        this.#cell.update({ busy: true });
        const outcome = await outcomeOf(() => this.#services.callables.call(name, request));
        this.#cell.update({ busy: false });
        this.#services.notify(outcome.ok ? { key: done } : outcome.error);
        return outcome;
    }

    #decideItem(item: ReviewItem, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>> {
        const seen = decision === 'approve' ? { seenAt: item.seenAt } : {};
        const request = { cityId: this.#services.cityId, entity: item.entity, id: item.id, decision, ...seen, ...this.#noted(note) };
        return this.#call('review.decide', request, 'adminContent.review.done');
    }

    #noted(note: string): { readonly note?: string } {
        return note.trim() === '' ? {} : { note: note.trim() };
    }

    #decideRequest(uid: string, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>> {
        return this.#call(
            'contribute.decide',
            { cityId: this.#services.cityId, uid, decision, ...this.#noted(note) },
            'adminContent.review.done',
        );
    }

    #decideSuggestion(id: string, asked: 'approve' | 'adjust' | 'reject', note: string): Promise<Outcome<unknown>> {
        const { adjusted, suggestions } = this.#cell.state;
        const decision = decisionOf(
            asked,
            adjusted,
            suggestions.items.find((item) => item.id === id),
        );
        const request = {
            cityId: this.#services.cityId,
            suggestionId: id,
            decision,
            ...(decision === 'adjust' ? { adjusted: adjusted ?? {} } : {}),
            ...this.#noted(note),
        };
        return this.#call('suggestions.decide', request, 'adminContent.review.done');
    }

    async #block(): Promise<void> {
        const asked = this.#cell.state.confirmBlock;
        this.#cell.update({ confirmBlock: null });
        if (asked !== null) {
            const about = asked.about === null ? {} : { about: asked.about };
            const request = { cityId: this.#services.cityId, uid: asked.uid, blocked: true, ...about };
            await this.#call('contributors.setBlocked', request, 'adminContent.review.blocked');
        }
    }

    /** That decision taken off and no other; the server refuses when someone changed the same fields since. */
    #revert(suggestion: ReviewSuggestion): Promise<Outcome<unknown>> {
        const request = { cityId: this.#services.cityId, suggestionId: suggestion.id, decision: 'revert' } as const;
        return this.#call('suggestions.decide', request, 'adminContent.review.reverted');
    }

    #selectedRow(): ReviewSuggestion | undefined {
        const { suggestions, selected } = this.#cell.state;
        return suggestions.items.find((row) => row.id === selected);
    }

    /** The map shows the photo as it is and the proposal side by side: a marker, and the pin. */
    #select(id: string): void {
        this.#cell.update({ selected: id, adjusted: null, current: null });
        this.#stopPhoto?.();
        const row = this.#selectedRow();
        if (row === undefined) {
            return;
        }
        this.#stopPhoto = this.#services.store.watchDoc(
            FIRESTORE_PATHS.photo(this.#services.cityId, row.photoId),
            photoDocSchema,
            (doc) => {
                this.#cell.update({ current: doc === null ? null : currentOf(doc.data) });
                this.#draw();
            },
            () => undefined,
        );
    }

    #draw(): void {
        const { current, selected } = this.#cell.state;
        this.#map?.show(currentMarker(selected ?? 'current', current));
        void this.#map?.editPin(this.#proposedPlace());
    }

    #proposedPlace(): NonNullable<SuggestionProposal['location']> | null {
        return this.#cell.state.adjusted?.location ?? this.#selectedRow()?.proposal.location ?? null;
    }

    #startAdjusting(): void {
        this.#cell.update({ adjusted: this.#selectedRow()?.proposal ?? {} });
    }

    #adjustedNow(): SuggestionProposal {
        return this.#cell.state.adjusted ?? this.#selectedRow()?.proposal ?? {};
    }

    #editAdjusted(patch: SuggestionProposal): void {
        this.#cell.update({ adjusted: adjustedWith(this.#adjustedNow(), patch, this.#services.locale()) });
        if (patch.location !== undefined) {
            void this.#map?.editPin(patch.location);
        }
    }

    /** One map per page visit, once the city and the box are both there. */
    #attach(): void {
        const bounds = this.#bounds;
        const container = this.#container;
        if (bounds === null || container === null || this.#map !== null) {
            return;
        }
        this.#map = new PhotoMapSession(this.#services.maps ?? null, {
            status: (map) => {
                this.#mapStatus(map);
            },
            select: () => undefined,
            pin: (position) => {
                this.#moved({ lat: position[1], lng: position[0] });
            },
            refused: () => {
                this.#services.notify({ key: 'apiError.suggestion.outsideCity' });
            },
        });
        const view = { center: bboxCenter(bounds), zoom: ZOOM, bearing: 0 };
        void this.#map.attach(container, { bounds, view, locale: this.#services.locale() });
    }

    #mapStatus(map: MapStatus): void {
        this.#cell.update({ map });
        if (map === 'ready') {
            this.#draw();
        }
    }

    /** The pin moved: the reviewer is adjusting. */
    #moved(location: NonNullable<SuggestionProposal['location']>): void {
        this.#cell.update({ adjusted: { ...this.#adjustedNow(), location } });
    }
}

export const REVIEW_MODULE: AreaModule<ReviewState, ReviewIntents> = {
    area: 'review',
    create: (services) => new ReviewStore(services),
};
