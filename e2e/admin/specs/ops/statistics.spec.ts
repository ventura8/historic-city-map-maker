import type { Page } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../../packages/admin/src/google/scopes.js';
import type { InputBudget } from '../../../support/budget.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { projectCity } from '../../support/content.js';
import type { GoogleConsent } from '../../support/consent.js';
import { contentText } from '../../support/ops.js';
import { shellText } from '../../support/i18n.js';
import { seedPhotosCity } from '../../support/photos.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Statistics view's numbers (behaviour A153, DECISIONS-for-review.md §203): the owner of a provisioned map whose
 * Google Analytics is linked opens Crashes → Where people get stuck and presses Show the numbers here. Google's consent is
 * the mock APIs' stand-in (the read-only Analytics scope only); the measurement id comes from `setup.analyticsConfig`
 * (the server's world), the property from the Analytics Admin API and the numbers from the Data API (the browser's world);
 * Error Reporting's groups are `telemetry.listGroups`.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

const AT = new Date('2026-10-01T09:00:00.000Z');

test.beforeEach(async ({ adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    await upstream.scenario('google.provisioned', 'both');
    await upstream.scenario('firebase-management.analyticsLinked', 'both');
    await upstream.scenario('analytics-data.registered', 'browser');
});

async function openStatistics(page: Page, lang: 'ro' | 'en') {
    await page.goto(adminPath(lang, 'crashes/statistics'));
    const numbers = page.locator('[data-statistics-numbers]');
    await expect(numbers.getByRole('heading', { name: contentText(lang, 'adminContent.statistics.numbers.title') })).toBeVisible();
    return { numbers, show: numbers.getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.show') }) };
}

test(
    'Show the numbers here: one read-only consent, then the overview, the apps and the new city funnel; a period read once',
    { tag: ['@S-A153-HAPPY-NUMBERS'] },
    async ({ page, lang, consent, inputBudget, upstream, consoleErrors }) => {
        await upstream.scenario('analytics-data.sample', 'browser');
        await upstream.scenario('error-reporting.twoGroups', 'server');
        const { numbers, show } = await openStatistics(page, lang);
        await expect(numbers.locator('hcm-consent-note')).toHaveAttribute('scope', 'analyticsRead');

        const popup = await consent.opened(page, () => show.click());
        expect(await popup.requestedScopes()).toEqual([GOOGLE_SCOPES.analyticsRead]);
        await popup.allow(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        await expect(numbers.getByText(contentText(lang, 'adminContent.statistics.numbers.notMeasured'))).toBeVisible();
        await expect(numbers.locator('[data-funnel="new_city"]')).toContainText('3 (30 %)');
        await expect(page.locator('[data-statistics-crashes] a.external')).toHaveCount(2);
        await expectStateSound(page, adminVisit('crashes.statistics-numbers', lang));

        const periods = numbers.getByRole('radio', { name: contentText(lang, 'adminContent.statistics.numbers.days.7') });
        await periods.click();
        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('30');
        await numbers.getByRole('radio', { name: contentText(lang, 'adminContent.statistics.numbers.days.28') }).click();
        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        expect(await upstream.calls('browser', 'analytics-data')).toHaveLength(14);
        expect(await consent.requests()).toHaveLength(1);

        // Refresh lists the period's error groups again: Error Reporting off is said with the way to Setup.
        await upstream.fail('error-reporting', 'apiDisabled', 'server');
        await numbers.getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.refresh') }).click();
        await expect(
            page.locator('[data-statistics-crashes]').getByText(contentText(lang, 'adminContent.crashes.apiDisabled')),
        ).toBeVisible();
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

test(
    'A refused Analytics consent reads nothing and says to tick the permission next time',
    { tag: ['@S-A153-BAD-CONSENT-REFUSED'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        const { numbers, show } = await openStatistics(page, lang);

        const popup = await consent.opened(page, () => show.click());
        await popup.cancel(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.getByRole('alert')).toContainText(contentText(lang, 'adminContent.statistics.problem.consent'));
        await expect(show).toBeEnabled();
        expect(await upstream.calls('browser', 'analytics-data')).toEqual([]);
    },
);

test(
    'The Data API off: the view says so and leads to Setup and to the API in the Google Cloud console',
    { tag: ['@S-A153-BAD-API-DISABLED'] },
    async ({ page, lang, consent, inputBudget, upstream, consoleErrors }) => {
        await upstream.fail('analytics-data', 'apiDisabled', 'browser');
        const { numbers, show } = await openStatistics(page, lang);

        const popup = await consent.opened(page, () => show.click());
        await popup.allow(inputBudget.flow('statistics-consent', 1));

        await expect(numbers.getByRole('alert')).toContainText(contentText(lang, 'adminContent.statistics.problem.apiDisabled'));
        await expect(numbers.getByRole('link', { name: contentText(lang, 'adminContent.statistics.problem.openSetup') })).toHaveAttribute(
            'href',
            '#/setup',
        );
        await expect(
            numbers.getByRole('link', { name: new RegExp(contentText(lang, 'adminContent.statistics.problem.openConsole').slice(0, 20)) }),
        ).toHaveAttribute('href', /^https:\/\/console\.cloud\.google\.com\/apis\/library\/analyticsdata\.googleapis\.com\?project=/);
        await expectStateSound(page, adminVisit('crashes.statistics-problem', lang));
        expect(consoleErrors.takeMatching(/status of 403/).length).toBeGreaterThan(0);
    },
);

/** The guide is folded under its own summary: the codes' line shows once it opens (once a page: a second click would fold it). */
async function openHelp(page: Page, lang: 'ro' | 'en') {
    const help = page.locator('[data-statistics-help]');
    if ((await help.getAttribute('open')) === null) {
        await help.getByText(contentText(lang, 'adminContent.statistics.helpTitle'), { exact: true }).click();
    }
}

async function shown(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, inputBudget: InputBudget) {
    const opened = await openStatistics(page, lang);
    const popup = await consent.opened(page, () => opened.show.click());
    await popup.allow(inputBudget.flow('statistics-consent', 1));
    return opened.numbers;
}

test(
    'Names registered but not ready: the other numbers show, the reports GA4 cannot answer are not asked, and the page says when to look again',
    { tag: ['@S-A153-BAD-NOT-READY', '@S-A153-HAPPY-PARTIAL'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        await upstream.scenario('analytics-data.sample', 'browser');
        await upstream.scenario('analytics-data.notReady', 'browser');
        const numbers = await shown(page, lang, consent, inputBudget);

        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        await expect(numbers.locator('[data-statistics-pending="notReady"]')).toContainText(
            contentText(lang, 'adminContent.statistics.pending.notReadyFix'),
        );
        await openHelp(page, lang);
        await expect(page.locator('[data-statistics-codes="notReady"]')).toBeVisible();
        await expect(numbers.getByRole('alert')).toHaveCount(0);
        const bodies = (await upstream.calls('browser', 'analytics-data'))
            .filter((call) => call.method === 'POST')
            .map((call) => call.body);
        expect(bodies).toHaveLength(4);
        expect(bodies.every((body) => !body.includes('customEvent:'))).toBe(true);
        await expectStateSound(page, adminVisit('crashes.statistics-pending', lang));
    },
);

test(
    'Names never registered: the numbers that can be read show, with Setup step g as the fix',
    { tag: ['@S-A153-BAD-NOT-REGISTERED', '@S-A153-HAPPY-PARTIAL'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        await upstream.scenario('analytics-data.sample', 'browser');
        // Not `registered`: the Admin fake has no custom names, so none is in the property's metadata.
        await upstream.scenario('analytics-data.unregistered', 'browser');
        const numbers = await shown(page, lang, consent, inputBudget);

        await expect(numbers.locator('[data-statistics-visitors]')).toHaveText('120');
        await expect(numbers.locator('[data-statistics-pending="notRegistered"]')).toBeVisible();
        await expect(numbers.getByRole('link', { name: contentText(lang, 'adminContent.statistics.problem.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/analytics',
        );
    },
);

test(
    'No values yet: the page says so and when to look again; once they arrive Refresh shows the steps and the note goes',
    { tag: ['@S-A153-BAD-NO-DATA', '@S-A153-HAPPY-DATA-ARRIVES'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        const numbers = await shown(page, lang, consent, inputBudget);

        await expect(numbers.locator('[data-statistics-pending="noData"]')).toContainText(
            contentText(lang, 'adminContent.statistics.pending.noDataFix'),
        );
        await openHelp(page, lang);
        await expect(page.locator('[data-statistics-codes="noData"]')).toBeVisible();

        await upstream.scenario('analytics-data.sample', 'browser');
        await numbers.getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.refresh') }).click();
        await expect(numbers.locator('[data-funnel="new_city"]')).toContainText('3 (30 %)');
        await expect(numbers.locator('[data-statistics-pending]')).toHaveCount(0);
        await openHelp(page, lang);
        await expect(page.locator('[data-statistics-codes="ready"]')).toBeVisible();
    },
);

test(
    "A report request Google refuses: said as the admin's fault, with Google Analytics as the way to the numbers meanwhile",
    { tag: ['@S-A153-BAD-REFUSED'] },
    async ({ page, lang, consent, inputBudget, upstream, consoleErrors }) => {
        await upstream.scenario('analytics-data.refuse', 'browser');
        const numbers = await shown(page, lang, consent, inputBudget);

        await expect(numbers.getByRole('alert')).toContainText(contentText(lang, 'adminContent.statistics.problem.refused'));
        await expect(numbers.getByRole('link', { name: contentText(lang, 'adminContent.statistics.open') })).toHaveAttribute(
            'href',
            'https://analytics.google.com/analytics/web/',
        );
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBeGreaterThan(0);
    },
);

// Home's Visitors card (the owner, 2026-11-16; behaviour A194): the Statistics page's last numbers of this session.
test(
    "Home's Visitors card shows the Statistics page's last numbers, and before any read says where to allow it",
    { tag: ['@S-A194-HAPPY', '@S-A194-BAD-NOT-READ'] },
    async ({ page, lang, consent, inputBudget, upstream }) => {
        await upstream.scenario('analytics-data.sample', 'browser');
        await page.goto(adminPath(lang, 'home'));
        const card = page.locator('[data-visitors]');
        await expect(card).toHaveAttribute('data-visitors', 'none');
        await expect(card.getByRole('link', { name: shellText(lang, 'adminShell.home.visitors.open') })).toHaveAttribute(
            'href',
            '#/crashes/statistics',
        );
        const calls = (await upstream.calls('browser', 'analytics-data')).length;
        expect(calls).toBe(0);

        await card.getByRole('link', { name: shellText(lang, 'adminShell.home.visitors.open') }).click();
        const show = page
            .locator('[data-statistics-numbers]')
            .getByRole('button', { name: contentText(lang, 'adminContent.statistics.numbers.show') });
        const popup = await consent.opened(page, () => show.click());
        await popup.allow(inputBudget.flow('statistics-consent', 1));
        await expect(page.locator('[data-statistics-visitors]')).toHaveText('120');

        await page.evaluate(() => {
            window.location.hash = '#/home';
        });
        await expect(card).toHaveAttribute('data-visitors', 'read');
        await expect(card.locator('[data-top="years"]')).toContainText('1966');
        await expectStateSound(page, adminVisit('home.visitors', lang));
    },
);
