import { axeViolations } from '@hcm/test-support/axe';
import { WIZARD_IDS } from '@hcm/shared/funnels';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState, StatisticsNumbersPort } from '../../../src/admin/crashes/crashes-port.js';
import { formatShare, pageName, screenName } from '../../../src/admin/crashes/statistics-bars.js';
import { causeTitle, crashesSection } from '../../../src/admin/crashes/statistics-crashes.js';
import { errorName, eventName } from '../../../src/admin/crashes/statistics-format.js';
import { loadStatisticsLive, statisticsLiveSheet } from '../../../src/admin/crashes/statistics-view.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';
import { crashesState, nth, page } from './fixtures.js';
import { NUMBERS, statistics } from './statistics-fixtures.js';

async function setupStatistics(): Promise<void> {
    defineAll();
    await loadStatisticsLive();
}

async function ready(numbers: StatisticsNumbersPort, locale: 'en' | 'ro' = 'en'): Promise<HTMLElement> {
    const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
        crashesState({ statistics: statistics({ status: 'ready', numbers }) }),
    );
    return (await page('crashes', crashes, { params: ['statistics'], locale })).element;
}

/** The owner's "prettify" of 2026-11-13: stat cards, bar lists, step bars, error cards, skeletons and the folded help. */
describe('the Statistics view as cards and charts', () => {
    beforeAll(setupStatistics);
    afterEach(cleanup);

    it('happyPath_pathsAndScreensInWords_andSharesAsTheLanguageWritesThem', () => {
        expect(pageName('en', '/')).toBe('The public map');
        expect(pageName('en', '/index.html')).toBe('The public map');
        expect(pageName('ro', '/admin/')).toBe('Administrarea');
        expect(pageName('en', '/admin/index.html')).toBe('The admin');
        expect(pageName('en', '/start/')).toBe('/start/');
        expect(screenName('en', 'crashes')).toBe('Crashes');
        expect(screenName('en', '(not set)')).toBe('(not set)');
        expect(formatShare('en', 0.62)).toBe('62%');
    });

    it('happyPath_theKeyNumbersAreStatCards_andALongListFoldsTheRestUnderShowAll', async () => {
        const pages = Array.from({ length: 8 }, (_, index) => ({ name: `/p${String(index)}/`, count: 80 - index * 10 }));
        const element = await ready({ ...NUMBERS, pages });

        expect(deepAll(element, '.stat')).toHaveLength(4);
        expect(deepText(deep(element, '.stats'))).toMatch(/Visits per visitor ?1\.6/);
        expect(deepText(deep(element, '.stats'))).toMatch(/Key actions on the map ?50/);
        const card = deepAll(element, 'section.card').find((item) => deepText(item).includes('Most viewed pages'));
        expect(card?.querySelectorAll(':scope > ol.bars > li')).toHaveLength(5);
        expect(deepText(card?.querySelector('details.more summary') ?? element)).toBe('Show all 8');
        expect(card?.querySelectorAll('details.more li')).toHaveLength(3);
        const fill = card?.querySelector<HTMLElement>('.bar-fill');
        expect(fill?.style.getPropertyValue('--hcm-bar')).toBe('100%');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aListOfZerosDrawsEmptyBars_andNobodyOnAWizardsFirstStepDrawsNoBar', async () => {
        const steps = [
            { wizard: 'upload', step: 'choose', visitors: 0, averageMs: null, errors: [] },
            { wizard: 'upload', step: 'year', visitors: 0, averageMs: null, errors: [] },
        ];
        const element = await ready({ ...NUMBERS, visitors: 0, events: [{ name: 'share', count: 0 }], steps });

        const shares = deepAll(element, '.bar-share').map((item) => item.textContent.trim());
        expect(shares).toContain('0%');
        const funnel = deep(element, '[data-funnel="upload"]');
        expect([...funnel.querySelectorAll<HTMLElement>('.bar-fill')].map((fill) => fill.style.getPropertyValue('--hcm-bar'))).toEqual([
            '0%',
            '0%',
        ]);
        expect(deepText(deep(element, '.stats'))).toMatch(/Visits per visitor ?0/);
    });

    it('happyPath_theWizardsUsedAreCards_andTheOthersOneQuietLine', async () => {
        const element = await ready(NUMBERS);

        expect(deepAll(element, '[data-funnel]').map((item) => item.dataset['funnel'])).toEqual(['new_city']);
        const unused = deepText(deep(element, '[data-statistics-unused]'));
        expect(unused).toContain('Not used in the last 28 days: Setup, The start page of a new map');
        expect(deepAll(deep(element, '[data-funnel="new_city"]'), '.step-errors li')).toHaveLength(2);
    });

    it('happyPath_everyWizardUsedLeavesNoQuietLine', async () => {
        const steps = WIZARD_IDS.map((wizard) => ({ wizard, step: 'one', visitors: 2, averageMs: 1000, errors: [] }));
        const element = await ready({ ...NUMBERS, steps });

        expect(deepAll(element, '[data-funnel]')).toHaveLength(WIZARD_IDS.length);
        expect(deepAll(element, '[data-statistics-unused], [data-statistics-no-wizard]')).toEqual([]);
    });

    it('badPath_noWizardUsedIsOneLine', async () => {
        const element = await ready({ ...NUMBERS, steps: [] }, 'ro');

        expect(deepText(deep(element, '[data-statistics-no-wizard]'))).toBe('Niciun asistent n-a fost folosit în ultimele 28 de zile.');
        expect(deepAll(element, '[data-statistics-wizards] h5')).toEqual([]);
    });

    it('happyPath_whileGoogleAnswersTheCardsShowAsSkeletons', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ statistics: statistics({ status: 'loading' }) }));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        const loading = deep(element, '[data-statistics-loading]');
        expect(loading.getAttribute('role')).toBe('status');
        expect(deepText(loading)).toBe('Loading…');
        expect(deepAll(loading, '.skeleton')).toHaveLength(7);
    });
});

