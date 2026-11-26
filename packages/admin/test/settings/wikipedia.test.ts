/**
 * Settings → Wikipedia (`packages/admin/src/settings/wikipedia.ts`; S-A230-*): opening the section reads `wikipedia.manage`,
 * the switch, the languages (never none) and hiding an article edit the draft, Save sends it and says so, Refresh now asks for
 * a fetch, and a refusal shows and changes nothing.
 */
import type { WikipediaManageResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { settingsModule } from '../../src/settings/settings.js';
import { NO_WIKIPEDIA_SECTION, wikipediaDirty, wikipediaIntents, type WikipediaSectionState } from '../../src/settings/wikipedia.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { CITY_PATH, cityDoc } from '../layers/fixtures.js';

const ANSWER: WikipediaManageResponse = {
    settings: { enabled: false, languages: ['ro', 'en'], hidden: [] },
    refreshRequested: false,
    articles: [{ id: 'ro-1', title: 'Ateneul Român', language: 'ro' }],
};

function world() {
    const content = contentWorld();
    let state: WikipediaSectionState = NO_WIKIPEDIA_SECTION;
    const states: WikipediaSectionState[] = [];
    const intents = wikipediaIntents(
        content.services,
        () => state,
        (next) => {
            state = next;
            states.push(next);
        },
    );
    return { ...content, intents, states, state: () => state };
}

describe('the Wikipedia section', () => {
    it('happyPath_theSettingsAreReadEditedAndSaved @S-A230-HAPPY-SAVE', async () => {
        const w = world();
        w.callables.answer('wikipedia.manage', (request) =>
            request.action === 'save' ? { ...ANSWER, settings: request.settings, refreshRequested: true } : ANSWER,
        );

        await w.intents.loadWikipedia();
        expect(w.state()).toMatchObject({ data: ANSWER, draft: ANSWER.settings, busy: false });
        expect(wikipediaDirty(w.state())).toBe(false);

        w.intents.setWikipediaEnabled(true);
        w.intents.setWikipediaLanguage('en', false);
        w.intents.setWikipediaLanguage('ro', false);
        w.intents.setWikipediaLanguage('en', true);
        w.intents.setWikipediaHidden('ro-1', true);
        w.intents.setWikipediaHidden('ro-2', true);
        w.intents.setWikipediaHidden('ro-2', false);
        expect(w.state().draft).toEqual({ enabled: true, languages: ['ro', 'en'], hidden: ['ro-1'] });
        expect(wikipediaDirty(w.state())).toBe(true);

        await expect(w.intents.saveWikipedia()).resolves.toBe(true);
        expect(w.callables.calls.at(-1)?.request).toEqual({
            cityId: CITY,
            action: 'save',
            settings: { enabled: true, languages: ['ro', 'en'], hidden: ['ro-1'] },
        });
        expect(w.notices).toEqual([{ key: 'adminContent.settings.wikipedia.saved' }]);
        expect(wikipediaDirty(w.state())).toBe(false);
    });

    it('happyPath_refreshNowAsksForAFetch', async () => {
        const w = world();
        w.callables.answer('wikipedia.manage', () => ({ ...ANSWER, refreshRequested: true }));

        await expect(w.intents.refreshWikipedia()).resolves.toBe(true);

        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, action: 'refresh' });
        expect(w.notices).toEqual([{ key: 'adminContent.settings.wikipedia.refreshAsked' }]);
    });

    it('badPath_aRefusalShowsAndNothingChanges @S-A230-BAD-LAST-LANGUAGE', async () => {
        const w = world();
        w.callables.fail('wikipedia.manage', failure('permission-denied', 'apiError.notAdmin'));

        await expect(w.intents.saveWikipedia()).resolves.toBe(false);

        expect(w.callables.calls.at(-1)?.request).toEqual({ cityId: CITY, action: 'get' });
        expect(w.state()).toEqual({ ...NO_WIKIPEDIA_SECTION, error: { key: 'apiError.notAdmin' } });
        expect(w.notices).toEqual([]);
        w.intents.setWikipediaEnabled(true);
        expect(w.state().draft).toBeNull();
        expect(wikipediaDirty(w.state())).toBe(false);
    });

    it('happyPath_theWikipediaSectionReadsItsCardOnceAndForgetsItWhenLeft', async () => {
        const world = contentWorld();
        world.store.docs.set(CITY_PATH, cityDoc());
        const store = settingsModule({ passes: () => true }).create(world.services);
        store.open([]);
        world.callables.answer('wikipedia.manage', () => ({
            settings: { enabled: true, languages: ['ro'], hidden: [] },
            refreshRequested: false,
            articles: [],
        }));

        store.open(['wikipedia']);
        await expect.poll(() => store.state.wikipedia.data?.settings.enabled).toBe(true);
        store.open(['wikipedia']);
        expect(world.callables.named('wikipedia.manage')).toBe(1);

        store.open(['area']);
        expect(store.state.wikipedia.data).toBeNull();
    });
});
