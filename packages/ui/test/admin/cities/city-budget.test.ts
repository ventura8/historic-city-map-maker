/**
 * Settings → The city's budget (M5, `docs/research/M5-interfaces.md` §1.8; behaviour A52): the card the project's owner
 * changes and every other admin reads, its own chunk, and its row on the settings page.
 */
import { translateAdminContent, type Locale } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { budgetCard } from '../../../src/admin/cities/city-budget.js';
import type { BudgetIntentsPort, BudgetSectionPort } from '../../../src/admin/cities/budget-port.js';
import { BUDGET_CARD_CHUNK, lazyBudgetCard, type BudgetCardChunk } from '../../../src/admin/cities/lazy-budget.js';
import { chunkLoader } from '../../../src/admin/imagery/orders/lazy-card.js';
import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';

const LIMITS = { computeUnitsPerMonth: 8, rasterJobsPerDay: 3, aiRequestsPerMonth: 100, geocodeCellsPerDay: 100, exportsPerDay: 2 };

function sectionOf(overrides: Partial<BudgetSectionPort> = {}): BudgetSectionPort {
    return {
        status: 'ready',
        failure: null,
        owner: true,
        limits: LIMITS,
        draft: {},
        used: { computeUnitsPerMonth: 3.5, aiRequestsPerMonth: 7 },
        saving: false,
        error: null,
        ...overrides,
    };
}

function draw(
    view: BudgetSectionPort,
    options: { readonly locale?: Locale; readonly readOnly?: boolean } = {},
): { root: HTMLElement; calls: string[] } {
    const calls: string[] = [];
    const intents: BudgetIntentsPort = {
        setLimit: (field, text) => calls.push(`setLimit ${field} ${text}`),
        saveLimits: () => {
            calls.push('saveLimits');
            return Promise.resolve(true);
        },
        discardLimits: () => calls.push('discardLimits'),
        retryBudget: () => calls.push('retryBudget'),
    };
    const root = document.createElement('div');
    document.body.append(root);
    render(budgetCard({ locale: options.locale ?? 'en', view, intents, readOnly: options.readOnly === true }), root);
    return { root, calls };
}

async function click(button: Element): Promise<void> {
    await updated(button);
    deep(button, 'button').click();
}

describe('the city budget card', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theProjectsOwnerChangesALimitAndSaves @S-A52-HAPPY', async () => {
        const { root, calls } = draw(sectionOf({ draft: { rasterJobsPerDay: '5' } }));

        expect(deepAll(root, 'input').map((input) => (input as HTMLInputElement).value)).toEqual(['8', '5', '100', '100', '2']);
        expect(deepText(root)).toContain('Used so far in this period: 3.5 of 8');
        expect(deep(root, '#limit-computeUnitsPerMonth').getAttribute('aria-describedby')).toBe('used-computeUnitsPerMonth');
        expect(deep(root, '#limit-exportsPerDay').hasAttribute('aria-describedby')).toBe(false);
        const field = deep(root, '#limit-exportsPerDay') as HTMLInputElement;
        field.value = '4';
        field.dispatchEvent(new Event('input'));
        const [save, discard] = deepAll(root, 'hcm-button');
        if (save === undefined || discard === undefined) {
            throw new Error('the owner has Save and Discard');
        }
        await click(save);
        await click(discard);

        expect(calls).toEqual(['setLimit exportsPerDay 4', 'saveLimits', 'discardLimits']);
        expect(await axeViolations(root)).toEqual([]);
    });

    it('badPath_anAdminWhoIsNotTheProjectsOwnerReadsThemOnly @S-A52-BAD-NOT-PROJECT-OWNER', async () => {
        const { root } = draw(sectionOf({ owner: false }), { locale: 'ro' });

        expect(deepAll(root, 'input').every((input) => (input as HTMLInputElement).readOnly)).toBe(true);
        expect(deep(root, '[data-budget-readonly]').textContent).toContain('proiectului');
        expect(deepAll(root, 'hcm-button')).toHaveLength(0);
        expect(await axeViolations(root)).toEqual([]);
    });

    it('badPath_aValueOutOfRangeSaysWhyAndNothingChangedLeavesSaveOff', () => {
        const { root } = draw(sectionOf({ error: { key: 'adminContent.budgets.invalid' } }));

        expect(deep(root, '[role="alert"]').textContent).toContain('from 0 up to');
        expect(deepAll(root, 'hcm-button').every((button) => button.hasAttribute('disabled'))).toBe(true);
    });

    it('happyPath_aCityWithoutLimitsSaysTheProjectsCapsHoldItAndARevokedPageCannotSave', () => {
        // docs/LESSONS.md 256: the new-city defaults were shown as if they applied, and "used X of Y" used them as Y.
        const { root } = draw(sectionOf({ limits: null, used: { aiRequestsPerMonth: 7 }, draft: { exportsPerDay: '1' } }), {
            readOnly: true,
        });

        expect(deepAll(root, 'input').map((input) => (input as HTMLInputElement).value)).toEqual(['', '', '', '', '1']);
        expect(deep(root, '[data-budget-caps-only]').textContent).toBe(translateAdminContent('en', 'adminContent.budgets.projectCapsOnly'));
        expect(deep(root, '#used-aiRequestsPerMonth').textContent).toBe(
            translateAdminContent('en', 'adminContent.budgets.usedNoLimit', { used: '7' }),
        );
        expect(deepAll(root, 'input').every((input) => (input as HTMLInputElement).readOnly)).toBe(true);
        expect(deepAll(root, 'hcm-button')[0]?.hasAttribute('disabled')).toBe(true);
    });

    it('badPath_loadingThenAnErrorWithTryAgain', async () => {
        expect(deepAll(draw(sectionOf({ status: 'loading' })).root, 'hcm-loading-indicator')).toHaveLength(1);

        const { root, calls } = draw(sectionOf({ status: 'error', failure: { kind: 'denied', code: 'permission-denied' } }));
        await click(deep(root, 'hcm-button'));

        expect(calls).toEqual(['retryBudget']);
    });
});

