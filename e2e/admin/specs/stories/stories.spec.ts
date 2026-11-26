import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { AT, cityText } from '../cities/world.js';
import type { EmulatorWorld } from '../../support/emulators.js';

// One admin test at a time: memberships (`admins/*`) are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * M17's stories in the admin (docs/research/M17-stories.md §6; behaviour A100), against the emulators' rules and triggers, driven
 * from outside: an owner writes and publishes one; an http link is refused at the text; an uploader's story waits for review.
 * The rules' matrix is firebase/rules-tests/test/stories.test.ts.
 */
const STAMP = { updatedBy: 'system:photos', updatedAt: AT };

async function seedCity(emulators: EmulatorWorld): Promise<void> {
    await emulators.setDocument(`cities/${PROJECT_CITY}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        ...STAMP,
    });
}

async function storyId(emulators: EmulatorWorld): Promise<string> {
    const stories = await emulators.collection(`cities/${PROJECT_CITY}/stories`);
    return Object.keys(stories)[0] ?? '';
}

test.describe('an owner', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'writes a story, publishes it and finds its versions',
        { tag: ['@S-A100-HAPPY-EDIT', '@S-A100-BAD-HTTP-LINK'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators } = adminWorld;
            await seedCity(emulators);
            await page.goto(adminPath(lang, 'stories'));
            await page.getByLabel(cityText(lang, 'adminContent.stories.newTitle')).fill('Teatrul Național');
            await page.getByRole('button', { name: cityText(lang, 'adminContent.stories.create') }).click();
            await expect(page.getByRole('heading', { name: 'Teatrul Național' })).toBeVisible();

            const body = page.getByLabel(cityText(lang, 'adminContent.stories.bodyRo'));
            await body.fill('O [sursă](http://example.org).');
            await expect(body).toHaveAttribute('aria-invalid', 'true');
            await expect(page.getByRole('button', { name: cityText(lang, 'adminContent.common.save') })).toBeDisabled();
            await expectStateSound(page, adminVisit('stories.refused-link', lang));

            await body.fill('Clădirea a ars în **1944**. O [sursă](https://example.org).');
            await page.getByLabel(cityText(lang, 'adminContent.stories.yearStart')).fill('1852');
            await page.getByRole('switch', { name: cityText(lang, 'adminContent.stories.published') }).click();
            await page.getByRole('button', { name: cityText(lang, 'adminContent.common.save') }).click();
            await expect(page.getByRole('status').filter({ hasText: cityText(lang, 'adminContent.stories.state.saved') })).toBeVisible();
            const id = await storyId(emulators);
            await expect.poll(async () => (await emulators.document(`cities/${PROJECT_CITY}/stories/${id}`))?.['published']).toBe(true);
            await expectStateSound(page, adminVisit('stories.editor', lang));

            await page.getByRole('link', { name: cityText(lang, 'adminContent.stories.versions') }).click();
            await expect(page).toHaveURL(new RegExp(`#/history/story/${id}$`));
        },
    );
});

test.describe('an uploader', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'writes a story that waits for review and cannot publish it',
        { tag: '@S-A100-BAD-UPLOADER-WAITS' },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await emulators.updateFields(`admins/${accounts.admin.uid}`, { cities: { [PROJECT_CITY]: 'uploader' } }, ['cities']);
            await page.goto(adminPath(lang, 'stories'));
            await page.getByLabel(cityText(lang, 'adminContent.stories.newTitle')).fill('Povestea mea');
            await page.getByRole('button', { name: cityText(lang, 'adminContent.stories.create') }).click();
            await expect(page.getByRole('heading', { name: 'Povestea mea' })).toBeVisible();
            await expect(page.getByText(cityText(lang, 'adminContent.stories.waitsHelp'))).toBeVisible();
            await expect(page.getByRole('switch')).toHaveCount(0);
            const id = await storyId(emulators);
            expect(await emulators.document(`cities/${PROJECT_CITY}/stories/${id}`)).toMatchObject({
                reviewStatus: 'pending',
                published: false,
            });
            await expectStateSound(page, adminVisit('stories.uploader', lang));
        },
    );
});

test.describe('a moderator', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'reviews a story but gets no New story, no Delete and no Versions',
        { tag: '@S-A100-BAD-ROLE-ACTIONS' },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await emulators.setDocument(`cities/${PROJECT_CITY}/stories/teatrul`, {
                title: { ro: 'Teatrul Național' },
                body: { ro: 'Clădirea a ars în 1944.' },
                published: true,
                ...STAMP,
            });
            await emulators.updateFields(`admins/${accounts.admin.uid}`, { cities: { [PROJECT_CITY]: 'moderator' } }, ['cities']);
            await page.goto(adminPath(lang, 'stories/teatrul'));
            await expect(page.getByRole('heading', { name: 'Teatrul Național' })).toBeVisible();
            await expect(page.getByRole('switch', { name: cityText(lang, 'adminContent.stories.published') })).toBeVisible();
            await expect(page.getByLabel(cityText(lang, 'adminContent.stories.newTitle'))).toHaveCount(0);
            await expect(page.getByRole('button', { name: cityText(lang, 'adminContent.stories.delete') })).toHaveCount(0);
            await expect(page.getByRole('link', { name: cityText(lang, 'adminContent.stories.versions') })).toHaveCount(0);
            await expectStateSound(page, adminVisit('stories.moderator', lang));
        },
    );
});
