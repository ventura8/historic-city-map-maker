import { describe, expect, it, vi } from 'vitest';

import { showsShell } from '../../src/auth/auth-state.js';
import { resolveAdminLocale } from '../../src/state/locale.js';
import { Store } from '../../src/state/store.js';
import { testLog } from '../app/fakes.js';

describe('Store', () => {
    it('happyPath_aChangeReplacesTheStateAndTellsTheListeners', () => {
        const store = new Store({ a: 1, b: 'x' }, testLog().log);
        const first = store.state;
        const listener = vi.fn();
        const stop = store.subscribe(listener);

        store.update({ a: 2 });
        stop();
        store.update({ a: 3 });

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith({ a: 2, b: 'x' });
        expect(first).toEqual({ a: 1, b: 'x' });
        expect(store.state).toEqual({ a: 3, b: 'x' });
    });

    it('badPath_anUnchangedPatchTellsNobody', () => {
        const store = new Store({ a: 1 }, testLog().log);
        const listener = vi.fn();
        store.subscribe(listener);

        store.update({ a: 1 });
        store.update({});

        expect(listener).not.toHaveBeenCalled();
    });

    it('badPath_aThrowingListenerIsLoggedAndTheOthersStillRun', () => {
        const { log, recording } = testLog();
        const store = new Store({ a: 1 }, log);
        const after = vi.fn();
        store.subscribe(() => {
            throw new Error('listener');
        });
        store.subscribe(after);

        store.update({ a: 2 });

        expect(after).toHaveBeenCalledTimes(1);
        expect(recording.records[0]).toMatchObject({ level: 'error', message: 'state listener failed' });
    });
});

describe('resolveAdminLocale', () => {
    it('happyPath_theAddressThenTheStoredChoiceThenTheBrowser', () => {
        expect(resolveAdminLocale('?lang=en', 'ro', ['ro-RO'])).toBe('en');
        expect(resolveAdminLocale('?lang=ro', 'en', ['en-US'])).toBe('ro');
        expect(resolveAdminLocale('', 'en', ['ro-RO'])).toBe('en');
        expect(resolveAdminLocale('', null, ['en-GB'])).toBe('en');
    });

    it('happyPath_everyInterfaceLanguageIsTakenFromTheAddressTheStoreOrTheBrowser', () => {
        expect(resolveAdminLocale('?lang=fa', 'de', ['fr-FR'])).toBe('fa');
        expect(resolveAdminLocale('', 'ja', ['fr-FR'])).toBe('ja');
        expect(resolveAdminLocale('', null, ['hu-HU'])).toBe('hu');
    });

    it('badPath_anythingElseIsRomanian', () => {
        expect(resolveAdminLocale('?lang=sv', 'xx', ['sv-SE'])).toBe('ro');
        expect(resolveAdminLocale('', null, [])).toBe('ro');
    });
});

describe('showsShell', () => {
    it('happyPath_onlyTheAdminAndStartUpStatesShowTheShell', () => {
        expect([showsShell('admin'), showsShell('bootstrap'), showsShell('claimPending'), showsShell('signedOut')]).toEqual([
            true,
            true,
            false,
            false,
        ]);
    });
});
