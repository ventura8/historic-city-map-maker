import { translate } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_ABOUT_DIALOG_TAG, HcmAboutDialog, defineHcmAboutDialog } from '../../src/viewer/hcm-about-dialog.js';
import { defineKitDoubles, fireKitEvent, mountElement, recordEvents, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { testManifest } from './fixtures.js';

const CITY = testManifest().city;

/** The icons the theme choice passes to the kit's segmented button, per option. */
/** The icons of the first segmented button (the theme's mode; the language is a dropdown), or of the `index`th one. */
function themeIcons(element: HcmAboutDialog, index = 0): (string | undefined)[] {
    const theme = shadowQueryAll(element, 'hcm-segmented-button').at(index) as unknown as {
        readonly options: readonly { readonly icon?: string }[];
    };
    return theme.options.map((option) => option.icon);
}

async function about(properties: Partial<HcmAboutDialog> = {}): Promise<HcmAboutDialog> {
    return mountElement<HcmAboutDialog>(HCM_ABOUT_DIALOG_TAG, { open: true, city: CITY, engineVersion: '1.4.2', ...properties });
}

describe('<hcm-about-dialog>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aboutCreditsPrivacyAndEngineInRomanian', async () => {
        const element = await about();

        await expect.element(page.getByRole('dialog', { name: 'Despre' })).toBeVisible();
        const text = shadowText(element);
        expect(text).toContain('București dispărut');
        expect(text).toContain('Mulțumiri');
        expect(text).toContain('Fotografii: arhiva A');
        expect(text).toContain('Fără cookie-uri fără acord.');
        expect(text).toContain('Motor: Historic City Map Maker 1.4.2');
        expect(element.shadowRoot?.querySelector('strong')?.textContent).toBe('Despre');
        await expect.element(page.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
    });

    it('badPath_aboutHoldsNoLanguageOrThemeChoice', async () => {
        // The owner (2026-11-08): Limba and Tema do not belong in About; they are the menu's Settings.
        const element = await about({ locale: 'en' });

        expect(shadowQueryAll(element, 'hcm-segmented-button')).toEqual([]);
        expect(shadowQueryAll(element, 'hcm-language-select')).toEqual([]);
        expect(shadowText(element)).not.toContain('Language');
        expect(shadowText(element)).not.toContain('Theme');
    });

    it('happyPath_englishAndFullScreen', async () => {
        const element = await about({ locale: 'en', fullscreen: true });

        expect(shadowText(element)).toContain('Lost Bucharest');
        expect(shadowText(element)).toContain('No cookies without consent.');
        expect(shadowQuery(element, 'hcm-dialog').hasAttribute('fullscreen')).toBe(true);
    });

    it('badPath_itsFootCarriesNoCopyOfTheMapsCredits', async () => {
        // The Pixel 9 Pro review (P3): the copy took 40 to 80 px of About and Settings on a phone; full screen, no map shows.
        const element = await about({ fullscreen: true });

        expect(element.shadowRoot?.querySelector('hcm-map-attribution')).toBeNull();
    });

    it('badPath_emptyCreditsHideTheirSection', async () => {
        const element = await about({ city: { ...CITY, credits: [] } });

        expect(shadowText(element)).not.toContain('Mulțumiri');
    });

    it('happyPath_grantedConsentCanBeWithdrawn', async () => {
        const element = await about({ analytics: true, consent: 'granted' });
        const events = recordEvents(element, 'hcm-consent');

        expect(shadowText(element)).toContain('Statistici anonime: permise');
        await page.getByRole('button', { name: 'Retrage acordul pentru statistici' }).click();

        expect(events).toEqual([{ type: 'hcm-consent', detail: { decision: 'denied' } }]);
    });

    it('badPath_deniedUnknownOrNoAnalyticsShowNoWithdrawButton', async () => {
        const denied = await about({ analytics: true, consent: 'denied' });
        expect(shadowText(denied)).toContain('Statistici anonime: refuzate');
        expect(shadowText(denied)).not.toContain('Retrage');

        const unknown = await about({ analytics: true, consent: 'unknown' });
        expect(shadowText(unknown)).not.toContain('Statistici anonime');

        const none = await about({ analytics: false, consent: 'granted' });
        expect(shadowText(none)).not.toContain('Statistici anonime');
    });

    it('happyPath_settingsHoldTheLanguageAndThemeChoices', async () => {
        const element = await about({ mode: 'settings', theme: 'dark' });
        const events = recordEvents(element, 'hcm-locale-change', 'hcm-theme-change', 'hcm-change');

        await expect.element(page.getByRole('dialog', { name: 'Setări' })).toBeVisible();
        expect(shadowText(element)).not.toContain('Mulțumiri');
        expect(themeIcons(element)).toEqual(['brightness_auto', 'light_mode', 'dark_mode']);
        await expect.element(page.getByRole('radio', { name: 'Întunecată' })).toHaveAttribute('aria-checked', 'true');
        await expect.element(page.getByRole('combobox', { name: 'Limbă' })).toHaveValue('ro');
        await page.getByRole('combobox', { name: 'Limbă' }).selectOptions('en');
        await page.getByRole('radio', { name: 'Luminoasă' }).click();

        expect(events).toEqual([
            { type: 'hcm-locale-change', detail: { locale: 'en' } },
            { type: 'hcm-theme-change', detail: { theme: 'light' } },
        ]);
    });

    it('happyPath_settingsInEnglishAndFullScreenDropTheThemeIcons', async () => {
        const element = await about({ mode: 'settings', locale: 'en', fullscreen: true });

        await expect.element(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
        // A compact screen has no room for an icon beside every theme label (the kit still shows the check mark).
        expect(themeIcons(element)).toEqual([undefined, undefined, undefined]);
        expect(themeIcons(element, 1)).toEqual([undefined, undefined]);
    });

    it('happyPath_settingsFollowTheDeviceAndItsAccentByDefault', async () => {
        const element = await about({ mode: 'settings', locale: 'en' });
        const events = recordEvents(element, 'hcm-theme-change');

        await expect.element(page.getByRole('radio', { name: 'Follow my device' })).toHaveAttribute('aria-checked', 'true');
        await expect.element(page.getByRole('radio', { name: 'Device accent' })).toHaveAttribute('aria-checked', 'true');
        expect(themeIcons(element, 1)).toEqual(['palette', 'map']);
        await page.getByRole('radio', { name: 'Map colours' }).click();

        expect(events).toEqual([{ type: 'hcm-theme-change', detail: { accent: 'map' } }]);
    });

    it('badPath_anUnknownAccentValueIsIgnored', async () => {
        const element = await about({ mode: 'settings', accent: 'map' });
        const events = recordEvents(element, 'hcm-theme-change');

        await expect.element(page.getByRole('radio', { name: 'Culorile hărții' })).toHaveAttribute('aria-checked', 'true');
        fireKitEvent(shadowQuery(element, 'hcm-segmented-button:last-of-type'), 'hcm-change', { value: 'rainbow' });

        expect(events).toEqual([]);
    });

    it('badPath_anUnknownThemeValueIsIgnored', async () => {
        const element = await about({ mode: 'settings' });
        const events = recordEvents(element, 'hcm-theme-change');

        fireKitEvent(shadowQuery(element, 'hcm-segmented-button:nth-of-type(2)'), 'hcm-change', { value: 'sepia' });

        expect(events).toEqual([]);
    });

    it('badPath_noCityLeavesTheDialogEmpty', async () => {
        const element = await about({ city: null });

        expect(element.shadowRoot?.querySelector('.details')).toBeNull();
        expect(customElements.get(HCM_ABOUT_DIALOG_TAG)).toBe(HcmAboutDialog);
    });
});

describe('<hcm-about-dialog>: the statement and the help panel', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('badPath_aCityWithNoCreditsStillHasAWayToReportAProblem', async () => {
        const element = await about({ city: { ...CITY, credits: [] } });

        const label = translate(element.locale, 'about.a11yReport');
        const link = shadowQueryAll(element, 'a').find((anchor) => anchor.textContent === label) as HTMLAnchorElement | undefined;

        expect(link?.href).toBe('https://github.com/ventura8/historic-city-map-maker/issues');
    });

    it('happyPath_theStatementSaysWhatWorksWhatIsMissingAndHowToReport', async () => {
        const text = shadowText(await about());
        expect(text).toContain('Accesibilitate');
        expect(text).toContain('Lipsește: o descriere text a hărții.');
        expect(text).toContain('Raportează o problemă pe GitHub');

        expect(shadowText(await about({ locale: 'en' }))).toContain('Report problems');
    });

    it('happyPath_aboutOpensTheHelpPanelWhichListsTheKeysAndThePad', async () => {
        const element = await about();
        const events = recordEvents(element, 'hcm-help-open');
        const buttons = shadowQueryAll(element, 'hcm-button');
        buttons.at(-1)?.click();
        expect(events.map((event) => event.type)).toEqual(['hcm-help-open']);

        element.mode = 'help';
        await element.updateComplete;

        await expect.element(page.getByRole('dialog', { name: 'Tastatură și gamepad' })).toBeVisible();
        expect(shadowText(element)).toContain('Anul următor și anterior');
        expect(shadowText(element)).toContain('Gamepad standard');
        expect(shadowText(element)).not.toContain('Accesibilitate');
        expect([...(element.shadowRoot?.querySelectorAll('kbd') ?? [])].map((kbd) => kbd.textContent)).toEqual([
            '.',
            ',',
            'o',
            'i',
            'n',
            'p',
            'l',
            '?',
        ]);
    });

    it('happyPath_theHelpPanelsSwitchSaysItsChoice', async () => {
        const element = await about({ mode: 'help' });
        const events = recordEvents(element, 'hcm-shortcuts-change');

        fireKitEvent(shadowQuery(element, 'hcm-switch'), 'hcm-change', { checked: false });

        expect(events.map((event) => (event as CustomEvent<unknown>).detail)).toEqual([{ enabled: false }]);
    });

    it('edge_openingHelpInAClosedDialogMovesNoFocus', async () => {
        const element = await about({ open: false });

        element.mode = 'help';
        await element.updateComplete;

        expect(element.mode).toBe('help');
    });

    it('edge_goingFromSettingsToAboutMovesNoFocus', async () => {
        const element = await about({ mode: 'settings' });
        const before = document.activeElement;

        element.mode = 'about';
        await element.updateComplete;

        expect(document.activeElement).toBe(before);
    });
});

