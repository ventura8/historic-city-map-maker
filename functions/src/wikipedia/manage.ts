import '../global-options.js';

import {
    DEFAULT_WIKIPEDIA_SETTINGS,
    FIRESTORE_PATHS,
    shownWikipediaLanguage,
    timestampFromDate,
    timestampToDate,
    wikipediaStateDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WikipediaArticle,
    type WikipediaLanguage,
    type WikipediaSettings,
    type WikipediaStateDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { requestManifestBuild, type RequestDeps } from '../publish/request.js';
import { storedArticles } from './store.js';

/**
 * `wikipedia.manage` (`docs/research/M31-wikipedia.md` §3; a city editor): the admin's Wikipedia card. `get` answers the
 * settings (the defaults before the first save: off, Romanian and English, nothing hidden) and the last fetch's articles;
 * `save` writes the settings and asks for a build, which fetches when the languages changed or no fetch was made yet;
 * `refresh` asks for a fetch at the next build and the build. Every answer is the state after the action.
 */
export type ManageDeps = RequestDeps & Pick<Ports, 'admins' | 'blobs'>;

type Response = CallableResponse<'wikipedia.manage'>;

function settingsOf(state: WikipediaStateDoc | undefined): WikipediaSettings {
    if (state === undefined) {
        return DEFAULT_WIKIPEDIA_SETTINGS;
    }
    const { enabled, languages, hidden } = state;
    return { enabled, languages, hidden };
}

/** The admin's list: each article in the city's first language when it has it. */
function listed(articles: readonly WikipediaArticle[], first: WikipediaLanguage): Response['articles'] {
    return articles.map((article) => {
        const language = shownWikipediaLanguage(article, first);
        return { id: article.id, language, title: article.versions[language]?.title ?? article.id };
    });
}

function fetchFields(state: WikipediaStateDoc | undefined): Pick<Response, 'refreshedAt' | 'failure'> {
    return {
        ...(state?.refreshedAt === undefined ? {} : { refreshedAt: timestampToDate(state.refreshedAt).toISOString() }),
        ...(state?.failure === undefined ? {} : { failure: state.failure }),
    };
}

function responseOf(state: WikipediaStateDoc | undefined, stored: readonly WikipediaArticle[]): Response {
    const settings = settingsOf(state);
    const articles = listed(stored, settings.languages[0] ?? 'ro');
    return { settings, refreshRequested: state?.refreshRequested === true, articles, ...fetchFields(state) };
}

function sameLanguages(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((language, index) => language === b[index]);
}

type Stamp = Pick<WikipediaStateDoc, 'updatedBy' | 'updatedAt'>;

/** Saved settings: other languages (or a fetch already asked for) keep a fetch asked for. */
function saved(base: WikipediaStateDoc, settings: WikipediaSettings, stamp: Stamp): WikipediaStateDoc {
    const asked = base.refreshRequested === true || !sameLanguages(settings.languages, base.languages);
    const { enabled, languages, hidden } = settings;
    return { ...base, ...stamp, enabled, languages, hidden, ...(asked ? { refreshRequested: true } : {}) };
}

/** The state after a save or a refresh, before it is written. */
function nextState(
    current: WikipediaStateDoc | undefined,
    request: Exclude<CallableRequest<'wikipedia.manage'>, { action: 'get' }>,
    stamp: Stamp,
): WikipediaStateDoc {
    const base = current ?? { ...DEFAULT_WIKIPEDIA_SETTINGS, ...stamp };
    return request.action === 'refresh' ? { ...base, ...stamp, refreshRequested: true } : saved(base, request.settings, stamp);
}

export async function manageWikipedia(
    deps: ManageDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'wikipedia.manage'>,
): Promise<Response> {
    const path = FIRESTORE_PATHS.wikipedia(request.cityId);
    const current = await deps.documents.get(path, wikipediaStateDocSchema);
    const stored = await storedArticles(deps, request.cityId, current);
    if (request.action === 'get') {
        return responseOf(current, stored);
    }
    const next = nextState(current, request, { updatedBy: caller.uid, updatedAt: timestampFromDate(deps.clock.now()) });
    await deps.documents.set(path, wikipediaStateDocSchema, next);
    await requestManifestBuild(deps, { cityId: request.cityId, full: true, updatedBy: caller.uid });
    deps.log.info('wikipedia settings changed', {
        cityId: request.cityId,
        action: request.action,
        enabled: next.enabled,
        hidden: next.hidden.length,
    });
    return responseOf(next, stored);
}

/** `wikipedia-manage` (callable, city editors). */
export function manageWikipediaFunction(getDeps: () => ManageDeps) {
    return defineCallable('wikipedia.manage', manageWikipedia, getDeps);
}
