import { html, render, type TemplateResult } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AdminPanel, issueTemplate } from '../../../src/admin/auth/panel.js';
import { EMPTY } from '../../../src/admin/shell/empty.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount } from '../shell/fake-app.js';

const TEST_PANEL_TAG = 'hcm-test-admin-panel';

class TestAdminPanel extends AdminPanel {
    protected override render(): TemplateResult {
        return this.otherAccount(this.state?.locale ?? 'en');
    }
}

function defineTestPanel(): void {
    defineAll();
    if (customElements.get(TEST_PANEL_TAG) === undefined) {
        customElements.define(TEST_PANEL_TAG, TestAdminPanel);
    }
}

describe('issueTemplate', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_rendersAnAlertWithTheNoticeMessage', () => {
        const host = document.createElement('div');
        document.body.append(host);

        render(issueTemplate('en', { key: 'adminShell.oauth.popupClosed' }), host);

        const alert = deep(host, 'p.issue[role="alert"]');
        expect(deep(alert, 'hcm-icon').getAttribute('name')).toBe('error');
        expect(deepText(alert)).toContain('The Google window closed before the end.');
    });

    it('badPath_returnsEmptyWhenThereIsNoIssue', () => {
        const host = document.createElement('div');
        document.body.append(host);

        const result = issueTemplate('en', null);
        render(result, host);

        expect(result).toBe(EMPTY);
        expect(deepAll(host, '[role="alert"]')).toEqual([]);
    });
});

describe('AdminPanel', () => {
    beforeAll(defineTestPanel);
    afterEach(cleanup);

    it('happyPath_otherAccountSignsOutThroughTheApp', async () => {
        const app = new FakeAdminApp(adminState({ locale: 'en' }));
        const panel = await mount<TestAdminPanel>(html`<hcm-test-admin-panel .app=${app} .state=${app.state}></hcm-test-admin-panel>`);

        const button = deep(panel, 'hcm-button');
        expect(deepText(button)).toContain('Use another Google account');
        button.click();

        expect(app.named('signOut')).toHaveLength(1);
    });

    it('badPath_startsWithNullAppAndStateAndIgnoresSignOutWithoutAnApp', async () => {
        const panel = await mount<TestAdminPanel>(html`<hcm-test-admin-panel></hcm-test-admin-panel>`);

        expect(panel.app).toBeNull();
        expect(panel.state).toBeNull();
        expect(() => {
            deep(panel, 'hcm-button').click();
        }).not.toThrow();
    });
});
