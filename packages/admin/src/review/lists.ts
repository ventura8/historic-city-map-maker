/** The review queue's live lists (M13, `docs/research/M13-roles.md` §8): each one read while the page is open, changes into the store. */
import {
    FIRESTORE_PATHS,
    contributorDocSchema,
    photoDocSchema,
    poiDocSchema,
    roleRequestDocSchema,
    storyDocSchema,
    suggestionDocSchema,
    type Schema,
} from '@hcm/shared';

import { LiveList, type ListState } from '../content/list.js';
import type { ContentQuery, ContentServices, Stored } from '../content/services.js';
import {
    blockedRow,
    photoItem,
    poiItem,
    requestRow,
    storyItem,
    suggestionRow,
    type ReviewBlocked,
    type ReviewItem,
    type ReviewRequest,
    type ReviewSuggestion,
} from './rows.js';

const NEWEST: NonNullable<ContentQuery['orderBy']> = [['updatedAt', 'desc']];
const PENDING: ContentQuery = { where: [['reviewStatus', '==', 'pending']], orderBy: NEWEST };
const OPEN: ContentQuery = { where: [['status', '==', 'pending']], orderBy: NEWEST };
const APPLIED: ContentQuery = { where: [['status', 'in', ['approved', 'adjusted']]], orderBy: NEWEST, limit: 10 };
/** No order: one equality needs no composite index, and the list is short. */
const BLOCKED: ContentQuery = { where: [['blocked', '==', true]] };

export interface ReviewListsPatch {
    readonly photos?: ListState<ReviewItem>;
    readonly places?: ListState<ReviewItem>;
    readonly stories?: ListState<ReviewItem>;
    readonly suggestions?: ListState<ReviewSuggestion>;
    readonly decided?: ListState<ReviewSuggestion>;
    readonly blocked?: ListState<ReviewBlocked>;
    readonly requests?: ListState<ReviewRequest>;
}

export interface ReviewLists {
    show(): void;
    stop(): void;
    retry(): void;
}

type ListServices = Pick<ContentServices, 'store' | 'clock' | 'denied' | 'cityId'>;

/** What a list is besides who reads it. */
interface ListParts<Doc, Item> {
    readonly collection: string;
    readonly schema: Schema<Doc>;
    readonly map: (doc: Stored<Doc>) => Item;
    readonly changed: (list: ListState<Item>) => void;
}

function liveList<Doc, Item>(services: ListServices, parts: ListParts<Doc, Item>): LiveList<Doc, Item> {
    const { store, clock, denied } = services;
    return new LiveList({ store, clock, denied, ...parts });
}

/** One list, as this module drives them whatever they hold. */
type Driven = Pick<LiveList<unknown, unknown>, 'stop' | 'retry'> & { show(query: ContentQuery): void };
type Shown = readonly [Driven, ContentQuery];

function contentLists(services: ListServices, changed: (patch: ReviewListsPatch) => void): Shown[] {
    const city = services.cityId;
    const photos = liveList(services, {
        collection: FIRESTORE_PATHS.photos(city),
        schema: photoDocSchema,
        map: photoItem,
        changed: (list) => {
            changed({ photos: list });
        },
    });
    const places = liveList(services, {
        collection: FIRESTORE_PATHS.pois(city),
        schema: poiDocSchema,
        map: poiItem,
        changed: (list) => {
            changed({ places: list });
        },
    });
    const stories = liveList(services, {
        collection: FIRESTORE_PATHS.stories(city),
        schema: storyDocSchema,
        map: storyItem,
        changed: (list) => {
            changed({ stories: list });
        },
    });
    return [
        [photos, PENDING],
        [places, PENDING],
        [stories, PENDING],
    ];
}

function suggestionLists(services: ListServices, changed: (patch: ReviewListsPatch) => void): Shown[] {
    const parts = { collection: FIRESTORE_PATHS.suggestions(services.cityId), schema: suggestionDocSchema, map: suggestionRow };
    const open = liveList(services, {
        ...parts,
        changed: (list) => {
            changed({ suggestions: list });
        },
    });
    const decided = liveList(services, {
        ...parts,
        changed: (list) => {
            changed({ decided: list });
        },
    });
    return [
        [open, OPEN],
        [decided, APPLIED],
    ];
}

function accountLists(services: ListServices, withRequests: boolean, changed: (patch: ReviewListsPatch) => void): Shown[] {
    const blocked = liveList(services, {
        collection: FIRESTORE_PATHS.contributors(services.cityId),
        schema: contributorDocSchema,
        map: blockedRow,
        changed: (list) => {
            changed({ blocked: list });
        },
    });
    const requests = liveList(services, {
        collection: FIRESTORE_PATHS.roleRequests(services.cityId),
        schema: roleRequestDocSchema,
        map: requestRow,
        changed: (list) => {
            changed({ requests: list });
        },
    });
    return withRequests
        ? [
              [blocked, BLOCKED],
              [requests, OPEN],
          ]
        : [[blocked, BLOCKED]];
}

/** `withRequests`: role requests are the city's owners' only (the rules read the same). */
export function reviewLists(services: ListServices, withRequests: boolean, changed: (patch: ReviewListsPatch) => void): ReviewLists {
    const shows = [
        ...contentLists(services, changed),
        ...suggestionLists(services, changed),
        ...accountLists(services, withRequests, changed),
    ];
    return {
        show: () => {
            for (const [list, query] of shows) {
                list.show(query);
            }
        },
        stop: () => {
            for (const [list] of shows) {
                list.stop();
            }
        },
        retry: () => {
            for (const [list] of shows) {
                list.retry();
            }
        },
    };
}
