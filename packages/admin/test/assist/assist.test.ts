/**
 * The editors' assists (`packages/admin/src/assist/assist.ts`; `docs/research/M4-interfaces.md` §4.1): title
 * suggestions answered at once or after the queue answers the cell the editor listens to, refusals in words, and
 * translation drafts handed to the editor's draft only. Every value is a generated test value.
 */
import { FIRESTORE_PATHS, NOMINATIM_ATTRIBUTION, type CallableResponse } from '@hcm/shared';
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';

import { AssistSession, NO_ASSIST, QUEUED_WAIT_MS, draftSlot, titlesOf, type AssistState } from '../../src/assist/assist.js';
import { FakeCallables, FakeClock, failure } from '../app/fakes.js';
import { asContentStore, at } from '../content/world.js';

const KEY = 'n444413_e260973';
const PLACE = { lat: 44.4413, lng: 26.0973 };

function session() {
    const callables = new FakeCallables();
    const store = new FakeContentStore();
    const clock = new FakeClock();
    const states: AssistState[] = [];
    const assist = new AssistSession({
        callables,
        store: asContentStore(store),
        cityId: 'bucharest',
        clock,
        changed: (state) => states.push(state),
    });
    return { assist, callables, store, clock, states };
}

function cell(state: 'queued' | 'ready' | 'failed', extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        state,
        suggestions: [],
        attribution: NOMINATIM_ATTRIBUTION,
        requestedAt: at('2026-10-24T08:00:00.000Z'),
        expiresAt: at('2026-10-24T08:02:00.000Z'),
        updatedBy: 'system:assist',
        updatedAt: at('2026-10-24T08:00:00.000Z'),
        ...extra,
    };
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('title suggestions', () => {
    it('happyPath_aCachedCellAnswersAtOnce', async () => {
        const { assist, callables, states } = session();
        callables.answer('assist.suggestTitle', () => ({
            state: 'ready',
            key: KEY,
            suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }],
            attribution: NOMINATIM_ATTRIBUTION,
        }));

        await assist.suggestTitles(PLACE);

        expect(callables.calls.map((call) => call.request)).toEqual([{ cityId: 'bucharest', location: PLACE }]);
        expect(states.map((state) => state.titles.status)).toEqual(['asking', 'ready']);
        expect(assist.state.titles).toEqual({
            status: 'ready',
            suggestions: [{ ro: 'Ateneul Român', en: 'Romanian Athenaeum' }],
            attribution: NOMINATIM_ATTRIBUTION,
            error: null,
        });
    });

    it('happyPath_aQueuedCellIsListenedToUntilTheQueueAnswers', async () => {
        const { assist, callables, store, clock } = session();
        callables.answer('assist.suggestTitle', () => ({ state: 'queued', key: KEY, suggestions: [], attribution: NOMINATIM_ATTRIBUTION }));
        store.put(FIRESTORE_PATHS.geocodeCell(KEY), cell('queued'));

        await assist.suggestTitles(PLACE);
        expect([assist.state.titles.status, store.listeners(), clock.pending]).toEqual(['queued', 1, 1]);

        store.put(FIRESTORE_PATHS.geocodeCell(KEY), cell('ready', { suggestions: [{ ro: 'Sector 1' }] }));

        expect(assist.state.titles).toMatchObject({ status: 'ready', suggestions: [{ ro: 'Sector 1' }] });
        expect([store.listeners(), clock.pending]).toEqual([0, 0]);
    });

    it('badPath_aQueuedCellNoAnswerReachesEndsTheWaitSoSuggestATitleWorksAgain', async () => {
        const { assist, callables, store, clock } = session();
        callables.answer('assist.suggestTitle', () => ({ state: 'queued', key: KEY, suggestions: [], attribution: NOMINATIM_ATTRIBUTION }));
        store.put(FIRESTORE_PATHS.geocodeCell(KEY), cell('queued'));
        await assist.suggestTitles(PLACE);

        clock.advance(QUEUED_WAIT_MS - 1);
        expect(assist.state.titles.status).toBe('queued');
        clock.advance(1);

        expect(assist.state.titles).toEqual({
            status: 'failed',
            suggestions: [],
            attribution: null,
            error: { key: 'apiError.assist.unavailable' },
        });
        expect(store.listeners()).toBe(0);
        // A later answer of the cell changes nothing; asking again listens anew.
        store.put(FIRESTORE_PATHS.geocodeCell(KEY), cell('ready', { suggestions: [{ ro: 'Târziu' }] }));
        expect(assist.state.titles.status).toBe('failed');
        await assist.suggestTitles(PLACE);
        expect(assist.state.titles).toMatchObject({ status: 'ready', suggestions: [{ ro: 'Târziu' }] });
    });

    it('badPath_aCellAnsweredBeforeTheListenerAttachedStopsItAtOnce', async () => {
        const { assist, callables, store } = session();
        callables.answer('assist.suggestTitle', () => ({ state: 'queued', key: KEY, suggestions: [], attribution: NOMINATIM_ATTRIBUTION }));
        store.put(FIRESTORE_PATHS.geocodeCell(KEY), cell('failed', { error: 'apiError.assist.rateLimited' }));

        await assist.suggestTitles(PLACE);

        expect(assist.state.titles).toMatchObject({ status: 'failed', error: { key: 'apiError.assist.rateLimited' } });
        expect(store.listeners()).toBe(0);
    });

    it('badPath_aRefusalAFailedCallAndALostListenerSayWhy', async () => {
        const { assist, callables, store, clock } = session();
        callables.answer('assist.suggestTitle', () => ({
            state: 'failed',
            key: KEY,
            suggestions: [],
            attribution: NOMINATIM_ATTRIBUTION,
            error: 'apiError.assist.rateLimited',
        }));
        await assist.suggestTitles(PLACE);
        expect(assist.state.titles.error).toEqual({ key: 'apiError.assist.rateLimited' });

        callables.fail('assist.suggestTitle', failure('invalid-argument', 'apiError.invalidRequest'));
        await assist.suggestTitles(PLACE);
        expect(assist.state.titles).toMatchObject({ status: 'failed', error: { key: 'apiError.invalidRequest' } });

        callables.answer('assist.suggestTitle', () => ({ state: 'queued', key: KEY, suggestions: [], attribution: NOMINATIM_ATTRIBUTION }));
        await assist.suggestTitles(PLACE);
        store.fail(FIRESTORE_PATHS.geocodeCell(KEY), { kind: 'denied', code: 'permission-denied' });
        expect(assist.state.titles).toMatchObject({ status: 'failed', error: { key: 'apiError.assist.unavailable' } });
        expect(clock.pending).toBe(0);
    });

    it('badPath_anOlderAnswerNeverReplacesANewerRequest', async () => {
        const { assist, callables } = session();
        type Answer = CallableResponse<'assist.suggestTitle'>;
        const pending: { resolve?: (value: Answer) => void } = {};
        callables.answer(
            'assist.suggestTitle',
            () =>
                new Promise<Answer>((resolve) => {
                    pending.resolve = resolve;
                }),
        );
        const first = assist.suggestTitles(PLACE);
        await settled();

        assist.reset();
        pending.resolve?.({ state: 'ready', key: KEY, suggestions: [{ ro: 'Vechi' }], attribution: NOMINATIM_ATTRIBUTION });
        await first;

        expect(assist.state).toEqual(NO_ASSIST);
    });

    it('happyPath_theStateOfEachAnswer', () => {
        expect(titlesOf({ state: 'queued', suggestions: [], attribution: 'x' })).toEqual({
            status: 'queued',
            suggestions: [],
            attribution: null,
            error: null,
        });
    });
});

