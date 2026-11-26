import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmAccountMenu } from '../../../src/admin/shell/hcm-account-menu.js';
import type { HcmAdminNav } from '../../../src/admin/shell/hcm-admin-nav.js';
import type { HcmLanguageSelect } from '../../../src/components/language-select.js';
import type { HcmSegmentedButton } from '../../../src/components/segmented-button.js';
import type { HcmSheet } from '../../../src/components/sheet.js';
import type { HcmSwitch } from '../../../src/components/switch.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, DESTINATIONS, FakeAdminApp, mount, updated } from './fake-app.js';

/** The words of an element's text that the browser broke across two lines (a range over one word with two line boxes). */
function brokenWords(element: Element): string[] {
    const broken: string[] = [];
    // Lit puts a comment marker before a bound text, so every text node is read, not the first child.
    for (const text of [...element.childNodes].filter((node): node is Text => node instanceof Text)) {
        for (const match of text.data.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(text, match.index);
            range.setEnd(text, match.index + match[0].length);
            const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
            if (tops.size > 1) {
                broken.push(match[0]);
            }
        }
    }
    return broken;
}

function links(nav: Element): HTMLAnchorElement[] {
    return deepAll(nav, 'a.item') as HTMLAnchorElement[];
}

describe('<hcm-admin-nav>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theCompactBarHoldsFourDestinationsAndMoreOpensTheRest', async () => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav variant="bar" current="jobs" locale="en" .destinations=${DESTINATIONS}></hcm-admin-nav>`,
            360,
        );

        expect(links(nav).map((link) => link.getAttribute('href'))).toEqual([
            '#/setup',
            '#/photos',
            '#/pois',
            '#/layers',
            '#/jobs',
            '#/admins',
        ]);
        const more = deep(nav, 'button.item');
        expect(more.textContent).toContain('More');
        more.click();
        await updated(nav);
        const sheet = deep(nav, 'hcm-sheet') as HcmSheet;
        expect(sheet.open).toBe(true);
        expect(more.getAttribute('aria-expanded')).toBe('true');
        const jobs = links(nav).find((link) => link.getAttribute('href') === '#/jobs');
        expect(jobs?.getAttribute('aria-current')).toBe('page');

        jobs?.addEventListener('click', (event) => {
            event.preventDefault();
        });
        jobs?.click();
        await updated(nav);

        expect(sheet.open).toBe(false);
        expect(await axeViolations(nav)).toEqual([]);
    });

    it.each([360, 320])('happyPath_onA %d px phoneEveryRomanianLabelOfTheBarKeepsItsWordsWhole', async (width) => {
        // The visual audit of 2026-10-18: "Configurare" broke after its tenth letter, its last "e" on a line of its own, at
        // 360 px, then at 320 px (the smallest tour window, the M2e review).
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav variant="bar" current="setup" locale="ro" .destinations=${DESTINATIONS}></hcm-admin-nav>`,
            width,
        );
        // Measured in the kit's own font (Roboto Flex), as the admin draws it, not a fallback.
        await document.fonts.load('500 12px "HCM Roboto Flex"', 'Configurare');
        await updated(nav);

        const labels = deepAll(nav, 'nav > .item .label');
        expect(labels.map((label) => label.textContent.trim())).toEqual(['Configurare', 'Fotografii', 'Locuri', 'Straturi', 'Mai mult']);
        expect(labels.flatMap((label) => brokenWords(label))).toEqual([]);
    });

    it('badPath_aBarWithFewDestinationsHasNoMore', async () => {
        const nav = await mount<HcmAdminNav>(html`<hcm-admin-nav variant="bar" .destinations=${DESTINATIONS.slice(0, 2)}></hcm-admin-nav>`);

        expect(deepAll(nav, 'button.item')).toEqual([]);
        expect(links(nav)[0]?.getAttribute('aria-current')).toBe('page');
    });

    it('happyPath_theSheetsOwnCloseClosesIt', async () => {
        const nav = await mount<HcmAdminNav>(html`<hcm-admin-nav variant="bar" .destinations=${DESTINATIONS}></hcm-admin-nav>`);
        deep(nav, 'button.item').click();
        await updated(nav);

        deep(nav, 'hcm-sheet').dispatchEvent(new CustomEvent('hcm-close', { bubbles: true, composed: true }));
        await updated(nav);

        expect(nav.moreOpen).toBe(false);
    });

    it.each(['rail', 'expanded'] as const)('happyPath_the_%s_listsEveryDestinationInRomanianWithAFoot', async (variant) => {
        const nav = await mount<HcmAdminNav>(
            html`<hcm-admin-nav .variant=${variant} current="admins" locale="ro" .destinations=${DESTINATIONS}
                ><span slot="foot">foot</span></hcm-admin-nav
            >`,
        );

        expect(links(nav)).toHaveLength(6);
        expect(deepText(nav)).toContain('Administratori');
        expect(deep(nav, 'nav').getAttribute('aria-label')).toBe('Navigare');
        expect(deep(nav, 'slot[name="foot"]')).toBeTruthy();
        expect(await axeViolations(nav)).toEqual([]);
    });
});

