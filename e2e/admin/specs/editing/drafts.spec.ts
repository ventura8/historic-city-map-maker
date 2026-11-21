import { translate, translateAdminShell } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { chooseInMenu } from '../../support/menu.js';
import { awaitManifest, entry, seedPublicCity } from '../../support/flows.js';
import { templatePattern } from '../../support/i18n.js';
import { contentText } from '../../support/ops.js';
import { poisText, seedCategories, seedPlace } from '../pois/places.js';

/**
 * Drafts and saving, the editing kit's behaviour every editor shares (docs/research/M2c-interfaces.md §2.4, §5; behaviour
 * A38), shown on a place of a city of the admin's own: an edit is a draft the list previews and one Save writes with its
 * history and the public map's update; leaving with changes asks first; invalid fields are named at the field and nothing
 * is written; offline, the draft stays until a later Save writes it once; a place deleted elsewhere cannot be saved back.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/**
 * The list beside the editor and the navigation rail, which the draft's preview and the unsaved guard's "another page"
 * use: a large window (on a phone the editor is full screen, without the list and the bar).
 */
async function sideBySide(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1440, height: 900 });
}

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

/** The unsaved guard's dialog (its actions are slotted content of the kit's dialog). */
function guard(page: Page): Locator {
    return page.locator('hcm-dialog[open]');
}

