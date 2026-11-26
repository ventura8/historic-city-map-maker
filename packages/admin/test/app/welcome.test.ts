import { describe, expect, it } from 'vitest';

import { mount } from '../../src/app/mount.js';
import { contributorWelcome, followWelcome, startLocale } from '../../src/app/welcome.js';
import { LANGUAGE_KEY } from '../../src/state/locale.js';
import { FakeLocation, MemoryStore, settle, undeployed } from './fakes.js';
import { mountWorld as world } from './mount-world.js';

/** The map menu's Contribute link as the viewer writes it (`menuAction`): the language and the city's name in it. */
function mapLink(name: string, lang = 'ro'): string {
    return `?${new URLSearchParams({ lang, name }).toString()}`;
}

const ROOT = 'https://demo-hcm.web.app/';

describe('contributorWelcome (M13 §3: a visitor is welcomed, never shown the admin sign-in)', () => {
    it('happyPath_theFirstCitysContributePageNamesTheCity_andGoesBackToTheRootMap @S-A92-HAPPY-WELCOME', () => {
        const location = new FakeLocation('#/contribute/bucharest', mapLink('București'));

        expect(contributorWelcome(location, 'bucharest')).toEqual({ cityId: 'bucharest', cityName: 'București', mapUrl: ROOT });
    });

    it('happyPath_anotherCitysPhotoSuggestion_goesBackToThatCitysMap', () => {
        const location = new FakeLocation('#/contribute/bacau/photo-1', mapLink('Bacău', 'en'));

        expect(contributorWelcome(location, 'bucharest')).toEqual({ cityId: 'bacau', cityName: 'Bacău', mapUrl: `${ROOT}bacau/` });
    });

    it('badPath_anAdminsAddressHasNoWelcome @S-A92-BAD-ADMIN-ROUTE', () => {
        expect(contributorWelcome(new FakeLocation('#/photos', mapLink('București')), 'bucharest')).toBeNull();
        expect(contributorWelcome(new FakeLocation('', ''), 'bucharest')).toBeNull();
        expect(contributorWelcome(new FakeLocation('#/no-such-page', ''), null)).toBeNull();
    });

    it('badPath_aLinkWithoutANameNamesNoCity_andWithoutACityGoesToTheRoot', () => {
        expect(contributorWelcome(new FakeLocation('#/contribute', ''), null)).toEqual({ cityId: null, cityName: null, mapUrl: ROOT });
        expect(contributorWelcome(new FakeLocation('#/contribute/bucharest', '?name=%20%07%20'), null)).toEqual({
            cityId: 'bucharest',
            cityName: null,
            mapUrl: `${ROOT}bucharest/`,
        });
    });

    it('badPath_aLongOrControlLadenNameIsCleanedAndCut', () => {
        const location = new FakeLocation('#/contribute/bucharest', mapLink(`\u0007${'x'.repeat(200)}`));

        expect(contributorWelcome(location, 'bucharest')?.cityName).toBe('x'.repeat(80));
    });

    it('happyPath_theWelcomeFollowsTheAddress_untilItStops', () => {
        const location = new FakeLocation('#/photos', '');
        const seen: (string | null)[] = [];
        const stop = followWelcome(location, ['bucharest'], (welcome) => {
            seen.push(welcome?.mapUrl ?? null);
        });

        location.visit('#/contribute/bacau');
        location.visit('#/home');
        stop();
        location.visit('#/contribute/bucharest');

        expect(seen).toEqual([`${ROOT}bacau/`, null]);
    });

    it('badPath_aProjectWithoutCitiesSendsEveryCityToItsOwnPath', () => {
        const location = new FakeLocation('', '');
        const seen: (string | null)[] = [];
        const stop = followWelcome(location, [], (welcome) => {
            seen.push(welcome?.mapUrl ?? null);
        });

        location.visit('#/contribute/bucharest');
        stop();

        expect(seen).toEqual([`${ROOT}bucharest/`]);
    });
});

describe('startLocale (M13 §3: the welcome speaks the language of the map, Romanian by default)', () => {
    function stored(values: Readonly<Record<string, string>>): MemoryStore {
        const local = new MemoryStore();
        for (const [key, value] of Object.entries(values)) {
            local.set(key, value);
        }
        return local;
    }

    it('happyPath_theLinksLanguageWins_thenTheOneChosenOnThatCitysMap', () => {
        const local = stored({ 'hcm:bacau:lang': 'en', [LANGUAGE_KEY]: 'ro' });

        expect(startLocale(new FakeLocation('#/contribute/bacau', '?lang=ro'), local, ['en-GB'])).toBe('ro');
        expect(startLocale(new FakeLocation('#/contribute/bacau/photo-1', ''), local, ['ro'])).toBe('en');
    });

    it('badPath_noLanguageAnywhereIsTheMapsRomanian_notTheBrowsers_butTheAdminsOwnChoiceCounts', () => {
        expect(startLocale(new FakeLocation('#/contribute/bucharest', '?lang=sv'), stored({ 'hcm:bucharest:lang': 'xx' }), ['en'])).toBe(
            'ro',
        );
        expect(startLocale(new FakeLocation('#/contribute', ''), stored({ [LANGUAGE_KEY]: 'en' }), ['ro'])).toBe('en');
    });

    it('happyPath_anAdminsAddressKeepsTheAdminsOrder', () => {
        expect(startLocale(new FakeLocation('#/photos', ''), stored({ 'hcm:bucharest:lang': 'ro' }), ['en-US'])).toBe('en');
    });
});

describe('mount: the welcome in the state', () => {
    it('happyPath_aSignedOutVisitorOnTheContributePageHasTheWelcome_andAnAddressChangeFollows', async () => {
        const w = world({ hash: '#/contribute/bucharest', search: mapLink('București') });
        undeployed(w.callables);
        const app = mount(w.deps);
        await settle();

        expect(app.state.welcome).toEqual({ cityId: 'bucharest', cityName: 'București', mapUrl: ROOT });
        w.location.visit('#/photos');
        expect(app.state.welcome).toBeNull();
        app.destroy();
    });
});
