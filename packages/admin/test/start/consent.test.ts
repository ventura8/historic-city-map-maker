import { describe, expect, it } from 'vitest';

import { AUTHORIZE_URL, consentUrl, readConsentAnswer, START_SCOPES } from '../../src/start/consent.js';
import { clearPlan, loadPlan, parsePlan, savePlan } from '../../src/start/plan.js';

describe('Google consent, in this tab', () => {
    it('happyPath_theAddressAsksForATokenOnTheFragment', () => {
        const url = new URL(
            consentUrl({
                authorizeUrl: AUTHORIZE_URL,
                clientId: 'c',
                redirectUri: 'https://s/',
                state: 's1',
                loginHint: 'a@b',
                testId: 't',
            }),
        );
        expect(url.searchParams.get('response_type')).toBe('token');
        expect(url.searchParams.get('scope')).toBe(START_SCOPES.join(' '));
        expect(url.searchParams.get('login_hint')).toBe('a@b');
        expect(url.searchParams.get('test')).toBe('t');
        const plain = new URL(consentUrl({ authorizeUrl: AUTHORIZE_URL, clientId: 'c', redirectUri: 'https://s/', state: 's1' }));
        expect(plain.searchParams.has('login_hint')).toBe(false);
        expect(plain.searchParams.has('test')).toBe(false);
    });

    it('happyPath_theAnswerBecomesAToken', () => {
        const fragment = `#access_token=x&state=s1&scope=${encodeURIComponent(START_SCOPES.join(' '))}&expires_in=10`;
        expect(readConsentAnswer(fragment, 's1', 5)).toEqual({
            kind: 'granted',
            grant: { token: 'x', scopes: [...START_SCOPES], expiresAt: 10_005 },
        });
        const noLifetime = `#access_token=x&state=s1&scope=${encodeURIComponent(START_SCOPES.join(' '))}`;
        expect(readConsentAnswer(noLifetime, 's1', 0)).toMatchObject({ grant: { expiresAt: 3_540_000 } });
    });

    it('badPath_whatGivesNothing', () => {
        expect(readConsentAnswer('', null, 0)).toEqual({ kind: 'none' });
        expect(readConsentAnswer('#17/44/26', null, 0)).toEqual({ kind: 'none' });
        expect(readConsentAnswer('#access_token=x&state=s1', null, 0)).toEqual({ kind: 'wrongState' });
        expect(readConsentAnswer('#access_token=x&state=other', 's1', 0)).toEqual({ kind: 'wrongState' });
        expect(readConsentAnswer('#error=access_denied&state=s1', 's1', 0)).toEqual({ kind: 'denied' });
        expect(readConsentAnswer('#access_token=x&state=s1', 's1', 0)).toEqual({ kind: 'scope' });
        expect(readConsentAnswer(`#access_token=&state=s1&scope=${encodeURIComponent(START_SCOPES.join(' '))}`, 's1', 0)).toEqual({
            kind: 'scope',
        });
    });
});

describe('the plan in the tab', () => {
    const PLAN = { projectId: 'my-project', displayName: 'My project', create: true, city: { id: 'bacau', name: { ro: 'Bacău' } } };
    const session = (): Parameters<typeof savePlan>[0] => {
        const values = new Map<string, string>();
        return {
            get: (key) => values.get(key) ?? null,
            set: (key, value) => {
                values.set(key, value);
            },
            remove: (key) => {
                values.delete(key);
            },
            keys: () => [...values.keys()],
        };
    };

    it('happyPath_keptAndCleared', () => {
        const store = session();
        expect(loadPlan(store)).toBeNull();
        savePlan(store, PLAN);
        expect(loadPlan(store)).toEqual(PLAN);
        clearPlan(store);
        expect(loadPlan(store)).toBeNull();
    });

    it('badPath_whatIsNotAPlanCountsAsNone', () => {
        const store = session();
        store.set('hcm:start:plan', '{not json');
        expect(loadPlan(store)).toBeNull();
        expect(parsePlan({ projectId: 'X', displayName: 'x', create: true, city: {} })).toBeNull();
    });
});
