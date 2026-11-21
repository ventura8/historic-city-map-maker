import { PROVISION_ITEMS, PROVISION_SET_VERSION } from '@hcm/shared';
import { translateAdminWorkerHousehold, type AdminWorkerHouseholdKey } from '@hcm/shared/admin-worker-household';
import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { E2E_PROJECT_ID } from '../../world.js';
import { readyImagery } from './world.js';

// One admin test at a time: the image's digest is in `setup/status`, the project's singleton.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * W5, household computers (docs/research/M7-local-worker.md, *Household computers*; behaviour A143): the Jobs page lists the city's
 * computers with Rename, Pause and Remove (`worker.manage` in the Functions emulator), Add another computer gives the one line for
 * a computer without a screen (its one-time code minted by `worker.pairCode`) or this admin's address for one with a screen, and
 * Remove this computer waits for a computer that is off, with Disconnect now anyway and then the line that cleans it up by hand.
 * Cleanup item 6 (2026-11-14): a computer's disk below its worker's floor is said with why and the fix, and Free space now asks it.
 * M20 §22 (2026-11-14): a computer that holds scanned maps says it shares them with the others and how far, or why it stopped today.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date();
const DIGEST = `sha256:${'e7'.repeat(32)}`;
const NUC = 'w-0123456789abcdef';
const LAPTOP = 'w-fedcba9876543210';

function text(lang: 'ro' | 'en', key: AdminWorkerHouseholdKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorkerHousehold(lang, key, params);
}

/** `setup/status` with the pipeline installed and its image's digest (the worker's panel then shows the computers). */
async function recordPipeline(imagery: ImageryWorld): Promise<void> {
    const ok = { state: 'ok', checkedAt: NOW };
    await imagery.cityWorld.emulators.updateFields(
        'setup/status',
        {
            billing: { ...ok, budgetAmount: 5, currency: 'USD' },
            provision: { ...ok, items: PROVISION_ITEMS.map((id) => ({ id, ...ok })), setVersion: PROVISION_SET_VERSION },
            install: { pipeline: { state: 'installed', release: '1.0.0', checkedAt: NOW.toISOString(), image: DIGEST } },
        },
        ['billing', 'provision', 'install'],
    );
}

/** Two computers: the NUC on and calm, the laptop off for an hour with someone at it. */
async function seedComputers(imagery: ImageryWorld, uid: string): Promise<void> {
    const recent = new Date(NOW.getTime() - 20_000);
    const hourAgo = new Date(NOW.getTime() - 3_600_000);
    const base = { uid, version: '1.0.0', startedAt: hourAgo, state: 'idle', updatedBy: uid };
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${NUC}`, {
        ...base,
        ...{ lastSeenAt: recent, updatedAt: recent, host: 'nuc', os: 'linux', starter: '0123456789ab' },
        share: { profile: 'full', why: 'idle', cores: 8, threads: 7, memoryMb: 8192 },
    });
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${LAPTOP}`, {
        ...base,
        ...{ lastSeenAt: hourAgo, updatedAt: hourAgo, host: 'laptop', os: 'windows' },
        share: { profile: 'quiet', why: 'user-active', cores: 16, threads: 2, memoryMb: 4096 },
    });
}

function computers(page: Page): Locator {
    return page.locator('hcm-worker-household');
}

function line(page: Page, which: string): Locator {
    return computers(page).locator(`[data-line="${which}"]`);
}