describe('translation drafts', () => {
    it('happyPath_aDraftGoesIntoTheEditorsDraftWithTheModelsNote', async () => {
        const { assist, callables } = session();
        callables.answer('assist.translateDraft', () => ({ draft: 'Romanian Athenaeum', truncated: true, model: 'gemini-3.5-flash-lite' }));
        const applied: string[] = [];

        await assist.draft({ field: 'title', from: 'ro', to: 'en', text: 'Ateneul Român' }, (text) => applied.push(text));

        expect(callables.calls.map((call) => call.request)).toEqual([
            { cityId: 'bucharest', field: 'title', from: 'ro', to: 'en', text: 'Ateneul Român' },
        ]);
        expect(applied).toEqual(['Romanian Athenaeum']);
        expect(assist.state.drafts[draftSlot('title', 'en')]).toEqual({
            status: 'done',
            model: 'gemini-3.5-flash-lite',
            truncated: true,
            error: null,
        });
    });

    it('badPath_aDraftAnsweredAfterAnotherItemOpenedIsDropped', async () => {
        const { assist, callables } = session();
        type Answer = CallableResponse<'assist.translateDraft'>;
        const pending: { resolve?: (value: Answer) => void } = {};
        callables.answer(
            'assist.translateDraft',
            () =>
                new Promise<Answer>((resolve) => {
                    pending.resolve = resolve;
                }),
        );
        const applied: string[] = [];
        const asked = assist.draft({ field: 'title', from: 'ro', to: 'en', text: 'Ateneul Român' }, (text) => applied.push(text));
        await settled();
        expect(assist.state.drafts['title.en']?.status).toBe('working');

        assist.reset();
        pending.resolve?.({ draft: 'Romanian Athenaeum', truncated: false, model: 'gemini-3.5-flash-lite' });
        await asked;

        expect(applied).toEqual([]);
        expect(assist.state).toEqual(NO_ASSIST);
    });

    it('badPath_anUnavailableModelLeavesTheFieldAsItWas', async () => {
        const { assist, callables } = session();
        callables.fail('assist.translateDraft', failure('unavailable', 'apiError.assist.unavailable'));
        const applied: string[] = [];

        await assist.draft({ field: 'description', from: 'en', to: 'ro', text: 'First.' }, (text) => applied.push(text));

        expect(applied).toEqual([]);
        expect(assist.state.drafts['description.ro']).toEqual({
            status: 'failed',
            model: null,
            truncated: false,
            error: { key: 'apiError.assist.unavailable' },
        });
    });
});
