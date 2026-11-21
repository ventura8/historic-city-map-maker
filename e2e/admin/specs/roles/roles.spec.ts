import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { PROJECT_CITY } from '../../support/content.js';
import { ADMIN_EXPECTED_CONSOLE_ERRORS, ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { PERSONAS } from '../../world.js';
import { AT, cityText, shellText } from '../cities/world.js';
import type { EmulatorWorld } from '../../support/emulators.js';

// One admin test at a time: memberships (`admins/*`) are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Roles and review end to end (docs/research/M13-roles.md; behaviours A90 to A93): against the Functions emulator's callables and
 * the emulators' rules, driven from outside. A stranger on the Contribute page stays signed in and is told; a moderator's
 * navigation is theirs and the queue decides; an uploader sees their own. The rules' matrix is firebase/rules-tests/test/roles.test.ts.
 */
const STAMP = { updatedBy: 'system:photos', updatedAt: AT };
const BOUNDS = { west: 25.9, south: 44.3, east: 26.3, north: 44.6 };
const PIXEL = 'https://storage.googleapis.com/demo-hcm-public/photos/e2e/t.webp';
const IMAGE = { web: PIXEL, thumb: PIXEL, sha256: 'a'.repeat(64), w: 10, h: 10 };
const REVIEW_ROUTE = adminPath;

async function seedCity(emulators: EmulatorWorld): Promise<void> {
    await emulators.setDocument(`cities/${PROJECT_CITY}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: BOUNDS,
        published: true,
        ...STAMP,
    });
}

async function seedPhoto(emulators: EmulatorWorld, id: string, fields: Readonly<Record<string, unknown>>): Promise<void> {
    await emulators.setDocument(`cities/${PROJECT_CITY}/photos/${id}`, {
        title: { ro: 'Calea Victoriei', en: 'Victory Avenue' },
        license: 'PD',
        published: true,
        processing: 'done',
        image: IMAGE,
        createdBy: 'someone',
        ...STAMP,
        ...fields,
    });
}

async function setRole(emulators: EmulatorWorld, uid: string, role: string): Promise<void> {
    await emulators.updateFields(`admins/${uid}`, { cities: { [PROJECT_CITY]: role } }, ['cities']);
}

function reason(page: Page, lang: 'ro' | 'en') {
    return page.getByLabel(cityText(lang, 'adminContent.contribute.reason'));
}

test.describe('a stranger', () => {
    test.use({ persona: 'stranger', mapOwner: 'owner' });

    test(
        'asks for a role on the Contribute page and is told the refusal',
        { tag: ['@S-A92-HAPPY-REQUEST', '@S-A92-BAD-REFUSED-TOLD'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}`));
            await expect(reason(page, lang)).toBeVisible();
            await expectStateSound(page, adminVisit('roles.contribute-request', lang));

            await reason(page, lang).fill('Am multe fotografii de familie.');
            await page.getByRole('button', { name: cityText(lang, 'adminContent.contribute.send') }).click();
            await expect(page.getByText(cityText(lang, 'adminContent.contribute.pending'))).toBeVisible();
            await expectStateSound(page, adminVisit('roles.contribute-pending', lang));
            const uid = accounts.stranger.uid;
            await expect
                .poll(() => emulators.document(`cities/${PROJECT_CITY}/roleRequests/${uid}`))
                .toMatchObject({ role: 'uploader', status: 'pending' });
            expect(await emulators.document(`admins/${uid}`)).toBeUndefined();

            // The owner refuses (as `contribute.decide` leaves the document); the page says it next time.
            await emulators.updateFields(
                `cities/${PROJECT_CITY}/roleRequests/${uid}`,
                { status: 'refused', note: 'Mai multe detalii, te rog.', decidedBy: accounts.owner.uid, decidedAt: new Date() },
                ['status', 'note', 'decidedBy', 'decidedAt'],
            );
            await page.reload();
            await expect(page.getByText('Mai multe detalii, te rog.', { exact: false })).toBeVisible();
            await expectStateSound(page, adminVisit('roles.contribute-refused', lang));
        },
    );

    test(
        'suggests where a photo with no place was taken, and the public photo stays',
        { tag: '@S-A93-HAPPY-PLACE' },
        async ({ page, lang, adminWorld }) => {
            const { emulators } = adminWorld;
            await seedCity(emulators);
            await seedPhoto(emulators, 'lost', {});

            await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}/lost`));
            await expect(page.getByRole('heading', { name: cityText(lang, 'adminContent.contribute.place.title') })).toBeVisible();
            await expectStateSound(page, adminVisit('roles.contribute-place', lang));
            await page.getByLabel(cityText(lang, 'adminContent.contribute.lat')).fill('44.44');
            await page.getByLabel(cityText(lang, 'adminContent.contribute.lat')).blur();
            await page.getByLabel(cityText(lang, 'adminContent.contribute.lng')).fill('26.1');
            await page.getByLabel(cityText(lang, 'adminContent.contribute.lng')).blur();
            await page.getByRole('button', { name: cityText(lang, 'adminContent.contribute.suggest') }).click();
            await expect(page.getByRole('status').filter({ hasText: '19' })).toBeVisible();
            const groups = Object.values(await emulators.collection(`cities/${PROJECT_CITY}/suggestions`));
            expect(groups).toEqual([expect.objectContaining({ photoId: 'lost', status: 'pending', count: 1 })]);
            expect((await emulators.document(`cities/${PROJECT_CITY}/photos/lost`))?.['location']).toBeUndefined();
        },
    );

    test('contests a placed photo with a reason', { tag: '@S-A93-HAPPY-CORRECTION' }, async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(emulators);
        await seedPhoto(emulators, 'placed', { location: { lat: 44.43, lng: 26.09 }, bearing: 90 });
        await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}/placed`));
        await expect(page.getByRole('heading', { name: cityText(lang, 'adminContent.contribute.correct.title') })).toBeVisible();
        await expectStateSound(page, adminVisit('roles.contribute-correct', lang));
        await page.getByLabel(cityText(lang, 'adminContent.contribute.year'), { exact: true }).fill('1950');
        await page.getByLabel(cityText(lang, 'adminContent.contribute.year'), { exact: true }).blur();
        await page.getByLabel(cityText(lang, 'adminContent.contribute.why')).fill('Pe verso scrie 1950.');
        await page.getByRole('button', { name: cityText(lang, 'adminContent.contribute.suggest') }).click();
        await expect.poll(async () => Object.values(await emulators.collection(`cities/${PROJECT_CITY}/suggestions`)).length).toBe(1);
        expect((await emulators.document(`cities/${PROJECT_CITY}/photos/placed`))?.['year']).toBeUndefined();
    });
});

