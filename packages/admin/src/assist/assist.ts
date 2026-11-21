/**
 * The editors' assists (`docs/research/M4-interfaces.md` §4.1; CR-M4-4): **title suggestions** for the place a photo or
 * a point shows (`assist.suggestTitle`: a cached cell answers at once, else the editor listens to the cell until the
 * server's one-a-second queue answers it) and **translation drafts** between Romanian and English (`assist.translateDraft`,
 * Vertex AI Gemini on the server). A draft and a chosen suggestion go into the editor's own draft through `apply`, never
 * further: only the admin's Save writes, so nothing an assist proposes is published on its own; an answer that comes after
 * another item opened is dropped. A queued cell no answer reaches within `GEOCODE_QUEUED_MINUTES` (its task lost) ends
 * the wait with `apiError.assist.unavailable`, and Suggest a title queues it anew. Every text is plain text (the server
 * sanitized it; the pages render it as text). DOM-free: each editor area holds one session for its open item.
 */
import {
    FIRESTORE_PATHS,
    GEOCODE_QUEUED_MINUTES,
    geocodeCellDocSchema,
    type AssistField,
    type CallableResponse,
    type Locale,
    type TitleSuggestion,
} from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { Clock, Unsubscribe } from '../app/ports.js';
import type { ContentStore } from '../content/services.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';

type TitleStatus = 'idle' | 'asking' | 'queued' | 'ready' | 'failed';

export interface TitleSuggestionsState {
    readonly status: TitleStatus;
    readonly suggestions: readonly TitleSuggestion[];
    /** OpenStreetMap's licence line, shown with the suggestions. */
    readonly attribution: string | null;
    readonly error: NoticeInput | null;
}

export interface DraftState {
    readonly status: 'working' | 'done' | 'failed';
    /** The model that wrote the draft (the note names it). */
    readonly model: string | null;
    /** The draft was shortened to fit the field. */
    readonly truncated: boolean;
    readonly error: NoticeInput | null;
}

export interface AssistState {
    readonly titles: TitleSuggestionsState;
    /** By slot: the field and the language the draft fills (`title.en`, `description.ro`). */
    readonly drafts: Readonly<Record<string, DraftState>>;
}

const NO_TITLES: TitleSuggestionsState = { status: 'idle', suggestions: [], attribution: null, error: null };

export const NO_ASSIST: AssistState = { titles: NO_TITLES, drafts: {} };

export interface DraftRequest {
    readonly field: AssistField;
    readonly from: Locale;
    readonly to: Locale;
    readonly text: string;
}

/** The slot a draft request fills. */
export function draftSlot(field: string, to: Locale): string {
    return `${field}.${to}`;
}

export interface AssistDeps {
    readonly callables: CallablesPort;
    readonly store: ContentStore;
    readonly cityId: string;
    /** The wait for a queued cell's answer ends after `GEOCODE_QUEUED_MINUTES`. */
    readonly clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>;
    readonly changed: (state: AssistState) => void;
}

/** How long an editor listens to a queued cell: as long as the server counts it queued, so asking again queues it anew. */
export const QUEUED_WAIT_MS = GEOCODE_QUEUED_MINUTES * 60_000;

type Answer = CallableResponse<'assist.suggestTitle'>;

/** The suggestions' state of an answer (a cell ready, refused or failed). */
export function titlesOf(answer: Pick<Answer, 'state' | 'suggestions' | 'attribution' | 'error'>): TitleSuggestionsState {
    if (answer.state === 'queued') {
        return { ...NO_TITLES, status: 'queued' };
    }
    const error = answer.error === undefined ? null : { key: answer.error };
    return { status: answer.state, suggestions: answer.suggestions, attribution: answer.attribution, error };
}

export class AssistSession {
    readonly #deps: AssistDeps;
    #state: AssistState = NO_ASSIST;
    #watch: Unsubscribe | null = null;
    /** Each title request's number: a cell or an answer of an older request never replaces a newer one. */
    #request = 0;
    /** The open item's number (`reset` counts it up): a draft asked for another item never lands in this one. */
    #item = 0;

