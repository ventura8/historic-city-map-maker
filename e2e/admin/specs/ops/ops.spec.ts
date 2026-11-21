import type { Page, Route } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { recordLiveRegions } from '../../../support/live-regions.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { shellText } from '../../support/i18n.js';
import { projectCity, PROJECT_CITY } from '../../support/content.js';
import { contentText, seedCity, seedJob, seedPlace } from '../../support/ops.js';
import { seedPhoto } from '../../support/photos.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The operations screens that read the project's singletons (docs/research/M2c-interfaces.md §9; behaviours A02, A22,
 * A40): the owner of a map whose server answers opens the admins, the crash reports (the server's world of the fake
 * upstreams) and the dashboard (`setup/status`); the jobs and History, which read a city only, are
 * e2e/tour/admin-jobs.tour.ts. Each page follows the
 * canonical list and detail layout of its window (§1.2: both panes from 840 px of page, one pane with Back below, and on
 * a phone the open item as a full-screen editor without the navigation bar), and every screen and dialog on the way runs
 * the generic layout and accessibility checkers (the ops section of e2e/tour/states.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner', admins: ['admin'] });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The page area of the window, as the list and detail layout measures it (the rail takes the rest). */
function layoutOf(page: Page): { readonly split: boolean; readonly phone: boolean } {
    const width = page.viewportSize()?.width ?? 0;
    return { split: width >= 1200, phone: width < 600 };
}

/**
 * From an open item back to its list where one pane shows at a time: Back below 1200 px of window, Close on a phone
 * (its full-screen editor). Both panes show side by side from 1200 px, where nothing needs to go back.
 */
async function backToList(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const { split, phone } = layoutOf(page);
    if (split) {
        return;
    }
    const name = contentText(lang, phone ? 'adminContent.common.close' : 'adminContent.common.back');
    await page.getByRole('button', { name, exact: true }).click();
}

/**
 * The open dialog (the page behind it is inert). Its content is slotted into the kit's `hcm-dialog` (light DOM), not a
 * descendant of the native `<dialog>` in its shadow root, so the element is the scope.
 */
function dialog(page: Page) {
    return page.locator('hcm-dialog[open]');
}

test(
    'Admins: an invitation is made, its link copied and cancelled; nobody removes the owner',
    {
        tag: [
            '@S-A02-HAPPY-INVITE-AND-CANCEL',
            '@S-A02-BAD-REVOKE-CANCELLED',
            '@S-A02-BAD-OWNER-NOT-REVOCABLE',
            '@S-A02-BAD-INVALID-EMAIL',
        ],
    },
    async ({ page, lang, adminWorld, inputBudget }) => {
        const { emulators, accounts } = adminWorld;
        await page.context().addInitScript(recordLiveRegions);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto(adminPath(lang, 'admins'));
        await expect(page.getByRole('link', { name: /admin@e2e\.test/ })).toBeVisible();
        await expectStateSound(page, adminVisit('admins.list', lang));

        // The owner (oneself here) has no Remove access: the page says why.
        await page.getByRole('link', { name: new RegExp(shellText(lang, 'adminShell.admins.role.owner')) }).click();
        await expect(page.getByText(contentText(lang, 'adminContent.admins.ownerNote'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toHaveCount(0);

        // Another admin: Remove access asks first; Keep access keeps them.
        await backToList(page, lang);
        await page.getByRole('link', { name: /admin@e2e\.test/ }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'admin@e2e.test' })).toBeVisible();
        await expectStateSound(page, adminVisit('admins.detail', lang));
        await page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expectStateSound(page, adminVisit('admins.revoke-confirm', lang));
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.admins.keep') })
            .click();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toBeFocused();
        expect(await emulators.document(`admins/${accounts.admin.uid}`)).toBeDefined();

        // Invite: an address refused at the field (not counted: the bad path's own inputs), then the invitation in three
        // inputs (Invite, the address, Enter), its link already copied; then cancelled.
        await backToList(page, lang);
        const flow = inputBudget.flow('inviteAdmin', contentFlowBudget('inviteAdmin'));
        await flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.admins.invite') }).first());
        const address = dialog(page).getByLabel(shellText(lang, 'adminShell.admins.email'));
        await address.fill('not an address');
        await address.press('Enter');
        await expect(address).toHaveAttribute('aria-invalid', 'true');
        await expectStateSound(page, adminVisit('admins.invite', lang));
        await flow.fill(address, 'new.admin@e2e.test');
        await flow.press(address, 'Enter');
        const link = page.getByLabel(shellText(lang, 'adminShell.admins.link'));
        await expect(link).toHaveValue(/^https:\/\//);
        await expect(page.getByText(new RegExp(shellText(lang, 'adminShell.admins.invited', { date: '.+' })))).toBeVisible();
        await expect(page.getByText(shellText(lang, 'adminShell.admins.copied'))).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await link.inputValue());
        expect(flow.used).toBe(3);
        await expectStateSound(page, adminVisit('admins.invite-link', lang));
        expect(Object.keys(await emulators.collection('invites'))).toHaveLength(1);
        await page.getByRole('button', { name: contentText(lang, 'adminContent.admins.cancelInvite') }).click();
        await dialog(page)
            .getByRole('button', { name: contentText(lang, 'adminContent.admins.cancelInvite') })
            .click();
        await expect.poll(async () => Object.keys(await emulators.collection('invites')).length).toBe(0);
    },
);

test.describe('signed in as an admin who is not the owner', () => {
    test.use({ persona: 'admin' });

    test('Admins: an admin cannot remove their own access', { tag: ['@S-A02-BAD-LAST-ADMIN'] }, async ({ page, lang, adminWorld }) => {
        await page.goto(adminPath(lang, `admins/${adminWorld.accounts.admin.uid}`));
        await expect(page.getByRole('heading', { level: 2, name: 'admin@e2e.test' })).toBeVisible();
        await expect(page.getByText(contentText(lang, 'adminContent.admins.selfNote'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.admins.remove') })).toHaveCount(0);
    });

    // The merge of M17 with M18 item 7: an uploader reads only their own stories, and has no Home, so the count of every
    // waiting story is never shown to or asked for them (the store does not ask it for the role either: home.test.ts).
    test(
        "An uploader's address of Home opens Photos, with no What needs you and no stories, photos or places to review",
        { tag: ['@S-A40-BAD-UPLOADER-NO-STORY-COUNT', '@S-A40-BAD-UPLOADER-NO-PHOTO-PLACE-COUNT'] },
        async ({ page, lang, adminWorld }) => {
            const { emulators, accounts } = adminWorld;
            await seedCity(projectCity(emulators, accounts.owner.uid), AT);
            await emulators.setDocument(`cities/${PROJECT_CITY}/stories/teatrul`, {
                title: { ro: 'Teatrul Național' },
                published: false,
                reviewStatus: 'pending',
                updatedBy: accounts.owner.uid,
                updatedAt: AT,
            });
            const city = projectCity(emulators, accounts.owner.uid);
            await seedPhoto(city, { id: 'ateneul', title: 'Ateneul Român', extra: { reviewStatus: 'pending' } }, AT);
            await seedPlace(city, 'gara', 'Gara de Nord', AT);
            await emulators.updateFields(`cities/${PROJECT_CITY}/pois/gara`, { reviewStatus: 'pending' }, ['reviewStatus']);
            await emulators.updateFields(`admins/${accounts.admin.uid}`, { cities: { [PROJECT_CITY]: 'uploader' } }, ['cities']);
            const counted: string[] = [];
            page.on('request', (request) => {
                if (request.url().includes(':runAggregationQuery')) {
                    counted.push(request.postData() ?? '');
                }
            });
            await page.goto(adminPath(lang, 'home'));

            await expect(page.getByRole('heading', { level: 1, name: shellText(lang, 'adminShell.nav.photos') })).toBeVisible();
            await expect(page.getByRole('region', { name: shellText(lang, 'adminShell.home.needsYou') })).toHaveCount(0);
            for (const key of ['storiesToReview', 'photosToReview', 'placesToReview'] as const) {
                const label = shellText(lang, `adminShell.home.count.${key}`);
                await expect(page.getByRole('link', { name: new RegExp(label) })).toHaveCount(0);
            }
            // Never asked: no count of the review queue's waiting items leaves the page for an uploader.
            expect(counted.filter((body) => body.includes('reviewStatus'))).toEqual([]);
        },
    );
});

test(
    'Crash groups are browsed by period with their details, and a disabled Error Reporting is explained',
    { tag: ['@S-A22-HAPPY-CRASH-DETAIL', '@S-A22-BAD-CRASHES-API-DISABLED'] },
    async ({ page, lang, upstream, consoleErrors }) => {
        await page.context().addInitScript(recordLiveRegions);
        await page.goto(adminPath(lang, 'crashes'));
        await expect(page.getByText(contentText(lang, 'adminContent.crashes.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('crashes.empty', lang));

        await upstream.scenario('error-reporting.twoGroups', 'server');
        await page.getByRole('radio', { name: contentText(lang, 'adminContent.crashes.period.720') }).click();
        const group = page.getByRole('button', { name: /TypeError: Cannot read properties of undefined/ });
        await expect(group).toBeVisible();
        await expectStateSound(page, adminVisit('crashes.list', lang));
        await group.click();
        // The detail's facts are slotted into the layout's pane (light DOM), so they are found from the page.
        await expect(page.getByRole('term')).toHaveText(
            (['count', 'firstSeen', 'lastSeen', 'service', 'state'] as const).map((key) =>
                contentText(lang, `adminContent.crashes.${key}`),
            ),
        );
        await expect(page.getByRole('definition').first()).toHaveText('12');
        // The top of the stack, as text, and the release's notes beside the console link.
        await expect(page.getByRole('listitem').filter({ hasText: 'at applyManifest (engine.mjs:1:2345)' })).toBeVisible();
        await expect(
            page.getByRole('link', { name: contentText(lang, 'adminContent.crashes.release', { version: '1.0.0' }) }),
        ).toHaveAttribute('href', 'https://github.com/ventura8/historic-city-map-maker/releases/tag/v1.0.0');
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.crashes.openConsole') })).toHaveAttribute(
            'href',
            /^https:\/\/console\.cloud\.google\.com\/errors\/detail\/[^/?]+\?project=/,
        );
        await expectStateSound(page, adminVisit('crashes.detail', lang));

        await upstream.fail('error-reporting', 'apiDisabled', 'server');
        await backToList(page, lang);
        await page.getByRole('radio', { name: contentText(lang, 'adminContent.crashes.period.24') }).click();
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.crashes.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/analytics',
        );
        await expect(page.getByText(contentText(lang, 'adminContent.crashes.apiDisabled'))).toBeVisible();
        await expect(page.getByRole('button', { name: contentText(lang, 'adminContent.common.retry') })).toBeVisible();
        // The callable's refusal (failed-precondition) is an HTTP 400, which Chromium logs.
        await expect.poll(() => consoleErrors.takeMatching(/status of 400/).length).toBe(1);
        await expectStateSound(page, adminVisit('crashes.error', lang));
    },
);

test(
    'Statistics lists every wizard with its steps, says when analytics is off, and links Google Analytics',
    { tag: ['@S-A151-HAPPY-STATISTICS', '@S-A151-BAD-NO-ANALYTICS'] },
    async ({ page, lang }) => {
        await page.goto(adminPath(lang, 'crashes'));
        await page.getByRole('link', { name: contentText(lang, 'adminContent.statistics.link') }).click();
        await expect(page.getByRole('heading', { name: contentText(lang, 'adminContent.statistics.title'), exact: true })).toBeVisible();
        // The help is folded under its own summary: the wizards and their step codes show once it opens.
        await page.getByText(contentText(lang, 'adminContent.statistics.helpTitle'), { exact: true }).click();
        await expect(page.getByRole('heading', { name: contentText(lang, 'adminContent.statistics.wizard.new_city') })).toBeVisible();
        // The e2e admin has no measurement id: the view says statistics are off and leads to Setup's step g.
        await expect(page.getByText(contentText(lang, 'adminContent.statistics.off'))).toBeVisible();
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.statistics.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/analytics',
        );
        await expect(page.getByRole('link', { name: contentText(lang, 'adminContent.statistics.open') })).toHaveAttribute(
            'href',
            'https://analytics.google.com/analytics/web/',
        );
        await expectStateSound(page, adminVisit('crashes.statistics', lang));
    },
);

test(
    "The dashboard counts the city, says what waits, and shows each service's state",
    { tag: ['@S-A40-HAPPY', '@S-A40-BAD-SERVICE-NEEDS-ATTENTION'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        const city = projectCity(emulators, adminWorld.accounts.owner.uid);
        await page.context().addInitScript(recordLiveRegions);
        await seedCity(city, AT);
        await emulators.setDocument('setup/status', {
            billing: { state: 'ok' },
            provision: { state: 'ok' },
            mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' },
            updatedBy: 'system:setup',
            updatedAt: AT,
        });
        await emulators.setDocument(`manifests/${PROJECT_CITY}`, {
            requestedVersion: 2,
            builtVersion: 2,
            status: 'idle',
            builtAt: AT,
            updatedBy: 'system:publish',
            updatedAt: AT,
        });
        await seedJob(city, 'scan-1', { type: 'usgs-import', status: 'running', createdBy: city.uid }, AT);
        await seedPlace(city, 'gara', 'Gara de Nord', AT);
        await page.goto(adminPath(lang, 'home'));

        const jobs = page.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.activeJobs')}`) });
        await expect(jobs).toBeVisible();
        await expect(page.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.pois')}`) })).toBeVisible();
        await expect(page.getByText(new RegExp(`Mapbox: ${shellText(lang, 'adminShell.home.state.invalid')}`))).toBeVisible();
        await expect(page.getByRole('link', { name: shellText(lang, 'adminShell.home.openSetup'), exact: true })).toHaveAttribute(
            'href',
            '#/setup',
        );
        await expectStateSound(page, adminVisit('home.dashboard', lang));
        await jobs.click();
        await expect(page).toHaveURL(/#\/jobs$/);
    },
);

// M18 item 7 (docs/research/M18-improvements.md): What needs you, each item a link to where it is done.
test(
    'Home says what needs you, each a link to where it is done, and says when nothing does',
    { tag: ['@S-A40-HAPPY-NEEDS-YOU', '@S-A40-BAD-NOTHING-NEEDS-YOU', '@S-A40-HAPPY-STORIES-TO-REVIEW'] },
    async ({ page, lang, adminWorld }) => {
        const city = projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await seedCity(city, AT);
        await page.goto(adminPath(lang, 'home'));
        const needs = page.getByRole('region', { name: shellText(lang, 'adminShell.home.needsYou') });
        await expect(needs).toContainText(shellText(lang, 'adminShell.home.needsNothing'));

        await seedJob(city, 'scan-stuck', { type: 'usgs-import', status: 'failed', createdBy: city.uid }, AT);
        await page.getByRole('button', { name: shellText(lang, 'adminShell.home.refresh') }).click();
        const stuck = needs.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.failedJobs')}`) });
        await expect(stuck).toBeVisible();
        // The merge of M17 with M18: an uploader's story waiting in the review queue is listed too, a link to the queue.
        await adminWorld.emulators.setDocument(`cities/${PROJECT_CITY}/stories/teatrul`, {
            title: { ro: 'Teatrul Național' },
            published: false,
            reviewStatus: 'pending',
            updatedBy: city.uid,
            updatedAt: AT,
        });
        await page.getByRole('button', { name: shellText(lang, 'adminShell.home.refresh') }).click();
        const story = needs.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.storiesToReview')}`) });
        await expect(story).toHaveAttribute('href', '#/review');
        await expectStateSound(page, adminVisit('home.dashboard', lang));
        await stuck.click();
        await expect(page).toHaveURL(/#\/jobs$/);
    },
);

// The owner, 2026-11-21: a failed join a later join of the same layer that worked replaced is no work left for the owner.
test(
    'What needs you leaves out a failed job a later run that worked replaced, and counts one nothing replaced',
    { tag: ['@S-A195-HAPPY-REPLACED-JOB', '@S-A195-BAD-NOT-REPLACED'] },
    async ({ page, lang, adminWorld }) => {
        const city = projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await seedCity(city, AT);
        const join = (layerId: string): Record<string, unknown> => ({
            type: 'layer-join',
            params: { parts: [{ layerId }] },
            createdBy: city.uid,
        });
        const failure = { status: 'failed', error: { code: 'apiError.imagery.joinNoFrames', message: 'no frames' } };
        await seedJob(city, 'join-old', { ...join('aerial-1974'), ...failure }, AT);
        await seedJob(city, 'join-new', { ...join('aerial-1974'), status: 'succeeded' }, new Date('2026-10-17T10:00:00.000Z'));
        await seedJob(city, 'join-other', { ...join('aerial-1975'), ...failure }, AT);
        await page.goto(adminPath(lang, 'home'));

        const needs = page.getByRole('region', { name: shellText(lang, 'adminShell.home.needsYou') });
        await expect(
            needs.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.failedJobs')}`) }),
        ).toBeVisible();
    },
);

// DECISIONS-for-review.md §104c: an uploader's photos and places wait in the same review queue as their stories.
test(
    'What needs you counts the photos and places waiting in the review queue, each a link to it',
    { tag: ['@S-A40-HAPPY-PHOTOS-PLACES-TO-REVIEW'] },
    async ({ page, lang, adminWorld }) => {
        const city = projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await seedCity(city, AT);
        await seedPhoto(city, { id: 'ateneul', title: 'Ateneul Român', extra: { reviewStatus: 'pending' } }, AT);
        await seedPlace(city, 'gara', 'Gara de Nord', AT);
        await adminWorld.emulators.updateFields(`cities/${PROJECT_CITY}/pois/gara`, { reviewStatus: 'pending' }, ['reviewStatus']);
        await seedPlace(city, 'teatrul', 'Teatrul Național', AT);
        await page.goto(adminPath(lang, 'home'));

        const needs = page.getByRole('region', { name: shellText(lang, 'adminShell.home.needsYou') });
        const photos = needs.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.photosToReview')}`) });
        const places = needs.getByRole('link', { name: new RegExp(`1\\s+${shellText(lang, 'adminShell.home.count.placesToReview')}`) });
        await expect(photos).toHaveAttribute('href', '#/review');
        await expect(places).toHaveAttribute('href', '#/review');
        await expectStateSound(page, adminVisit('home.dashboard', lang));
        await places.click();
        await expect(page).toHaveURL(/#\/review$/);
        await expect(page.getByText('Gara de Nord')).toBeVisible();
    },
);

/** What the network does with Home's counts (the emulator's `runAggregationQuery`): hold them, drop the failed jobs' one, drop all. */
type CountNetwork = 'hold' | 'dropFailedJobs' | 'dropAll';

/** The counts' network, switched by the test; `release` answers or drops the held ones as the current mode says. */
async function countNetwork(page: Page): Promise<{ set(mode: CountNetwork): Promise<void>; readonly held: Route[] }> {
    let mode: CountNetwork = 'hold';
    const held: Route[] = [];
    const isFailedJobs = (route: Route): boolean => (route.request().postData() ?? '').includes('"failed"');
    const handle = (route: Route): Promise<void> =>
        mode === 'dropAll' || isFailedJobs(route) ? route.abort('internetdisconnected') : route.fallback();
    await page.route(/:runAggregationQuery/, async (route) => {
        if (mode === 'hold') {
            held.push(route);
            return;
        }
        await handle(route);
    });
    return {
        held,
        set: async (next) => {
            mode = next;
            await Promise.all(held.splice(0).map(handle));
        },
    };
}

// Review of M18 item 7: What needs you never reads "nothing" while a count is unknown. A count is a request to the
// emulator; the network is the boundary the test holds and fails (a flaky connection), never the admin's own code.
test(
    'What needs you shows an ellipsis while counting and a dash for a count that failed, never Nothing needs you',
    { tag: ['@S-A40-BAD-COUNT-UNREAD-SHOWN'] },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        await seedCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
        const network = await countNetwork(page);
        await page.goto(adminPath(lang, 'home'));
        const needs = page.getByRole('region', { name: shellText(lang, 'adminShell.home.needsYou') });
        const failedJobs = needs.getByRole('link', { name: new RegExp(shellText(lang, 'adminShell.home.count.failedJobs')) });

        await expect(failedJobs).toContainText(shellText(lang, 'adminShell.home.counting'));
        await expect(needs.getByRole('link')).toHaveCount(7);
        await expect(needs).not.toContainText(shellText(lang, 'adminShell.home.needsNothing'));
        await expect.poll(() => network.held.length).toBeGreaterThan(0);

        // The connection drops: the failed jobs' count is refused, every other one is answered (all zero).
        await network.set('dropFailedJobs');
        await expect(failedJobs).toContainText(shellText(lang, 'adminShell.home.unknown'));
        await expect(needs.getByRole('link')).toHaveCount(1);
        await expect(needs).not.toContainText(shellText(lang, 'adminShell.home.needsNothing'));

        // Every count refused: each item of What needs you with its dash, still never "nothing".
        await network.set('dropAll');
        await page.getByRole('button', { name: shellText(lang, 'adminShell.home.refresh') }).click();
        await expect(needs.getByRole('link')).toHaveCount(7);
        for (const link of await needs.getByRole('link').all()) {
            await expect(link).toContainText(shellText(lang, 'adminShell.home.unknown'));
        }
        await expect(needs).not.toContainText(shellText(lang, 'adminShell.home.needsNothing'));
        await expectStateSound(page, adminVisit('home.dashboard', lang));
        await expect.poll(() => consoleErrors.takeMatching(/ERR_INTERNET_DISCONNECTED|runAggregationQuery/).length).toBeGreaterThan(0);
    },
);

/** The navigation (a bar on a phone, a rail on a wider window). */
function navigation(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('navigation', { name: shellText(lang, 'adminShell.nav.label') });
}

/** `setup/status` with billing, provisioning and Mapbox done, and USGS as given. */
async function seedStatus(emulators: Parameters<typeof projectCity>[0], usgs: 'ok' | 'pending'): Promise<void> {
    await emulators.setDocument('setup/status', {
        billing: { state: 'ok' },
        provision: { state: 'ok' },
        mapbox: { state: 'ok' },
        usgs: { state: usgs },
        updatedBy: 'system:setup',
        updatedAt: AT,
    });
}

test(
    "Once Setup is complete an empty address opens the dashboard, which takes Setup's place on a phone's bar",
    { tag: ['@S-A40-HAPPY-FIRST-SCREEN'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(projectCity(emulators, adminWorld.accounts.owner.uid), AT);
        await seedStatus(emulators, 'ok');

        await page.goto(adminPath(lang));

        const home = navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true });
        await expect(home).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('hcm-home-page')).toBeVisible();
        // A phone's bar: Home, Photos, Places, Layers, with Setup under More; a rail lists them all.
        await expect(home).toBeVisible();
        await expect(navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true })).toBeVisible({
            visible: !layoutOf(page).phone,
        });
        // This browser remembers it: the next empty address opens the dashboard at once.
        await page.reload();
        await expect(home).toHaveAttribute('aria-current', 'page');
    },
);

test(
    'While Setup is not complete an empty address still opens Setup, which keeps its place on the bar',
    { tag: ['@S-A40-BAD-SETUP-INCOMPLETE'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await seedCity(projectCity(emulators, adminWorld.accounts.owner.uid), AT);
        await seedStatus(emulators, 'pending');

        await page.goto(adminPath(lang));

        const setup = navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true });
        await expect(setup).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('hcm-setup-page')).toBeVisible();
        // A phone's bar keeps Setup, with Home under More; a rail lists them all.
        await expect(setup).toBeVisible();
        await expect(navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.home'), exact: true })).toBeVisible({
            visible: !layoutOf(page).phone,
        });
    },
);

/** A second city of the project, owned by the map's owner too (a reset removes it: not a content world's). */
const SECOND_CITY = 'bacau';

/** The map's owner as an owner of the project's city and of `SECOND_CITY`. */
async function ownTwoCities(emulators: Parameters<typeof projectCity>[0], uid: string): Promise<void> {
    await seedCity(projectCity(emulators, uid), AT);
    await seedCity({ emulators, city: SECOND_CITY, uid }, AT);
    await emulators.updateFields(`admins/${uid}`, { cities: { [PROJECT_CITY]: 'owner', [SECOND_CITY]: 'owner' } }, ['cities']);
}

test(
    "An admin of two cities: once Setup is complete an empty address opens their city's dashboard, its address naming the city",
    { tag: ['@S-A49-HAPPY-FIRST-SCREEN'] },
    async ({ page, lang, adminWorld }) => {
        // docs/LESSONS.md 257: the empty address became #/setup before Setup's readiness was known, and stayed on Setup.
        const { emulators } = adminWorld;
        await ownTwoCities(emulators, adminWorld.accounts.owner.uid);
        await seedStatus(emulators, 'ok');

        await page.goto(adminPath(lang));

        await expect(page.locator('hcm-home-page')).toBeVisible();
        // With no remembered city, the first by name: `bacau`, before the project's city.
        await expect(page).toHaveURL(new RegExp(`#/c/${SECOND_CITY}/home$`));
    },
);

test(
    'An admin of two cities: while Setup is not complete an empty address opens Setup and stays empty',
    { tag: ['@S-A49-BAD-FIRST-SCREEN-INCOMPLETE'] },
    async ({ page, lang, adminWorld }) => {
        const { emulators } = adminWorld;
        await ownTwoCities(emulators, adminWorld.accounts.owner.uid);
        await seedStatus(emulators, 'pending');

        await page.goto(adminPath(lang));

        await expect(page.locator('hcm-setup-page')).toBeVisible();
        await expect(
            navigation(page, lang).getByRole('link', { name: shellText(lang, 'adminShell.nav.setup'), exact: true }),
        ).toHaveAttribute('aria-current', 'page');
        expect(new URL(page.url()).hash).toBe('');
    },
);
