import { translate, translateAdminShell } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPhotosCity } from '../../support/photos.js';
import { ADMIN_URL } from '../../world.js';

/**
 * The admin as an installable app (behaviour A185; docs/ENGINE_API.md → *Installable app*; lesson 711): its own manifest
 * at `/admin/` (start, scope and id: the admin's folder), the push worker as its service worker, which keeps nothing and
 * answers nothing (every `admin.mjs` and `runtime.json` comes from the network, lesson 707), and **Install app** in the
 * account menu only while the browser's install prompt waits (the spec fires it as Chrome would).
 */

test.use({ serviceWorkers: 'allow' });

const AT = new Date('2026-10-17T09:00:00.000Z');

async function openAdmin(page: Page, content: ContentWorld): Promise<void> {
    await seedPhotosCity(content, AT);
    await page.goto(content.address('en', 'photos', { map: false }));
    await expect(page.getByRole('heading', { level: 1, name: translateAdminShell('en', 'adminShell.nav.photos') })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    // The photo list finishes loading first: its indicator would sit under the account menu the layout check reads.
    await expect(page.locator('hcm-loading-indicator')).toHaveCount(0);
}

async function openAccountMenu(page: Page): Promise<void> {
    await page
        .getByRole('button', { name: translateAdminShell('en', 'adminShell.account.label') })
        .filter({ visible: true })
        .click();
}

test(
    'The admin is an installable app at its own folder, and the account menu offers Install app',
    { tag: '@S-A185-HAPPY-INSTALLABLE' },
    async ({ page, context, content }) => {
        await openAdmin(page, content);

        expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope)).toBe(ADMIN_URL);
        const cdp = await context.newCDPSession(page);
        const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: unknown[]; data?: string };
        expect(manifest.url).toBe(`${ADMIN_URL}app.webmanifest`);
        expect(manifest.errors).toEqual([]);
        expect(JSON.parse(manifest.data ?? '{}')).toMatchObject({ display: 'standalone', scope: './', id: './' });

        await page.evaluate(() => {
            const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
                prompt: () => {
                    (window as unknown as { hcmPrompted?: number }).hcmPrompted = 1;
                    return Promise.resolve();
                },
                userChoice: Promise.resolve({ outcome: 'accepted' }),
            });
            window.dispatchEvent(event);
        });
        await openAccountMenu(page);
        await expect(page.getByText(translateAdminShell('en', 'adminShell.account.installHint'))).toBeVisible();
        // On a computer installing is the way to the device's colour, and the note says so; a phone's never gets it.
        const phone = await page.evaluate(
            () => (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile === true,
        );
        await expect(page.getByText(translateAdminShell('en', 'adminShell.account.installFix'), { exact: false })).toHaveCount(
            phone ? 0 : 1,
        );
        const account = translateAdminShell('en', 'adminShell.account.label');
        await expectStateSound(page, adminVisit('account-menu-install', 'en', { escape: { opener: account } }));
        await openAccountMenu(page);
        await page
            .getByRole('button', { name: translate('en', 'app.install') })
            .first()
            .click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { hcmPrompted?: number }).hcmPrompted)).toBe(1);
        await expect(page.getByRole('button', { name: translate('en', 'app.install') })).toHaveCount(0);
    },
);

test(
    "The admin's worker keeps nothing, and without the browser's prompt the menu offers no install",
    { tag: '@S-A185-BAD-NOTHING-KEPT' },
    async ({ page, content }) => {
        await openAdmin(page, content);
        await page.reload();
        await expect(page.getByRole('heading', { level: 1, name: translateAdminShell('en', 'adminShell.nav.photos') })).toBeVisible();

        // The worker controls the page and answers nothing: no cache at all, so a deploy's admin.mjs shows on the next load.
        expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toBe(
            `${ADMIN_URL}firebase-messaging-sw.js`,
        );
        expect(await page.evaluate(() => caches.keys())).toEqual([]);
        await openAccountMenu(page);
        await expect(page.getByText(translate('en', 'accent.hidden'))).toBeVisible();
        await expect(page.getByRole('button', { name: translate('en', 'app.install') })).toHaveCount(0);
    },
);
