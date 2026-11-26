import { describe, expect, it } from 'vitest';

import { startFunnel } from '../../src/start/start-funnel.js';

describe('startFunnel', () => {
    it('happyPath_theScreensInOrderAndTheDoneScreenCompletes', () => {
        expect(startFunnel({ screen: 'work', failure: null, notice: null })).toMatchObject({
            wizard: 'start',
            step: 'work',
            done: ['intro', 'plan'],
            errors: {},
            complete: false,
        });
        expect(startFunnel({ screen: 'done', failure: null, notice: null })).toMatchObject({ complete: true });
    });

    it('badPath_aFailureOrANoticeIsAnErrorOfItsScreenAndClosedIsNothing', () => {
        expect(startFunnel({ screen: 'work', failure: { key: 'start.failure.quota' }, notice: null })?.errors).toEqual({
            work: 'start.failure.quota',
        });
        expect(startFunnel({ screen: 'intro', failure: null, notice: 'start.signedOut.denied' })?.errors).toEqual({
            intro: 'start.signedOut.denied',
        });
        expect(startFunnel({ screen: 'closed', failure: null, notice: null })).toBeNull();
    });
});
