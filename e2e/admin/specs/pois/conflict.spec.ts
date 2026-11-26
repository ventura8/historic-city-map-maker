import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { testIdOf } from '../../../support/test.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import { ContentWorld } from '../../support/content.js';
import { EmulatorWorld } from '../../support/emulators.js';
import { seedPublicCity } from '../../support/flows.js';
import { contentText } from '../../support/ops.js';
import { poisText, seedCategories, seedPlace } from './places.js';

/**
 * Another admin's save while a place is open (docs/research/M2c-interfaces.md §5.1, §5.3; behaviour A38;
 * DECISIONS-for-review.md §42c), in a city of the admin's own: the banner names the other admin and when they saved, and
 * the fields both changed; Keep mine saves the draft over their version. The banner's state runs the generic checkers,
 * which are Chromium's (the editing forms' Firefox and WebKit projects, `specs/editing/`, do not run them: Firefox keeps
 * the focus on the last control when Tab leaves the page, which the Tab round would take for a trap).
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** When the other admin's version was saved (a fixed time, after the place's own). */
const SAVED_ELSEWHERE = new Date('2026-10-18T10:30:00.000Z');

async function openPlace(page: Page, content: ContentWorld, lang: 'ro' | 'en'): Promise<void> {
    await seedPublicCity(content, AT);
    await seedCategories(content, AT);
    await seedPlace(content, { id: 'gara', title: 'Gara Veche', at: [26.0726, 44.4467] }, AT);
    await page.goto(content.address(lang, 'pois/gara', { map: false }));
    await expect(title(page, lang)).toHaveValue('Gara Veche');
}

function title(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') });
}

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true });
}

test(
    'A change another admin saved meanwhile is never overwritten silently: the banner names them, when, and the fields both changed',
    { tag: ['@S-A38-BAD-CONFLICT'] },
    async ({ page, lang, content, mockApiRequest }, testInfo) => {
        test.setTimeout(150_000);
        // Another admin of the map, with an account and a city of their own (their address is their name), and an editor of
        // this city too: the banner names the admins of the city only (M5, docs/research/M5-interfaces.md §1.7).
        const other = await ContentWorld.prepare(new EmulatorWorld(mockApiRequest), `${testIdOf(testInfo)}-other`);
        await other.emulators.updateFields(`admins/${other.uid}`, { cities: { [other.city]: 'owner', [content.city]: 'editor' } }, [
            'cities',
        ]);
        try {
            await openPlace(page, content, lang);
            await title(page, lang).fill('Gara de Nord');
            // The other admin's save: a new title (a document read back from the emulator would not pass the schema again).
            await seedPlace(
                content,
                { id: 'gara', title: 'Gara Mare', at: [26.0726, 44.4467], extra: { updatedBy: other.uid, updatedAt: SAVED_ELSEWHERE } },
                AT,
            );

            const banner = page.getByRole('alert').filter({ hasText: poisText(lang, 'adminContent.pois.conflict') });
            await expect(banner).toContainText(other.account.email);
            await expect(banner).toContainText('2026');
            await expect(banner).toContainText(
                poisText(lang, 'adminContent.pois.conflictFields', { fields: contentText(lang, 'adminContent.field.title') }),
            );
            await expectStateSound(page, adminVisit('editing.conflict', lang));

            // Keep mine: the draft's title over the other admin's version, saved once.
            await banner.getByRole('button', { name: poisText(lang, 'adminContent.pois.keepMine') }).click();
            await saveButton(page, lang).click();
            await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
            expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara de Nord' });
        } finally {
            await other.retire();
        }
    },
);