describe('<hcm-account-menu>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    async function opened(app: FakeAdminApp): Promise<HcmAccountMenu> {
        const menu = await mount<HcmAccountMenu>(html`<hcm-account-menu .app=${app} .state=${app.state}></hcm-account-menu>`);
        deep(menu, 'hcm-icon-button').click();
        await updated(menu);
        return menu;
    }

    it('happyPath_languageThemeConsentAndSignOut', async () => {
        const app = new FakeAdminApp(adminState({ analytics: true, consent: 'unknown' }));
        const menu = await opened(app);
        const language = deep(menu, 'hcm-language-select') as HcmLanguageSelect;
        const [theme, accent] = deepAll(menu, 'hcm-segmented-button') as HcmSegmentedButton[];
        expect(accent?.value).toBe('device');
        // The test browser is a Chromium tab: Device accent says it cannot show here and what shows instead.
        expect(deepText(menu)).toContain("This browser does not share your device's accent colour");

        language.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'ro' } }));
        language.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'en' } }));
        // Any of the interface's 25 languages (docs/I18N.md); an unknown code is ignored, and the list keeps the admin's
        // language until the app has switched.
        language.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'fa' } }));
        language.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'sv' } }));
        expect(language.options).toHaveLength(25);
        expect(language.value).toBe(app.state.locale);
        theme?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'dark' } }));
        theme?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'sepia' } }));
        accent?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'map' } }));
        // A value that is no choice reads as the default, the device's accent.
        accent?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'sepia' } }));
        const consent = deep(menu, 'hcm-switch') as HcmSwitch;
        consent.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        consent.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        deepAll(menu, 'hcm-button').at(-1)?.click();

        expect(deepText(menu)).toContain('Signed in as owner@e2e.test');
        expect(deepText(menu)).toContain('Anonymous usage and performance statistics of the administration (Google Analytics)');
        expect(app.calls).toEqual([
            'setLocale "ro"',
            'setLocale "en"',
            'setLocale "fa"',
            'setTheme "dark"',
            'setAccent "map"',
            'setAccent "device"',
            'setConsent "granted"',
            'setConsent "denied"',
            'signOut',
        ]);
        expect(menu.open).toBe(false);
    });

    it('badPath_aVisitorOnTheContributePageIsToldOfItsStatistics_neverTheAdministrations @S-A92-BAD-NO-ADMIN-SIGN-IN', async () => {
        const app = new FakeAdminApp(adminState({ auth: 'visitor', role: null, analytics: true, locale: 'ro' }));
        const menu = await opened(app);

        expect(deepText(menu)).toContain('Statistici anonime de utilizare și performanță ale paginii Contribuie (Google Analytics)');
        expect(deepText(menu)).not.toContain('administrării');
    });

    it('badPath_withoutAUserOrAnalyticsTheMenuHoldsThePreferencesOnly', async () => {
        const app = new FakeAdminApp(
            adminState({ user: null, analytics: false, locale: 'ro', theme: { mode: 'light', city: null, preview: null, accent: 'map' } }),
        );
        const menu = await opened(app);
        // Map colours chosen: no word on the device's accent.
        expect(deepText(menu)).not.toContain('Acest browser nu transmite');

        expect(deepAll(menu, 'hcm-switch')).toEqual([]);
        expect(deepAll(menu, 'hcm-button')).toEqual([]);
        expect(deepText(menu)).toContain('Ca dispozitivul');
        deep(menu, 'hcm-dialog').dispatchEvent(new CustomEvent('hcm-close', { detail: { returnValue: 'cancel' } }));
        await updated(menu);
        expect(menu.open).toBe(false);
    });

    it('happyPath_installAppWhileTheBrowserOffersIt_andTheAccentNoteSaysItBringsTheDevicesColour', async () => {
        const asked: string[] = [];
        window.HistoricCityMapApp = {
            installable: true,
            install: () => {
                asked.push('install');
                return Promise.resolve('accepted');
            },
        };
        try {
            const menu = await opened(new FakeAdminApp(adminState({ locale: 'en' })));

            expect(deepText(menu)).toContain('Open the administration in its own window');
            expect(deepText(menu)).toContain("Install the administration as an app to use your device's colour.");
            const installs = deepAll(menu, 'hcm-button').filter((button) => button.textContent.includes('Install app'));
            expect(installs).toHaveLength(2);
            installs[0]?.click();
            expect(asked).toEqual(['install']);
            window.HistoricCityMapApp = { installable: false };
            window.dispatchEvent(new Event('hcm-install-available'));
            await updated(menu);
            expect(deepText(menu)).not.toContain('Install app');
            expect(deepText(menu)).toContain('Firefox on a computer shares it');
        } finally {
            Reflect.deleteProperty(window, 'HistoricCityMapApp');
        }
    });

    it('badPath_withoutStateOrAppItDoesNothing', async () => {
        const empty = await mount<HcmAccountMenu>(html`<hcm-account-menu></hcm-account-menu>`);
        const orphan = await mount<HcmAccountMenu>(html`<hcm-account-menu .state=${adminState({ analytics: true })}></hcm-account-menu>`);
        deep(orphan, 'hcm-icon-button').click();
        await updated(orphan);

        deep(orphan, 'hcm-language-select').dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'ro' } }));
        deepAll(orphan, 'hcm-segmented-button')[0]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { value: 'dark' } }));
        deep(orphan, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));
        deepAll(orphan, 'hcm-button').at(-1)?.click();

        expect(deepText(empty)).toBe('');
        expect(orphan.open).toBe(false);
    });
});
