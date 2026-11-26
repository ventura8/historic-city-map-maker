/**
 * Settings → Wikipedia (`docs/research/M31-wikipedia.md` §3; S-A-WIKI-*): the public map's Wikipedia overlay for this city, through
 * `wikipedia.manage`. Opening the section reads the settings and the last fetch's articles; the editor switches the overlay
 * on or off, picks the languages, hides or shows single articles, and saves (the manifest is rebuilt); **Refresh now** asks
 * for a new fetch at that build. A refusal or a failed call shows beside the card; nothing changes then.
 */
import type { WikipediaLanguage, WikipediaManageRequest, WikipediaManageResponse, WikipediaSettings } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';

export interface WikipediaSectionState {
    /** The last answer of `wikipedia.manage`, null before the first. */
    readonly data: WikipediaManageResponse | null;
    /** The settings as edited (equal to `data.settings` until a change). */
    readonly draft: WikipediaSettings | null;
    readonly busy: boolean;
    readonly error: NoticeInput | null;
}

export const NO_WIKIPEDIA_SECTION: WikipediaSectionState = { data: null, draft: null, busy: false, error: null };

export interface WikipediaIntents {
    /** Reads the settings and articles (the section opened). */
    loadWikipedia(): Promise<void>;
    setWikipediaEnabled(enabled: boolean): void;
    /** Adds or removes a language; the last one stays. */
    setWikipediaLanguage(language: WikipediaLanguage, on: boolean): void;
    setWikipediaHidden(articleId: string, hidden: boolean): void;
    saveWikipedia(): Promise<boolean>;
    refreshWikipedia(): Promise<boolean>;
}

/** Whether the draft differs from what was saved. */
export function wikipediaDirty(state: WikipediaSectionState): boolean {
    return state.data !== null && state.draft !== null && JSON.stringify(state.draft) !== JSON.stringify(state.data.settings);
}

function withLanguage(settings: WikipediaSettings, language: WikipediaLanguage, on: boolean): WikipediaSettings {
    const languages = on ? [...new Set([...settings.languages, language])] : settings.languages.filter((each) => each !== language);
    return languages.length === 0 ? settings : { ...settings, languages };
}

function withHidden(settings: WikipediaSettings, articleId: string, hidden: boolean): WikipediaSettings {
    const others = settings.hidden.filter((id) => id !== articleId);
    return { ...settings, hidden: hidden ? [...others, articleId] : others };
}

/** The callable's request: Save sends the draft (none yet: a read), the others their action. */
function requestOf(cityId: string, action: 'get' | 'refresh' | 'save', draft: WikipediaSettings | null): WikipediaManageRequest {
    if (action === 'save' && draft !== null) {
        return { cityId, action: 'save', settings: draft };
    }
    return { cityId, action: action === 'refresh' ? 'refresh' : 'get' };
}

/**
 * The card's intents; `get` reads the section's state and `set` receives each new one (the store keeps it, and sets
 * `NO_WIKIPEDIA_SECTION` when the section is left).
 */
export function wikipediaIntents(
    services: ContentServices,
    get: () => WikipediaSectionState,
    set: (state: WikipediaSectionState) => void,
): WikipediaIntents {
    const edit = (change: (settings: WikipediaSettings) => WikipediaSettings): void => {
        const state = get();
        if (state.draft !== null) {
            set({ ...state, draft: change(state.draft) });
        }
    };
    const send = async (action: 'get' | 'refresh' | 'save', notice?: 'saved' | 'refreshAsked'): Promise<boolean> => {
        const state = get();
        set({ ...state, busy: true, error: null });
        const request = requestOf(services.cityId, action, state.draft);
        const outcome = await outcomeOf(() => services.callables.call('wikipedia.manage', request));
        if (!outcome.ok) {
            set({ ...get(), busy: false, error: outcome.error });
            return false;
        }
        set({ data: outcome.value, draft: outcome.value.settings, busy: false, error: null });
        if (notice !== undefined) {
            services.notify({ key: `adminContent.settings.wikipedia.${notice}` });
        }
        return true;
    };
    return {
        loadWikipedia: async () => {
            await send('get');
        },
        setWikipediaEnabled: (enabled) => {
            edit((settings) => ({ ...settings, enabled }));
        },
        setWikipediaLanguage: (language, on) => {
            edit((settings) => withLanguage(settings, language, on));
        },
        setWikipediaHidden: (articleId, hidden) => {
            edit((settings) => withHidden(settings, articleId, hidden));
        },
        saveWikipedia: () => send('save', 'saved'),
        refreshWikipedia: () => send('refresh', 'refreshAsked'),
    };
}
