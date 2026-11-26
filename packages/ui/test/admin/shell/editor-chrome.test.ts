import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminPageElement } from '../../../src/admin/admin-port.js';
import { failureText, formatDay, whoText } from '../../../src/admin/editing/states.js';
import type { HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { fillsPage, type HcmPageOutlet } from '../../../src/admin/shell/hcm-page-outlet.js';
import { adminState, cleanup, deep, deepAll, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

class PlainPage extends HTMLElement implements AdminPageElement {
    app: AdminPageElement['app'] = null;
    state: AdminPageElement['state'] = null;
}

class FillingPage extends PlainPage {
    static readonly fillsPage = true;
}

describe('the page area for the editors', () => {
    beforeAll(() => {
        defineAll();
        customElements.define('hcm-plain-page', PlainPage);
        customElements.define('hcm-filling-page', FillingPage);
    });
    afterEach(cleanup);

    it('happyPath_aFillingPageGetsThePageAreasHeightAndAnotherPageScrollsAsBefore', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'jobs', params: [] } }));
        app.pages = { jobs: 'hcm-filling-page', admins: 'hcm-plain-page' };
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);
        const filled = outlet.hasAttribute('fill');

        outlet.state = adminState({ route: { id: 'admins', params: [] } });
        await updated(outlet);

        expect([filled, outlet.hasAttribute('fill')]).toEqual([true, false]);
        expect([fillsPage(null), fillsPage(document.createElement('div'))]).toEqual([false, false]);
    });

    it('happyPath_aCompactEditorHidesTheBarForItsOwnPageOnly', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'jobs', params: ['b'] } }));
        app.pages = { jobs: 'hcm-filling-page', admins: 'hcm-plain-page' };
        const shell = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 360);
        await updated(shell);

        deep(shell, 'hcm-filling-page').dispatchEvent(
            new CustomEvent('hcm-chrome', { detail: { chrome: 'editor' }, bubbles: true, composed: true }),
        );
        await updated(shell);
        const editor = [deep(shell, '.frame').dataset['nav'], deepAll(shell, 'hcm-admin-nav').length];
        expect(await axeViolations(shell)).toEqual([]);
        app.set({ route: { id: 'admins', params: [] } });
        await updated(shell);

        expect(editor).toEqual(['none', 0]);
        expect([deep(shell, '.frame').dataset['nav'], deepAll(shell, 'hcm-admin-nav').length]).toEqual(['bar', 1]);
    });

    it('badPath_theEditorChromeKeepsTheRailOfAWideWindow', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'jobs', params: ['b'] } }));
        app.pages = { jobs: 'hcm-filling-page' };
        const shell = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 1300);
        await updated(shell);

        deep(shell, 'hcm-filling-page').dispatchEvent(
            new CustomEvent('hcm-chrome', { detail: { chrome: 'editor' }, bubbles: true, composed: true }),
        );
        await updated(shell);

        expect(deep(shell, '.frame').dataset['nav']).toBe('expanded');
    });

    it('happyPath_aNoticeWithAnActionShowsItAndRunsIt', async () => {
        const ran: string[] = [];
        const app = new FakeAdminApp(adminState());
        const shell = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 1300);
        app.set({
            notice: {
                id: 1,
                key: 'adminContent.history.restored',
                params: { count: '2' },
                action: { key: 'adminContent.common.retry', run: () => ran.push('undo') },
            },
        });
        await updated(shell);

        const snackbar = deep(shell, 'hcm-snackbar') as HTMLElement & { actionLabel: string; message: string; timeoutMs: number };
        expect([snackbar.message, snackbar.actionLabel, snackbar.timeoutMs]).toEqual([
            'Restored. The public map follows within about a minute.',
            'Try again',
            10_000,
        ]);
        snackbar.dispatchEvent(new CustomEvent('hcm-action'));
        app.set({ notice: { id: 2, key: 'adminShell.admins.removed' } });
        await updated(shell);
        snackbar.dispatchEvent(new CustomEvent('hcm-action'));

        expect(ran).toEqual(['undo']);
        expect([snackbar.actionLabel, snackbar.timeoutMs]).toEqual(['', 8000]);
    });

    it('happyPath_leavingAnUnsavedEditAsksAndKeepEditingIsTheFocusedAnswer', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS }));
        const shell = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, 1300);
        const dialog = deep(shell, 'hcm-confirm-dialog') as HTMLElement & { open: boolean; headline: string };
        const closed = dialog.open;

        app.set({ leaving: { kind: 'route', route: { id: 'photos', params: [] } } });
        await updated(shell);
        const asked = [dialog.open, dialog.headline];
        expect(await axeViolations(shell)).toEqual([]);
        deep(dialog, '.cancel').click();
        app.set({ leaving: null });
        await updated(shell);
        app.set({ leaving: { kind: 'signOut' } });
        await updated(shell);
        deep(dialog, '.confirm').click();

        expect([closed, ...asked]).toEqual([false, true, 'Discard your changes?']);
        expect(app.calls.filter((call) => call === 'stayOnPage' || call === 'leavePage')).toEqual(['stayOnPage', 'leavePage']);
    });

    it('happyPath_whoWhenAndWhyAsText', () => {
        expect(whoText('en', 'u1', 'u1')).toBe('you');
        expect(whoText('en', 'system:photos', 'u1')).toBe('the server');
        expect(whoText('en', 'u2', null, { u2: 'Ion' })).toBe('Ion');
        expect(whoText('ro', 'u3', null)).toBe('alt administrator');
        // Said after "de" ("Modificat de tine", "Pornită de server"): the forms that follow a preposition.
        expect([whoText('ro', 'u1', 'u1'), whoText('ro', 'system:photos', 'u1')]).toEqual(['tine', 'server']);
        expect(failureText('en', null)).toBe('This could not be read. Try again.');
        expect(formatDay('en', '2026-10-17T10:00:00.000Z')).toBe('Oct 17, 2026');
    });
});
