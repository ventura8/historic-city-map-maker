import { translateAdminShell } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { followDeepLink, standInProviderPages } from '../../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import {
    detail,
    errorText,
    FREE_1968,
    FRESH_HARVEST,
    IMAGERY_AT,
    imageryText,
    PAID_FRAMES,
    readyImagery,
    sceneLink,
    sceneList,
    TARGET_FRAMES,
} from './world.js';

// One admin test at a time: the orders read setup/status, and USGS's answers come from the server's upstream world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Buying a scan (behaviour A13, docs/research/M4-interfaces.md §1): a frame USGS has not scanned yet has an order card
 * with its cost, how to order it and its own EarthExplorer page (a new tab: the purchase is the admin's own step there,
 * never this app's), then "I ordered it" (`usgs.markOrdered` in the Functions emulator). From then on the server does the
 * rest: the fake USGS delivers (`usgs.ordersDelivered`), "Check now" (or the daily watch, whose reminders, give-up and
 * guard are the functions tests') imports it into the M3 pipeline, and the admins are told. The states of a reminder, a
 * delivery and an order never delivered are seeded as the watch leaves them.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const PAID = PAID_FRAMES[0];
const EE_PAGE = `https://earthexplorer.usgs.gov/scene/metadata/full/5e839febdccb64b3/${PAID}/`;
const DAY_MS = 86_400_000;
/** A 1980 frame seeded as one that had to be bought and was never delivered. */
const EXPIRED = TARGET_FRAMES[4];

/**
 * The scenes the area lists, a recent harvest the page does not repeat, and the paid frames with them; the paid Corona
 * frame's preview is in our bucket already (the fake browse host never serves that one: S-A11-BAD-BROWSE-UNAVAILABLE).
 */
async function seedScenes(imagery: ImageryWorld): Promise<void> {
    for (const entityId of [...TARGET_FRAMES, FREE_1968, ...PAID_FRAMES]) {
        await imagery.seedScene(entityId, FRESH_HARVEST);
    }
    await imagery.seedBrowse(PAID, IMAGERY_AT);
}

/** An order as the watch leaves it, `days` days old (timestamps as Firestore stores them). */
async function seedOrder(imagery: ImageryWorld, entityId: string, order: Readonly<Record<string, unknown>>): Promise<void> {
    const orderedAt = new Date(IMAGERY_AT.getTime() - 8 * DAY_MS);
    const value = {
        state: 'ordered',
        orderedAt,
        orderedBy: 'system:e2e',
        checks: 8,
        lastCheckedAt: new Date(IMAGERY_AT.getTime() - DAY_MS),
        nextCheckAt: new Date(IMAGERY_AT.getTime() + 365 * DAY_MS),
        remindersSent: [],
        ...order,
    };
    await imagery.cityWorld.emulators.updateFields(`cities/${imagery.city}/usgsScenes/${entityId}`, { order: value }, ['order']);
}

/** The scenes that must be ordered join the list (Free only off), then the paid Corona frame opens. */
async function openPaidScene(page: Page, lang: 'ro' | 'en', entityId: string = PAID): Promise<void> {
    await page.goto(adminPath(lang, 'imagery'));
    await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });
    await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') }).click();
    await expect(sceneLink(page, lang, entityId)).toBeVisible();
    await sceneLink(page, lang, entityId).click();
}

/** The open scene's order card. */
function orderCard(page: Page): Locator {
    return detail(page).locator('.order-card');
}

function orderButton(page: Page, lang: 'ro' | 'en', key: Parameters<typeof imageryText>[1]): Locator {
    return orderCard(page).getByRole('button', { name: imageryText(lang, key) });
}

/** The snackbar that says `key` (with its action, the mark's Undo). */
async function snackbar(page: Page, lang: 'ro' | 'en', key: Parameters<typeof imageryText>[1]): Promise<Locator> {
    const notice = page.locator('hcm-snackbar').filter({ hasText: imageryText(lang, key) });
    await expect(notice).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    return notice;
}

/** The four steps of the order card's guide, as the owner did them on EarthExplorer's scene page (2026-11-08). */
const ORDER_GUIDE = [
    'adminContent.orders.guide.signIn',
    'adminContent.orders.guide.order',
    'adminContent.orders.guide.selections',
    'adminContent.orders.guide.pay',
] as const;

/** Closes the snackbar `key`: the states that follow are about the card, and its timer could end mid-check. */
async function closeSnackbar(page: Page, lang: 'ro' | 'en', key: Parameters<typeof imageryText>[1]): Promise<void> {
    const notice = await snackbar(page, lang, key);
    await notice.getByRole('button', { name: translateAdminShell(lang, 'adminShell.notice.close') }).click();
    await expect(notice).toBeHidden();
}

