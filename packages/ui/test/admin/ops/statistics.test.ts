import { axeViolations } from '@hcm/test-support/axe';
import { WIZARD_IDS } from '@hcm/shared/funnels';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState } from '../../../src/admin/crashes/crashes-port.js';
import { GA_HOME_URL, loadStatisticsLive, statisticsLiveReady, statisticsView } from '../../../src/admin/crashes/statistics-view.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';
import { crashesState, page } from './fixtures.js';
import { NUMBERS, statistics } from './statistics-fixtures.js';

/** The Statistics view (`#/crashes/statistics`, §200): the wizards' funnels in plain words, and the way to Google Analytics. */
describe('the Statistics view', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theLiveSectionsArriveInAChunkOfTheirOwn', async () => {
        // The first test of the file: before the sections' chunk is there, the view shows the loading line in their place.
        expect(statisticsLiveReady()).toBe(false);
        const context = { analytics: true, projectId: 'demo-hcm', authDomain: '', intents: null, groupUrl: (id: string) => id };
        const before = await mount<HTMLElement>(statisticsView('en', { ...context, view: crashesState({}) }));
        expect(deepAll(before, '[role="status"]')).toHaveLength(1);
        expect(deepAll(before, '[data-statistics-numbers]')).toEqual([]);

        await loadStatisticsLive();
        const after = await mount<HTMLElement>(statisticsView('en', { ...context, view: crashesState({}) }));

        expect(statisticsLiveReady()).toBe(true);
        expect(deepAll(after, '[data-statistics-numbers]')).toHaveLength(1);
    });

    it('happyPath_everyWizardWithItsStepsAndTheWayToItsFunnel', async () => {
        // @S-A151-HAPPY-STATISTICS
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { app, element } = await page('crashes', crashes, { params: ['statistics'] });
        (element as HTMLElement & { state: unknown }).state = { ...app.state, analytics: true };
        await updated(element);

        expect(deepAll(element, '[data-wizard]').map((item) => item.dataset['wizard'])).toEqual([...WIZARD_IDS]);
        expect(deepText(deep(element, '[data-wizard="new_city"]'))).toMatch(/The area on the map ?area/);
        expect(deepText(deep(element, '[data-wizard="setup"]'))).toContain('One step per Setup card');
        expect(deepAll(element, 'a.external').some((link) => link.getAttribute('href') === GA_HOME_URL)).toBe(true);
        expect(deepAll(element, '[data-statistics-off]')).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAnalyticsItSaysSoAndLeadsToSetup', async () => {
        // @S-A151-BAD-NO-ANALYTICS
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'], locale: 'ro' });

        expect(deepText(deep(element, '[data-statistics-off]'))).toContain('Statisticile sunt oprite');
        expect(deepAll(element, 'a').some((link) => link.getAttribute('href') === '#/setup/analytics')).toBe(true);
    });

    it('happyPath_theCrashListLinksTheView', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes);

        expect(deep(element, '[data-statistics-link]').getAttribute('href')).toBe('#/crashes/statistics');
    });
});

