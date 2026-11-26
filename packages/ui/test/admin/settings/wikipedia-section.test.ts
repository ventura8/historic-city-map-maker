/**
 * Settings → Wikipedia (`packages/ui/src/admin/settings/wikipedia-section.ts`; S-A230-*): the switch, the languages (the last one
 * cannot go), Save only with a change, Refresh now, when the articles were fetched or why the last fetch failed with the fix,
 * the articles with Hide and Show, in both languages, and nothing that writes for a revoked admin.
 */
import type { WikipediaManageResponse } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { WIKIPEDIA_CARD_CHUNK } from '../../../src/admin/settings/lazy-wikipedia.js';
import type { SettingsIntentsPort, SettingsViewState, WikipediaSectionPort } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, defineAll } from '../shell/fake-app.js';

const DATA: WikipediaManageResponse = {
    settings: { enabled: true, languages: ['ro', 'en'], hidden: ['ro-2'] },
    refreshRequested: false,
    refreshedAt: '2026-11-21T08:00:00.000Z',
    articles: [
        { id: 'ro-1', title: 'Ateneul Român', language: 'ro' },
        { id: 'ro-2', title: 'Palatul CEC', language: 'ro' },
    ],
};

function card(patch: Partial<WikipediaSectionPort> = {}): SettingsViewState {
    return {
        ...settingsState(),
        section: 'wikipedia',
        wikipedia: { data: DATA, draft: DATA.settings, busy: false, error: null, ...patch },
    };
}

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, {
        saveWikipedia: Promise.resolve(true),
        refreshWikipedia: Promise.resolve(true),
    });
}

function action(element: HTMLElement, name: 'save' | 'refresh'): HTMLElement {
    return deep(element, `[data-wikipedia-${name}]`);
}

describe('<hcm-settings-page> Wikipedia', () => {
    beforeAll(async () => {
        defineAll();
        await WIKIPEDIA_CARD_CHUNK.load();
    });
    afterEach(cleanup);

    it('happyPath_theCardShowsTheSettingsAndArticlesAndSendsEachChange @S-A230-HAPPY-CARD', async () => {
        const settings = area(card());
        const { element } = await page('settings', settings, { params: ['wikipedia'] });

        expect(deep(element, '[data-detail-heading]').textContent).toBe('Wikipedia');
        expect(deep(element, '[data-wikipedia-status]').textContent).toContain('fetched on');
        expect(deepAll(element, '[data-wikipedia-article]').map((row) => row.hasAttribute('data-hidden'))).toEqual([false, true]);
        expect(action(element, 'save').hasAttribute('disabled')).toBe(true);

        const switches = deepAll(element, '[data-section="wikipedia"] hcm-switch');
        switches[0]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        switches[2]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deepAll(element, '[data-wikipedia-article] hcm-button')[0]?.click();
        deepAll(element, '[data-wikipedia-article] hcm-button')[1]?.click();
        action(element, 'refresh').click();

        expect(settings.named('setWikipediaEnabled')).toEqual(['setWikipediaEnabled false']);
        expect(settings.named('setWikipediaLanguage')).toEqual(['setWikipediaLanguage "en" false']);
        expect(settings.named('setWikipediaHidden')).toEqual(['setWikipediaHidden "ro-1" true', 'setWikipediaHidden "ro-2" false']);
        expect(settings.named('refreshWikipedia')).toEqual(['refreshWikipedia']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aChangedDraftSavesInRomanian', async () => {
        const settings = area(card({ draft: { ...DATA.settings, enabled: false } }));
        const { element } = await page('settings', settings, { params: ['wikipedia'], locale: 'ro' });

        expect(action(element, 'refresh').hasAttribute('disabled')).toBe(true);
        action(element, 'save').click();

        expect(settings.named('saveWikipedia')).toEqual(['saveWikipedia']);
        expect(action(element, 'save').textContent.trim()).toBe('Salvează');
    });

    it('badPath_aFailedFetchSaysWhyAndWhatToDo @S-A230-BAD-WIKIPEDIA-DOWN', async () => {
        const { element } = await page('settings', area(card({ data: { ...DATA, failure: 'rateLimited', refreshedAt: undefined } })), {
            params: ['wikipedia'],
        });

        expect(deep(element, '[data-wikipedia-failure]').textContent).toContain('Press Refresh now in an hour');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_neverFetchedAWaitingFetchAndNoArticles', async () => {
        const data = { ...DATA, refreshedAt: undefined, refreshRequested: true, articles: [] };
        const { element } = await page('settings', area(card({ data, draft: { ...DATA.settings, languages: ['ro'] } })), {
            params: ['wikipedia'],
        });

        expect(deep(element, '[data-wikipedia-status]').textContent).toContain('have not been fetched yet');
        expect(deep(element, '[data-wikipedia-status]').textContent).toContain('waits for the map');
        expect(deep(element, '[data-wikipedia-empty]')).not.toBeNull();
        const languages = deepAll(element, '[data-wikipedia-languages] hcm-switch');
        expect(languages.map((toggle) => toggle.hasAttribute('disabled'))).toEqual([true, false]);
    });

    it('badPath_beforeTheAnswerARefusalAndARevokedAdmin', async () => {
        const loading = await page('settings', area(card({ data: null, draft: null, busy: true })), { params: ['wikipedia'] });
        expect(deep(loading.element, '[data-wikipedia-loading]').textContent).toContain('Reading the Wikipedia settings');

        const refused = await page('settings', area(card({ data: null, draft: null, error: { key: 'apiError.notAdmin' } })), {
            params: ['wikipedia'],
        });
        expect(deep(refused.element, '[data-wikipedia-error]')).not.toBeNull();

        const revoked = await page('settings', area(card()), { params: ['wikipedia'], revoked: true });
        expect(action(revoked.element, 'refresh').hasAttribute('disabled')).toBe(true);
        expect(deepAll(revoked.element, '[data-wikipedia-article] hcm-button').every((button) => button.hasAttribute('disabled'))).toBe(
            true,
        );
    });
});