    constructor(deps: AssistDeps) {
        this.#deps = deps;
    }

    get state(): AssistState {
        return this.#state;
    }

    /** Asks for titles for `location` (the place just set, or Suggest a title). */
    async suggestTitles(location: { readonly lat: number; readonly lng: number }): Promise<void> {
        this.#stopWatch();
        this.#request += 1;
        const request = this.#request;
        this.#setTitles({ ...NO_TITLES, status: 'asking' });
        const outcome = await outcomeOf(() => this.#deps.callables.call('assist.suggestTitle', { cityId: this.#deps.cityId, location }));
        if (request !== this.#request) {
            return;
        }
        if (!outcome.ok) {
            this.#setTitles({ ...NO_TITLES, status: 'failed', error: outcome.error });
            return;
        }
        this.#setTitles(titlesOf(outcome.value));
        if (outcome.value.state === 'queued') {
            this.#listen(outcome.value.key, request);
        }
    }

    /**
     * A draft of `request` for the slot it fills; `apply` puts it into the editor's draft. An answer that comes after
     * another item opened (`reset`) is dropped, state and text alike: it was asked for the item the admin left.
     */
    async draft(request: DraftRequest, apply: (text: string) => void): Promise<void> {
        const slot = draftSlot(request.field, request.to);
        const item = this.#item;
        this.#setDraft(slot, { status: 'working', model: null, truncated: false, error: null });
        const outcome = await outcomeOf(() =>
            this.#deps.callables.call('assist.translateDraft', { cityId: this.#deps.cityId, ...request }),
        );
        if (item !== this.#item) {
            return;
        }
        if (!outcome.ok) {
            this.#setDraft(slot, { status: 'failed', model: null, truncated: false, error: outcome.error });
            return;
        }
        apply(outcome.value.draft);
        this.#setDraft(slot, { status: 'done', model: outcome.value.model, truncated: outcome.value.truncated, error: null });
    }

    /** Another item opened (or the editor closed): nothing of the last one stays. */
    reset(): void {
        this.#stopWatch();
        this.#request += 1;
        this.#item += 1;
        this.#set(NO_ASSIST);
    }

    /**
     * Listens to the cell until the queue answers it (a cell answered by then stops the listener at once), a lost
     * listener says so, and so does a wait past `QUEUED_WAIT_MS`.
     */
    #listen(key: string, request: number): void {
        // The listener may settle before `watchDoc` returns: the flag says so then (an object, set from the callbacks).
        const listening = { settled: false };
        const stop = this.#deps.store.watchDoc(
            FIRESTORE_PATHS.geocodeCell(key),
            geocodeCellDocSchema,
            (cell) => {
                if (cell !== null && cell.data.state !== 'queued' && request === this.#request) {
                    listening.settled = true;
                    this.#stopWatch();
                    this.#setTitles(titlesOf(cell.data));
                }
            },
            () => {
                listening.settled = true;
                this.#stopWatch();
                this.#setTitles({ ...NO_TITLES, status: 'failed', error: { key: 'apiError.assist.unavailable' } });
            },
        );
        if (listening.settled) {
            stop();
            return;
        }
        const { clock } = this.#deps;
        const timer = clock.setTimeout(() => {
            this.#stopWatch();
            this.#setTitles({ ...NO_TITLES, status: 'failed', error: { key: 'apiError.assist.unavailable' } });
        }, QUEUED_WAIT_MS);
        this.#watch = () => {
            clock.clearTimeout(timer);
            stop();
        };
    }

    #stopWatch(): void {
        this.#watch?.();
        this.#watch = null;
    }

    #setTitles(titles: TitleSuggestionsState): void {
        this.#set({ ...this.#state, titles });
    }

    #setDraft(slot: string, draft: DraftState): void {
        this.#set({ ...this.#state, drafts: { ...this.#state.drafts, [slot]: draft } });
    }

    #set(state: AssistState): void {
        this.#state = state;
        this.#deps.changed(state);
    }
}
