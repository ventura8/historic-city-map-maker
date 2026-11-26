import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { text } from './world.js';

/**
 * Settings → Wikipedia (behaviour A230; docs/research/M31-wikipedia.md §3) against the Functions and Firestore emulators: the
 * card reads `wikipedia.manage` (the state the server's last fetch left, written here past the rules), an editor hides an
 * article and saves, and the state holds it; a failed fetch is said with what to do, and the last language cannot go.
 */

const AT = new Date('2026-11-21T08:00:00.000Z');

function card(page: Page): Locator {
    return page.locator('hcm-settings-page section[data-section="wikipedia"]');
}

const ARTICLES = [
    {
        id: 'ro-1',
        lng: 26.0973,
        lat: 44.4413,
        versions: { ro: { title: 'Ateneul Român', extract: 'Sală.', url: 'https://ro.wikipedia.org/wiki/Ateneul_Rom%C3%A2n' } },
    },
    {
        id: 'ro-2',
        lng: 26.0966,
        lat: 44.4313,
        versions: { ro: { title: 'Palatul CEC', extract: 'Palat.', url: 'https://ro.wikipedia.org/wiki/Palatul_CEC' } },
    },
];

async function seedState(content: ContentWorld, extra: Readonly<Record<string, unknown>>): Promise<void> {
    await content.emulators.setDocument(`cities/${content.city}/wikipedia/state`, {
        enabled: true,
        languages: ['ro', 'en'],
        hidden: [],
        articles: ARTICLES,
        refreshedAt: AT,
        updatedBy: 'system:publish',
        updatedAt: AT,
        ...extra,
    });
}

async function hidden(content: ContentWorld): Promise<unknown> {
    const state = await content.emulators.document(`cities/${content.city}/wikipedia/state`);
    return state?.['hidden'];
}

test(
    'The Wikipedia card lists the articles, an editor hides one and saves',
    { tag: ['@S-A230-HAPPY-CARD', '@S-A230-HAPPY-SAVE'] },
    async ({ page, lang, content }) => {
        await seedPublicCity(content, AT);
        await seedState(content, {});
        await page.goto(content.address(lang, 'settings/wikipedia', { map: false }));

        await expect(card(page).locator('[data-wikipedia-article]')).toHaveCount(2);
        await expect(card(page).locator('[data-wikipedia-status]')).toBeVisible();
        await expectStateSound(page, adminVisit('settings.wikipedia-articles', lang));

        await card(page)
            .getByRole('button', { name: text(lang, 'adminContent.settings.wikipedia.hideNamed', { title: 'Palatul CEC' }) })
            .click();
        await card(page).locator('[data-wikipedia-save]').click();

        await expect(page.locator('hcm-snackbar').filter({ hasText: text(lang, 'adminContent.settings.wikipedia.saved') })).toBeVisible();
        await expect.poll(() => hidden(content)).toEqual(['ro-2']);
        await expect(card(page).locator('[data-wikipedia-article="ro-2"]')).toHaveAttribute('data-hidden', '');
    },
);

test(
    'A failed fetch is said with what to do, and the last language cannot be switched off',
    { tag: ['@S-A230-BAD-WIKIPEDIA-DOWN', '@S-A230-BAD-LAST-LANGUAGE'] },
    async ({ page, lang, content }) => {
        await seedPublicCity(content, AT);
        await seedState(content, { languages: ['ro'], failure: 'rateLimited' });
        await page.goto(content.address(lang, 'settings/wikipedia', { map: false }));

        await expect(card(page).locator('[data-wikipedia-failure]')).toHaveText(
            text(lang, 'adminContent.settings.wikipedia.failure.rateLimited'),
        );
        const languages = card(page).locator('[data-wikipedia-languages] hcm-switch');
        await expect(languages.first()).toHaveAttribute('disabled', '');
        await expect(card(page).locator('[data-wikipedia-save]')).toHaveAttribute('disabled', '');
        await expectStateSound(page, adminVisit('settings.wikipedia-failed', lang));
    },
);
