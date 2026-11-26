import { describe, expect, it } from 'vitest';

import { createGoogleAuth } from '../../src/auth/google-auth.js';
import { createStandInPopup, POPUP_POLL_MS, STAND_IN_ORIGIN, type StandInMessage } from '../../src/auth/stand-in.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { FakeClock, settle, testLog } from '../app/fakes.js';

const GRANT = {
    idToken: '{"sub":"owner","email":"owner@e2e.test","email_verified":true}',
    accessToken: 'ya29.e2e-owner-access-token',
    scope: 'x',
    expiresIn: 3599,
};

function world(blocked = false) {
    const clock = new FakeClock();
    const listeners = new Set<(message: StandInMessage) => void>();
    const opened: string[] = [];
    const popup = { closed: false };
    const signIns: { readonly idToken: string; readonly accessToken: string }[] = [];
    const signIn = createStandInPopup({
        open: (url) => {
            opened.push(url);
            return blocked ? null : popup;
        },
        onMessage: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        clock,
        testId: 'spec-1#0',
        signInWithCredential: (idToken, accessToken) => {
            signIns.push({ idToken, accessToken });
            return Promise.resolve({ email: 'owner@e2e.test' });
        },
    });
    const post = (message: StandInMessage): void => {
        for (const listener of [...listeners]) {
            listener(message);
        }
    };
    return { clock, listeners, opened, popup, signIns, signIn, post };
}

describe('createStandInPopup', () => {
    it('happyPath_allowSignsInWithTheStandInsCredential', async () => {
        const w = world();
        const result = w.signIn(GOOGLE_SCOPES.cloudReadOnly, { include_granted_scopes: 'true', login_hint: 'owner@e2e.test' });

        w.post({ origin: 'http://127.0.0.1:9999', source: w.popup, data: GRANT });
        w.post({ origin: STAND_IN_ORIGIN, source: {}, data: GRANT });
        w.post({ origin: STAND_IN_ORIGIN, source: w.popup, data: { unrelated: true } });
        w.post({ origin: STAND_IN_ORIGIN, source: w.popup, data: GRANT });

        await expect(result).resolves.toEqual({ accessToken: GRANT.accessToken, email: 'owner@e2e.test' });
        const url = new URL(w.opened[0] ?? '');
        expect(url.origin + url.pathname).toBe(`${STAND_IN_ORIGIN}/__oauth/authorize`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            include_granted_scopes: 'true',
            login_hint: 'owner@e2e.test',
            scope: GOOGLE_SCOPES.cloudReadOnly,
            test: 'spec-1#0',
        });
        expect(w.signIns).toEqual([{ idToken: GRANT.idToken, accessToken: GRANT.accessToken }]);
        expect(w.listeners.size).toBe(0);
        expect(w.clock.pending).toBe(0);
    });

    it('happyPath_theDailySignInAsksForNoScope', async () => {
        const w = world();
        const result = w.signIn(null, {});

        w.post({ origin: STAND_IN_ORIGIN, source: w.popup, data: GRANT });

        await expect(result).resolves.toMatchObject({ email: 'owner@e2e.test' });
        expect(new URL(w.opened[0] ?? '').searchParams.get('scope')).toBe('');
    });

    it('badPath_cancelIsAClosedPopup', async () => {
        const w = world();
        const result = w.signIn(GOOGLE_SCOPES.cloudBilling, {});

        w.post({ origin: STAND_IN_ORIGIN, source: w.popup, data: { cancelled: true } });

        await expect(result).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
        expect(w.signIns).toEqual([]);
    });

    it('badPath_aPopupClosedWithoutAnAnswerIsNoticed', async () => {
        const w = world();
        const result = w.signIn(GOOGLE_SCOPES.cloudBilling, {});

        w.clock.advance(POPUP_POLL_MS);
        await settle();
        w.popup.closed = true;
        w.clock.advance(POPUP_POLL_MS);

        await expect(result).rejects.toMatchObject({ code: 'auth/popup-closed-by-user' });
        expect(w.listeners.size).toBe(0);
    });

    it('badPath_aBlockedPopupIsReported', async () => {
        const w = world(true);

        await expect(w.signIn(null, {})).rejects.toMatchObject({ code: 'auth/popup-blocked' });
    });

    it('happyPath_theProductionChecksRunOnTheStandInsToken', async () => {
        const w = world(true);
        const port = createGoogleAuth(w.signIn, {
            fetch: () => Promise.reject(new Error('offline')),
            clock: { now: () => 0 },
            log: testLog().log,
        });

        await expect(port.request('cloudReadOnly', {})).rejects.toMatchObject({ failure: 'popupBlocked' });
    });
});