describe('<hcm-about-dialog>: the device accent note', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
        document.documentElement.style.removeProperty('--hcm-device-accent');
    });

    it('happyPath_aSharedAccentNeedsNoNote', async () => {
        document.documentElement.style.setProperty('--hcm-device-accent', '#1e8e3e');
        const element = await about({ mode: 'settings', locale: 'en' });

        expect(shadowQueryAll(element, '.accent-note')).toEqual([]);
    });

    it('badPath_aBrowserThatHidesTheAccentSaysSoAndWhatShows', async () => {
        // The test browser is a Chromium tab: Chrome does not give a tab the device's accent.
        const element = await about({ mode: 'settings', locale: 'en' });

        expect(shadowQuery(element, '.accent-note').textContent).toContain("This browser does not share your device's accent colour");
        element.accent = 'map';
        await element.updateComplete;
        expect(shadowQueryAll(element, '.accent-note')).toEqual([]);
        document.documentElement.style.setProperty('--hcm-device-accent', '#808080');
        element.accent = 'device';
        await element.updateComplete;
        expect(shadowQuery(element, '.accent-note').textContent).toContain("Your device's accent colour is grey");
    });
});

describe('<hcm-about-dialog>: Install app (docs/ENGINE_API.md → Installable app)', () => {
    /** What the page script leaves on `window` (`startAppPage`): the prompt waits, and each install is recorded. */
    function offerInstall(): string[] {
        const asked: string[] = [];
        window.HistoricCityMapApp = {
            installable: true,
            install: () => {
                asked.push('install');
                return Promise.resolve('accepted');
            },
        };
        window.dispatchEvent(new Event('hcm-install-available'));
        return asked;
    }

    beforeAll(() => {
        defineKitDoubles();
        defineHcmAboutDialog();
    });

    afterEach(() => {
        document.body.replaceChildren();
        Reflect.deleteProperty(window, 'HistoricCityMapApp');
    });

    it('happyPath_settingsOffersTheInstallAndTheAccentNoteSaysItBringsTheDevicesColour', async () => {
        const element = await about({ mode: 'settings', locale: 'en' });
        const asked = offerInstall();
        await element.updateComplete;

        expect(shadowText(element)).toContain('Open the map in its own window');
        expect(shadowQuery(element, '.accent-note').textContent).toContain("Install the map as an app to use your device's colour.");
        const buttons = shadowQueryAll(element, 'hcm-button').filter((button) => button.textContent.includes('Install app'));
        expect(buttons).toHaveLength(2);
        buttons[0]?.click();
        expect(asked).toEqual(['install']);
    });

    it('badPath_noInstallPromptNoInstallAndTheOldNote', async () => {
        const element = await about({ mode: 'settings', locale: 'en' });

        expect(shadowText(element)).not.toContain('Install app');
        expect(shadowQuery(element, '.accent-note').textContent).toContain('Firefox on a computer shares it');
        element.remove();
        offerInstall();
        // Detached, the dialog no longer listens.
        expect(element.installable).toBe(false);
    });
});
