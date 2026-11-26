/** The Contribute page's store (M13, `docs/research/M13-roles.md` §§3, 4): callables only, and the photo editor's map session. */
import type { ContributeContextResponse } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CONTRIBUTE_MODULE, changedFrom } from '../../src/contribute/contribute.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';
import { CONTAINER, FakeMaps, settle } from '../photos/world.js';

const BOUNDS: ContributeContextResponse['city']['bounds'] = [
    [25.9, 44.3],
    [26.3, 44.6],
];

const CONTEXT: ContributeContextResponse = {
    city: { id: CITY, name: { ro: 'București' }, bounds: BOUNDS, publicToken: 'pk.test' },
    role: null,
    blocked: false,
    request: null,
    photo: null,
};

const PHOTO = { id: 'p1', title: { ro: 'Unde?' }, thumb: 'https://example.org/t.webp' };

function world(context: ContributeContextResponse = CONTEXT, locale: 'ro' | 'en' = 'ro') {
    const maps = new FakeMaps();
    const made = contentWorld({ maps: maps as never, locale: () => locale });
    made.callables.answer('contribute.context', () => context);
    return { ...made, maps, area: CONTRIBUTE_MODULE.create(made.services) };
}

describe('the Contribute page: asking for a role', () => {
    it('happyPath_readsTheCityThenSendsTheRequest @S-A92-HAPPY-REQUEST', async () => {
        const w = world();
        w.callables.answer('contribute.request', () => ({ status: 'pending' }));
        w.area.open([CITY]);
        await settle();
        expect(w.area.state).toMatchObject({ status: 'ready', context: CONTEXT });
        const outcome = await w.area.intents.request('uploader', '  Am fotografii.  ', ' ');
        expect(outcome.ok).toBe(true);
        expect(w.callables.calls.find((call) => call.name === 'contribute.request')?.request).toEqual({
            cityId: CITY,
            role: 'uploader',
            reason: 'Am fotografii.',
        });
        expect(w.callables.calls.filter((call) => call.name === 'contribute.context')).toHaveLength(2);
    });

    it('badPath_aRefusedRequestSaysWhy @S-A92-BAD-ALREADY-PENDING', async () => {
        const w = world();
        w.callables.fail('contribute.request', failure('already-exists', 'apiError.contribute.alreadyPending'));
        w.area.open([CITY]);
        await settle();
        await w.area.intents.request('moderator', 'x', 'Maria');
        expect(w.area.state.problem).toEqual({ key: 'apiError.contribute.alreadyPending' });
    });

    it('badPath_aCityThatCannotBeReadOffersTryAgain', async () => {
        const w = world();
        w.callables.fail('contribute.context', failure('not-found', 'apiError.notFound'));
        w.area.open([CITY]);
        await settle();
        expect(w.area.state).toMatchObject({ status: 'error', failure: { key: 'apiError.notFound' } });
        w.callables.answer('contribute.context', () => CONTEXT);
        w.area.intents.retry();
        await settle();
        expect(w.area.state.status).toBe('ready');
        expect([CONTRIBUTE_MODULE.area, w.area.hasUnsavedChanges()]).toEqual(['contribute', false]);
    });
});