test(
    "The Jobs page lists the city's computers, renames and pauses one, and gives the line for a computer without a screen",
    { tag: ['@S-A143-HAPPY-LIST', '@S-A143-HAPPY-MANAGE', '@S-A143-HAPPY-HEADLESS-PAIR'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedComputers(imagery, owner);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto(adminPath(lang, 'jobs'));
        const nuc = computers(page).locator(`[data-computer="${NUC}"]`);
        await expect(nuc.getByText('nuc', { exact: true })).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(nuc).toHaveAttribute('data-online', 'true');
        await expect(computers(page).locator(`[data-computer="${LAPTOP}"]`)).toHaveAttribute('data-online', 'false');
        await expect(computers(page).locator('[data-share="user-active"]')).toContainText(
            text(lang, 'adminWorkerHousehold.why.user-active'),
        );
        await expectStateSound(page, adminVisit('worker.household-list', lang));

        // Rename and Pause go to the server; the list follows the document.
        await nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.rename') }).click();
        await nuc.getByLabel(text(lang, 'adminWorkerHousehold.name')).fill('Living room');
        await nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.save') }).click();
        await expect(nuc.getByText('Living room', { exact: true })).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.pause') }).click();
        await expect(nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.resume') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${imagery.city}/workers/${NUC}`))?.['pausedAt'])
            .toBeDefined();

        // Add another computer, without a screen: one line, its one-time code on standard input, Copy.
        await computers(page)
            .getByRole('button', { name: text(lang, 'adminWorkerHousehold.add') })
            .click();
        const base = `http://127.0.0.1:5001/${E2E_PROJECT_ID}/us-central1/worker-starter?city=${imagery.city}&os=linux&action=install`;
        const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        await expect(line(page, 'headless')).toHaveText(
            new RegExp(`^curl -fsSL '${escaped}' -o ~/hcm-worker\\.sh && echo [a-z2-7]{26} \\| sh ~/hcm-worker\\.sh$`),
            {
                timeout: FUNCTIONS_TIMEOUT_MS,
            },
        );
        const first = (await line(page, 'headless').textContent()) ?? '';
        await computers(page)
            .getByRole('button', { name: text(lang, 'adminWorkerHousehold.copy') })
            .click();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
        await expectStateSound(page, adminVisit('worker.household-add', lang));

        // A new line replaces the old one (its code is another).
        await computers(page)
            .getByRole('button', { name: text(lang, 'adminWorkerHousehold.newLine') })
            .click();
        await expect(line(page, 'headless')).not.toHaveText(first, { timeout: FUNCTIONS_TIMEOUT_MS });

        // A computer with a screen: this admin's address.
        await computers(page)
            .getByRole('button', { name: text(lang, 'adminWorkerHousehold.kind.windows') })
            .click();
        await expect(line(page, 'address')).toContainText('#/jobs');
        await expectStateSound(page, adminVisit('worker.household-add-screen', lang));
    },
);

test(
    'Remove this computer waits for a computer that is off, and Disconnect now anyway shows the line that cleans it by hand',
    { tag: ['@S-A143-HAPPY-REMOVE', '@S-A143-HAPPY-REMOVE-OFFLINE', '@S-A143-BAD-REMOVE-FORCED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedComputers(imagery, owner);
        const path = `cities/${imagery.city}/workers/${LAPTOP}`;

        await page.goto(adminPath(lang, 'jobs'));
        const laptop = computers(page).locator(`[data-computer="${LAPTOP}"]`);
        await laptop.getByRole('button', { name: text(lang, 'adminWorkerHousehold.remove') }).click({ timeout: FUNCTIONS_TIMEOUT_MS });
        await laptop.getByRole('switch', { name: text(lang, 'adminWorkerHousehold.keep') }).click();
        await expectStateSound(page, adminVisit('worker.household-remove', lang));
        await laptop.getByRole('button', { name: text(lang, 'adminWorkerHousehold.removeNow') }).click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(path))?.['removal'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ step: 'asked', keep: true, docker: false });
        await expect(laptop.locator('[data-removal]')).toHaveText(text(lang, 'adminWorkerHousehold.removal.askedOffline'));
        await expectStateSound(page, adminVisit('worker.household-forced', lang));

        // The last resort: disconnected now, then the Windows line and file that clean it by hand.
        await laptop.getByRole('button', { name: text(lang, 'adminWorkerHousehold.disconnect') }).click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(path))?.['revokedAt'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeDefined();
        await expect(laptop.locator('[data-line^="cleanup-"]')).toContainText('os=windows&action=uninstall', {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(laptop.getByRole('link', { name: text(lang, 'adminWorkerHousehold.cleanupFile') })).toHaveAttribute(
            'download',
            'hcm-worker-remove.bat',
        );
    },
);

test(
    'A computer whose disk is almost full says so, takes no new work, and Free space now asks it to delete what no map needs',
    { tag: ['@S-A62-HAPPY-FREE-SPACE', '@S-A62-BAD-LOW-DISK'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedComputers(imagery, owner);
        const path = `cities/${imagery.city}/workers/${NUC}`;
        const gb = 1024 ** 3;
        const disk = { workBytes: 80 * gb, freeBytes: 4 * gb, floorBytes: 10 * gb, at: new Date(NOW.getTime() - 20_000) };
        await imagery.cityWorld.emulators.updateFields(path, { disk }, ['disk']);

        await page.goto(adminPath(lang, 'jobs'));
        const nuc = computers(page).locator(`[data-computer="${NUC}"]`);
        await expect(nuc.locator('[data-low-disk]')).toContainText(text(lang, 'adminWorkerHousehold.lowDisk3'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.household-low-disk', lang));

        await nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.freeSpace') }).click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(path))?.['freeSpaceAskedAt'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeDefined();
        await expect(nuc.locator('[data-freed]')).toHaveText(text(lang, 'adminWorkerHousehold.freeing'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(nuc.getByRole('button', { name: text(lang, 'adminWorkerHousehold.freeSpace') })).toBeDisabled();
    },
);

test(
    'A computer that holds scanned maps says it shares them with the others and how far; at the daily limit it says why it stopped',
    { tag: ['@S-A143-HAPPY-SHARING', '@S-A143-BAD-SHARING-DAY-LIMIT', '@S-A143-BAD-SHARING-STALE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedComputers(imagery, owner);
        const path = `cities/${imagery.city}/workers/${NUC}`;
        const mb = 1024 ** 2;
        const day = NOW.toISOString().slice(0, 10);
        const sending = { state: 'sending', computers: 2, jobId: 'ar-series', sentBytes: 120 * mb, totalBytes: 677 * mb, day, dayBytes: 0 };
        await imagery.cityWorld.emulators.updateFields(path, { sharing: { ...sending, at: new Date(NOW.getTime() - 20_000) } }, [
            'sharing',
        ]);

        await page.goto(adminPath(lang, 'jobs'));
        const nuc = computers(page).locator(`[data-computer="${NUC}"]`);
        const progress = text(lang, 'adminWorkerHousehold.sharingProgress', { sent: '120', total: '677' });
        await expect(nuc.locator('[data-sharing="sending"]')).toContainText(progress, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(nuc.getByRole('progressbar', { name: text(lang, 'adminWorkerHousehold.sharingBar') })).toBeVisible();
        await expectStateSound(page, adminVisit('worker.household-sharing', lang));

        const limit = { ...sending, state: 'dayLimit', dayBytes: 20 * 1024 * mb, at: new Date() };
        await imagery.cityWorld.emulators.updateFields(path, { sharing: limit }, ['sharing']);
        await expect(nuc.locator('[data-sharing="dayLimit"]')).toContainText(text(lang, 'adminWorkerHousehold.sharingDayLimit2'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(nuc.locator('[data-sharing="dayLimit"]')).toContainText(text(lang, 'adminWorkerHousehold.sharingDayLimit3'));

        // A copy said over 10 minutes ago: the computer stopped (its next start resumes it), so the card no longer says it shares.
        const stale = { ...sending, at: new Date(NOW.getTime() - 3_600_000) };
        await imagery.cityWorld.emulators.updateFields(path, { sharing: stale }, ['sharing']);
        await expect(nuc.locator('[data-sharing]')).toHaveCount(0, { timeout: FUNCTIONS_TIMEOUT_MS });
    },
);
