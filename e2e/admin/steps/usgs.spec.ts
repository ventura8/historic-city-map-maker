import { USGS_CREDENTIALS } from '@hcm/test-support/fakes';
import type { Locator, Page } from '@playwright/test';

import { projectCity } from '../support/content.js';
import { apiText, setupText, templatePattern } from '../support/i18n.js';
import { seedPhotosCity } from '../support/photos.js';
import { followDeepLink, SetupPage, standInProviderPages } from '../support/setup-page.js';
import type { UpstreamControl } from '../support/upstream.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Setup Assistant's USGS step (docs/research/M2b-interfaces.md §3.3 f; behaviour A07) on a claimed map, its owner
 * signed in: the ERS username, "Open the USGS token page" (the paste box first, then the 60 s countdown on the page's
 * clock), and the paste, which goes at once to `setup.saveUsgs`; the server logs in to the fake M2M API (the server's
 * world of the fake upstreams) with the credentials of `USGS_CREDENTIALS`, each encoding its answer.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** The page's time: the expiry reminder counts from it. */
const NOW = new Date('2026-10-18T09:00:00.000Z');
/** When the claim created the city (a fixed time). */
const AT = new Date('2026-10-01T09:00:00.000Z');

test.beforeEach(async ({ page, adminWorld, upstream }) => {
    await seedPhotosCity(projectCity(adminWorld.emulators, adminWorld.accounts.owner.uid), AT);
    // The project was provisioned: the secrets the server keeps the credentials in exist.
    await upstream.scenario('google.provisioned', 'server');
    await standInProviderPages(page.context(), ['https://ers.cr.usgs.gov']);
    await page.clock.install({ time: NOW });
    await page.clock.resume();
});

interface UsgsCard {
    readonly card: Locator;
    readonly username: Locator;
    readonly expiry: Locator;
    readonly tokenPage: Locator;
    readonly token: Locator;
}

async function usgsCard(page: Page, lang: 'ro' | 'en'): Promise<UsgsCard> {
    const setup = new SetupPage(page, lang);
    await setup.visit();
    const card = await setup.show('usgs');
    return {
        card,
        username: card.getByLabel(setupText(lang, 'adminSetup.usgs.username')),
        expiry: card.getByLabel(setupText(lang, 'adminSetup.usgs.expiresOn')),
        tokenPage: card.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) }),
        token: card.getByLabel(setupText(lang, 'adminSetup.usgs.token')),
    };
}

/** A text's pattern found anywhere in an element's text (a paragraph's own line breaks around it included). */
function unanchored(pattern: RegExp): RegExp {
    return new RegExp(pattern.source.replace(/^\^/, '').replace(/\$$/, ''));
}

/** The secret versions the server added, as their payloads (Secret Manager's `addVersion` bodies). */
async function secretPayloads(upstream: UpstreamControl): Promise<string[]> {
    const calls = await upstream.calls('server', 'secret-manager');
    return calls
        .filter((call) => call.method === 'POST' && call.url.includes(':addVersion'))
        .map((call) => Buffer.from((JSON.parse(call.body) as { payload?: { data?: string } }).payload?.data ?? '', 'base64').toString());
}

test(
    'An approved M2M account: the username, the token page and the paste save the credentials to Secret Manager only, and the card is green',
    { tag: ['@S-A07-HAPPY'] },
    async ({ page, lang, adminWorld, upstream, setupBudget }) => {
        const usgs = await usgsCard(page, lang);
        const inputs = setupBudget.inputs('usgs');
        await inputs.fill(usgs.username, USGS_CREDENTIALS.approved.username);
        await followDeepLink(page, () => inputs.click(usgs.tokenPage));
        await expect(usgs.token).toBeFocused();
        await inputs.paste(usgs.token, USGS_CREDENTIALS.approved.applicationToken);

        const setup = new SetupPage(page, lang);
        await setup.expectState('usgs', 'ok');
        await expect((await setup.show('usgs')).getByText(setupText(lang, 'adminSetup.usgs.role.download'))).toBeVisible();
        const documents = JSON.stringify([
            await adminWorld.emulators.document('setup/status'),
            await adminWorld.emulators.document('cities/bucharest'),
        ]);
        expect(documents).not.toContain(USGS_CREDENTIALS.approved.applicationToken);
        expect((await secretPayloads(upstream)).some((payload) => payload.includes(USGS_CREDENTIALS.approved.applicationToken))).toBe(true);
        // The server ends the M2M key it logged in with.
        expect((await upstream.calls('server', 'usgs')).map((call) => call.operation)).toContain('usgs.logout');
    },
);

