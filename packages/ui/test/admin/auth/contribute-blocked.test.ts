import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminStatePort } from '../../../src/admin/admin-port.js';
import type { HcmBlockedPanel } from '../../../src/admin/auth/hcm-blocked-panel.js';
import type { HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

/**
 * M13 §3: on the Contribute page's address every blocked state speaks to a contributor: the welcome's heading, "the map is
 * resting" with Try again, "not open yet", and Back to the map; never "Map administration", "does not administer", another
 * account or the owner's check with Google.
 */
const WELCOME = { cityId: 'bucharest', cityName: 'București', mapUrl: 'https://demo-hcm.web.app/' };
const ADMIN_COPY = ['Map administration', 'administer', 'Use another Google account', 'Administrarea hărții', 'administrează'];

function contributor(overrides: Partial<AdminStatePort>): AdminStatePort {
    return adminState({ user: { uid: 'u', email: 'visitor@e2e.test', displayName: null }, role: null, welcome: WELCOME, ...overrides });
}

async function blocked(app: FakeAdminApp): Promise<HcmBlockedPanel> {
    const element = await mount<HcmBlockedPanel>(html`<hcm-blocked-panel .app=${app} .state=${app.state}></hcm-blocked-panel>`);
    await updated(element);
    return element;
}

function withoutAdminCopy(element: Element): void {
    const text = deepText(element);
    for (const copy of ADMIN_COPY) {
        expect(text).not.toContain(copy);
    }
}

describe('<hcm-blocked-panel> on the Contribute page', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_aServerThatDoesNotAnswerIsRestingWithTryAgainAndTheWayBack @S-A92-BAD-CONTRIBUTE-BUSY', async () => {
        const app = new FakeAdminApp(contributor({ auth: 'backendDown', locale: 'en' }));
        const element = await blocked(app);

        deepAll(element, 'hcm-button')[0]?.click();

        expect(deep(element, 'h1').textContent).toBe('Contribute to the map of București');
        expect(deepText(element)).toContain('The map is resting. Try again in a minute.');
        expect(deepText(element)).toContain('Try again');
        const back = deep(element, 'a.back') as HTMLAnchorElement;
        expect(back.textContent).toBe('Back to the map');
        expect(back.getAttribute('href')).toBe('https://demo-hcm.web.app/');
        expect(deepAll(element, 'hcm-button')).toHaveLength(1);
        expect(app.calls).toEqual(['retry']);
        withoutAdminCopy(element);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRefusedSessionShowsItsReason_neverNotAnAdmin @S-A92-BAD-CONTRIBUTE-SESSION', async () => {
        const issue = { id: 1, key: 'apiError.unauthenticated' } as const;
        const app = new FakeAdminApp(
            contributor({ auth: 'backendDown', locale: 'ro', gate: { reconsent: false, issue, enableApi: null } }),
        );
        const element = await blocked(app);

        expect(deep(element, 'h1').textContent).toBe('Contribuie la harta orașului București');
        expect(deepText(element)).toContain('Harta se odihnește. Încearcă din nou peste un minut.');
        expect(deepAll(element, '.issue')).toHaveLength(1);
        expect(deep(element, 'a.back').textContent).toBe('Înapoi la hartă');
        withoutAdminCopy(element);
    });

    it.each(['contributeClosed', 'notAdmin', 'notOwner'] as const)('badPath_%s_isNotOpenYet_withOnlyTheWayBack', async (auth) => {
        const app = new FakeAdminApp(contributor({ auth, locale: 'en', welcome: { ...WELCOME, cityName: null } }));
        const element = await blocked(app);

        expect(deep(element, 'h1').textContent).toBe('Contribute to the map');
        expect(deepText(element)).toContain('Contributions to this map are not open yet.');
        expect(deepAll(element, 'hcm-button')).toEqual([]);
        expect(deepAll(element, 'a.back')).toHaveLength(1);
        withoutAdminCopy(element);
    });

    it('badPath_aMissingConfigurationOffersReloadInAContributorsWords', async () => {
        const app = new FakeAdminApp(contributor({ auth: 'configMissing', user: null, locale: 'en' }));
        const element = await blocked(app);

        deepAll(element, 'hcm-button')[0]?.click();

        expect(deepText(element)).toContain('The map is resting.');
        expect(app.calls).toEqual(['reload']);
    });

    it('badPath_elsewhereAnUnopenedMapStaysInTheAdministrationsWords', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'contributeClosed', locale: 'en' }));
        const element = await blocked(app);

        expect(deep(element, 'h1').textContent).toBe('Map administration');
        expect(deepAll(element, 'a.back')).toEqual([]);
    });
});

describe('<hcm-admin-shell> loading on the Contribute page', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    async function shell(app: FakeAdminApp): Promise<HcmAdminShell> {
        const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 1300);
        await updated(element);
        return element;
    }

    it('happyPath_theGoogleWindowIsSaidWhileSigningIn', async () => {
        const element = await shell(new FakeAdminApp(contributor({ auth: 'signingIn', locale: 'en' })));

        expect(deep(element, '.loading p').textContent).toBe('Continue in the Google window…');
    });

    it('badPath_neverTheOwnersCheckWithGoogle_whileElsewhereItIsSaid', async () => {
        const app = new FakeAdminApp(contributor({ auth: 'claiming', locale: 'en' }));
        const element = await shell(app);
        expect(deep(element, '.loading p').textContent).toBe('Loading…');

        app.set({ welcome: null });
        await updated(element);
        expect(deep(element, '.loading p').textContent).toBe('Checking with Google that you own the project…');
    });
});
