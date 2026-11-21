import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminStatePort } from '../../../src/admin/admin-port.js';
import type { HcmBlockedPanel } from '../../../src/admin/auth/hcm-blocked-panel.js';
import type { HcmClaimPanel } from '../../../src/admin/auth/hcm-claim-panel.js';
import type { HcmConsentNote } from '../../../src/admin/auth/hcm-consent-note.js';
import type { HcmJoinPanel } from '../../../src/admin/auth/hcm-join-panel.js';
import type { HcmSignIn } from '../../../src/admin/auth/hcm-sign-in.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const SIGNED_OUT = adminState({ auth: 'signedOut', user: null, role: null });

function button(root: Element, text: string): HTMLElement {
    const found = deepAll(root, 'hcm-button').find((candidate) => deepText(candidate).includes(text));
    if (found === undefined) {
        throw new Error(`no button "${text}"`);
    }
    return found;
}

describe('<hcm-sign-in>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_normalModeSignsInWithoutAConsentNote', async () => {
        const app = new FakeAdminApp(SIGNED_OUT);
        const panel = await mount<HcmSignIn>(html`<hcm-sign-in .app=${app} .state=${app.state}></hcm-sign-in>`);

        button(panel, 'Sign in with Google').click();

        expect(deepText(panel)).toContain('Sign in with the Google account that administers the map.');
        expect(deepAll(panel, 'hcm-consent-note')).toEqual([]);
        expect(app.named('signIn')).toHaveLength(1);
        expect(await axeViolations(panel)).toEqual([]);
    });

    it('happyPath_startUpModeExplainsTheReadOnlyConsentInRomanian', async () => {
        const app = new FakeAdminApp({ ...SIGNED_OUT, mode: 'bootstrap', locale: 'ro' });
        const panel = await mount<HcmSignIn>(html`<hcm-sign-in .app=${app} .state=${app.state}></hcm-sign-in>`);
        await updated(panel);

        const note = deep(panel, 'hcm-consent-note') as HcmConsentNote;
        expect(note.scope).toBe('cloudReadOnly');
        expect(deepText(panel)).toContain('Proprietarul proiectului Google Cloud demo-hcm o configurează de aici.');
        expect(deepText(note)).toContain('Atunci alege opțiunile avansate și continuă spre demo-hcm.firebaseapp.com.');
    });

    it('badPath_aReloadAsksToConfirmAgainAndOffersAnotherAccount', async () => {
        const app = new FakeAdminApp({
            ...SIGNED_OUT,
            mode: 'bootstrap',
            user: { uid: 'owner-uid', email: 'owner@e2e.test', displayName: null },
            gate: { reconsent: true, issue: { id: 1, key: 'adminShell.oauth.popupClosed' }, enableApi: null },
        });
        const panel = await mount<HcmSignIn>(html`<hcm-sign-in .app=${app} .state=${app.state}></hcm-sign-in>`);

        button(panel, 'Use another Google account').click();

        expect(deepText(panel)).toContain('To continue the setup, confirm with Google again.');
        expect(deep(panel, '[role="alert"]').textContent).toContain('The Google window closed before the end.');
        expect(app.named('signOut')).toHaveLength(1);
    });

    it('badPath_aDisabledResourceManagerIsEnabledFirst', async () => {
        const app = new FakeAdminApp({
            ...SIGNED_OUT,
            mode: 'bootstrap',
            gate: {
                reconsent: false,
                issue: { id: 2, key: 'apiError.cloud.apiDisabled', params: { api: 'cloudresourcemanager.googleapis.com' } },
                enableApi: 'cloudresourcemanager.googleapis.com',
            },
        });
        const panel = await mount<HcmSignIn>(html`<hcm-sign-in .app=${app} .state=${app.state}></hcm-sign-in>`);
        await updated(panel);

        button(panel, 'Enable with Google').click();

        expect((deep(panel, 'hcm-consent-note') as HcmConsentNote).scope).toBe('cloudPlatform');
        expect(deepText(panel)).toContain('cloudresourcemanager.googleapis.com');
        expect(app.named('enableApi')).toHaveLength(1);
    });

    it('badPath_withoutStateNothingRenders', async () => {
        const panel = await mount<HcmSignIn>(html`<hcm-sign-in></hcm-sign-in>`);

        expect(deepText(panel)).toBe('');
    });
});