describe('the city budget card’s chunk', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_loadingUntilTheChunkIsIn_thenTheCard', async () => {
        let refreshes = 0;
        const chunk = chunkLoader<BudgetCardChunk>(async () => import('../../../src/admin/cities/city-budget.js'));
        const root = document.createElement('div');
        document.body.append(root);
        const context = { locale: 'en' as const, view: sectionOf(), intents: null, readOnly: false, refresh: () => (refreshes += 1) };

        render(lazyBudgetCard(context, chunk), root);
        expect(deepAll(root, 'hcm-loading-indicator')).toHaveLength(1);
        await chunk.load();
        render(lazyBudgetCard(context, chunk), root);

        expect(refreshes).toBe(1);
        expect(deepAll(root, '[data-city-budget] input')).toHaveLength(5);
    });

    it('badPath_aFailedFetchSaysSoWithTryAgain', async () => {
        let fetches = 0;
        let refreshes = 0;
        const chunk = chunkLoader<BudgetCardChunk>(() => {
            fetches += 1;
            return Promise.reject(new Error('offline'));
        });
        const root = document.createElement('div');
        document.body.append(root);
        const context = { locale: 'en' as const, view: sectionOf(), intents: null, readOnly: false, refresh: () => (refreshes += 1) };

        render(lazyBudgetCard(context, chunk), root);
        await chunk.load().catch(() => undefined);
        render(lazyBudgetCard(context, chunk), root);
        expect(deepAll(root, '[role="alert"]')).toHaveLength(1);
        await click(deep(root, 'hcm-button'));

        expect(fetches).toBe(2);
        expect(refreshes).toBeGreaterThanOrEqual(2);
    });
});

describe('<hcm-settings-page> budget', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theSectionShowsTheCardOnceItsChunkIsIn', async () => {
        const settings = new FakeArea<SettingsViewState, SettingsIntentsPort>(settingsState({ section: 'budget', budget: sectionOf() }));
        const { element } = await page('settings', settings, { params: ['budget'] });

        await BUDGET_CARD_CHUNK.load();
        await updated(element);

        expect(deepText(element)).toContain('Mapbox compute units a month');
        expect(deepAll(element, 'a.section-row[href="#/settings/budget"]')).toHaveLength(1);
        expect(await axeViolations(element)).toEqual([]);
    });
});
