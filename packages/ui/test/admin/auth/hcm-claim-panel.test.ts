import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminStatePort } from '../../../src/admin/admin-port.js';
import { defineHcmClaimPanel, HCM_CLAIM_PANEL_TAG, HcmClaimPanel } from '../../../src/admin/auth/hcm-claim-panel.js';
import type { HcmConsentNote } from '../../../src/admin/auth/hcm-consent-note.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount } from '../shell/fake-app.js';

function button(root: Element, text: string): HTMLElement {
    const found = deepAll(root, 'hcm-button').find((candidate) => deepText(candidate).includes(text));
    if (found === undefined) {
        throw new Error(`no button "${text}"`);
    }
    return found;
}

describe('<hcm-claim-panel>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_rendersClaimPanelAndTriggersClaimIntent', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'claimPending', role: null }));
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${app} .state=${app.state}></hcm-claim-panel>`);

        button(panel, 'Confirm with Google').click();

        const note = deep(panel, 'hcm-consent-note') as HcmConsentNote;
        expect(deep(panel, 'h1').textContent).toBe('Confirm that you own Google Cloud project demo-hcm');
        expect(note.scope).toBe('cloudReadOnly');
        expect(note.projectId).toBe('demo-hcm');
        expect(note.domain).toBe('demo-hcm.firebaseapp.com');
        expect(app.named('claim')).toHaveLength(1);
        expect(await axeViolations(panel)).toEqual([]);
    });

    it('happyPath_offersSwitchingToAnotherAccount', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'claimPending', role: null }));
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${app} .state=${app.state}></hcm-claim-panel>`);

        button(panel, 'Use another Google account').click();

        expect(app.named('signOut')).toHaveLength(1);
    });

    it('badPath_clickingClaimWithoutAppIsANoOp', async () => {
        const state: AdminStatePort = adminState({ auth: 'claimPending', busy: false, role: null });
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${null} .state=${state}></hcm-claim-panel>`);

        button(panel, 'Confirm with Google').click();

        expect(button(panel, 'Confirm with Google').hasAttribute('disabled')).toBe(false);
    });

    it('badPath_busyDisablesClaimButtonAndShowsIssue', async () => {
        const state: AdminStatePort = adminState({
            auth: 'claimPending',
            busy: true,
            gate: { reconsent: false, issue: { id: 3, key: 'apiError.claim.tokenMismatch' }, enableApi: null },
        });
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel .app=${null} .state=${state}></hcm-claim-panel>`);

        expect(button(panel, 'Confirm with Google').hasAttribute('disabled')).toBe(true);
        expect(deep(panel, '[role="alert"]').textContent.trim()).not.toBe('');
    });

    it('badPath_withoutStateRendersNothing', async () => {
        const panel = await mount<HcmClaimPanel>(html`<hcm-claim-panel></hcm-claim-panel>`);

        expect(deepText(panel)).toBe('');
    });

    it('happyPath_defineHcmClaimPanelRegistersOnce', () => {
        const entries = new Map<string, CustomElementConstructor>();
        let defineCalls = 0;
        const registry = {
            get: (name: string): CustomElementConstructor | undefined => entries.get(name),
            define: (name: string, ctor: CustomElementConstructor): void => {
                defineCalls += 1;
                entries.set(name, ctor);
            },
        } as unknown as CustomElementRegistry;

        defineHcmClaimPanel(registry);
        defineHcmClaimPanel(registry);
        defineHcmClaimPanel();

        expect(defineCalls).toBe(1);
        expect(entries.get(HCM_CLAIM_PANEL_TAG)).toBe(HcmClaimPanel);
    });
});
