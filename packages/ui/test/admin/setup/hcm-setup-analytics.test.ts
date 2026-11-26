import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import type { HcmCrashGroups } from '../../../src/admin/setup/hcm-crash-groups.js';
import type { HcmCrashesPage } from '../../../src/admin/setup/hcm-crashes-page.js';
import { defineHcmCrashesPage } from '../../../src/admin/setup/hcm-crashes-page.js';
import type { HcmSetupAnalytics } from '../../../src/admin/setup/hcm-setup-analytics.js';
import { defineHcmSetupAnalytics } from '../../../src/admin/setup/hcm-setup-analytics.js';
import type { HcmSetupImport } from '../../../src/admin/setup/hcm-setup-import.js';
import { defineHcmSetupImport } from '../../../src/admin/setup/hcm-setup-import.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, type ViewChanges } from './fixtures.js';

defineHcmSetupAnalytics();
defineHcmSetupImport();
defineHcmCrashesPage();

const GROUP = {
    groupId: 'g1',
    message: 'TypeError: <b>x</b> is undefined',
    service: 'viewer',
    count: 3,
    lastSeen: '2026-10-12T09:00:00.000Z',
};

async function analytics(changes: ViewChanges = {}, locale = 'ro') {
    const port = new FakeSetupPort(setupView(changes));
    const element = await fixture<HcmSetupAnalytics>(
        html`<hcm-setup-analytics .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-analytics>`,
    );
    return { port, element };
}

function crashPanel(element: HcmSetupAnalytics): HcmCrashGroups {
    return shadowPart(element, 'hcm-crash-groups') as HcmCrashGroups;
}