describe('the Contribute page: a suggestion', () => {
    it('happyPath_thePinAndTheDirectionMakeAPlace @S-A93-HAPPY-PLACE', async () => {
        const w = world({ ...CONTEXT, photo: PHOTO });
        w.callables.answer('suggestions.submit', () => ({ received: true, remainingToday: 19 }));
        w.area.open([CITY, 'p1']);
        await settle();
        w.area.intents.attachMap(CONTAINER);
        await settle();
        expect((w.maps.created[0] as { readonly options: { readonly token: string } }).options.token).toBe('pk.test');
        w.area.intents.placeAtCentre();
        await settle();
        const { location } = w.area.state.proposal;
        expect(location).toBeDefined();
        const picking = w.area.intents.pickDirection();
        await settle();
        expect(w.area.state.picking).toBe(true);
        w.maps.draw.resolvePick([26.2, 44.5]);
        await picking;
        expect(w.area.state.proposal.bearing).toBeGreaterThan(0);
        const outcome = await w.area.intents.suggest({ reason: '', sourceUrl: '', credit: 'Maria' });
        expect(outcome.ok).toBe(true);
        expect(w.area.state.thanks).toEqual({ remaining: 19 });
        const sent = w.callables.calls.find((call) => call.name === 'suggestions.submit')?.request;
        expect(sent).toMatchObject({ cityId: CITY, photoId: 'p1', kind: 'place', credit: 'Maria' });
    });

    it('happyPath_aPlacedPhotoIsCorrected @S-A93-HAPPY-CORRECTION', async () => {
        const placed = { ...PHOTO, location: { lat: 44.4, lng: 26.1 }, bearing: 10 };
        const w = world({ ...CONTEXT, photo: placed });
        w.callables.answer('suggestions.submit', () => ({ received: true, remainingToday: 3 }));
        w.area.open([CITY, 'p1']);
        await settle();
        expect(w.area.state.proposal).toEqual({ location: placed.location, bearing: 10 });
        w.area.intents.edit({ year: 1950 });
        await w.area.intents.suggest({ reason: 'Pe verso.' });
        expect(w.callables.calls.at(-1)?.request).toMatchObject({ kind: 'correction', reason: 'Pe verso.', proposal: { year: 1950 } });
    });

    it('badPath_aRefusedSuggestionSaysWhy @S-A93-BAD-DAILY-LIMIT', async () => {
        const w = world({ ...CONTEXT, photo: PHOTO });
        w.callables.fail('suggestions.submit', failure('resource-exhausted', 'apiError.suggestion.dailyLimit', { max: '20' }));
        w.area.open([CITY, 'p1']);
        await settle();
        w.area.intents.edit({ location: { lat: 44.44, lng: 26.1 } });
        await w.area.intents.suggest({});
        expect(w.area.state).toMatchObject({ problem: { key: 'apiError.suggestion.dailyLimit' }, thanks: null });
    });

    it('badPath_noDirectionWithoutAPlaceAndNoMapTwice', async () => {
        const w = world({ ...CONTEXT, photo: PHOTO });
        w.area.open([CITY, 'p1']);
        await settle();
        await w.area.intents.pickDirection();
        expect(w.area.state.picking).toBe(false);
        w.area.intents.attachMap(CONTAINER);
        w.area.intents.attachMap(CONTAINER);
        await settle();
        w.area.intents.zoomBy(1);
        w.area.intents.cancelPick();
        expect(w.maps.created).toHaveLength(1);
        w.area.close();
        expect(w.area.state.map).toBe('none');
        w.area.destroy();
    });

    it('badPath_noMapBeforeTheCityIsKnownOrWithoutTheFactory', async () => {
        const w = world();
        w.area.intents.attachMap(CONTAINER);
        expect(w.maps.created).toHaveLength(0);
        const bare = contentWorld({ maps: null });
        bare.callables.answer('contribute.context', () => ({ ...CONTEXT, city: { ...CONTEXT.city, publicToken: undefined } }));
        const area = CONTRIBUTE_MODULE.create(bare.services);
        area.open([CITY]);
        await settle();
        area.intents.attachMap(CONTAINER);
        await settle();
        expect(area.state.map).toBe('unavailable');
        area.intents.placeAtCentre();
        expect(area.state.proposal).toEqual({});
    });
});

describe('the Contribute page: only what changed is sent', () => {
    const placed = {
        ...CONTEXT,
        photo: { ...PHOTO, location: { lat: 44.43, lng: 26.09 }, bearing: 90, year: 1920, dateText: { ro: 'Iulie', en: 'July' } },
    };

    async function open(locale: 'ro' | 'en' = 'ro') {
        const w = world(placed, locale);
        w.callables.answer('suggestions.submit', () => ({ received: true, remainingToday: 3 }));
        w.area.open([CITY, 'p1']);
        await settle();
        return w;
    }

    const sent = (w: Awaited<ReturnType<typeof open>>) => w.callables.calls.find((call) => call.name === 'suggestions.submit')?.request;

    it('happyPath_aContestedYearCarriesNoPlace @S-A93-HAPPY-ONLY-CHANGED', async () => {
        const w = await open();
        w.area.intents.edit({ year: 1950 });
        await w.area.intents.suggest({ reason: 'Pe verso.' });
        expect(sent(w)).toMatchObject({ proposal: { year: 1950 } });
        expect(Object.keys((sent(w) as { proposal: object }).proposal)).toEqual(['year']);
    });

    it('happyPath_aNewEndNamesItsStart', async () => {
        const w = await open();
        w.area.intents.edit({ yearEnd: 1925 });
        await w.area.intents.suggest({ reason: 'x' });
        expect((sent(w) as { proposal: object }).proposal).toEqual({ year: 1920, yearEnd: 1925 });
    });

    it('happyPath_aDateTextSaysItsLanguage @S-A93-HAPPY-DATE-LANGUAGE', async () => {
        const w = await open('en');
        w.area.intents.edit({ dateText: 'Summer' });
        await w.area.intents.suggest({ reason: 'x' });
        expect((sent(w) as { proposal: object }).proposal).toEqual({ dateText: 'Summer', dateLocale: 'en' });
    });

    it('badPath_nothingChangedIsToldWithoutACall @S-A93-HAPPY-ONLY-CHANGED', async () => {
        const w = await open();
        w.area.intents.edit({ dateText: 'Iulie' });
        await w.area.intents.suggest({ reason: 'x' });
        expect(sent(w)).toBeUndefined();
        expect(w.area.state.problem).toEqual({ key: 'apiError.suggestion.noChange' });
    });
});

describe('changedFrom', () => {
    it('happyPath_aPhotoWithNothingYetKeepsEverythingTyped', () => {
        expect(changedFrom(null, { location: { lat: 1, lng: 2 }, dateText: 'Vara' }, 'ro')).toEqual({
            location: { lat: 1, lng: 2 },
            dateText: 'Vara',
            dateLocale: 'ro',
        });
    });

    it('happyPath_anEndWithItsOwnStartAndAPhotoWithNoDateText', () => {
        expect(changedFrom({ ...PHOTO, year: 1920 }, { year: 1921, yearEnd: 1925 }, 'en')).toEqual({ year: 1921, yearEnd: 1925 });
        expect(changedFrom({ ...PHOTO }, { yearEnd: 1925 }, 'en')).toEqual({ yearEnd: 1925 });
    });
});
