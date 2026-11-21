import { registerCatalogue } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AdminAuthStatePort } from '../../../src/admin/admin-port.js';
import { ADMIN_TAGS, defineAdminElements } from '../../../src/admin/define.js';
import { HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import { shellLayout, shownTokens, themeTokensOf, type HcmAdminShell } from '../../../src/admin/shell/hcm-admin-shell.js';
import { noticeOf, noticeText } from '../../../src/admin/shell/text.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

async function shell(app: FakeAdminApp | null, width = 1300): Promise<HcmAdminShell> {
    const element = await mount<HcmAdminShell>(html`<hcm-admin-shell .app=${app}></hcm-admin-shell>`, width);
    await updated(element);
    return element;
}

describe('<hcm-admin-shell>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aLargeWindowGetsTheExpandedRailTheTopBarAndThePage', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'admins', params: [] } }));
        app.pages = { admins: 'hcm-admins-page' };
        const element = await shell(app);

        const nav = deep(element, 'hcm-admin-nav') as HcmAdminNav;
        expect(nav.variant).toBe('expanded');
        expect(deep(element, '.top-bar h1').textContent).toBe('Admins');
        expect(deepAll(element, 'hcm-admins-page')).toHaveLength(1);
        expect(app.calls).toContain('setWindowClass "large"');
        expect(document.documentElement.lang).toBe('en');
        expect(document.title).toBe('Map administration');
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        [360, 'bar'],
        [700, 'rail'],
    ] as const)('happyPath_aWindow_%ipxWide_gets_%s', async (width, variant) => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS }));
        const element = await shell(app, width);

        expect((deep(element, 'hcm-admin-nav') as HcmAdminNav).variant).toBe(variant);
        expect(deep(element, '.frame').dataset['nav']).toBe(variant);
    });

    it('badPath_startUpModeShowsTheBannerAndSetupOnly', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'bootstrap', mode: 'bootstrap', locale: 'ro' }));
        const element = await shell(app);

        expect(deep(element, '[role="note"]').textContent).toBe(
            'Mod de pornire: harta nu are încă server, așa că pașii vorbesc direct cu Google.',
        );
        expect(document.documentElement.lang).toBe('ro');
        expect(document.title).toBe('Administrarea hărții');
    });

    it('badPath_aRevokedAdminKeepsThePageUnderABannerWithSignOut', async () => {
        // S-A20-BAD-REVOKED-WHILE-EDITING (DECISIONS-for-review.md §35e).
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS, revoked: true }));
        const element = await shell(app);

        const banner = deep(element, '.banner.revoked');
        expect(banner.getAttribute('role')).toBe('alert');
        expect(banner.textContent).toContain('Your access was removed: nothing more can be saved.');
        expect(deepAll(element, 'hcm-page-outlet')).toHaveLength(1);
        deep(deep(banner, 'hcm-button'), 'button').click();
        expect(app.calls).toContain('signOut');
        expect(await axeViolations(element)).toEqual([]);

        app.set({ revoked: false });
        await updated(element);
        expect(deepAll(element, '.banner.revoked')).toEqual([]);
    });

    it.each([
        ['starting', 'Loading…'],
        ['probing', 'Loading…'],
        ['signingIn', 'Continue in the Google window…'],
        ['claiming', 'Checking with Google that you own the project…'],
    ] as const)('happyPath_%s_showsWhatItWaitsFor', async (auth, text) => {
        const element = await shell(new FakeAdminApp(adminState({ auth })));

        expect(deep(element, '.loading p').textContent).toBe(text);
    });

    it.each([
        ['signedOut', 'hcm-sign-in'],
        ['claimPending', 'hcm-claim-panel'],
        ['joinPending', 'hcm-join-panel'],
        ['configMissing', 'hcm-blocked-panel'],
        ['notOwner', 'hcm-blocked-panel'],
        ['notAdmin', 'hcm-blocked-panel'],
        ['backendDown', 'hcm-blocked-panel'],
    ] as const satisfies readonly (readonly [AdminAuthStatePort, string])[])(
        'badPath_%s_showsItsPanelAndNoNavigation',
        async (auth, tag) => {
            const element = await shell(new FakeAdminApp(adminState({ auth })));

            expect(deepAll(element, tag)).toHaveLength(1);
            expect(deepAll(element, 'hcm-admin-nav')).toEqual([]);
        },
    );

    it('happyPath_theAppsStateChangesAreFollowedAndMessagesShowInTheSnackbar', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'signedOut' }));
        const element = await shell(app);

        app.set({ auth: 'admin', notice: { id: 1, key: 'adminShell.route.notFound' } });
        await updated(element);
        const snackbar = deep(element, 'hcm-snackbar');
        snackbar.dispatchEvent(new CustomEvent('hcm-dismiss', { detail: { reason: 'close' } }));

        expect((snackbar as unknown as { message: string }).message).toBe('That page does not exist, so you are on Setup.');
        expect(app.named('dismissNotice')).toHaveLength(1);
    });

    it('happyPath_theConsentBannerAsksOnceAndReportsTheAnswer', async () => {
        const app = new FakeAdminApp(adminState({ analytics: true, consent: 'unknown' }));
        const element = await shell(app);

        deep(element, 'hcm-consent-banner').dispatchEvent(new CustomEvent('hcm-consent', { detail: { decision: 'granted' } }));
        app.set({ consent: 'granted' });
        await updated(element);

        expect(app.calls).toContain('setConsent "granted"');
        expect(deepAll(element, 'hcm-consent-banner')).toEqual([]);
    });

    it('happyPath_aThemeChangeIsAppliedOnce', async () => {
        const app = new FakeAdminApp(adminState());
        const element = await shell(app);
        const background = (): string => getComputedStyle(element).getPropertyValue('--md-sys-color-surface').trim();
        const light = background();

        app.set({ theme: { mode: 'dark', city: null, preview: null } });
        await updated(element);
        app.set({ busy: true });
        await updated(element);

        expect(background()).not.toBe(light);
    });

    it('badPath_anotherAppReplacesTheSubscriptionAndDisconnectingStopsIt', async () => {
        const first = new FakeAdminApp(adminState());
        const second = new FakeAdminApp(adminState({ locale: 'ro' }));
        const element = await shell(first);

        element.app = second;
        await updated(element);
        expect(first.listening).toBe(0);
        expect(second.listening).toBe(1);
        element.remove();

        expect(second.listening).toBe(0);
    });

    it('badPath_withoutAnAppItWaits', async () => {
        const element = await shell(null);

        expect(deepText(element)).toContain('Se încarcă…');
    });
});

