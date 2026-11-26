import { CLOUD_RUN_FREE_TIER, PROVISION_ITEMS, PROVISION_SET_VERSION, usageMonth, WORKER_WAIT_MINUTES } from '@hcm/shared';
import { readFileSync } from 'node:fs';

import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import type { Download, Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { SetupPage } from '../../support/setup-page.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { E2E_PROJECT_ID } from '../../world.js';
import { readyImagery } from './world.js';

// One admin test at a time: the image's digest is in `setup/status`, the project's singleton.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * "Run on my computer" in the admin (docs/research/M7-local-worker.md §1.1, §3, §4, §7; behaviours A62, A63): the Jobs page
 * and the pipeline card show the city's computer, the docker command with the pipeline image's digest, the city's choice
 * and this month's Cloud Run use; a version whose job holds no run says where it runs and moves it (`imagery.runOn` in the
 * Functions emulator, with the dispatcher's place and free-tier wait behind it).
 *
 * The month's use is counted by the server's clock (the wall clock of the Functions emulator), so the spec names the
 * month and the worker's last sight from the same clock: `NOW`, read once.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date();
const MONTH = usageMonth(NOW);
const DIGEST = `sha256:${'e7'.repeat(32)}`;
const WORKER = 'w-0123456789abcdef';
const SCENE = { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' } as const;
const LAYER = 'kh-4a-corona-1966';

function text(lang: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(lang, key, params);
}

/** "Use this computer"'s words (finding 72, the `worker-local` chunk's catalogue). */
function local(lang: 'ro' | 'en', key: AdminWorkerLocalKey): string {
    return translateAdminWorkerLocal(lang, key);
}

/** A whole number as the page writes it. */
function count(lang: 'ro' | 'en', value: number): string {
    return new Intl.NumberFormat(lang).format(value);
}

/**
 * `setup/status` as a project with its pipeline installed: billing and the project prepared (so the pipeline's card is
 * open to its body) and the pipeline's record, with the image's digest unless `image` is false.
 */
async function recordPipeline(imagery: ImageryWorld, image = true): Promise<void> {
    const ok = { state: 'ok', checkedAt: NOW };
    const pipeline = { state: 'installed', release: '1.0.0', checkedAt: NOW.toISOString(), ...(image ? { image: DIGEST } : {}) };
    await imagery.cityWorld.emulators.updateFields(
        'setup/status',
        {
            billing: { ...ok, budgetAmount: 5, currency: 'USD' },
            provision: { ...ok, items: PROVISION_ITEMS.map((id) => ({ id, ...ok })), setVersion: PROVISION_SET_VERSION },
            install: { pipeline },
        },
        ['billing', 'provision', 'install'],
    );
}

/** The city's worker, last seen `secondsAgo` before `NOW`, its last job done. */
async function seedWorker(imagery: ImageryWorld, uid: string, secondsAgo: number): Promise<void> {
    const seen = new Date(NOW.getTime() - secondsAgo * 1000);
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${WORKER}`, {
        ...{ uid, version: '1.0.0', startedAt: seen, lastSeenAt: seen, state: 'idle' },
        lastJob: { id: 'done-1', outcome: 'done', at: seen },
        ...{ updatedBy: 'system:worker', updatedAt: seen },
    });
}

/** This month's Cloud Run use (the server's month). */
async function seedUsage(imagery: ImageryWorld, vcpuSeconds: number, gibSeconds: number): Promise<void> {
    await imagery.cityWorld.emulators.setDocument(`usage/cloudrun-${MONTH}`, {
        ...{ month: MONTH, vcpuSeconds, gibSeconds, runs: 3 },
        ...{ updatedBy: 'system:imagery', updatedAt: NOW },
    });
}

/** A queued import placed in the cloud, and its version (the dispatcher then decides its wait). */
async function seedQueued(imagery: ImageryWorld, id: string, owner: string): Promise<void> {
    await imagery.seedVersion(
        id,
        {
            ...{ layerId: LAYER, origin: 'usgs', state: 'processing', year: 1966, date: '1966-07-12', sensor: 'KH-4A' },
            source: { kind: 'usgs', ...SCENE, acquisitionDate: '1966-07-12' },
            label: { ro: 'KH-4A Corona, 12 iulie 1966', en: 'KH-4A Corona, 12 July 1966' },
        },
        NOW,
    );
    await imagery.seedJob(
        id,
        { type: 'usgs-import', status: 'queued', params: { ...SCENE }, layerId: LAYER, versionId: id, runOn: 'cloud', createdBy: owner },
        NOW,
    );
}

/**
 * The one-line command the panel shows on this (Linux) browser (finding 66): the old worker removed, the new one detached,
 * named and restarted with the computer, the named volume, the image by digest, and (finding 67) a fresh pairing code.
 */
function commandPattern(city: string): RegExp {
    const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const fixed =
        'docker rm -f hcm-worker 2>&1 | true; docker run -d --name hcm-worker --restart unless-stopped ' +
        `-p 127.0.0.1:8765:8765 -v hcm-worker:/work us-central1-docker.pkg.dev/${E2E_PROJECT_ID}/hcm/pipeline@${DIGEST} ` +
        `worker --city ${city} --project ${E2E_PROJECT_ID} --pair `;
    return new RegExp(`^${escaped(fixed)}[a-z2-7]{26}$`);
}

function panel(page: Page): Locator {
    return page.locator('hcm-worker-panel');
}

/** Opens Advanced (the copyable command, finding 66) in `scope`'s computer part, which mints the command's code. */
async function openAdvanced(scope: Locator, lang: 'ro' | 'en'): Promise<Locator> {
    await scope.getByText(local(lang, 'adminWorkerLocal.advanced')).click();
    return scope.locator('hcm-worker-local pre');
}

/** The text of a file the browser saved. */
async function savedText(download: Download): Promise<string> {
    return readFileSync(await download.path(), 'utf8');
}

function place(page: Page): Locator {
    return page.locator('hcm-run-place');
}

test(
    'The Jobs page and the pipeline card show the connected computer, the command, the choice and the month',
    { tag: ['@S-A62-HAPPY-PANEL', '@S-A62-HAPPY-PANEL-ALIGNED', '@S-A63-HAPPY-METER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedWorker(imagery, owner, 60);
        await seedUsage(imagery, 12_345, 45_678);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

        await page.goto(adminPath(lang, 'jobs'));
        const shown = panel(page);
        await expect(shown.getByText(text(lang, 'adminWorker.connected', { when: '' }).split(':')[0] ?? '')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(shown.getByText(text(lang, 'adminWorker.lastDone', { when: '' }).split(':')[0] ?? '')).toBeVisible();
        // Finding 72: the computer's part leads with Use this computer; the command waits behind Advanced.
        await expect(shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.getDocker') })).toHaveAttribute(
            'href',
            'https://docs.docker.com/get-started/get-docker/',
        );
        const pre = await openAdvanced(shown, lang);
        await expect(pre).toHaveText(commandPattern(imagery.city), { timeout: FUNCTIONS_TIMEOUT_MS });
        const command = (await pre.textContent()) ?? '';
        await expect(shown.getByText(local(lang, 'adminWorkerLocal.notePair'))).toBeVisible();
        await expect(shown.getByRole('radio', { name: text(lang, 'adminWorker.choice.auto') })).toHaveAttribute('aria-checked', 'true');
        const use = text(lang, 'adminWorker.meterUse', {
            ...{ vcpu: count(lang, 12_345), vcpuFree: count(lang, CLOUD_RUN_FREE_TIER.vcpuSeconds) },
            ...{ gib: count(lang, 45_678), gibFree: count(lang, CLOUD_RUN_FREE_TIER.gibSeconds) },
        });
        await expect(shown.getByText(use)).toBeVisible();
        await expect(shown.getByText(text(lang, 'adminWorker.meter'))).toBeVisible();
        // Finding 81, batch 4: the panel is a full-width card above the list; its heading lines up with the card's own title.
        const summary = await page.locator('hcm-jobs-page details[data-computer] > summary').boundingBox();
        const title = await shown.getByRole('heading', { name: text(lang, 'adminWorker.title') }).boundingBox();
        const list = await page.locator('hcm-jobs-page hcm-list-detail').boundingBox();
        expect(title?.x).toBeCloseTo((summary?.x ?? Number.NaN) + 16, 0);
        expect((summary?.y ?? Number.NaN) + (summary?.height ?? 0)).toBeLessThanOrEqual(list?.y ?? Number.NaN);
        await expectStateSound(page, adminVisit('worker.panel-connected', lang));

        // Copy puts the command on the clipboard and says so in a polite region.
        await shown.getByRole('button', { name: local(lang, 'adminWorkerLocal.copy') }).click();
        await expect(shown.getByRole('status').filter({ hasText: local(lang, 'adminWorkerLocal.copied') })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

        // The pipeline card shows the same panel and the same month.
        const setup = new SetupPage(page, lang);
        await page.goto(adminPath(lang, 'setup/pipeline'));
        const card = await setup.show('pipeline');
        await expect(card.locator('hcm-worker-panel').getByText(use)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(card.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.setup-panel', lang));
        // Setup's analytics card asks for its stream's settings, which this world's project has none of (a 400 the browser logs).
        consoleErrors.takeMatching(/setup-analyticsConfig/);
    },
);

test(
    'Without a recorded image digest the panel asks to update the pipeline and shows no command',
    { tag: ['@S-A62-BAD-NO-IMAGE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery, false);

        await page.goto(adminPath(lang, 'jobs'));
        const shown = panel(page);
        await expect(shown.getByText(text(lang, 'adminWorker.noImage'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.getByRole('link', { name: text(lang, 'adminWorker.openSetup') })).toHaveAttribute('href', '#/setup/pipeline');
        await expect(shown.locator('pre')).toHaveCount(0);
        await expect(shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') })).toHaveCount(0);
        await expectStateSound(page, adminVisit('worker.panel-no-image', lang));
    },
);

test(
    'A run past the free tier waits for the OK; the computer instead sets the city choice and waits for it',
    { tag: ['@S-A63-BAD-OVER-FREE-TIER', '@S-A62-HAPPY-CHOICE', '@S-A62-BAD-NO-WORKER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(180_000);
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        // No computer seen for ten minutes; the month's use already near the free tier, so any cloud run would pass it.
        await seedWorker(imagery, owner, 600);
        const used = { vcpu: CLOUD_RUN_FREE_TIER.vcpuSeconds - 1000, gib: CLOUD_RUN_FREE_TIER.gibSeconds - 1000 };
        await seedUsage(imagery, used.vcpu, used.gib);
        await seedQueued(imagery, 'ok-1', owner);
        await seedQueued(imagery, 'local-1', owner);
        for (const id of ['ok-1', 'local-1']) {
            await expect.poll(async () => (await imagery.job(id))?.['waitReason'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('free-tier');
        }

        // The panel: no computer connected.
        await page.goto(adminPath(lang, 'jobs'));
        await expect(panel(page).getByText(text(lang, 'adminWorker.none'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.panel-none', lang));

        // The version waiting for the OK: its estimate and the month's use; Run in Google Cloud anyway dispatches it.
        await page.goto(adminPath(lang, 'imagery/version/ok-1'));
        const waiting = place(page);
        const estimate = text(lang, 'adminWorker.estimate', { vcpu: count(lang, 7200), gib: count(lang, 28_800) });
        await expect(waiting.getByText(estimate)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(waiting.getByText(text(lang, 'adminWorker.freeTier'))).toBeVisible();
        await expect(waiting.getByText(text(lang, 'adminWorker.meter'))).toBeVisible();
        await expectStateSound(page, adminVisit('worker.place-free-tier', lang));
        await waiting.getByRole('button', { name: text(lang, 'adminWorker.runCloudAnyway') }).click();
        await expect
            .poll(async () => (await imagery.job('ok-1'))?.['freeTierOk'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ by: owner });
        await expect.poll(async () => (await imagery.runs()).length, { timeout: FUNCTIONS_TIMEOUT_MS }).toBeGreaterThan(0);

        // The other one goes to the computer: it waits for it, and the city's choice is the computer from now on.
        await page.goto(adminPath(lang, 'imagery/version/local-1'));
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runLocal') })
            .click();
        await expect(place(page).getByText(text(lang, 'adminWorker.waitWorker'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        expect(await imagery.job('local-1')).toMatchObject({ runOn: 'local', waitReason: 'worker' });
        expect(await adminWorld.emulators.document(`cities/${imagery.city}/workers/choice`)).toMatchObject({ choice: 'local' });
        await expect(place(page).getByRole('link', { name: text(lang, 'adminWorker.startWorker') })).toHaveAttribute('href', '#/jobs');
        await expectStateSound(page, adminVisit('worker.place-worker', lang));

        // No computer comes: Run in Google Cloud moves it back to the cloud.
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runCloud') })
            .click();
        await expect.poll(async () => (await imagery.job('local-1'))?.['runOn'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cloud');
        // Past the free tier without the OK it waits again: no run of it was asked for.
        await expect.poll(async () => (await imagery.job('local-1'))?.['waitReason'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('free-tier');
        expect((await imagery.runs()).map((run) => run.jobId)).not.toContain('local-1');
    },
);

test(
    "A connected computer's job shows its step live, an outdated one is told to update, and Disconnect revokes it",
    { tag: ['@S-A62-HAPPY-DISCONNECT', '@S-A62-BAD-WORKER-OUTDATED', '@S-A62-HAPPY-PROGRESS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedQueued(imagery, 'busy-1', owner);
        await imagery.cityWorld.emulators.updateFields(
            `cities/${imagery.city}/jobs/busy-1`,
            { status: 'running', runOn: 'local', step: 'georef', progress: 0.4 },
            ['status', 'runOn', 'step', 'progress'],
        );
        await seedWorker(imagery, owner, 10);
        const workerPath = `cities/${imagery.city}/workers/${WORKER}`;
        await imagery.cityWorld.emulators.updateFields(workerPath, { state: 'busy', jobId: 'busy-1' }, ['state', 'jobId']);

        // Finding 68: the job it works on, with its step and how far it got, live.
        await page.goto(adminPath(lang, 'jobs'));
        const said = text(lang, 'adminWorker.progress', { step: 'georef', percent: '40' });
        await expect(panel(page).locator('[data-progress]')).toHaveText(said, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.panel-progress', lang));
        await imagery.cityWorld.emulators.updateFields(`cities/${imagery.city}/jobs/busy-1`, { progress: 0.8 }, ['progress']);
        await expect(panel(page).locator('[data-progress]')).toHaveText(
            text(lang, 'adminWorker.progress', { step: 'georef', percent: '80' }),
        );

        // Finding 67: the pipeline was updated since the computer's command: it takes no job until the command runs again.
        await imagery.cityWorld.emulators.updateFields(workerPath, { state: 'idle', outdated: true }, ['state', 'jobId', 'outdated']);
        await expect(panel(page).locator('[data-outdated]')).toHaveText(text(lang, 'adminWorker.outdated', { version: '1.0.0' }), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.panel-outdated', lang));

        // Disconnect this computer: its worker (and the pairing it signed in with) refused from now on.
        await panel(page)
            .getByRole('button', { name: text(lang, 'adminWorker.disconnect') })
            .click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(workerPath))?.['revokedAt'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeDefined();
        await expect(panel(page).getByText(text(lang, 'adminWorker.disconnected'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(panel(page).getByText(text(lang, 'adminWorker.none'))).toBeVisible();
    },
);

test(
    'A connected computer says what its local AI runs on, or why it cannot',
    { tag: ['@S-A68-HAPPY-DEVICE-SHOWN', '@S-A68-BAD-AI-UNAVAILABLE', '@S-A68-BAD-OLD-STARTER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedWorker(imagery, owner, 10);
        const workerPath = `cities/${imagery.city}/workers/${WORKER}`;
        const ready = { state: 'ready', device: 'gpu', deviceName: 'NVIDIA RTX 3080' };
        await imagery.cityWorld.emulators.updateFields(workerPath, { ai: ready }, ['ai']);

        await page.goto(adminPath(lang, 'jobs'));
        await expect(panel(page).locator('[data-ai="ready"]')).toHaveText(text(lang, 'adminWorker.ai.gpu', { name: 'NVIDIA RTX 3080' }), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.panel-ai-gpu', lang));

        await imagery.cityWorld.emulators.updateFields(workerPath, { ai: { state: 'unavailable', why: 'disk' } }, ['ai']);
        await expect(panel(page).locator('[data-ai="unavailable"]')).toHaveText(
            text(lang, 'adminWorker.ai.unavailable', { why: text(lang, 'adminWorker.ai.why.disk') }),
            { timeout: FUNCTIONS_TIMEOUT_MS },
        );
        await expectStateSound(page, adminVisit('worker.panel-ai-unavailable', lang));

        // M18 item 9: an old starter file says the one action (Use this computer, on the same panel) and what it unlocks.
        await imagery.cityWorld.emulators.updateFields(workerPath, { ai: { state: 'unavailable', why: 'old-starter' } }, ['ai']);
        await expect(panel(page).locator('[data-ai="old-starter"]')).toHaveText(text(lang, 'adminWorker.ai.oldStarter'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.panel-ai-old-starter', lang));
    },
);

test(
    'A job no computer came for offers Run in Google Cloud instead, which moves it there in one click',
    { tag: ['@S-A62-HAPPY-NO-WORKER-OFFER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);
        await seedQueued(imagery, 'late-1', owner);
        // What imagery.tick leaves on a local job that waited WORKER_WAIT_MINUTES with no computer seen (finding 68).
        await imagery.cityWorld.emulators.updateFields(
            `cities/${imagery.city}/jobs/late-1`,
            { runOn: 'local', waitReason: 'worker', workerOverdueAt: NOW },
            ['runOn', 'waitReason', 'workerOverdueAt'],
        );

        await page.goto(adminPath(lang, 'imagery/version/late-1'));
        const overdue = text(lang, 'adminWorker.waitOverdue', { minutes: String(WORKER_WAIT_MINUTES) });
        await expect(place(page).locator('[data-overdue]')).toHaveText(overdue, { timeout: FUNCTIONS_TIMEOUT_MS });
        await expectStateSound(page, adminVisit('worker.place-overdue', lang));
        await place(page)
            .getByRole('button', { name: text(lang, 'adminWorker.runCloudInstead') })
            .click();

        await expect.poll(async () => (await imagery.job('late-1'))?.['runOn'], { timeout: FUNCTIONS_TIMEOUT_MS }).toBe('cloud');
        expect(await imagery.job('late-1')).not.toHaveProperty('workerOverdueAt');
    },
);

test(
    "Use this computer gives the starter file for the browser's system, and Stop using this computer the file that removes it",
    {
        tag: [
            '@S-A62-HAPPY-STARTER',
            '@S-A62-HAPPY-STOP-COMPUTER',
            '@S-A62-BAD-STARTER-TEMPLATE',
            '@S-A62-BAD-FIND-COMPUTER',
            '@S-A62-HAPPY-LOOKING-AFTER-RELOAD',
            '@S-A62-BAD-NOT-SET-UP-AFTER-RELOAD',
        ],
    },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        // Finding 72 of 2026-11-02 ("I should not have to copy and paste"): one file, opened once, sets the computer up.
        // Finding 73 of 2026-11-03: a link the owner clicks, which the server's worker.starter answers as a download.
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await recordPipeline(imagery);

        await page.goto(adminPath(lang, 'jobs'));
        const shown = panel(page);
        // Finding 75: a computer set up another way is looked for, with no file; nothing answers here, so it says so.
        await shown.getByRole('button', { name: local(lang, 'adminWorkerLocal.find') }).click({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.looking'));
        await expect(shown.getByRole('button', { name: local(lang, 'adminWorkerLocal.find') })).toHaveCount(0);
        await expectStateSound(page, adminVisit('worker.local-looking', lang));
        // A reload still looks: it never says a file was just saved, which nobody downloaded.
        await page.reload();
        await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.looking'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.locator('[data-open]')).toHaveCount(0);
        await page.evaluate(() => {
            localStorage.clear();
        });
        await page.reload();
        const use = shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') });
        await expect(use).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        // A browser that set nothing up looks for nothing after a reload, and offers both ways.
        await expect(shown.locator('[data-local]')).toHaveText('');
        await expect(shown.getByRole('button', { name: local(lang, 'adminWorkerLocal.find') })).toBeVisible();
        await expect(use).toHaveAttribute('href', /\/worker-starter\?city=[a-z0-9-]+&os=linux&action=install$/);
        const linux = page.waitForEvent('download');
        await use.click();
        const starter = await linux;
        expect(starter.suggestedFilename()).toBe('hcm-worker.sh');
        const script = await savedText(starter);
        expect(script).toContain(`HCM_PROJECT='${E2E_PROJECT_ID}'`);
        expect(script).toContain(`HCM_CITY='${imagery.city}'`);
        expect(script).toContain("HCM_ACTION='install'");
        expect(script).not.toMatch(/__HCM_|--pair/);
        // After the click: the browser may ask to keep it, where it is saved, and on Linux the line that runs it.
        await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.saved'));
        await expect(shown.locator('[data-open="linux"]')).toHaveText(local(lang, 'adminWorkerLocal.open.linux'));
        await expect(shown.getByLabel(local(lang, 'adminWorkerLocal.runCommand'))).toHaveText('sh ~/Downloads/hcm-worker.sh');
        await expectStateSound(page, adminVisit('worker.local-downloaded', lang));

        // Windows: the .bat that calls PowerShell, with Windows' line ends.
        await shown.getByRole('radio', { name: local(lang, 'adminWorkerLocal.os.windows') }).click();
        const windows = page.waitForEvent('download');
        await use.click();
        const bat = await windows;
        expect(bat.suggestedFilename()).toBe('hcm-worker.bat');
        expect(await savedText(bat)).toContain(`set "HCM_CITY=${imagery.city}"\r\n`);
        await expect(shown.locator('[data-open="windows"]')).toHaveText(local(lang, 'adminWorkerLocal.open.windows'));

        // Stop using this computer: the same file, set to remove the worker.
        await shown.getByRole('radio', { name: local(lang, 'adminWorkerLocal.os.linux') }).click();
        const removal = page.waitForEvent('download');
        await shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.stop') }).click();
        const remover = await removal;
        expect(remover.suggestedFilename()).toBe('hcm-worker-remove.sh');
        expect(await savedText(remover)).toContain("HCM_ACTION='uninstall'");
        await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.stopped'));

        // A server that does not make the file yet (one from before this release): no link, and the panel says so.
        await page.route('**/worker-starter?**', (route) => route.fulfill({ status: 404, body: '' }));
        await page.reload();
        await expect(shown.locator('[data-starter-missing]')).toHaveText(local(lang, 'adminWorkerLocal.failed'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') })).toHaveCount(0);
        await openAdvanced(shown, lang);
        await expect(shown.getByLabel(local(lang, 'adminWorkerLocal.command'))).toHaveText(commandPattern(imagery.city), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expectStateSound(page, adminVisit('worker.local-advanced', lang));
        // The starter refused on purpose, and the auto-pair's looks at this computer, where no worker runs in this test
        // (the browser logs a refused connection; worker-run.spec.ts pairs a real one).
        consoleErrors.takeMatching(/worker-starter|127\.0\.0\.1:8765/);
    },
);