/** §203: Google Analytics' numbers and Error Reporting's groups on the same view. */
describe('the Statistics view with the numbers', () => {
    beforeAll(async () => {
        defineAll();
        await loadStatisticsLive();
    });
    afterEach(cleanup);

    it('happyPath_theButtonAsksForTheNumbersWithGooglesNote_andThePeriodIsChosen', async () => {
        // @S-A153-HAPPY-NUMBERS
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        expect(deep(element, 'hcm-consent-note').getAttribute('scope')).toBe('analyticsRead');
        const buttons = deepAll(element, '[data-statistics-numbers] hcm-button').filter((item) =>
            item.textContent.includes('Show the numbers here'),
        );
        expect(buttons).toHaveLength(1);
        buttons.forEach((button) => {
            button.click();
        });
        deep(element, '[data-statistics-numbers] hcm-segmented-button').dispatchEvent(
            new CustomEvent('hcm-change', { detail: { value: '90' } }),
        );

        expect(crashes.calls.filter((call) => !call.startsWith('open'))).toEqual(['showNumbers', 'setStatisticsDays 90']);
    });

    it('happyPath_theNumbersTheAppsAndEachWizardsSteps', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({ statistics: statistics({ status: 'ready', numbers: NUMBERS }) }),
        );
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        expect(deepText(deep(element, '[data-statistics-visitors]'))).toBe('1,234');
        const text = deepText(deep(element, '[data-statistics-numbers]'));
        expect(text).toContain('The public map');
        expect(text).toContain('The admin: the owner');
        expect(text).toContain('Before this release');
        expect(text).toContain('Not measured: the start page loads no statistics.');
        expect(text).toMatch(/Year changed ?50 ?100\s?%/);
        expect(text).toMatch(/Phone ?4 ?80\s?%/);
        expect(text).toMatch(/The public map ?\/ ?300/);
        expect(text).toMatch(/Home ?12/);
        expect(text).toContain('Visits per visitor');
        const funnel = deepText(deep(element, '[data-funnel="new_city"]'));
        expect(funnel).toMatch(/The city’s names/);
        expect(funnel).toContain('3 (30 %)');
        expect(funnel).toContain('2.5 min');
        expect(funnel).toContain('30 s');
        expect(funnel).toContain('(apiError.invalidRequest)');
        expect(funnel).toContain('e2e_unknown_code');
        expect(deepAll(element, 'svg.daily').length).toBeGreaterThan(0);
        expect(deepAll(element, '[data-surface="start"]')).toHaveLength(1);
        deepAll(element, '[data-statistics-numbers] hcm-button')[0]?.click();
        expect(crashes.named('refreshStatistics')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['consent', 'tick “See your Google Analytics data”', []],
        [
            'apiDisabled',
            'Data API is off',
            ['#/setup', 'https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=demo-hcm'],
        ],
        ['noAccess', 'cannot read', ['https://analytics.google.com/analytics/web/']],
        ['refused', 'refused the way the admin asked', ['https://analytics.google.com/analytics/web/']],
        ['notSetUp', 'not set up', ['#/setup/analytics']],
        ['blocked', 'never left this browser', []],
    ] as const)('badPath_theProblem_%s_isSaidWithItsFix', async (problem, words, link) => {
        // @S-A153-BAD-CONSENT-REFUSED @S-A153-BAD-API-DISABLED
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({ statistics: statistics({ status: 'error', problem }) }),
        );
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        expect(deep(element, '[data-statistics-problem]').dataset['statisticsProblem']).toBe(problem);
        expect(deepText(deep(element, '[data-statistics-problem]'))).toContain(words);
        expect(deepAll(element, '[data-statistics-numbers] a').map((item) => item.getAttribute('href'))).toEqual(link);
    });

    it('badPath_theServersOwnRefusalIsItsMessage_andLoadingShowsTheIndicator', async () => {
        const refused = statistics({ status: 'error', problem: 'server', notice: { key: 'apiError.city.notProjectOwner' } });
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ statistics: refused }));
        const { element } = await page('crashes', crashes, { params: ['statistics'], locale: 'ro' });
        expect(deepText(deep(element, '[data-statistics-problem]'))).toContain('proprietarul proiectului');

        crashes.set({ statistics: statistics({ status: 'loading' }) });
        await updated(element);
        expect(deepAll(element, '[data-statistics-numbers] [role="status"]')).toHaveLength(1);
    });
});

