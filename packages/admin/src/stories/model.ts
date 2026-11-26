/**
 * The stories area's state and its pure parts (M17, `docs/research/M17-stories.md` §6): a list row of a story, a pick of the
 * photo and place pickers, the list's query, a new story's first fields and the editor's checks beyond the schema.
 */
import type { CityRole, PhotoDoc, PoiDoc, StoryDoc, ValidationIssue } from '@hcm/shared';

import type { DocState } from '../content/doc.js';
import type { ListState } from '../content/list.js';
import type { ContentQuery, Stored, WriteOutcome } from '../content/services.js';
import type { DraftState } from '../layers/draft.js';

interface Text {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** One story in the list. */
export interface StoryItem {
    readonly id: string;
    readonly title: Text;
    readonly yearStart: number | null;
    readonly yearEnd: number | null;
    readonly published: boolean;
    /** M13: `pending` or `refused` while it is not cleared; null once approved or staff's. */
    readonly review: 'pending' | 'refused' | null;
}

/** A photo or a place the editor can link, by its title. */
export interface StoryPick {
    readonly id: string;
    readonly title: Text;
}

/** The story the page has open: its document and its draft. */
interface OpenStory {
    readonly id: string;
    readonly doc: DocState<StoryDoc>;
    readonly draft: DraftState<StoryDoc>;
}

export interface StoriesState {
    readonly list: ListState<StoryItem>;
    readonly open: OpenStory | null;
    /** The city's photos and places for the pickers, read once when the editor first asks (null until then). */
    readonly picks: { readonly photos: readonly StoryPick[]; readonly places: readonly StoryPick[] } | null;
    /** A moderator, an editor or an owner: Published shows (an uploader's story waits for review instead). */
    readonly reviewer: boolean;
    /** The city role (null for staff without one): what New story, Delete and Versions show for (the rules' matrix, M17 §6). */
    readonly role: CityRole | null;
    readonly busy: boolean;
}

export interface StoriesIntents {
    /** Creates an unpublished story (pending for an uploader) titled `title` in Romanian; its id, or null when refused. */
    create(title: string): Promise<string | null>;
    edit(patch: Partial<StoryDoc>): void;
    save(): Promise<WriteOutcome | null>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    remove(): Promise<WriteOutcome | null>;
    more(): void;
    retry(): void;
    loadPicks(): void;
}

/** The fields the editor changes (`CLIENT_WRITES.story.update` without the stamp). */
export const STORY_EDITABLE = ['title', 'body', 'yearStart', 'yearEnd', 'photoIds', 'poiIds', 'credit', 'published'] as const;

export function storyItemOf(stored: Stored<StoryDoc>): StoryItem {
    const { id, data } = stored;
    const status = data.reviewStatus;
    return {
        id,
        title: data.title,
        yearStart: data.yearStart ?? null,
        yearEnd: data.yearEnd ?? null,
        published: data.published,
        review: status === 'pending' || status === 'refused' ? status : null,
    };
}

export function pickOf(stored: Stored<PhotoDoc | PoiDoc>): StoryPick {
    return { id: stored.id, title: stored.data.title };
}

/** Newest first; an uploader reads their own stories only (the rules ask the query to say so). */
export function storiesQuery(ownerOnly: string | null): ContentQuery {
    return ownerOnly === null ? { orderBy: [['updatedAt', 'desc']] } : { where: [['createdBy', '==', ownerOnly]] };
}

/** A new story's first fields: unpublished, and for an uploader waiting for review (`firestore.rules`). */
export function newStory(title: string, uploader: boolean): Readonly<Record<string, unknown>> {
    const fields = { title: { ro: title.trim() }, published: false };
    return uploader ? { ...fields, reviewStatus: 'pending' } : fields;
}

/** A published story needs its text (the builder would leave it out); a waiting one is not the editor's to publish. */
export function storyIssues(story: StoryDoc): readonly ValidationIssue[] {
    return story.published && story.body === undefined ? [{ path: 'body.ro', code: 'validation.required' }] : [];
}