describe('the Statistics view errors, formatting and help', () => {
    beforeAll(setupStatistics);
    afterEach(cleanup);

    it('happyPath_anErrorIsACardWithItsTitleItsCountAndTheFullTextFolded', async () => {
        const long = `Error: ${'a very long cause '.repeat(10)}\n    at stack (index.js:1:1)`;
        const [first, second] = crashesState().groups;
        const groups = [
            { ...first, message: long },
            { ...second, version: undefined },
        ] as CrashesViewState['groups'];
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ groups }));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        const [one, two] = deepAll(element, '.error-item');
        expect(deepText(one?.querySelector('.error-title') ?? element)).toMatch(/…$/);
        expect(deepText(one ?? element)).toContain('Reports: 1,234');
        expect(one?.querySelector('pre.cause')?.textContent).toBe(long);
        expect(two?.querySelector('details')).toBeNull();
        expect(deepText(two ?? element)).toContain('release —');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEmptyCauseIsAnEmptyTitle', () => {
        expect(causeTitle('')).toBe('');
        expect(causeTitle('  short  \nmore')).toBe('short');
    });

    it('happyPath_thePageAdoptsTheLiveSectionsStylesOnce', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });
        crashes.set({ status: 'loading' });
        await updated(element);

        const sheet = statisticsLiveSheet();
        expect(sheet).not.toBeNull();
        expect(element.shadowRoot?.adoptedStyleSheets.filter((item) => item === sheet)).toHaveLength(1);
    });

    it('happyPath_theHelpIsFolded_andOpensOnItsSummary', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({}));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        const help = deep(element, '[data-statistics-help]') as HTMLDetailsElement;
        expect(help.open).toBe(false);
        expect(deepText(help.querySelector('summary') ?? element)).toBe('How to explore more in Google Analytics');
        help.querySelector('summary')?.click();
        await updated(element);
        expect(help.open).toBe(true);
        expect(help.querySelectorAll('[data-wizard]')).toHaveLength(WIZARD_IDS.length);
    });

    it('badPath_unknownEventsAndCatalogueErrorCodesFormatSafely', async () => {
        const steps = [
            {
                wizard: 'new_city',
                step: 'names',
                visitors: 5,
                averageMs: 30_000,
                errors: [
                    { name: 'adminSetup.cloud.permission', count: 2 },
                    { name: 'adminSetup.unknownCode', count: 1 },
                ],
            },
        ];
        const element = await ready({
            ...NUMBERS,
            events: [
                { name: 'share', count: 2 },
                { name: 'custom_event', count: 1 },
            ],
            steps,
        });

        const text = deepText(deep(element, '[data-statistics-numbers]'));
        expect(text).toContain('custom_event');
        expect(text).toContain('Your Google account lacks the role … needed here. (adminSetup.cloud.permission)');
        expect(text).toContain('adminSetup.unknownCode');
        expect(text).not.toContain(' (adminSetup.unknownCode)');
        expect(eventName('en', 'custom_event')).toBe('custom_event');
        expect(errorName('en', 'adminSetup.cloud.permission')).toBe(
            'Your Google account lacks the role … needed here. (adminSetup.cloud.permission)',
        );
        expect(errorName('en', 'adminSetup.unknownCode')).toBe('adminSetup.unknownCode');
    });

    it('badPath_errorSectionWithoutApiDisabledHidesSetupLink_andWithoutIntentsStaysSafe', async () => {
        const errorState = crashesState({
            status: 'error',
            apiDisabled: false,
            failure: { key: 'apiError.errorReporting.unavailable' },
            groups: [],
        });
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(errorState);
        const { element } = await page('crashes', crashes, { params: ['statistics'] });
        const section = deep(element, '[data-statistics-crashes]');
        expect(deep(section, '[role="alert"]').textContent).toContain('Crash reports cannot be read right now.');
        expect(deepAll(section, 'a[href="#/setup/analytics"]')).toEqual([]);
        deep(section, 'hcm-button').click();
        expect(crashes.named('retry')).toHaveLength(1);
        cleanup();

        const orphan = await mount<HTMLElement>(crashesSection('en', errorState, null, (id) => id));
        deep(orphan, 'hcm-button').click();
        expect(deepAll(orphan, '[role="alert"]')).toHaveLength(1);
        expect(deepAll(orphan, 'a')).toEqual([]);
    });

    it('happyPath_errorCardsCapAtTenGroups', async () => {
        const base = nth(crashesState().groups, 0);
        const groups = Array.from({ length: 12 }, (_, index) => ({ ...base, groupId: `g${String(index)}` }));
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ groups }));
        const { element } = await page('crashes', crashes, { params: ['statistics'] });

        expect(deepAll(element, '.error-item')).toHaveLength(10);
    });
});
