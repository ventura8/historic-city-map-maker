import type { Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { seedLayer, text } from '../settings/world.js';

/**
 * Dates read in the admin's language whatever the browser's (behaviour A21; the orchestrator's review of the M2c
 * screenshots, 2026-10-18): the browser speaks American English, where a native date input shows `mm/dd/yyyy`; the layer
 * editor's exact date is a text field in the admin's language instead (`zz.ll.aaaa` in Romanian, `dd/mm/yyyy` in English,
 * `packages/ui/src/admin/editing/date-text.ts`), and what is typed is stored as an ISO date.
 */

test.use({ locale: 'en-US', timezoneId: 'America/New_York' });

const AT = new Date('2026-10-17T09:00:00.000Z');
const LAYER = 'corona-1968';

const PATTERN = { ro: 'zz.ll.aaaa', en: 'dd/mm/yyyy' } as const;
const SEPARATOR = { ro: '.', en: '/' } as const;

function dateField(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('textbox', { name: text(lang, 'adminContent.layers.date'), exact: true });
}

async function openLayer(page: Page, lang: 'ro' | 'en', content: ContentWorld): Promise<void> {
    await seedPublicCity(content, AT);
    await seedLayer(content, LAYER, AT, { attribution: 'USGS EarthExplorer (e2e)', date: '1968-08-24' });
    await page.goto(content.address(lang, `layers/${LAYER}`));
    await expect(page.getByRole('heading', { level: 2, name: 'Corona 1968' })).toBeVisible();
}

test(
    "A layer's exact date reads in the admin's language in an American browser and is saved as an ISO date",
    { tag: ['@S-A21-HAPPY-DATES-IN-LANGUAGE'] },
    async ({ page, lang, content }) => {
        await openLayer(page, lang, content);
        const field = dateField(page, lang);

        expect(await page.evaluate(() => navigator.language)).toBe('en-US');
        await expect(field).toHaveValue(['24', '08', '1968'].join(SEPARATOR[lang]));
        await expect(field).toHaveAttribute('placeholder', PATTERN[lang]);
        await expect(field).toHaveAttribute('type', 'text');
        await expect(page.getByText(text(lang, 'adminContent.common.dateHint', { pattern: PATTERN[lang] }))).toBeVisible();

        await field.fill(['25', '08', '1968'].join(SEPARATOR[lang]));
        await page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true }).click();

        await expect.poll(async () => (await content.document(`layers/${LAYER}`))?.['date']).toBe('1968-08-25');
        await expect(field).toHaveValue(['25', '08', '1968'].join(SEPARATOR[lang]));
    },
);

test(
    'A date that cannot be read is marked at its field and nothing is saved',
    { tag: ['@S-A21-BAD-DATE-UNREAD'] },
    async ({ page, lang, content }) => {
        await openLayer(page, lang, content);
        const field = dateField(page, lang);

        // 31 February does not exist: the draft keeps the text, the field says so and Save stays off.
        await field.fill(['31', '02', '1968'].join(SEPARATOR[lang]));

        await expect(field).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByRole('button', { name: text(lang, 'adminContent.common.save'), exact: true })).toBeDisabled();
        await expect(field).toHaveValue(['31', '02', '1968'].join(SEPARATOR[lang]));
        expect((await content.document(`layers/${LAYER}`))?.['date']).toBe('1968-08-24');
    },
);