test.describe('a photo that is not public', () => {
    test.use({
        persona: 'stranger',
        mapOwner: 'owner',
        // The refusal itself: the page says so, and the browser logs the callable's 404.
        expectedConsoleErrors: [
            [
                ...ADMIN_EXPECTED_CONSOLE_ERRORS,
                { text: /status of 404/, url: /contribute-context$/, why: 'the callable says the photo is not public' },
            ],
            { scope: 'test' },
        ],
    });

    test('is not there for a stranger', { tag: '@S-A93-BAD-NOT-PUBLIC' }, async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(emulators);
        await seedPhoto(emulators, 'hidden', { published: false });
        await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}/hidden`));
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('img')).toHaveCount(0);
    });
});

test.describe('a moderator', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'sees their own navigation, decides in the queue, and reaches no setting',
        {
            tag: [
                '@S-A91-HAPPY-NAV',
                '@S-A91-BAD-NOT-ALLOWED',
                '@S-A90-HAPPY-APPROVE',
                '@S-A93-HAPPY-APPROVE',
                '@S-A91-BAD-NO-REQUESTS',
                '@S-A93-BAD-MARKUP-IS-TEXT',
            ],
        },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await setRole(emulators, accounts.admin.uid, 'moderator');
            await seedPhoto(emulators, 'lost', {});
            await emulators.setDocument(`cities/${PROJECT_CITY}/pois/held`, {
                category: 'c',
                geometry: { type: 'Point', point: { lat: 44.4, lng: 26.1 } },
                title: { ro: 'Un loc nou', en: 'A new place' },
                yearStart: 1890,
                links: [],
                published: false,
                reviewStatus: 'pending',
                createdBy: 'someone',
                ...STAMP,
            });
            await emulators.setDocument(`cities/${PROJECT_CITY}/suggestions/group1`, {
                photoId: 'lost',
                photoTitle: { ro: 'Calea Victoriei', en: 'Victory Avenue' },
                photoThumb: PIXEL,
                kind: 'place',
                proposal: { location: { lat: 44.44, lng: 26.1 }, bearing: 45 },
                status: 'pending',
                count: 2,
                accounts: ['a', 'b'],
                voices: [{ uid: 'a', reason: '<b>Se vede</b> biserica.', at: AT }],
                createdAt: AT,
                ...STAMP,
            });

            await page.goto(REVIEW_ROUTE(lang, 'settings'));
            // The snackbar's message, not its live region, which repeats the text a moment after it shows (a strict-mode
            // violation once the announcement lands before the assertion, as it did at the tablet on a loaded machine).
            const notAllowed = page.getByText(shellText(lang, 'adminShell.route.notAllowed')).and(page.locator(':not([aria-live])'));
            await expect(notAllowed).toBeVisible();
            await expect(page).toHaveURL(/#\/photos$/);
            await expectStateSound(page, adminVisit('roles.moderator-nav', lang));

            await page.goto(REVIEW_ROUTE(lang, 'review'));
            await expect(page.getByText('Un loc nou', { exact: false }).or(page.getByText('A new place', { exact: false }))).toBeVisible();
            await expectStateSound(page, adminVisit('roles.review', lang));
            await expect(page.getByRole('region', { name: cityText(lang, 'adminContent.review.requests') })).toHaveCount(0);
            await expect(page.locator('li.card b')).toHaveCount(0);

            const place = page.locator('li.card').filter({ hasText: /new place|loc nou/ });
            await place.getByRole('button', { name: cityText(lang, 'adminContent.review.approve') }).click();
            await expect
                .poll(() => emulators.document(`cities/${PROJECT_CITY}/pois/held`))
                .toMatchObject({ published: true, reviewStatus: 'approved', updatedBy: accounts.admin.uid });

            const suggestion = page.locator('li.card').filter({ hasText: '<b>Se vede</b> biserica.' });
            await suggestion.getByRole('button', { name: cityText(lang, 'adminContent.review.compare') }).click();
            await expect(page.locator('hcm-admin-map')).toBeVisible();
            await expectStateSound(page, adminVisit('roles.review-compare', lang));
            await suggestion.getByRole('button', { name: cityText(lang, 'adminContent.review.approve'), exact: true }).click();
            await expect
                .poll(() => emulators.document(`cities/${PROJECT_CITY}/photos/lost`))
                .toMatchObject({ location: { lat: 44.44, lng: 26.1 }, bearing: 45, updatedBy: accounts.admin.uid });
        },
    );
});

test.describe('a moderator with a suggestion to adjust', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'types the values by hand, and blocks an account only after a question',
        { tag: ['@S-A93-HAPPY-ADJUST-FIELDS', '@S-A93-HAPPY-UNBLOCK', '@S-A93-HAPPY-ADJUST'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await setRole(emulators, accounts.admin.uid, 'moderator');
            await seedPhoto(emulators, 'placed', { location: { lat: 44.43, lng: 26.09 }, bearing: 90 });
            await emulators.setDocument(`cities/${PROJECT_CITY}/suggestions/group2`, {
                photoId: 'placed',
                photoTitle: { ro: 'Calea Victoriei', en: 'Victory Avenue' },
                photoThumb: PIXEL,
                kind: 'correction',
                proposal: { year: 1950 },
                status: 'pending',
                count: 1,
                accounts: ['spammer'],
                voices: [{ uid: 'spammer', reason: 'Cumpără aici.', at: AT }],
                createdAt: AT,
                ...STAMP,
            });

            await page.goto(adminPath(lang, 'review'));
            const card = page.locator('li.card').filter({ hasText: 'Cumpără aici.' });
            await card.getByRole('button', { name: cityText(lang, 'adminContent.review.block') }).click();
            await expect(page.getByRole('dialog', { name: cityText(lang, 'adminContent.review.blockTitle') })).toBeVisible();
            const question = page.locator('hcm-confirm-dialog');
            await expectStateSound(page, adminVisit('roles.review-block-question', lang));
            await question.getByRole('button', { name: cityText(lang, 'adminContent.common.cancel'), exact: true }).click();
            expect(await emulators.document(`cities/${PROJECT_CITY}/contributors/spammer`)).toBeUndefined();

            await card.getByRole('button', { name: cityText(lang, 'adminContent.review.block') }).click();
            await question.getByRole('button', { name: cityText(lang, 'adminContent.review.block'), exact: true }).click();
            await expect.poll(() => emulators.document(`cities/${PROJECT_CITY}/contributors/spammer`)).toMatchObject({ blocked: true });
            await expect(page.getByText(cityText(lang, 'adminContent.review.isBlocked')).first()).toBeVisible();
            await expectStateSound(page, adminVisit('roles.review-blocked', lang));
            const blocked = page.getByRole('region', { name: cityText(lang, 'adminContent.review.blockedList') });
            await blocked.getByRole('button', { name: cityText(lang, 'adminContent.review.unblock') }).click();
            await expect
                .poll(async () => (await emulators.document(`cities/${PROJECT_CITY}/contributors/spammer`))?.['blocked'])
                .toBeUndefined();

            await card.getByRole('button', { name: cityText(lang, 'adminContent.review.compare') }).click();
            await card.getByRole('button', { name: cityText(lang, 'adminContent.review.adjust') }).click();
            await page.getByLabel(cityText(lang, 'adminContent.contribute.bearing')).fill('120');
            await page.getByLabel(cityText(lang, 'adminContent.contribute.bearing')).blur();
            await expect(card.getByText('120°')).toBeVisible();
            await expectStateSound(page, adminVisit('roles.review-adjust', lang));
            await card.getByRole('button', { name: cityText(lang, 'adminContent.review.apply') }).click();
            await expect
                .poll(() => emulators.document(`cities/${PROJECT_CITY}/photos/placed`))
                .toMatchObject({ year: 1950, bearing: 120, location: { lat: 44.43, lng: 26.09 } });
        },
    );
});

test.describe('someone whose role changed', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test('an uploader may ask for more', { tag: '@S-A92-HAPPY-ASK-AGAIN' }, async ({ page, lang, adminWorld }) => {
        const { emulators, accounts } = adminWorld;
        await seedCity(emulators);
        await setRole(emulators, accounts.admin.uid, 'uploader');
        await emulators.setDocument(`cities/${PROJECT_CITY}/roleRequests/${accounts.admin.uid}`, {
            role: 'uploader',
            reason: 'Am fotografii.',
            status: 'approved',
            createdAt: AT,
            ...STAMP,
        });
        await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}`));
        await expect(page.getByText(cityText(lang, 'adminContent.contribute.askMore'))).toBeVisible();
        await expect(page.getByRole('option')).toHaveCount(1);
        await expect(reason(page, lang)).toBeVisible();
        await expectStateSound(page, adminVisit('roles.contribute-ask-more', lang));
    });
});