/** §203: the period's error groups and the view before its store. */
describe('the Statistics view with the error groups', () => {
    beforeAll(async () => {
        defineAll();
        await loadStatisticsLive();
    });
    afterEach(cleanup);

    it('happyPath_theErrorGroupsOfThePeriodWithTheirConsoleLinks', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ statistics: statistics({ days: 90 }) }));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        const section = deep(element, '[data-statistics-crashes]');
        expect(deepText(section)).toContain('Error Reporting keeps 30 days');
        expect(deepText(section)).toContain('1,234');
        expect(deepAll(section, 'a.external').map((link) => link.getAttribute('href'))).toEqual([
            'https://console.cloud.google.com/errors/detail/g1?project=demo-hcm',
            'https://console.cloud.google.com/errors/detail/g2?project=demo-hcm',
        ]);
        expect(deepText(section)).not.toContain('index.js');
    });

    it('badPath_errorGroupsDisabledEmptyOrLoading', async () => {
        const failure = { key: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } } as const;
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({ status: 'error', apiDisabled: true, failure, groups: [] }),
        );
        const { element } = await page('crashes', crashes, { params: ['statistics'] });
        const section = (): HTMLElement => deep(element, '[data-statistics-crashes]');
        expect(deepAll(section(), 'a').map((link) => link.getAttribute('href'))).toContain('#/setup/analytics');
        deepAll(section(), 'hcm-button')[0]?.click();
        expect(crashes.named('retry')).toHaveLength(1);

        crashes.set({ status: 'ready', failure: null, apiDisabled: false, groups: [] });
        await updated(element);
        expect(deepText(section())).toContain('No errors reported in this period.');
        crashes.set({ status: 'loading' });
        await updated(element);
        expect(deepAll(section(), '[role="status"]')).toHaveLength(1);
    });

    it('badPath_noProblemNamedIsGooglesSilence_andEmptyListsSayNoDataYet', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ statistics: statistics({ status: 'error' }) }));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });
        expect(deep(element, '[data-statistics-problem]').dataset['statisticsProblem']).toBe('unavailable');
        expect(deepAll(element, '[data-statistics-numbers] a')).toEqual([]);

        const empty = { ...NUMBERS, pages: [], screens: [], events: [], devices: [], countries: [], steps: [] };
        crashes.set({ statistics: statistics({ status: 'ready', numbers: empty }) });
        await updated(element);
        expect(deepAll(element, '[data-statistics-numbers] p.note').length).toBeGreaterThanOrEqual(5);
        expect(deepAll(element, '[data-funnel]')).toEqual([]);

        crashes.set({ statistics: statistics({ status: 'error', problem: 'noProperty' }) });
        await updated(element);
        expect(deepAll(element, '[data-statistics-numbers] a').map((link) => link.getAttribute('href'))).toEqual(['#/setup/analytics']);
    });

    it.each([
        ['notRegistered', 'lacks some measurement names', ['#/setup/analytics'], 'Codes missing'],
        ['notReady', 'cannot report on them yet', [], 'up to 48 hours later'],
        ['noData', 'No values yet', [], '24 to 48 hours after use'],
    ] as const)('badPath_incompleteNumbers_%s_sayWhyAndWhatToDo_andTheGuideFollows', async (reason, words, link, codes) => {
        const numbers = { ...NUMBERS, pending: { reason, names: ['app_surface'] } };
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({ statistics: statistics({ status: 'ready', numbers }) }),
        );
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        const note = deep(element, '[data-statistics-pending]');
        expect(note.dataset['statisticsPending']).toBe(reason);
        expect(deepText(note)).toContain(words);
        expect(deepAll(element, '[data-statistics-numbers] p > a').map((item) => item.getAttribute('href'))).toEqual(link);
        expect(deepText(deep(element, '[data-statistics-codes]'))).toContain(codes);
        expect(deepAll(element, '[data-statistics-visitors]')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theGuideSaysWhetherGoogleKnowsTheCodes_unknownBeforeARead_readyAfterACompleteOne', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });
        expect(deep(element, '[data-statistics-codes]').dataset['statisticsCodes']).toBe('unknown');

        crashes.set({ statistics: statistics({ status: 'ready', numbers: NUMBERS }) });
        await updated(element);
        expect(deep(element, '[data-statistics-codes]').dataset['statisticsCodes']).toBe('ready');
        expect(deepAll(element, '[data-statistics-pending]')).toEqual([]);
    });

    it('badPath_beforeTheStoreIsThereOnlyTheGuideShows', async () => {
        const { element } = await page('crashes', null, { params: ['statistics'] });

        expect(deepAll(element, '[data-wizard]')).toHaveLength(WIZARD_IDS.length);
        expect(deepAll(element, '[data-statistics-numbers]')).toEqual([]);
    });
});
