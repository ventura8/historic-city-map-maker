import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminStatePort } from '../../../src/admin/admin-port.js';
import { welcomeName, welcomeOf, type HcmSignIn } from '../../../src/admin/auth/hcm-sign-in.js';
import type { HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

/**
 * M13 §3: the Contribute page's address, signed out, welcomes a contributor in the visitor's language; the admin's sign-in
 * ("Map administration", "the Google account that administers the map") never shows there, and stays on every admin address.
 */
const WELCOME = { cityId: 'bucharest', cityName: 'București', mapUrl: 'https://demo-hcm.web.app/' };
const VISITOR = adminState({ auth: 'signedOut', user: null, role: null, mode: 'normal', welcome: WELCOME });
const ADMIN_COPY = ['Map administration', 'administers the map', 'Administrarea hărții', 'administrează harta'];

async function panel(state: AdminStatePort, app: FakeAdminApp | null = null): Promise<HcmSignIn> {
    const element = await mount<HcmSignIn>(html`<hcm-sign-in .app=${app} .state=${state}></hcm-sign-in>`);
    await updated(element);
    return element;
}

async function shell(app: FakeAdminApp): Promise<HcmAdminShell> {
    const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 1300);
    await updated(element);
    return element;
}

function signInButton(root: Element, text: string): HTMLElement {
    const found = deepAll(root, 'hcm-button').find((candidate) => deepText(candidate).includes(text));
    if (found === undefined) {
        throw new Error(`no button "${text}"`);
    }
    return found;
}

describe('<hcm-sign-in> on the Contribute page', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aVisitorIsWelcomedAsAContributorInEnglish @S-A92-HAPPY-WELCOME', async () => {
        const app = new FakeAdminApp({ ...VISITOR, locale: 'en' });
        const element = await panel(app.state, app);

        signInButton(element, 'Sign in with Google to contribute').click();

        expect(deep(element, 'h1').textContent).toBe('Contribute to the map of București');
        const text = deepText(element);
        expect(text).toContain('send photos and stories of the city');
        expect(text).toContain('suggest where a photo was taken, or the direction it looks');
        expect(text).toContain('become a contributor or a moderator, once an admin approves');
        expect(text).toContain('A Google account is needed only to send something');
        const back = deep(element, 'a.back') as HTMLAnchorElement;
        expect(back.textContent).toBe('Back to the map');
        expect(back.getAttribute('href')).toBe('https://demo-hcm.web.app/');
        expect(app.named('signIn')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_inRomanianTheTitleSaysTheMapOfTheCityNamesCity', async () => {
        const element = await panel({ ...VISITOR, locale: 'ro' });

        // „harta orașului București”: correct Romanian for any name, as „harta București” is not.
        expect(deep(element, 'h1').textContent).toBe('Contribuie la harta orașului București');
    });

    it('happyPath_inRomanian_andWithoutANameTheTitleNamesNoCity', async () => {
        const element = await panel({ ...VISITOR, locale: 'ro', welcome: { ...WELCOME, cityName: null } });

        expect(deep(element, 'h1').textContent).toBe('Contribuie la hartă');
        expect(deepText(element)).toContain('Conectează-te cu Google ca să contribui');
        expect(deepText(element)).toContain('Înapoi la hartă');
        signInButton(element, 'Conectează-te cu Google ca să contribui').click();
    });

    it('badPath_noAdminCopyOnTheContributePage_butAClosedPopupIsSaid @S-A92-BAD-NO-ADMIN-SIGN-IN', async () => {
        const issue = { id: 1, key: 'adminShell.oauth.popupClosed' } as const;
        const element = await panel({ ...VISITOR, locale: 'en', gate: { reconsent: false, issue, enableApi: null } });

        const text = deepText(element);
        for (const copy of ADMIN_COPY) {
            expect(text).not.toContain(copy);
        }
        expect(deep(element, '[role="alert"]').textContent).toContain('The Google window closed before the end.');
    });

    it('badPath_anAdminAddressStillShowsTheAdminsSignIn @S-A92-BAD-ADMIN-ROUTE', async () => {
        const element = await panel({ ...VISITOR, locale: 'en', welcome: null });

        expect(deep(element, 'h1').textContent).toBe('Map administration');
        expect(deepText(element)).toContain('Sign in with the Google account that administers the map.');
        expect(deepAll(element, 'a.back')).toEqual([]);
    });
});

describe('the welcome before the shell', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theTabSaysContributeAndTheCity_whileSignedOutOrLoading', async () => {
        const app = new FakeAdminApp({ ...VISITOR, locale: 'en' });
        const element = await shell(app);
        expect(document.title).toBe('Contribute · București');
        expect(deepAll(element, 'hcm-sign-in')).toHaveLength(1);

        app.set({ auth: 'signingIn' });
        await updated(element);
        expect(deep(element, 'h1.visually-hidden').textContent).toBe('Contribute');
        expect(document.title).toBe('Contribute · București');
    });

    it('badPath_aServerThatDidNotAnswerStillWelcomesAContributor_neverTheSetupIntro @S-A92-BAD-CONTRIBUTE-NO-SERVER', async () => {
        const bootstrap = { ...VISITOR, mode: 'bootstrap' as const, locale: 'en' as const };
        expect(welcomeOf(bootstrap)).toEqual(WELCOME);

        const element = await panel(bootstrap);

        expect(deep(element, 'h1').textContent).toBe('Contribute to the map of București');
        expect(deepAll(element, 'hcm-consent-note')).toEqual([]);
        expect(deepText(element)).not.toContain('demo-hcm');
    });

    it('badPath_theShellItselfIsTheAdministration', async () => {
        expect(welcomeOf(adminState({ auth: 'signedOut', user: null }))).toBeNull();
        expect(welcomeName(VISITOR, true)).toBeNull();
        expect(welcomeName({ ...VISITOR, locale: 'ro', welcome: { ...WELCOME, cityName: null } }, false)).toEqual({
            app: 'Contribuie',
            city: '',
        });

        const app = new FakeAdminApp({ ...VISITOR, auth: 'admin', locale: 'en' });
        const element = await shell(app);
        expect(document.title).toBe('Map administration');
        app.set({ auth: 'starting', welcome: null });
        await updated(element);
        expect(document.title).toBe('Map administration');
    });
});