describe('the shell helpers', () => {
    it('happyPath_aLandscapePhoneGetsTheRailAndNoTopBar', () => {
        expect(shellLayout({ widthClass: 'medium', heightClass: 'compact' })).toEqual({ nav: 'rail', topBar: false });
        expect(shellLayout({ widthClass: 'extra-large', heightClass: 'expanded' })).toEqual({ nav: 'expanded', topBar: true });
    });

    it('happyPath_thePreviewWinsOverTheCityAndTheBaselineIsTheFallback', () => {
        const city = { ...BASELINE_THEME };
        const preview = { ...BASELINE_THEME };

        expect(themeTokensOf(adminState({ theme: { mode: 'system', city, preview } }))).toBe(preview);
        expect(themeTokensOf(adminState({ theme: { mode: 'system', city, preview: null } }))).toBe(city);
        expect(themeTokensOf(adminState())).toBe(BASELINE_THEME);
    });

    it('happyPath_theShellWearsTheDevicesAccentButThePreviewItsOwnColours', () => {
        document.documentElement.style.setProperty('--hcm-device-accent', '#0b57d0');
        const city = { ...BASELINE_THEME };
        const preview = { ...BASELINE_THEME };
        try {
            expect(shownTokens(adminState({ theme: { mode: 'system', city, preview: null } }), document)).not.toBe(city);
            expect(shownTokens(adminState({ theme: { mode: 'system', accent: 'device', city, preview } }), document)).toBe(preview);
        } finally {
            document.documentElement.style.removeProperty('--hcm-device-accent');
        }
    });

    it('badPath_mapColoursKeepTheCitysOwn', () => {
        const city = { ...BASELINE_THEME };

        expect(shownTokens(adminState({ theme: { mode: 'dark', accent: 'map', city, preview: null } }), document)).toBe(city);
    });

    it('happyPath_everyNoticeFamilyIsTranslated', () => {
        expect(noticeText('en', 'apiError.unavailable')).not.toBe('apiError.unavailable');
        expect(noticeText('ro', 'adminSetup.import.done')).not.toBe('adminSetup.import.done');
        expect(noticeText('en', 'adminShell.auth.signIn')).toBe('Sign in with Google');
        expect(noticeOf('en', null)).toBe('');
    });

    it('happyPath_defineRegistersEveryAdminElementOnce', () => {
        const registry = new Map<string, CustomElementConstructor>();
        const fake = {
            get: (tag: string) => registry.get(tag),
            define: (tag: string, element: CustomElementConstructor) => registry.set(tag, element),
        } as unknown as CustomElementRegistry;

        defineAdminElements(fake);
        defineAdminElements(fake);

        expect(ADMIN_TAGS.every((tag) => registry.has(tag))).toBe(true);
        expect(registry.get('hcm-admin-nav')).toBe(HcmAdminNav);
    });
});

