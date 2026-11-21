/**
 * The assists of one editor (`docs/research/M4-interfaces.md` §4.1; CR-M4-4), the same for the photo, place and layer
 * editors over the open item's draft: a place set while nobody chose the title yet (empty, or, for a photo, still its
 * file's name: `untitled`) asks for title suggestions on its own (Suggest a title asks any time); a suggestion fills the
 * title (and its English one, when OpenStreetMap has it); a draft fills the other language of a text. Every change goes
 * through the editor's own draft (`fill`), so it is published only by the admin's Save; another item opened forgets it
 * all (`reset`), and an answer still on its way then lands nowhere.
 */
import type { AssistField, Locale } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import { AssistSession, type AssistState } from './assist.js';

/** A Romanian and English text as the editors hold them (English optional). */
export interface AssistedText {
    readonly ro: string;
    readonly en?: string | undefined;
}

export interface AssistIntents {
    suggestTitle(): void;
    useTitle(index: number): void;
    draftText(field: string, to: Locale): void;
}

export interface EditorAssistsDeps {
    readonly services: Pick<ContentServices, 'callables' | 'store' | 'cityId' | 'clock'>;
    /** The texts this editor drafts. */
    readonly fields: readonly AssistField[];
    /** The open item's text of `field` (undefined: none open, or no text). */
    readonly text: (field: AssistField) => AssistedText | undefined;
    /** Writes `field`'s text into the editor's draft. */
    readonly fill: (field: AssistField, text: AssistedText) => void;
    /** The open item's place, for Suggest a title (null: none, or no place yet). */
    readonly place: () => { readonly lat: number; readonly lng: number } | null;
    /** Nobody chose the open item's title yet (default: its Romanian title is empty). */
    readonly untitled?: (title: AssistedText | undefined) => boolean;
    readonly changed: (state: AssistState) => void;
}

/** `text` with one language replaced (the other language kept). */
export function withDraft(text: AssistedText | undefined, to: Locale, draft: string): AssistedText {
    const current = text ?? { ro: '' };
    return to === 'ro' ? { ...current, ro: draft } : { ...current, en: draft };
}

/** A title nobody typed: its Romanian text is empty. */
function emptyTitle(title: AssistedText | undefined): boolean {
    return title?.ro.trim() === '';
}

/** The language a draft is made from. */
function sourceOf(to: Locale): Locale {
    return to === 'en' ? 'ro' : 'en';
}

export class EditorAssists {
    readonly #deps: EditorAssistsDeps;
    readonly #session: AssistSession;
    readonly intents: AssistIntents;

    constructor(deps: EditorAssistsDeps) {
        this.#deps = deps;
        this.#session = new AssistSession({ ...deps.services, changed: deps.changed });
        this.intents = {
            suggestTitle: () => {
                this.#suggest(deps.place());
            },
            useTitle: (index) => {
                this.#useTitle(index);
            },
            draftText: (field, to) => {
                void this.#draft(field, to);
            },
        };
    }

    get state(): AssistState {
        return this.#session.state;
    }

    /** A place was set on the map: while nobody chose the title, the suggestions come by themselves. */
    placeSet(location: { readonly lat: number; readonly lng: number }): void {
        if ((this.#deps.untitled ?? emptyTitle)(this.#deps.text('title'))) {
            this.#suggest(location);
        }
    }

    /** Another item opened, or none: nothing of the last one stays. */
    reset(): void {
        this.#session.reset();
    }

    #suggest(location: { readonly lat: number; readonly lng: number } | null): void {
        if (location !== null) {
            void this.#session.suggestTitles(location);
        }
    }

    #useTitle(index: number): void {
        const current = this.#deps.text('title');
        const suggestion = this.#session.state.titles.suggestions[index];
        if (current === undefined || suggestion === undefined) {
            return;
        }
        const en = suggestion.en ?? current.en;
        this.#deps.fill('title', en === undefined ? { ro: suggestion.ro } : { ro: suggestion.ro, en });
    }

    /** The field `name` of this editor and its text in the language a draft to `to` is made from (null: nothing to draft). */
    #source(name: string, to: Locale): { readonly field: AssistField; readonly text: string } | null {
        const field = this.#deps.fields.find((candidate) => candidate === name);
        if (field === undefined) {
            return null;
        }
        const text = this.#deps.text(field)?.[sourceOf(to)] ?? '';
        return text.trim() === '' ? null : { field, text };
    }

    async #draft(name: string, to: Locale): Promise<void> {
        const source = this.#source(name, to);
        if (source === null) {
            return;
        }
        const { field, text } = source;
        await this.#session.draft({ field, from: sourceOf(to), to, text }, (draft) => {
            this.#deps.fill(field, withDraft(this.#deps.text(field), to, draft));
        });
    }
}