test(
    'Buying a scan is prepared, tracked and imported on its own when delivered',
    { tag: '@S-A13-HAPPY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);
        await standInProviderPages(page.context(), ['https://earthexplorer.usgs.gov']);
        await openPaidScene(page, lang);

        // The card: the state, the cost (paid to USGS), the guide, the scene's own EarthExplorer page in a new tab.
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.needsOrder'));
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.estimate', { usd: '35', frames: '1' }));
        await expect(orderCard(page).locator('.guide li')).toHaveText(ORDER_GUIDE.map((step) => imageryText(lang, step)));
        const earthExplorer = orderCard(page).getByRole('link', { name: new RegExp(`^${imageryText(lang, 'adminContent.orders.open')}`) });
        await expect(earthExplorer).toHaveAttribute('href', EE_PAGE);
        await expect(earthExplorer).toHaveAttribute('target', '_blank');
        await expect(earthExplorer).toHaveAttribute('rel', 'noopener noreferrer');
        await expectStateSound(page, adminVisit('orders.order-card', lang));

        // The flow's two inputs: EarthExplorer (the purchase there is the admin's own step), then I ordered it.
        const buying = inputBudget.flow('buyScan', contentFlowBudget('buyScan'));
        await followDeepLink(page, () => buying.click(earthExplorer));
        await buying.click(orderButton(page, lang, 'adminContent.orders.markOrdered'));
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.ordered'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await closeSnackbar(page, lang, 'adminContent.orders.notice.marked');
        await expectStateSound(page, adminVisit('orders.ordered', lang));

        // USGS delivers; Check now: delivered, and the import starts without another click.
        await upstream.scenario('usgs.ordersDelivered', 'server');
        await inputBudget
            .flow('checkOrderNow', contentFlowBudget('checkOrderNow'))
            .click(orderButton(page, lang, 'adminContent.orders.checkNow'));
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.importing'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const scene = await imagery.cityWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${PAID}`);
        const jobId = String((scene?.['order'] as Record<string, unknown> | undefined)?.['importJobId']);
        await expect(orderCard(page).getByRole('link', { name: imageryText(lang, 'adminContent.orders.openImport') })).toHaveAttribute(
            'href',
            `#/imagery/version/${jobId}`,
        );
        expect(await imagery.job(jobId)).toMatchObject({ type: 'usgs-import', createdBy: adminWorld.accounts.owner.uid });
        // The admins are told (the inbox shows it: assists-notify's S-A46-HAPPY).
        expect(await adminWorld.emulators.document(`notificationEvents/order.delivered~${imagery.city}~${PAID}`)).toMatchObject({
            kind: 'order.delivered',
            link: `#/imagery/scene/${PAID}`,
        });
    },
);

test(
    'An order marked by mistake is taken back',
    { tag: '@S-A13-HAPPY-TAKE-BACK' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);
        await openPaidScene(page, lang);
        await orderButton(page, lang, 'adminContent.orders.markOrdered').click();

        // The snackbar's Undo takes the mark back: the card offers EarthExplorer and I ordered it again.
        const notice = await snackbar(page, lang, 'adminContent.orders.notice.marked');
        await notice.getByRole('button', { name: imageryText(lang, 'adminContent.orders.undo') }).click();
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.needsOrder'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(orderButton(page, lang, 'adminContent.orders.markOrdered')).toBeEnabled();
        expect((await imagery.cityWorld.emulators.document(`cities/${imagery.city}/usgsScenes/${PAID}`))?.['order']).toBeUndefined();

        // Marked again, then Take the mark back on the card; the watch asks USGS nothing about it.
        await orderButton(page, lang, 'adminContent.orders.markOrdered').click();
        await expect(orderButton(page, lang, 'adminContent.orders.undo')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await orderButton(page, lang, 'adminContent.orders.undo').click();
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.needsOrder'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const asked = (await upstream.calls('server', 'usgs.download-options')).length;
        await imagery.tick();
        expect(await upstream.calls('server', 'usgs.download-options')).toHaveLength(asked);
    },
);

test(
    'An available scene cannot be marked as ordered',
    { tag: '@S-A13-BAD-ALREADY-AVAILABLE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneLink(page, lang, FREE_1968)).toContainText(imageryText(lang, 'adminContent.imagery.tag.free'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await sceneLink(page, lang, FREE_1968).click();

        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
        await expect(orderCard(page)).toHaveCount(0);
        await expect(detail(page).getByRole('link', { name: new RegExp(`^${imageryText(lang, 'adminContent.orders.open')}`) })).toHaveCount(
            0,
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.orders.markOrdered') })).toHaveCount(0);
    },
);

test(
    'A frame USGS scanned while it was being marked turns free, and the page still says why I ordered it was refused',
    { tag: '@S-A13-BAD-SCANNED-WHILE-MARKING' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);
        await openPaidScene(page, lang);
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.needsOrder'));

        // USGS scanned the frame meanwhile: the mark asks USGS first, finds the frame free, records it so and refuses.
        await upstream.scenario('usgs.ordersDelivered', 'server');
        await orderButton(page, lang, 'adminContent.orders.markOrdered').click();

        // The order card goes (Import is free now), and the snackbar says why in words (review 2026-10-24: the refusal was
        // shown only in the card that left with the order).
        const notice = page.locator('hcm-snackbar').filter({ hasText: errorText(lang, 'apiError.usgs.alreadyAvailable') });
        await expect(notice).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(orderCard(page)).toHaveCount(0);
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
        // The button the admin clicked went with its card: the keyboard is on the scene's heading, not the page's body.
        await expect(detail(page).locator('[data-detail-heading]')).toBeFocused();
        // The snackbar closed first: its timer could end mid-check (as closeSnackbar's states).
        await notice.getByRole('button', { name: translateAdminShell(lang, 'adminShell.notice.close') }).click();
        await expect(notice).toBeHidden();
        await expectStateSound(page, adminVisit('orders.scanned-while-marking', lang));
        expect(consoleErrors.takeMatching(/status of 400 .*usgs-markOrdered/)).toHaveLength(1);
    },
);

