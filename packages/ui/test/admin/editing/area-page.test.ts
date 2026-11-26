// `AreaPage` (packages/ui/src/admin/editing/area-page.ts), the base of every editor area's page: which store it follows,
// when it opens and closes it, and what it reads before the shell gives it an app or a state.
import { html, type TemplateResult } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdminRouteIdPort } from '../../../src/admin/admin-port.js';
import type { AreaPort, ContentPort } from '../../../src/admin/content-port.js';
import { AreaPage } from '../../../src/admin/editing/area-page.js';
import { adminState, FakeAdminApp } from '../shell/fake-app.js';
import { FakeArea } from './fake-area.js';

interface ProbeState {
    readonly name: string;
}

interface ProbeIntents {
    retry(): void;
}

/** A page of the jobs route that shows what the base gives it. */
class ProbePage extends AreaPage<ProbeState, ProbeIntents> {
    protected readonly route: AdminRouteIdPort = 'jobs';

    protected storeOf(content: ContentPort): AreaPort<ProbeState, ProbeIntents> | null {
        return content.jobs as unknown as AreaPort<ProbeState, ProbeIntents> | null;
    }

    /** What a subclass reads: the locale, the params, the intents, an item's address. */
    probe(): { readonly locale: string; readonly params: readonly string[]; readonly intents: boolean; readonly href: string } {
        return { locale: this.locale, params: this.params, intents: this.intents !== null, href: this.href(['a', 'b']) };
    }

    back(): void {
        this.go([]);
    }

    protected override render(): TemplateResult {
        return html`<p>${this.view?.name ?? 'none'}</p>`;
    }
}
customElements.define('hcm-test-probe-page', ProbePage);

const pages: ProbePage[] = [];

async function connected(page: ProbePage): Promise<ProbePage> {
    document.body.append(page);
    pages.push(page);
    await page.updateComplete;
    return page;
}

afterEach(() => {
    for (const page of pages.splice(0)) {
        page.remove();
    }
});

describe('AreaPage', () => {
    it('badPath_withoutAnAppOrAStateItFollowsNothingAndReadsTheDefaults', async () => {
        const page = await connected(new ProbePage());

        expect(page.probe()).toEqual({ locale: 'ro', params: [], intents: false, href: '#/jobs/a/b' });
        expect(page.shadowRoot?.textContent).toContain('none');
        expect((page.constructor as typeof AreaPage).fillsPage).toBe(true);
    });

    it('happyPath_itFollowsItsStoreOpensItWithItsRoutesParamsOnceAndClosesItWhenRemoved', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'jobs', params: ['j1'] } }));
        const store = new FakeArea<ProbeState, ProbeIntents>({ name: 'first' });
        app.areas.jobs = store;
        const page = new ProbePage();
        page.app = app;
        page.state = app.state;
        await connected(page);

        store.set({ name: 'second' });
        page.state = { ...app.state, locale: 'en' };
        await page.updateComplete;

        expect(page.shadowRoot?.textContent).toContain('second');
        expect(page.probe()).toEqual({ locale: 'en', params: ['j1'], intents: true, href: '#/jobs/a/b' });
        expect(store.named('open')).toEqual(['open ["j1"]']);
        page.back();
        expect(app.named('navigate')).toEqual(['navigate {"id":"jobs","params":[]}']);
        page.remove();
        expect(store.named('close')).toEqual(['close']);
        expect(store.listening).toBe(0);
    });

    it('badPath_anotherRoutesParamsNeitherOpenTheStoreNorReachThePage', async () => {
        const app = new FakeAdminApp(adminState({ route: { id: 'admins', params: ['u1'] } }));
        const store = new FakeArea<ProbeState, ProbeIntents>({ name: 'jobs' });
        app.areas.jobs = store;
        const page = new ProbePage();
        page.app = app;
        page.state = app.state;
        await connected(page);

        expect(page.probe().params).toEqual([]);
        expect(store.named('open')).toEqual([]);
    });

    it('badPath_anAppWithoutTheAreasStoreLeavesThePageEmptyAndAnotherAppFollowsItsOwn', async () => {
        const empty = new FakeAdminApp(adminState({ route: { id: 'jobs', params: [] } }));
        const page = new ProbePage();
        page.app = empty;
        page.state = empty.state;
        await connected(page);
        expect(page.probe().intents).toBe(false);

        const app = new FakeAdminApp(adminState({ route: { id: 'jobs', params: [] } }));
        const store = new FakeArea<ProbeState, ProbeIntents>({ name: 'arrived' });
        app.areas.jobs = store;
        page.app = app;
        await page.updateComplete;

        expect(page.shadowRoot?.textContent).toContain('arrived');
        expect(store.named('open')).toEqual(['open []']);
    });
});
