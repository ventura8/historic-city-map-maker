import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { shellText } from '../../support/i18n.js';
import { projectCity } from '../../support/content.js';
import { seedCity } from '../../support/ops.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

/**
 * Home's Monthly costs (the owner, 2026-11-16; behaviour A192): every paid service with this month's spend, the forecast and its
 * console; Mapbox's compute units measured from `usage/mapbox-<month>`; past the budget the alert's numbers, what pauses and
 * the way to Jobs.
 */

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });
test.use({ persona: 'owner', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-11-10T09:00:00.000Z');

test(
    'Home shows each paid service with its month so far, its forecast and its console, and says when the budget is passed',
    { tag: ['@S-A192-HAPPY', '@S-A192-BAD-OVER-BUDGET'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(projectCity(emulators, adminWorld.accounts.owner.uid), AT);
        await page.goto(adminPath(lang, 'home'));
        const month = await page.evaluate(() => new Date().toISOString().slice(0, 7));
        const stamp = { updatedBy: 'system:ops', updatedAt: AT };
        await emulators.setDocument(`usage/mapbox-${month}`, {
            month,
            computeUnits: 30,
            computeUnitBudget: 20,
            uploadedMb: 5,
            publishes: 2,
            ...stamp,
        });

        const costs = page.getByRole('region', { name: shellText(lang, 'adminShell.home.costs.title') });
        const mapbox = costs.getByRole('listitem').filter({ hasText: shellText(lang, 'adminShell.home.costs.service.mapbox') });
        await expect(mapbox).toContainText(shellText(lang, 'adminShell.home.costs.basis.measured'));
        await expect(mapbox).toContainText('150');
        await expect(costs.getByRole('listitem')).toHaveCount(5);
        await expect(mapbox.getByRole('link')).toHaveAttribute('href', 'https://console.mapbox.com/account/statistics/');
        await expect(costs).toContainText(shellText(lang, 'adminShell.home.costs.note.firebase'));

        // The bad path: Google's budget alert passed the budget; the card says what pauses and where to act.
        await emulators.setDocument('ops/guard', {
            state: 'red',
            reason: 'budget',
            spend: { costAmount: 6, budgetAmount: 5, currency: 'USD' },
            ...stamp,
        });
        await expect(costs.getByRole('status')).toContainText(shellText(lang, 'adminShell.home.costs.overBudget'));
        await expect(costs.getByRole('link', { name: shellText(lang, 'adminShell.home.costs.jobs') })).toHaveAttribute('href', '#/jobs');
        await expectStateSound(page, adminVisit('home.costs', lang));
    },
);