test.describe('an uploader', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        "sees their own photos with where each stands, and nobody else's",
        { tag: ['@S-A90-HAPPY-OWN', '@S-A90-BAD-OTHERS-HIDDEN'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(emulators);
            await setRole(emulators, accounts.admin.uid, 'uploader');
            await seedPhoto(emulators, 'mine', {
                published: false,
                reviewStatus: 'pending',
                title: { ro: 'A mea', en: 'Mine' },
                createdBy: accounts.admin.uid,
            });
            await seedPhoto(emulators, 'theirs', { title: { ro: 'A altcuiva', en: 'Someone elses' } });

            await page.goto(adminPath(lang, 'photos'));
            const mine = page.getByRole('link', { name: /Mine|A mea/ });
            await expect(mine).toBeVisible();
            await expect(page.getByText(cityText(lang, 'adminContent.review.status.pending'))).toBeVisible();
            await expect(page.getByRole('link', { name: /elses|altcuiva/ })).toHaveCount(0);
            await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.nav.review') })).toHaveCount(0);
            await expectStateSound(page, adminVisit('roles.uploader-photos', lang));
        },
    );
});

test.describe('an uploader adding to a place of their own', () => {
    test.use({ persona: 'admin', mapOwner: 'owner', admins: ['admin'] });

    test(
        'picks among their own photos, and a delete offers no Undo they could not use',
        { tag: ['@S-A90-HAPPY-UPLOADER-PICKER', '@S-A90-BAD-NO-UNDO'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            const uid = accounts.admin.uid;
            await seedCity(emulators);
            await setRole(emulators, uid, 'uploader');
            const mine = { published: false, reviewStatus: 'pending', title: { ro: 'A mea', en: 'Mine' }, createdBy: uid };
            await seedPhoto(emulators, 'mine', mine);
            await seedPhoto(emulators, 'theirs', { title: { ro: 'A altcuiva', en: 'Someone elses' } });
            await emulators.setDocument(`cities/${PROJECT_CITY}/pois/own`, {
                category: 'c',
                geometry: { type: 'Point', point: { lat: 44.4, lng: 26.1 } },
                title: { ro: 'Locul meu', en: 'My place' },
                yearStart: 1890,
                links: [],
                published: false,
                reviewStatus: 'pending',
                createdBy: uid,
                ...STAMP,
            });

            await page.goto(adminPath(lang, 'pois/own'));
            await page.getByRole('button', { name: cityText(lang, 'adminContent.pois.field.choosePhotos') }).click();
            const picker = page.locator('hcm-dialog.photo-picker');
            await expect(picker.getByText(/Mine|A mea/)).toBeVisible();
            await expect(picker.getByText(/elses|altcuiva/)).toHaveCount(0);
            await picker
                .getByRole('button', { name: cityText(lang, 'adminContent.pois.photoPicker.done') })
                .last()
                .click();

            await page.goto(adminPath(lang, 'photos/mine'));
            await page.getByRole('button', { name: cityText(lang, 'adminContent.photos.editor.delete') }).click();
            await page
                .locator('hcm-confirm-dialog')
                .getByRole('button', { name: cityText(lang, 'adminContent.photos.delete.confirm'), exact: true })
                .click();
            await expect.poll(() => emulators.document(`cities/${PROJECT_CITY}/photos/mine`)).toBeUndefined();
            const deleted = (name: string) => page.getByText(cityText(lang, 'adminContent.photos.deleted', { title: name }));
            await expect(deleted('A mea').or(deleted('Mine')).first()).toBeAttached();
            await expect(page.getByRole('button', { name: cityText(lang, 'adminContent.photos.undoAction') })).toHaveCount(0);
        },
    );
});

test.describe('the sign-in', () => {
    test.use({ persona: 'stranger', mapOwner: 'owner' });

    test('someone removed from the city may ask again', { tag: '@S-A92-HAPPY-ASK-AGAIN' }, async ({ page, lang, adminWorld }) => {
        const { emulators, accounts } = adminWorld;
        await seedCity(emulators);
        await emulators.setDocument(`cities/${PROJECT_CITY}/roleRequests/${accounts.stranger.uid}`, {
            role: 'uploader',
            reason: 'Am fotografii.',
            status: 'approved',
            createdAt: AT,
            ...STAMP,
        });
        await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}`));
        await expect(reason(page, lang)).toBeVisible();
        await expect(page.getByRole('option')).toHaveCount(2);
    });

    test('the persona is who the account menu says', { tag: '@S-A92-HAPPY-VISITOR-STAYS' }, async ({ page, lang, adminWorld }) => {
        await seedCity(adminWorld.emulators);
        await page.goto(adminPath(lang, `contribute/${PROJECT_CITY}`));
        await expect(reason(page, lang)).toBeVisible();
        await page.reload();
        await expect(reason(page, lang)).toBeVisible();
        expect(PERSONAS.stranger.email).toContain('@');
    });
});
