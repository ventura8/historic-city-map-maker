import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { shellText } from '../../support/i18n.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { AT, cityAddress, ownerCity } from '../assists/world.js';
import { failedItemId, failJob, inboxRow, navBadge, notifyText, unreadName } from './world.js';

// One admin test at a time: the inboxes and the events are the project's, and the lock's reset empties them.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The inbox (behaviour A46, docs/research/M4-interfaces.md §5.5): what happened reaches the owner's inbox through the
 * Functions emulator's own chain (a failed job → its event → the fan-out), with the unread count in the navigation's
 * name for the Notifications item; a click opens the item's page and marks it read, and Mark all as read marks the rest.
 * An inbox with nothing in it says so, with no badge and nothing to mark.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** Firestore's listen channel of the emulator (WebChannel), and what cutting it logs (e2e/admin/specs/ops/stream.spec.ts). */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;
const CUT = /ERR_CONNECTION_RESET|ERR_INTERNET_DISCONNECTED|Listen\/channel|cleardot\.gif/;

test(
    'What happened reaches the inbox with a badge, and is marked read when opened',
    { tag: '@S-A46-HAPPY' },
    async ({ page, lang, adminWorld, inputBudget }) => {
        const city = ownerCity(adminWorld);
        await page.goto(cityAddress(lang, 'inbox'));
        await expect(page.getByRole('heading', { name: notifyText(lang, 'adminContent.notify.list') })).toBeVisible();

        // A job fails: its item arrives unread, in the admin's language, with when it happened; the badge counts it.
        await failJob(city, 'j-failed', AT);
        const row = inboxRow(page, failedItemId(city, 'j-failed'));
        await expect(row).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(row).toHaveAttribute('data-unread', '');
        await expect(row).toContainText(notifyText(lang, 'adminContent.notify.event.job.failed', { label: 'usgs-import' }));
        await expect(navBadge(page).first()).toBeVisible();
        const unread = page
            .locator('hcm-admin-nav')
            .getByRole('link', { name: new RegExp(`^${shellText(lang, 'adminShell.nav.inbox')}${unreadName(lang).source}`) })
            .or(
                page
                    .locator('hcm-admin-nav')
                    .getByRole('button', { name: new RegExp(`^${shellText(lang, 'adminShell.nav.more')}${unreadName(lang).source}`) }),
            );
        await expect(unread.first()).toBeVisible();
        await expectStateSound(page, adminVisit('notify.inbox', lang));

        // A click opens the job's page and marks the item read.
        await inputBudget.flow('readNotification', contentFlowBudget('readNotification')).click(row);
        await expect(page).toHaveURL(/#\/jobs$/);
        await page.goto(cityAddress(lang, 'inbox'));
        await expect(row).toBeVisible();
        await expect(row).not.toHaveAttribute('data-unread', '');

        // Another failure, then Mark all as read: nothing unread is left, and the badge goes.
        await failJob(city, 'j-again', AT);
        await expect(inboxRow(page, failedItemId(city, 'j-again'))).toHaveAttribute('data-unread', '', { timeout: FUNCTIONS_TIMEOUT_MS });
        await page.getByRole('button', { name: notifyText(lang, 'adminContent.notify.markAllRead') }).click();
        await expect(page.locator('hcm-inbox-page a.row[data-unread]')).toHaveCount(0);
        await expect(navBadge(page)).toHaveCount(0);
        // The page shows its own write at once; the server has it once the write lands.
        await expect
            .poll(
                async () =>
                    (await adminWorld.emulators.collection(`admins/${adminWorld.accounts.owner.uid}/inbox`))[failedItemId(city, 'j-again')],
            )
            .toMatchObject({ kind: 'job.failed', read: true });
    },
);

test('An empty inbox says so, with no badge and nothing to mark', { tag: '@S-A46-BAD-EMPTY' }, async ({ page, lang }) => {
    await page.goto(cityAddress(lang, 'inbox'));

    await expect(page.locator('hcm-inbox-page').getByText(notifyText(lang, 'adminContent.notify.empty'))).toBeVisible();
    await expect(navBadge(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: notifyText(lang, 'adminContent.notify.markAllRead') })).toBeDisabled();
    await expectStateSound(page, adminVisit('notify.inbox-empty', lang));
});

/** Unread items in the owner's inbox, past the list's first page: `markAll-00` is the oldest. */
async function seedUnread(adminWorld: Parameters<typeof ownerCity>[0], count: number): Promise<string> {
    const city = ownerCity(adminWorld);
    const inbox = `admins/${adminWorld.accounts.owner.uid}/inbox`;
    for (let index = 0; index < count; index += 1) {
        const number = String(index).padStart(2, '0');
        const at = new Date(AT.getTime() + index * 1000);
        const id = failedItemId(city, `markAll-${number}`);
        await adminWorld.emulators.setDocument(`${inbox}/${id}`, {
            kind: 'job.failed',
            severity: 'error',
            cityId: city.city,
            params: { label: `Job ${number}` },
            link: '#/jobs',
            createdAt: at,
            read: false,
            updatedBy: 'system:notify',
            updatedAt: at,
        });
    }
    return inbox;
}

/** How many of the items `seedUnread` wrote are unread on the server (a content spec's own may arrive meanwhile). */
async function seededUnread(adminWorld: Parameters<typeof ownerCity>[0], inbox: string): Promise<number> {
    const items = Object.entries(await adminWorld.emulators.collection(inbox));
    return items.filter(([id, item]) => id.includes('markAll-') && item['read'] !== true).length;
}

const PAST_THE_PAGE = 51;

test(
    'Mark all as read reaches the items past the loaded page, and the badge goes',
    { tag: '@S-A46-HAPPY-MARK-ALL-READ' },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(150_000);
        const inbox = await seedUnread(adminWorld, PAST_THE_PAGE);
        await page.goto(cityAddress(lang, 'inbox'));
        await expect(page.locator('hcm-inbox-page a.row[data-unread]')).toHaveCount(50, { timeout: FUNCTIONS_TIMEOUT_MS });

        await page.getByRole('button', { name: notifyText(lang, 'adminContent.notify.markAllRead') }).click();

        await expect.poll(() => seededUnread(adminWorld, inbox)).toBe(0);
        await expect(page.locator('hcm-inbox-page a.row[data-unread]')).toHaveCount(0);
        await expect(navBadge(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: notifyText(lang, 'adminContent.notify.markAllRead') })).toBeDisabled();
    },
);

test(
    'Mark all as read that cannot reach the server says so and marks nothing',
    { tag: '@S-A46-BAD-MARK-ALL-OFFLINE' },
    async ({ page, lang, adminWorld, consoleErrors }) => {
        test.setTimeout(150_000);
        await page.clock.install();
        const inbox = await seedUnread(adminWorld, 1);
        await page.goto(cityAddress(lang, 'inbox'));
        const row = inboxRow(page, failedItemId(ownerCity(adminWorld), 'markAll-00'));
        await expect(row).toHaveAttribute('data-unread', '', { timeout: FUNCTIONS_TIMEOUT_MS });

        await page.route(LISTEN, (route) => route.abort('connectionreset'));
        await page.context().setOffline(true);
        await page.getByRole('button', { name: notifyText(lang, 'adminContent.notify.markAllRead') }).click();
        await page.clock.fastForward(30_000);

        await expect(page.getByText(notifyText(lang, 'adminContent.common.offline'))).toBeVisible();
        await page.context().setOffline(false);
        await page.unroute(LISTEN);
        expect(await seededUnread(adminWorld, inbox)).toBe(1);
        consoleErrors.takeMatching(CUT);
    },
);