describe('<hcm-admin-shell> a newer admin', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aNewerAdminServedOffersReloadPolitely_badPath_noneWhileThisOneIsServed', async () => {
        // Finding 29 of 2026-10-31: a tab left open across a redeploy runs the old admin.
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS }));
        const element = await shell(app);
        const status = deep(element, '.release-status');
        expect(status.getAttribute('role')).toBe('status');
        expect(deepAll(element, '.banner.release')).toEqual([]);

        app.set({ newRelease: '1.0.1+def5678' });
        await updated(element);
        const banner = deep(element, '.banner.release');
        expect(banner.textContent).toContain('A new version of the admin is ready. Reload the page to use it; you stay signed in.');
        expect(banner.dataset['release']).toBe('1.0.1+def5678');
        expect(deepAll(element, 'hcm-page-outlet')).toHaveLength(1);
        deep(deep(banner, 'hcm-button'), 'button').click();
        expect(app.calls).toContain('reload');
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-admin-shell> in a language being translated', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('a11y_aLanguageWithoutTheAdminsTextsMarksTheirEnglishFallback_happyPath_aTranslatedOneDoesNot', async () => {
        registerCatalogue('fa', { 'adminShell.nav.admins': 'مدیران' });
        const persian = await shell(
            new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'admins', params: [] }, locale: 'fa' })),
        );

        expect(document.documentElement.lang).toBe('fa');
        expect(deep(persian, '.scroller').getAttribute('lang')).toBe('en');
        expect(deep(persian, '.top-bar h1 span').getAttribute('lang')).toBe('fa');
        const labels = deepAll(deep(persian, 'hcm-admin-nav'), 'a.item .label').map((label) => label.getAttribute('lang'));
        expect(labels).toContain('fa');
        expect(labels).toContain('en');
        cleanup();

        const romanian = await shell(
            new FakeAdminApp(adminState({ destinations: DESTINATIONS, route: { id: 'admins', params: [] }, locale: 'ro' })),
        );
        expect(deep(romanian, '.scroller').getAttribute('lang')).toBe('ro');
    });
});

/** The framed screens are an app shell whose page never scrolls (packages/admin/src/admin.css); the sign-in panels are documents. */
describe('<hcm-admin-shell> data-frame', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theFramedScreensMarkTheShellAsAnAppShellAndThePanelsDoNot', async () => {
        const app = new FakeAdminApp(adminState({ destinations: DESTINATIONS }));
        const element = await shell(app);
        expect(element.hasAttribute('data-frame')).toBe(true);

        app.set({ auth: 'signedOut' });
        await updated(element);
        expect(element.hasAttribute('data-frame')).toBe(false);
    });
});