test(
    'A token USGS answers with its HTML 403 is refused as bad credentials, and nothing is stored',
    { tag: ['@S-A07-BAD-INVALID-TOKEN'] },
    async ({ page, lang, upstream, consoleErrors }) => {
        const usgs = await usgsCard(page, lang);
        await usgs.username.fill(USGS_CREDENTIALS.expired.username);
        await followDeepLink(page, () => usgs.tokenPage.click());
        await usgs.token.fill(USGS_CREDENTIALS.expired.applicationToken);
        await usgs.token.press('Enter');

        await expect(usgs.card.getByRole('alert').filter({ hasText: apiText(lang, 'apiError.usgs.credentials') })).toBeVisible();
        await new SetupPage(page, lang).expectState('usgs', 'invalid');
        expect((await secretPayloads(upstream)).some((payload) => payload.includes(USGS_CREDENTIALS.expired.applicationToken))).toBe(false);
        expect(consoleErrors.takeMatching(/status of 4\d\d/).length).toBeGreaterThan(0);
    },
);

test(
    "USGS under maintenance: the card says so with the chip unavailable, and the server's next check connects once USGS is back",
    { tag: ['@S-A07-BAD-MAINTENANCE'] },
    async ({ page, lang, adminWorld, upstream }) => {
        await upstream.fail('usgs', 'maintenance', 'server');
        const usgs = await usgsCard(page, lang);
        await usgs.username.fill(USGS_CREDENTIALS.approved.username);
        await followDeepLink(page, () => usgs.tokenPage.click());
        await usgs.token.fill(USGS_CREDENTIALS.approved.applicationToken);
        await usgs.token.press('Enter');

        const setup = new SetupPage(page, lang);
        await setup.expectState('usgs', 'unavailable');
        const card = await setup.show('usgs');
        await expect(card.getByText(apiText(lang, 'apiError.usgs.maintenance'))).toBeVisible();
        await expect(card.getByText(templatePattern(setupText(lang, 'adminSetup.usgs.nextCheck', { time: '\u0000' })))).toBeVisible();

        // USGS is back. The server's tick checks again when the next check is due: its clock cannot move, so the check's
        // time does.
        await upstream.fail('usgs', null, 'server');
        await adminWorld.emulators.updateFields('setup/status', { usgs: { nextCheckAt: new Date('2026-01-01T00:00:00Z') } }, [
            'usgs.nextCheckAt',
        ]);
        await adminWorld.emulators.runOpsTick();
        await expect
            .poll(async () => (await adminWorld.emulators.document('setup/status'))?.['usgs'], { timeout: 30_000 })
            .toMatchObject({ state: 'ok' });
    },
);

test(
    'A token saved with an expiry ten days ahead shows the date and the way to a new token',
    { tag: ['@S-A07-BAD-TOKEN-EXPIRING'] },
    async ({ page, lang }) => {
        const usgs = await usgsCard(page, lang);
        await usgs.username.fill(USGS_CREDENTIALS.approved.username);
        await usgs.expiry.fill('2026-10-28');
        await followDeepLink(page, () => usgs.tokenPage.click());
        await usgs.token.fill(USGS_CREDENTIALS.approved.applicationToken);
        await usgs.token.press('Enter');

        const setup = new SetupPage(page, lang);
        await setup.expectState('usgs', 'ok');
        const card = await setup.show('usgs');
        const reminder = card.getByText(unanchored(templatePattern(setupText(lang, 'adminSetup.usgs.expiresSoon', { date: '\u0000' }))));
        await expect(reminder).toContainText('28');
        await expect(card.getByRole('link', { name: new RegExp(`^${setupText(lang, 'adminSetup.usgs.openTokenPage')}`) })).toBeVisible();
    },
);

test(
    'A countdown that ends with nothing pasted asks for a new token, keeps the box open and sends nothing; the link starts it again',
    { tag: ['@S-A07-BAD-COUNTDOWN-EXPIRED'] },
    async ({ page, lang, upstream }) => {
        const usgs = await usgsCard(page, lang);
        await usgs.username.fill(USGS_CREDENTIALS.approved.username);
        await followDeepLink(page, () => usgs.tokenPage.click());
        const timer = usgs.card.getByRole('timer');
        await expect(timer).toBeVisible();

        await page.clock.fastForward('01:01');
        const expired = usgs.card.getByRole('alert').filter({ hasText: setupText(lang, 'adminSetup.usgs.expired') });
        await expect(expired).toBeVisible();
        await expect(timer).toBeHidden();
        await expect(usgs.token).toBeEditable();
        expect(await upstream.calls('server', 'usgs')).toEqual([]);

        await followDeepLink(page, () => usgs.tokenPage.click());
        await expect(timer).toBeVisible();
        await expect(expired).toHaveCount(0);
    },
);
