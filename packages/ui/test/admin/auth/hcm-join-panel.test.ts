import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineHcmJoinPanel, HCM_JOIN_PANEL_TAG, type HcmJoinPanel } from '../../../src/admin/auth/hcm-join-panel.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount } from '../shell/fake-app.js';

function button(root: Element, text: string): HTMLElement {
    const found = deepAll(root, 'hcm-button').find((candidate) => deepText(candidate).includes(text));
    if (found === undefined) {
        throw new Error(`no button "${text}"`);
    }
    return found;
}

function fakeRegistry(): { registry: CustomElementRegistry; defined: string[] } {
    const entries = new Map<string, CustomElementConstructor>();
    const defined: string[] = [];
    const registry = {
        get: (name: string): CustomElementConstructor | undefined => entries.get(name),
        define: (name: string, ctor: CustomElementConstructor): void => {
            entries.set(name, ctor);
            defined.push(name);
        },
    } as unknown as CustomElementRegistry;
    return { registry, defined };
}

describe('<hcm-join-panel>', () => {
    beforeAll(() => {
        defineAll();
        defineHcmJoinPanel();
    });
    afterEach(cleanup);

    it('happyPath_registersOncePerRegistry', () => {
        const { registry, defined } = fakeRegistry();

        defineHcmJoinPanel(registry);
        defineHcmJoinPanel(registry);

        expect(defined).toEqual([HCM_JOIN_PANEL_TAG]);
    });

    it('happyPath_joinsWithAnAppWhenIdle', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'joinPending', locale: 'en', busy: false }));
        const panel = await mount<HcmJoinPanel>(html`<hcm-join-panel .app=${app} .state=${app.state}></hcm-join-panel>`);

        const joinButton = button(panel, 'Join');
        joinButton.click();

        expect(deep(panel, 'h1').textContent.trim()).not.toBe('');
        expect(joinButton.hasAttribute('disabled')).toBe(false);
        expect(deepAll(panel, '[role="alert"]')).toEqual([]);
        expect(app.named('join')).toHaveLength(1);
    });

    it('badPath_busyWithIssueAndNoAppDisablesJoinAndShowsAlert', async () => {
        const state = adminState({
            auth: 'joinPending',
            busy: true,
            gate: { reconsent: false, issue: { id: 4, key: 'apiError.invite.expired' }, enableApi: null },
        });
        const panel = await mount<HcmJoinPanel>(html`<hcm-join-panel .app=${null} .state=${state}></hcm-join-panel>`);

        const joinButton = button(panel, 'Join');
        joinButton.click();

        expect(joinButton.hasAttribute('disabled')).toBe(true);
        expect(deepAll(panel, '[role="alert"]')).toHaveLength(1);
    });

    it('badPath_withoutStateRendersNothing', async () => {
        const panel = await mount<HcmJoinPanel>(html`<hcm-join-panel></hcm-join-panel>`);

        expect(deepText(panel)).toBe('');
    });
});
