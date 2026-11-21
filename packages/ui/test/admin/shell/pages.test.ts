import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AdminPageElement } from '../../../src/admin/admin-port.js';
import type { HcmPageOutlet } from '../../../src/admin/shell/hcm-page-outlet.js';
import { adminState, cleanup, deep, deepAll, defineAll, FakeAdminApp, mount, updated } from './fake-app.js';

class TestPage extends HTMLElement implements AdminPageElement {
    app: AdminPageElement['app'] = null;
    state: AdminPageElement['state'] = null;
}

describe('<hcm-page-outlet>', () => {
    beforeAll(() => {
        defineAll();
        customElements.define('hcm-test-page', TestPage);
    });
    afterEach(cleanup);

    it('happyPath_theRoutesPageIsCreatedAndFollowsTheState', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'admins', params: [] } }));
        app.pages = { admins: 'hcm-test-page' };
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);

        const page = deep(outlet, 'hcm-test-page') as TestPage;
        expect(page.app).toBe(app);
        outlet.state = adminState({ route: { id: 'admins', params: ['x'] }, locale: 'ro' });
        await updated(outlet);

        expect(page.state?.locale).toBe('ro');
        expect(app.named('loadPage')).toEqual(['loadPage admins']);
    });

    it('badPath_aRouteWithoutAPageSaysSoAndAnotherRouteLoadsAgain', async () => {
        const app = new FakeAdminApp(adminState());
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);

        expect(deep(outlet, '[role="status"]').textContent).toBe('This page is not available yet.');
        app.pages = { photos: 'hcm-test-page' };
        outlet.state = adminState({ route: { id: 'photos', params: [] } });
        await updated(outlet);

        expect(deepAll(outlet, 'hcm-test-page')).toHaveLength(1);
        expect(await axeViolations(outlet)).toEqual([]);
    });

    it('badPath_aSlowerEarlierLoadNeverReplacesALaterOne', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'photos', params: [] } }));
        const pending: { release?: (tag: string) => void } = {};
        vi.spyOn(app, 'loadPage').mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    pending.release = resolve;
                }),
        );
        app.pages = { admins: 'hcm-test-page' };
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        expect(deep(outlet, '[role="status"]').textContent).toBe('Loading…');

        outlet.state = adminState({ route: { id: 'admins', params: [] } });
        await updated(outlet);
        pending.release?.('hcm-test-page');
        await updated(outlet);

        expect((deep(outlet, 'hcm-test-page') as TestPage).state?.route.id).toBe('admins');
    });

    it('badPath_aPageWhoseChunkDoesNotLoadSaysSoAndRetryLoadsItAgain', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'photos', params: [] }, locale: 'ro' }));
        app.pages = { photos: 'hcm-test-page' };
        vi.spyOn(app, 'loadPage').mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module'));
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .app=${app} .state=${app.state}></hcm-page-outlet>`);
        await updated(outlet);

        expect(deep(outlet, '[role="alert"] p').textContent).toBe(
            'Pagina nu s-a încărcat. Verifică legătura la internet și încearcă din nou.',
        );
        expect(await axeViolations(outlet)).toEqual([]);
        deep(outlet, 'hcm-button').click();
        await updated(outlet);
        await updated(outlet);

        expect(deepAll(outlet, 'hcm-test-page')).toHaveLength(1);
        expect(deepAll(outlet, '[role="alert"]')).toHaveLength(0);
    });

    it('badPath_withoutAnAppOrStateNothingLoads', async () => {
        const outlet = await mount<HcmPageOutlet>(html`<hcm-page-outlet .state=${adminState()}></hcm-page-outlet>`);
        const blank = await mount<HcmPageOutlet>(html`<hcm-page-outlet></hcm-page-outlet>`);

        expect(deep(outlet, '[role="status"]').textContent).toBe('Loading…');
        expect(deep(blank, '[role="status"]').textContent).toBe('');
    });
});
