import { axeViolations } from '@hcm/test-support/axe';
import { WIZARD_IDS } from '@hcm/shared/funnels';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState, StatisticsNumbersPort } from '../../../src/admin/crashes/crashes-port.js';
import { formatShare, pageName, screenName } from '../../../src/admin/crashes/statistics-bars.js';
import { causeTitle } from '../../../src/admin/crashes/statistics-crashes.js';
import { loadStatisticsLive, statisticsLiveSheet } from '../../../src/admin/crashes/statistics-view.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { crashesState, page } from './fixtures.js';
import { NUMBERS, statistics } from './statistics-fixtures.js';

/** The owner's "prettify" of 2026-11-13: stat cards, bar lists, step bars, error cards, skeletons and the folded help. */
describe('the Statistics view as cards and charts', () => {
    beforeAll(async () => {
        defineAll();
        await loadStatisticsLive();
    });
    afterEach(cleanup);

    async function ready(numbers: StatisticsNumbersPort, locale: 'en' | 'ro' = 'en'): Promise<HTMLElement> {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({ statistics: statistics({ status: 'ready', numbers }) }),
        );
        return (await page('crashes', crashes, { params: ['statistics'], locale })).element;
    }

    it('happyPath_pathsAndScreensInWords_andSharesAsTheLanguageWritesThem', () => {
        expect(pageName('en', '/')).toBe('The public map');
        expect(pageName('ro', '/admin/')).toBe('Administrarea');
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
});
