/**
 * The editors' assists as their pages read them (`docs/research/M4-interfaces.md` §4.1; CR-M4-4), mirroring
 * `packages/admin/src/assist/assist.ts`: the title suggestions for the open item's place and the translation drafts by
 * slot (`title.en`, `description.ro`). Each editor area's port carries them in its own state, with its own intents.
 */
import type { AdminNoticeInputPort } from '../notice-port.js';

interface TitleSuggestionPort {
    readonly ro: string;
    readonly en?: string | undefined;
}

export interface TitleSuggestionsPort {
    readonly status: 'idle' | 'asking' | 'queued' | 'ready' | 'failed';
    readonly suggestions: readonly TitleSuggestionPort[];
    readonly attribution: string | null;
    readonly error: AdminNoticeInputPort | null;
}

export interface DraftPort {
    readonly status: 'working' | 'done' | 'failed';
    readonly model: string | null;
    readonly truncated: boolean;
    readonly error: AdminNoticeInputPort | null;
}

export interface AssistViewPort {
    readonly titles: TitleSuggestionsPort;
    readonly drafts: Readonly<Record<string, DraftPort>>;
}

/** The fields a draft fills, as the server knows them (`ASSIST_FIELDS`). */
export type AssistFieldPort = 'title' | 'label' | 'dateText' | 'description';

/** What an editor's templates call: its area's assist intents. */
export interface AssistActionsPort {
    /** Suggest a title (the suggestions also come by themselves when a place is set and the title is empty). */
    suggestTitle(): void;
    /** Fills the title with suggestion `index` (and its English name, when OpenStreetMap has one). */
    useTitle(index: number): void;
    /** A draft of the field in `to`, from its other language. */
    draftText(field: AssistFieldPort, to: 'ro' | 'en'): void;
}