test(
    'Before USGS approves downloads, the order cards say the daily check waits for it and lead to Setup',
    { tag: '@S-A13-BAD-WAITS-FOR-APPROVAL' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The account has the search role only: M2M has not approved its downloads yet, so the watch asks USGS nothing.
        await adminWorld.emulators.updateFields('setup/status', { usgs: { state: 'pending', role: 'search', checkedAt: IMAGERY_AT } }, [
            'usgs',
        ]);
        await seedScenes(imagery);
        await seedOrder(imagery, PAID, {});

        await openPaidScene(page, lang, PAID_FRAMES[1]);
        const buying = orderCard(page).locator('[data-state="waits-for-approval"]');
        await expect(buying).toContainText(imageryText(lang, 'adminContent.orders.waitsForApproval'));

        await page.goto(adminPath(lang, `imagery/scene/${PAID}`));
        const card = orderCard(page);
        await expect(card).toContainText(imageryText(lang, 'adminContent.orders.state.ordered'), { timeout: FUNCTIONS_TIMEOUT_MS });
        const note = card.locator('[data-state="waits-for-approval"]');
        await expect(note).toContainText(imageryText(lang, 'adminContent.orders.waitsForApproval'));
        await expect(note.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openUsgsSetup') })).toHaveAttribute(
            'href',
            '#/setup/usgs',
        );
        await expect(card).toContainText(imageryText(lang, 'adminContent.orders.fact.afterApproval'));
        await expectStateSound(page, adminVisit('orders.waits-for-approval', lang));
    },
);

test(
    'An order not delivered after a week reminds the admin to pay, and one never delivered is ordered again',
    { tag: '@S-A13-BAD-NEVER-DELIVERED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);
        // As the watch leaves them: a week old and reminded (its last check met USGS's maintenance), delivered, never delivered.
        await seedOrder(imagery, PAID, { state: 'reminder', remindersSent: [7], lastError: 'apiError.usgs.maintenance' });
        await seedOrder(imagery, PAID_FRAMES[1], { state: 'delivered', deliveredAt: IMAGERY_AT });
        await imagery.seedScene(EXPIRED, FRESH_HARVEST, { downloadAvailable: false });
        await seedOrder(imagery, EXPIRED, { state: 'expired', expiredAt: IMAGERY_AT, remindersSent: [7, 12] });

        // Work lists the orders, the expired one first; each opens from there (Free only hides them). Its tab counts the
        // three it lists (finding 54 of 2026-11-01: the count is what Work lists, not only what waits for the admin).
        await page.goto(adminPath(lang, 'imagery'));
        await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.work', { count: '3' }) }).click();
        const orders = page.locator('hcm-imagery-page').getByRole('region', { name: imageryText(lang, 'adminContent.orders.group') });
        await orders.locator(`a[href$="/imagery/scene/${PAID}"]`).click();
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.reminder'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.reminderNote'));
        await expect(orderCard(page).locator('[data-state="last-error"]')).toBeVisible();
        await expectStateSound(page, adminVisit('orders.reminder', lang));

        await page.goto(adminPath(lang, `imagery/scene/${PAID_FRAMES[1]}`));
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.state.delivered'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('orders.delivered', lang));

        await page.goto(adminPath(lang, `imagery/scene/${EXPIRED}`));
        await expect(orderCard(page)).toContainText(imageryText(lang, 'adminContent.orders.expiredNote'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(orderButton(page, lang, 'adminContent.orders.markOrdered')).toBeEnabled();
        // An order never delivered and no longer wanted: its mark can be taken back, which takes it out of Work.
        await expect(orderButton(page, lang, 'adminContent.orders.undo')).toBeEnabled();
        await expectStateSound(page, adminVisit('orders.expired', lang));
    },
);

test(
    'A scene to buy opens from its address while Free only hides it',
    { tag: '@S-A13-HAPPY-ADDRESS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);

        await page.goto(adminPath(lang, `imagery/scene/${PAID}`));

        await expect(orderButton(page, lang, 'adminContent.orders.markOrdered')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(sceneLink(page, lang, PAID)).toHaveCount(0);
    },
);

test(
    'An address of no scene says so once its read answers',
    { tag: '@S-A13-BAD-NO-SCENE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await seedScenes(imagery);

        await page.goto(adminPath(lang, 'imagery/scene/DS-NO-SUCH-FRAME'));

        await expect(detail(page).getByRole('heading', { name: imageryText(lang, 'adminContent.imagery.sceneNotFound') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(orderCard(page)).toHaveCount(0);
    },
);