describe('<hcm-claim-panel> and <hcm-join-panel>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theClaimAsksGoogleWithOneClick', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'claimPending', role: null }));
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${app} .state=${app.state}></hcm-claim-panel>`);

        button(panel, 'Confirm with Google').click();

        expect(deep(panel, 'h1').textContent).toBe('Confirm that you own Google Cloud project demo-hcm');
        expect((deep(panel, 'hcm-consent-note') as HcmConsentNote).scope).toBe('cloudReadOnly');
        expect(app.named('claim')).toHaveLength(1);
        expect(await axeViolations(panel)).toEqual([]);
    });

    it('badPath_aRunningClaimDisablesTheButtonAndARefusalShows', async () => {
        const state: AdminStatePort = adminState({
            auth: 'claimPending',
            busy: true,
            gate: { reconsent: false, issue: { id: 3, key: 'apiError.claim.tokenMismatch' }, enableApi: null },
        });
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${null} .state=${state}></hcm-claim-panel>`);

        button(panel, 'Confirm with Google').click();
        button(panel, 'Use another Google account').click();

        expect(button(panel, 'Confirm with Google').hasAttribute('disabled')).toBe(true);
        expect(deep(panel, '[role="alert"]').textContent.trim()).not.toBe('');
    });

    it('happyPath_anInvitationIsJoinedInRomanian', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'joinPending', locale: 'ro' }));
        const panel = await mount<HcmJoinPanel>(html`<hcm-join-panel .app=${app} .state=${app.state}></hcm-join-panel>`);

        button(panel, 'Alătură-te').click();

        expect(deep(panel, 'h1').textContent).toBe('Ai o invitație să administrezi harta');
        expect(app.named('join')).toHaveLength(1);
    });

    it('badPath_anExpiredInvitationShowsItsMessage', async () => {
        const state = adminState({
            auth: 'joinPending',
            gate: { reconsent: false, issue: { id: 4, key: 'apiError.invite.expired' }, enableApi: null },
        });
        const panel = await mount<HcmJoinPanel>(html`<hcm-join-panel .state=${state}></hcm-join-panel>`);

        button(panel, 'Join').click();

        expect(deepAll(panel, '[role="alert"]')).toHaveLength(1);
    });

    it('badPath_withoutStateTheyRenderNothing', async () => {
        const claim = await mount<HcmClaimPanel>(html`<hcm-claim-panel></hcm-claim-panel>`);
        const join = await mount<HcmJoinPanel>(html`<hcm-join-panel></hcm-join-panel>`);

        expect(deepText(claim) + deepText(join)).toBe('');
    });
});

describe('<hcm-blocked-panel>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aMissingConfigurationOffersReloadOnly', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'configMissing', user: null }));
        const panel = await mount<HcmBlockedPanel>(html`<hcm-blocked-panel .app=${app} .state=${app.state}></hcm-blocked-panel>`);

        button(panel, 'Reload the page').click();

        expect(deepText(panel)).toContain('The page did not load fully. Reload it.');
        expect(deepAll(panel, 'hcm-button')).toHaveLength(1);
        expect(app.named('reload')).toHaveLength(1);
        expect(await axeViolations(panel)).toEqual([]);
    });

    it('badPath_aServerDownOffersTryAgainAndAnotherAccount', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'backendDown' }));
        const panel = await mount<HcmBlockedPanel>(html`<hcm-blocked-panel .app=${app} .state=${app.state}></hcm-blocked-panel>`);

        button(panel, 'Try again').click();
        button(panel, 'Use another Google account').click();

        expect(app.calls).toEqual(['retry', 'signOut']);
    });

    it.each([
        ['notOwner', 'Only the owner of Google Cloud project demo-hcm can set up this map.'],
        ['notAdmin', 'This Google account does not administer this map.'],
    ] as const)('badPath_%s_isToldWhyAndMaySwitchAccounts', async (auth, message) => {
        const app = new FakeAdminApp(adminState({ auth }));
        const panel = await mount<HcmBlockedPanel>(html`<hcm-blocked-panel .app=${app} .state=${app.state}></hcm-blocked-panel>`);

        expect(deepText(panel)).toContain(message);
        expect(deepAll(panel, 'hcm-button')).toHaveLength(1);
    });

    it('badPath_anotherStateOrNoAppShowsNothingAndDoesNothing', async () => {
        const other = await mount<HcmBlockedPanel>(html`<hcm-blocked-panel .state=${adminState({ auth: 'admin' })}></hcm-blocked-panel>`);
        const orphan = await mount<HcmBlockedPanel>(
            html`<hcm-blocked-panel .state=${adminState({ auth: 'configMissing' })}></hcm-blocked-panel>`,
        );

        button(orphan, 'Reload the page').click();

        expect(deepText(other)).toBe('');
    });
});

describe('<hcm-consent-note>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it.each([
        ['cloudBilling', 'Google asks for access to billing: we link the account and create the 5 USD budget.'],
        ['cloudPlatform', "Google asks for access to Google Cloud: we prepare the map's services and storage."],
        ['analyticsEdit', "Google asks for access to Analytics: we stop measuring the map's address changes."],
    ] as const)('happyPath_%s_saysWhyForHowLongAndAboutGooglesScreen', async (scope, why) => {
        const note = await mount<HcmConsentNote>(
            html`<hcm-consent-note
                locale="en"
                scope=${scope}
                project-id="demo-hcm"
                amount="5 USD"
                domain="demo-hcm.firebaseapp.com"
            ></hcm-consent-note>`,
        );

        expect(deepText(note)).toContain(why);
        expect(deepText(note)).toContain('The permission stays in this tab only, for at most an hour, and is never saved.');
        expect(deepText(note)).toContain('Google may say that it has not verified this app.');
        expect(deep(note, 'aside').getAttribute('aria-label')).toBe('Google permission');
    });
});