test(
    "An edit previews in the list with nothing written, and one Save writes it stamped, with its history and the public map's update",
    { tag: ['@S-A38-HAPPY'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await sideBySide(page);
        await openPlace(page, content, lang);

        await title(page, lang).fill('Gara de Nord');
        await expect(page.locator('hcm-poi-list').getByText('Gara de Nord')).toBeVisible();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.unsaved'), { exact: true })).toBeVisible();
        expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara Veche' });

        await saveButton(page, lang).click();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        const saved = await content.document('pois/gara');
        expect(saved).toMatchObject({ title: { ro: 'Gara de Nord' }, updatedBy: content.uid });
        expect(new Date(String(saved?.['updatedAt'])).getTime()).toBeGreaterThan(AT.getTime());
        await expect
            .poll(async () => Object.values(await content.collection('pois/gara/history')).map((entry) => entry['previous']), {
                timeout: FUNCTIONS_TIMEOUT_MS,
            })
            .toContainEqual(expect.objectContaining({ title: { ro: 'Gara Veche' } }));

        // The public map follows: the build carries the new title, and the dashboard says it is up to date.
        await awaitManifest(content, 'carries the new title', (built) => {
            const place = entry(built, 'pois', 'gara');
            return (place?.['title'] as { ro?: string } | undefined)?.ro === 'Gara de Nord';
        });
        await page.goto(content.address(lang, 'home', { map: false }));
        await expect(
            page.getByText(templatePattern(translateAdminShell(lang, 'adminShell.home.map.idle', { date: '\u0000' }))),
        ).toBeVisible();
    },
);

test(
    'Leaving an editor with changes asks first: Keep editing keeps the draft and the address, Discard leaves; a reload asks the browser',
    { tag: ['@S-A38-BAD-UNSAVED-GUARD'] },
    async ({ page, lang, content }) => {
        await sideBySide(page);
        await openPlace(page, content, lang);
        // From the list to the place, as a person goes: the browser's Back then has a page of the admin to go to.
        await page.goto(content.address(lang, 'pois', { map: false }));
        await page.getByRole('link', { name: /Gara Veche/ }).click();
        await title(page, lang).fill('Gara de Nord');
        const address = page.url();
        const keep = (): Promise<void> =>
            guard(page)
                .getByRole('button', { name: contentText(lang, 'adminContent.common.keepEditing') })
                .click();

        // The browser's Back.
        await page.goBack();
        await expect(page.getByRole('dialog', { name: contentText(lang, 'adminContent.common.unsavedTitle') })).toBeVisible();
        await keep();
        await expect(title(page, lang)).toHaveValue('Gara de Nord');
        expect(page.url()).toBe(address);

        // Another page.
        await page
            .getByRole('navigation')
            .getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.photos') })
            .click();
        await expect(page.getByRole('dialog', { name: contentText(lang, 'adminContent.common.unsavedTitle') })).toBeVisible();
        await keep();
        await expect(title(page, lang)).toHaveValue('Gara de Nord');
        expect(page.url()).toBe(address);

        // Signing out.
        await page
            .getByRole('button', { name: translateAdminShell(lang, 'adminShell.account.label') })
            .filter({ visible: true })
            .click();
        await page.getByRole('button', { name: translateAdminShell(lang, 'adminShell.auth.signOut') }).click();
        await expect(page.getByRole('dialog', { name: contentText(lang, 'adminContent.common.unsavedTitle') })).toBeVisible();
        await keep();
        await expect(title(page, lang)).toHaveValue('Gara de Nord');

        // A reload: the browser's own question, which the test dismisses (it stays).
        const asked = new Promise<string>((resolve) => {
            page.once('dialog', (dialog) => {
                resolve(dialog.type());
                void dialog.dismiss();
            });
        });
        await page.evaluate(() => {
            location.reload();
        });
        expect(await asked).toBe('beforeunload');
        await expect(title(page, lang)).toHaveValue('Gara de Nord');

        // Discard: the page leaves and nothing was written.
        await page
            .getByRole('navigation')
            .getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.photos') })
            .click();
        await guard(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.common.discard'), exact: true })
            .click();
        await expect(page).toHaveURL(/#\/photos$/);
        expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara Veche' });
    },
);

test(
    'A new place nobody touched leaves without asking; one with a typed title asks first',
    { tag: ['@S-A38-HAPPY-NEW-UNTOUCHED', '@S-A38-BAD-NEW-TYPED-ASKS'] },
    async ({ page, lang, content }) => {
        await sideBySide(page);
        await seedPublicCity(content, AT);
        await seedCategories(content, AT);
        const photos = page.getByRole('navigation').getByRole('link', { name: translateAdminShell(lang, 'adminShell.nav.photos') });
        const addPoint = async (): Promise<void> => {
            await page.goto(content.address(lang, 'pois', { map: false }));
            await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
            await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.point'), exact: true }).click();
            // The category select starts filled in: a default, not an edit (finding 42 of 2026-11-01).
            await expect(page.locator('hcm-poi-editor #category')).not.toHaveValue('');
        };

        // Nothing typed, nothing drawn: another page opens at once.
        await addPoint();
        await photos.click();
        await expect(page).toHaveURL(/#\/photos$/);
        await expect(guard(page)).toHaveCount(0);

        // A typed title is a change: leaving asks first, and nothing was written.
        await addPoint();
        await title(page, lang).fill('Hala Matache');
        await photos.click();
        await expect(page.getByRole('dialog', { name: contentText(lang, 'adminContent.common.unsavedTitle') })).toBeVisible();
        expect(await content.collection('pois')).toEqual({});
    },
);

test(
    'Invalid fields are named at the field, Save says why and writes nothing',
    { tag: ['@S-A38-BAD-INVALID'] },
    async ({ page, lang, content }) => {
        await openPlace(page, content, lang);

        // A blank Romanian title, years in the wrong order, an http link.
        await title(page, lang).fill('');
        const start = page.locator('hcm-poi-editor #yearStart');
        await start.fill('1920');
        const end = page.locator('hcm-poi-editor #yearEnd');
        await end.fill('1900');
        await end.press('Tab');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.field.addLink') }).click();
        const url = page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.linkUrl', { number: '1' }) });
        await url.fill('http://arhiva.example/gara');
        await url.press('Tab');

        for (const field of [title(page, lang), end, url]) {
            await expect(field).toHaveAttribute('aria-invalid', 'true');
        }
        // Save is off, and says why: the first problem, the description of the button.
        await expect(saveButton(page, lang)).toBeDisabled();
        await expect(page.locator('hcm-poi-editor hcm-button.save')).toHaveAttribute('aria-describedby', 'save-issue');
        const why = poisText(lang, 'adminContent.common.cannotSave', { issues: '\u0000' }).split('\u0000')[0] ?? '';
        await expect(page.locator('hcm-poi-editor #save-issue')).toContainText(why);
        expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara Veche' });
    },
);

test(
    "An empty Romanian title says to add one, at the field and in Save's note, and typing one lets Save write",
    { tag: ['@S-A38-BAD-REQUIRED-FIELD-NAMED', '@S-A38-HAPPY-REQUIRED-FIELD-FIXED'] },
    async ({ page, lang, content }) => {
        await openPlace(page, content, lang);
        const words = poisText(lang, 'adminContent.common.issue.titleRo');
        const note = page.locator('hcm-poi-editor #save-issue');

        // Finding 37 of 2026-11-01: the field and the note say what to do, never the schema's generic words.
        await title(page, lang).fill('');
        await expect(page.locator('hcm-poi-editor #title-ro-error')).toHaveText(words);
        const inSentence = words.charAt(0).toLocaleLowerCase(lang) + words.slice(1);
        await expect(note).toHaveText(poisText(lang, 'adminContent.common.cannotSave', { issues: inSentence }));
        await expect(page.getByText(translate(lang, 'validation.tooSmall'))).toHaveCount(0);
        await expect(saveButton(page, lang)).toBeDisabled();

        await title(page, lang).fill('Gara de Nord');
        await expect(page.locator('hcm-poi-editor #title-ro-error')).toHaveCount(0);
        await expect(note).toHaveCount(0);
        await saveButton(page, lang).click();
        await expect.poll(async () => (await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara de Nord' });
    },
);

test(
    'Saving offline says the server was not reached and keeps the draft; Save once online writes it once',
    { tag: ['@S-A38-BAD-OFFLINE'] },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await openPlace(page, content, lang);
        await title(page, lang).fill('Gara de Nord');
        // Save is on once the city's categories have answered too: offline before that, the place's category is unknown
        // and Save stays off for good (a loaded machine, lesson 146).
        await expect(saveButton(page, lang)).toBeEnabled();

        await page.context().setOffline(true);
        await saveButton(page, lang).click();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.offline')).first()).toBeVisible({ timeout: 30_000 });
        await expect(title(page, lang)).toHaveValue('Gara de Nord');
        await page.context().setOffline(false);
        expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara Veche' });

        await saveButton(page, lang).click();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        expect((await content.document('pois/gara'))?.['title']).toEqual({ ro: 'Gara de Nord' });
        await expect
            .poll(async () => Object.keys(await content.collection('pois/gara/history')).length, { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeGreaterThanOrEqual(2);
        expect(Object.keys(await content.collection('pois/gara/history'))).toHaveLength(2);
        // Offline, every request fails (the browser logs each), and Firestore's channel probes the network with an image of
        // www.google.com, which the admin's CSP refuses (it loads no third-party image).
        // Each engine says it in its own words: Chromium's net::ERR_INTERNET_DISCONNECTED, Firefox's "Cross-Origin Request
        // Blocked" for a request that got no answer, WebKit's "internal error" and failed fetches.
        const offline =
            /cleardot\.gif|ERR_INTERNET_DISCONNECTED|Cross-Origin Request Blocked|WebKit encountered an internal error|Fetch API cannot load/;
        expect(consoleErrors.takeMatching(offline).length).toBeGreaterThan(0);
    },
);

test(
    'A place deleted elsewhere while it is open cannot be saved back, and History is offered to restore it',
    { tag: ['@S-A38-BAD-DELETED-WHILE-EDITING'] },
    async ({ page, lang, content }) => {
        await openPlace(page, content, lang);
        await title(page, lang).fill('Gara de Nord');

        await content.emulators.deleteDocument(content.path('pois/gara'));

        await expect(page.getByRole('alert').filter({ hasText: poisText(lang, 'adminContent.pois.gone') })).toBeVisible();
        await expect(saveButton(page, lang)).toBeDisabled();
        expect(await content.document('pois/gara')).toBeUndefined();
        // History, in the editor's overflow menu (a button of the editor's one style, DECISIONS-for-review.md §42e).
        const editor = page.locator('hcm-poi-editor');
        await chooseInMenu(page, editor, poisText(lang, 'adminContent.pois.actions'), poisText(lang, 'adminContent.pois.history'));
        await expect(page).toHaveURL(/#\/history\/poi\/gara$/);
    },
);