describe('<hcm-setup-analytics>', () => {
    afterEach(cleanup);

    it('happyPath_theMeasurementIdTheStreamSettingAndTheCrashSwitch', async () => {
        const { port, element } = await analytics(
            { analytics: { measurementId: 'G-E2E12345', pageChangesOff: false, crashEmails: true, watching: false, reports: null } },
            'en',
        );

        expect(shadowPart(element, '.success').textContent).toBe('Measurement ID: G-E2E12345');
        await page.getByRole('button', { name: 'Stop counting address changes as page views' }).click();
        await page.getByRole('switch', { name: 'E-mail me about new crashes' }).click();

        expect(port.calls).toEqual([['disableHistoryPageViews'], ['setCrashEmails', false]]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAnalyticsTheCardSaysWhereToEnableItAndWatches', async () => {
        const { element } = await analytics({
            analytics: { measurementId: null, pageChangesOff: false, crashEmails: true, watching: true, reports: null },
        });

        expect(shadowPart(element, '.body > .note').textContent).toContain('Setările proiectului, Integrări, Google Analytics');
        expect(shadowPart(element, '[role="status"]').textContent).toBe('Verificăm la fiecare 15 secunde…');
    });

    it('happyPath_createTheMeasurementReportsAndWhatTheLastRunDid', async () => {
        // §76f: one click; the line under the button says what was registered and what was there already.
        const { port, element } = await analytics(
            {
                analytics: {
                    measurementId: 'G-1',
                    pageChangesOff: true,
                    crashEmails: true,
                    watching: false,
                    reports: { created: 12, skipped: 2 },
                },
            },
            'en',
        );

        await page.getByRole('button', { name: 'Create the measurement reports' }).click();

        expect(port.calls).toEqual([['createMeasurementReports']]);
        expect(shadowPart(element, '.reports').textContent).toBe('Measurement reports: 12 created, 2 already there.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAMeasurementIdThereIsNoReportsButton_andBeforeARunNoResult', async () => {
        const without = await analytics();
        expect(without.element.shadowRoot?.querySelector('.reports')).toBeNull();
        cleanup();

        const before = await analytics({
            analytics: { measurementId: 'G-1', pageChangesOff: true, crashEmails: true, watching: false, reports: null },
        });
        expect(shadowPart(before.element, '.reports').textContent).toBe('');
        await expect.element(page.getByRole('button', { name: 'Creează rapoartele de măsurători' })).toBeVisible();
    });

    it('happyPath_historyPageViewsOffIsShownChecked', async () => {
        const { element } = await analytics({
            analytics: { measurementId: 'G-1', pageChangesOff: true, crashEmails: false, watching: false, reports: null },
        });

        expect(shadowPart(element, '.stream-off').textContent.trim()).toBe('Schimbările de adresă nu mai sunt numărate ca vizualizări.');
        await expect.element(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });
});

describe('<hcm-crash-groups>', () => {
    afterEach(cleanup);

    it('happyPath_listsTheGroupsAsText', async () => {
        const { element } = await analytics({ crashes: { ...setupView().crashes, loaded: true, groups: [GROUP] } }, 'en');
        const panel = crashPanel(element);
        await panel.updateComplete;

        expect(shadowPart(panel, '.message').textContent).toBe('TypeError: <b>x</b> is undefined');
        expect(panel.renderRoot.querySelector('b')).toBeNull();
        expect(shadowPart(panel, '[data-group="g1"] .note').textContent.trim()).toBe('How often: 3; last on 12 Oct 2026, 12:00 (viewer)');
        expect(shadowPart(panel, '.title').getAttribute('aria-level')).toBe('3');
    });

    it('badPath_noCrashesSaysSoAndLoadingShowsTheIndicator', async () => {
        const { element } = await analytics({ crashes: { ...setupView().crashes, loaded: true, busy: true } });
        const panel = crashPanel(element);
        await panel.updateComplete;

        expect(shadowPart(panel, '.note').textContent).toBe('Nicio eroare în ultimele 7 zile.');
        await expect.element(page.getByRole('progressbar', { name: 'Se încarcă rapoartele de erori…' })).toBeVisible();
    });

    it('badPath_aDisabledApiIsEnabledWithGoogle', async () => {
        const { port, element } = await analytics({
            crashes: {
                ...setupView().crashes,
                loaded: true,
                error: { key: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } },
                disabledApi: 'clouderrorreporting.googleapis.com',
            },
        });
        await crashPanel(element).updateComplete;

        await page.getByRole('button', { name: 'Activează cu Google' }).click();

        expect(port.calls).toEqual([['enableApi', 'clouderrorreporting.googleapis.com']]);
    });

    it('badPath_anyOtherFailureOffersRetry', async () => {
        const { port, element } = await analytics(
            { crashes: { ...setupView().crashes, loaded: true, error: { key: 'apiError.errorReporting.unavailable' } } },
            'en',
        );
        await crashPanel(element).updateComplete;

        expect(page.getByRole('alert').element().textContent).toContain('Crash reports cannot be read right now.');
        await page.getByRole('button', { name: 'Retry' }).click();

        expect(port.calls).toEqual([['loadCrashGroups']]);
    });
});

describe('<hcm-crashes-page>', () => {
    afterEach(cleanup);

    it('happyPath_thePageListsTheGroupsAsSoonAsItAppears', async () => {
        const port = new FakeSetupPort();
        const element = await fixture<HcmCrashesPage>(
            html`<hcm-crashes-page
                .app=${{ intents: { setup: port.intents } }}
                .state=${{ locale: 'en', setup: port.getState() }}
            ></hcm-crashes-page>`,
        );
        const panel = shadowPart(element, 'hcm-crash-groups') as HcmCrashGroups;
        await panel.updateComplete;

        expect(port.calls).toEqual([['loadCrashGroups']]);
        await expect.element(page.getByRole('heading', { level: 1, name: 'Crash reports' })).toBeVisible();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_loadedOrLoadingGroupsAreNotAskedAgain', async () => {
        const loaded = new FakeSetupPort(setupView({ crashes: { ...setupView().crashes, loaded: true } }));
        const busy = new FakeSetupPort(setupView({ crashes: { ...setupView().crashes, busy: true } }));

        await fixture<HcmCrashesPage>(html`<hcm-crashes-page .port=${loaded}></hcm-crashes-page>`);
        await fixture<HcmCrashesPage>(html`<hcm-crashes-page .port=${busy}></hcm-crashes-page>`);

        expect([...loaded.calls, ...busy.calls]).toEqual([]);
    });

    it('badPath_withoutAControllerThePageIsEmpty', async () => {
        const element = await fixture<HcmCrashesPage>(html`<hcm-crashes-page></hcm-crashes-page>`);

        expect(element.renderRoot.querySelector('hcm-crash-groups')).toBeNull();
    });

    it('badPath_aStandalonePanelWithoutStateLoadsNothing', async () => {
        const element = await fixture<HcmCrashGroups>(html`<hcm-crash-groups standalone></hcm-crash-groups>`);

        expect(element.renderRoot.querySelector('section')).toBeNull();
    });
});

describe('<hcm-setup-import>', () => {
    afterEach(cleanup);

    async function legacy(changes: ViewChanges = {}, locale = 'ro') {
        const port = new FakeSetupPort(setupView(changes));
        const element = await fixture<HcmSetupImport>(
            html`<hcm-setup-import .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-import>`,
        );
        return { port, element };
    }

    it('happyPath_oneClickImportsThePhotos', async () => {
        const { port, element } = await legacy();

        await page.getByRole('button', { name: 'Importă fotografiile (45)' }).click();

        expect(port.calls).toEqual([['importLegacy']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aRunningImportShowsItsProgress', async () => {
        const { element } = await legacy({ legacyImport: { done: 9, total: 45, failed: [], running: true } }, 'en');

        await expect.element(page.getByRole('progressbar', { name: 'Photos imported: 9 of 45' })).toHaveAttribute('aria-valuenow', '20');
        expect(shadowPart(element, 'hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_aCompleteImportSaysSo', async () => {
        const { element } = await legacy({ legacyImport: { done: 45, total: 45, failed: [], running: false } });

        expect(shadowPart(element, '.success').textContent).toBe('Toate fotografiile sunt pe hartă (45).');
        expect(element.renderRoot.querySelector('hcm-progress')).toBeNull();
    });

    it('badPath_aPartialImportWithFailuresListsTheirReasons', async () => {
        const { element } = await legacy(
            { legacyImport: { done: 44, total: 45, failed: [{ id: 'ferdinand', detail: 'apiError.photo.tooLarge' }], running: false } },
            'en',
        );

        expect(shadowPart(element, '[data-photo="ferdinand"]').textContent).toContain('The image is too large');
        expect(element.renderRoot.querySelector('hcm-progress')).not.toBeNull();
    });

    it('happyPath_aMapWithTheFirst45IsOfferedTheMissing12InOneClick', async () => {
        // The old site's 2023 additions (docs/research/M5-interfaces.md): the bundle has 57, the map 45.
        const { port, element } = await legacy({ legacyImport: { done: 45, total: 57, failed: [], running: false } }, 'en');

        expect(shadowPart(element, '.body > .note').textContent).toBe(
            "The map does not have 12 of the old site's photos yet. Those already on it stay as they are.",
        );
        await page.getByRole('button', { name: 'Import the missing photos (12)' }).click();

        expect(port.calls).toEqual([['importLegacy']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_whileTheMissingPhotosAreImportedTheNoteGivesWayToTheProgress', async () => {
        const { element } = await legacy({ legacyImport: { done: 50, total: 57, failed: [], running: true } });

        expect(element.renderRoot.querySelector('.body > p.note:not([role])')).toBeNull();
        expect(shadowPart(element, 'hcm-button').textContent).toBe('Importă fotografiile care lipsesc (7)');
        expect(shadowPart(element, 'hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_aMapWithEveryPhotoIsOfferedTheOldSitesDirectionsInOneClick', async () => {
        // Parc Ferdinand: the old site later gave it a cone (docs/research/M5-interfaces.md → Directions from the old site).
        const { port, element } = await legacy(
            { legacyImport: { done: 57, total: 57, failed: [], running: false, directions: 1, credits: true } },
            'en',
        );

        expect([...element.renderRoot.querySelectorAll('.body > .note')].map((note) => note.textContent)).toEqual([
            'Directions the old site adds to photos without one: 1. Those you set or moved stay as they are.',
            "The credits do not name every author of the old site's photos yet.",
        ]);
        expect(element.renderRoot.querySelector('.success')).toBeNull();
        await page.getByRole('button', { name: "Add the old site's directions (1)" }).click();

        expect(port.calls).toEqual([['importLegacy']]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_onlyTheCreditsLeftAreOfferedAndNothingShowsWhileItRuns', async () => {
        const { element } = await legacy({ legacyImport: { done: 57, total: 57, failed: [], running: false, credits: true } });

        expect(shadowPart(element, 'hcm-button').textContent).toBe('Adaugă noii autori la mulțumiri');
        expect(shadowPart(element, '.body > .note').textContent).toBe(
            'Mulțumirile nu îi numesc încă pe toți autorii fotografiilor vechiului site.',
        );
        const running = await legacy({ legacyImport: { done: 57, total: 57, failed: [], running: true, directions: 1 } });
        expect(running.element.renderRoot.querySelector('.body > p.note:not([role])')).toBeNull();
    });

    it('badPath_nothingDetectedYetDisablesTheButton', async () => {
        const { element } = await legacy({ legacyImport: { done: 0, total: 0, failed: [], running: false } });

        expect(shadowPart(element, 'hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('badPath_aPhotoTheServerNeverReceivedLinksTheStepThatGrantsItsRole', async () => {
        // M6 (finding 17): the upload's events never reached the server, even after photos.reprocess.
        const { element } = await legacy(
            {
                legacyImport: {
                    done: 44,
                    total: 45,
                    failed: [
                        { id: 'ferdinand', detail: 'apiError.photo.notReceived' },
                        { id: 'bateriilor', detail: 'apiError.photo.tooLarge' },
                    ],
                    running: false,
                },
            },
            'en',
        );

        const stuck = shadowPart(element, '[data-photo="ferdinand"]');
        expect(stuck.textContent).toContain('Not processed: the server did not receive the upload');
        expect(stuck.querySelector('a')?.getAttribute('href')).toBe('#/setup/provision');
        expect(stuck.querySelector('a')?.textContent).toBe('Open the step "Prepare the Google Cloud project"');
        expect(shadowPart(element, '[data-photo="bateriilor"]').querySelector('a')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });
});
