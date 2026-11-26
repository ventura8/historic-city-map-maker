import { BASELINE_THEME } from '@hcm/ui';
import { describe, expect, it, vi } from 'vitest';

import { CityTheme, cityThemeOf } from '../../src/app/city-theme.js';
import { FakeDocuments, shellStateAccess } from './fakes.js';

const THEME = { seedColor: '#6750a4', tokens: BASELINE_THEME };

function cityTheme(cityId: string | null = 'bucharest') {
    const documents = new FakeDocuments();
    documents.data.set('cities/bucharest', { theme: THEME, published: true });
    const shell = shellStateAccess();
    const denied = vi.fn();
    const subject = new CityTheme({ documents, shell, cityId, denied });
    const enter = (auth: 'admin' | 'signedOut'): void => {
        shell.update({ auth });
        subject.stateChanged(shell.get());
    };
    return { documents, shell, denied, subject, enter };
}

describe('CityTheme', () => {
    it('happyPath_theSignedInAdminWearsTheCitysTokensLive', () => {
        const c = cityTheme();

        c.enter('admin');
        c.enter('admin');
        expect(c.shell.get().theme.city).toEqual(BASELINE_THEME);
        c.documents.watchers.get('cities/bucharest')?.onNext({ published: true });

        expect(c.shell.get().theme.city).toBeNull();
        expect(c.documents.watchers.size).toBe(1);
    });

    it('happyPath_leavingTheShellStopsTheWatch', () => {
        const c = cityTheme();
        c.enter('admin');

        c.enter('signedOut');
        c.enter('signedOut');

        expect(c.documents.stopped).toBe(1);
    });

    it('badPath_aDeniedReadAsksWhoThisIs', () => {
        const c = cityTheme();
        c.enter('admin');

        c.documents.watchers.get('cities/bucharest')?.onError('unavailable');
        c.enter('admin');
        c.documents.watchers.get('cities/bucharest')?.onError('permission-denied');

        expect(c.denied).toHaveBeenCalledTimes(1);
    });

    it('badPath_withoutACityNothingIsWatched', () => {
        const c = cityTheme(null);

        c.enter('admin');

        expect(c.documents.watchers.size).toBe(0);
    });
});

describe('cityThemeOf', () => {
    it('badPath_aMissingOrInvalidThemeIsNone', () => {
        expect(cityThemeOf(null)).toBeNull();
        expect(cityThemeOf({ theme: { seedColor: 'red' } })).toBeNull();
        expect(cityThemeOf({ theme: THEME })).toEqual(BASELINE_THEME);
    });
});
