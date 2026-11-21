import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { WORKER_PORT } from '@hcm/shared';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { REPO_ROOT } from '../../support/imagery-runner.js';
import { LocalWorker } from '../../support/imagery-worker.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { E2E_PROJECT_ID } from '../../world.js';
import { FRAME_CITY, generateScene, SYNTHETIC_SCENE } from './synthetic.js';
import { awaitHarvest, cardImport, closeImportNotice, IMAGERY_AT, readyImagery, stepRow, stepStateText, versionIdOf } from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * "Run on my computer" for real (docs/research/M7-local-worker.md §1–§3, §5; S-A62-HAPPY-WORKER-RUN): the city's choice is
 * the computer, so the 1966 frame imported with Import on its card waits for a worker. The pipeline's own worker process
 * (`python -m hcm_pipeline worker --emulators`, the quality image's pipeline venv) is then started with the command the
 * Jobs page shows (finding 67 of 2026-11-02): its one-time pairing code (`--pair`), which the worker exchanges through
 * `worker.pair` for a custom token of the owner and signs in with at the Auth emulator: no browser, no `POST /session`.
 * It claims the job through `worker.claim`, runs every step of the import unchanged against the synthetic scene, writes the documents
 * through `worker.step` and the version's files through signed URLs to the Storage emulator, and reports the end. The
 * city's imagery settings do not publish on their own, so the version stops where a person approves it.
 *
 * The raw delivery stays on the computer: it is downloaded into the work folder and deleted there once `locate` has the
 * city crop (§5); neither it nor the scratch (`work/`) is ever an object of the bucket, and no Cloud Run execution is asked.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const STEPS = ['fetch', 'extract', 'stitch', 'locate', 'georef', 'warp', 'export'] as const;
const DIGEST = `sha256:${'e7'.repeat(32)}`;
/** The pairing code of the command the panel shows (finding 67). */
const PAIR = /--pair ([a-z2-7]{26})$/;

function text(lang: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(lang, key, params);
}

function local(lang: 'ro' | 'en', key: AdminWorkerLocalKey): string {
    return translateAdminWorkerLocal(lang, key);
}

/** The first sentence of a text with a `{when}`, which the page fills with a relative time. */
function lead(lang: 'ro' | 'en', key: AdminWorkerKey): string {
    return text(lang, key, { when: '' }).split(':')[0] ?? '';
}

/** Advanced's command on the Jobs page (finding 66; behind Advanced since finding 72), and its one-time pairing code. */
async function commandOfJobsPage(page: Page, lang: 'ro' | 'en'): Promise<{ readonly command: string; readonly code: string }> {
    await page.goto(adminPath(lang, 'jobs'));
    const shown = page.locator('hcm-worker-panel');
    await shown.getByText(local(lang, 'adminWorkerLocal.advanced')).click({ timeout: FUNCTIONS_TIMEOUT_MS });
    const pre = shown.locator('hcm-worker-local pre');
    await expect(pre).toContainText('--pair ', { timeout: FUNCTIONS_TIMEOUT_MS });
    const command = (await pre.textContent()) ?? '';
    return { command, code: PAIR.exec(command)?.[1] ?? '' };
}

/** The worker's page state (`GET /state`), once it says `field` is `value`. */
async function stateOnce(request: APIRequestContext, origin: string, field: string, value: unknown): Promise<Record<string, unknown>> {
    let state: Record<string, unknown> = {};
    await expect
        .poll(
            async () => {
                state = (await (await request.get(`${origin}/state`)).json()) as Record<string, unknown>;
                return state[field];
            },
            { timeout: FUNCTIONS_TIMEOUT_MS },
        )
        .toEqual(value);
    return state;
}

/** M26: the profile the owner chose, as the worker's `/state` says it. */
function chosenOf(state: Record<string, unknown>): unknown {
    const machine = state['machine'] as { readonly profile?: { readonly chosen?: unknown } } | null | undefined;
    return machine?.profile?.chosen;
}

/** The files under `folder` (relative to it), or none when it does not exist. */
function filesUnder(folder: string): string[] {
    return existsSync(folder) ? readdirSync(folder, { recursive: true, encoding: 'utf8' }) : [];
}

/** The Jobs page's worker panel shows the computer connected, its last job done. */
async function expectPanelIdle(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.goto(adminPath(lang, 'jobs'));
    const panel = page.locator('hcm-worker-panel');
    await expect(panel.getByText(lead(lang, 'adminWorker.connected'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await expect(panel.getByText(lead(lang, 'adminWorker.lastDone'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
}

/**
 * Advanced's command (finding 66) on another computer (an empty work folder): its one-time code pairs a worker once; the
 * same code on a third computer is refused, it worked once (S-A62-BAD-PAIR-REUSED).
 */
async function advancedCodeWorksOnce(
    page: Page,
    lang: 'ro' | 'en',
    request: APIRequestContext,
    testInfo: TestInfo,
    city: string,
): Promise<void> {
    const { command, code } = await commandOfJobsPage(page, lang);
    expect(command).toContain('docker rm -f hcm-worker');
    expect(command).toContain('--restart unless-stopped');
    expect(command).toContain(`-v hcm-worker:/work us-central1-docker.pkg.dev/${E2E_PROJECT_ID}/hcm/pipeline@${DIGEST} `);
    expect(code).toMatch(/^[a-z2-7]{26}$/);
    const second = testInfo.outputPath('work-second');
    mkdirSync(second, { recursive: true });
    const paired = LocalWorker.start(city, second, code);
    try {
        await stateOnce(request, await paired.origin(), 'signedIn', true);
        expect(paired.output()).not.toContain(code);
    } finally {
        await paired.stop();
    }
    const fresh = testInfo.outputPath('work-other');
    mkdirSync(fresh, { recursive: true });
    const other = LocalWorker.start(city, fresh, code);
    try {
        const refused = await stateOnce(request, await other.origin(), 'lastError', 'apiError.worker.pairCode');
        expect(refused).toMatchObject({ signedIn: false });
    } finally {
        await other.stop();
    }
}

test(
    "The real worker on the owner's computer claims a local import, runs it and keeps the raw scan local",
    { tag: ['@S-A62-HAPPY-WORKER-RUN', '@S-A62-HAPPY-PAIR', '@S-A62-BAD-PAIR-REUSED', '@S-A62-HAPPY-AUTO-PAIR', '@S-A142-HAPPY-VERSIONS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, request, consoleErrors }, testInfo) => {
        test.setTimeout(600_000);
        const owner = adminWorld.accounts.owner;
        const { emulators } = adminWorld;
        const imagery = await readyImagery({ emulators, api: mockApiRequest, upstream }, owner.uid, { autoPublish: false });
        const dir = testInfo.outputPath('synthetic');
        const corners = generateScene(dir);
        await imagery.useSyntheticScene(relative(REPO_ROOT, dir));
        // The pipeline is installed with its image (the panel's command), and the city's new jobs run on the computer.
        const pipeline = { state: 'installed', release: '1.0.0', checkedAt: IMAGERY_AT.toISOString(), image: DIGEST };
        await emulators.updateFields('setup/status', { install: { pipeline } }, ['install']);
        await emulators.setDocument(`cities/${imagery.city}/workers/choice`, {
            ...{ choice: 'local', updatedBy: owner.uid, updatedAt: IMAGERY_AT },
        });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        await emulators.updateFields(`cities/${imagery.city}/usgsScenes/${SYNTHETIC_SCENE}`, { corners }, ['corners']);
        await emulators.updateFields(`cities/${imagery.city}`, { bounds: FRAME_CITY }, ['bounds']);

        // Import: the job is placed on the computer and waits for it; the version says so.
        await cardImport(page, lang, SYNTHETIC_SCENE).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await closeImportNotice(page, lang);
        const versionId = versionIdOf(page);
        await expect
            .poll(
                async () => {
                    const job = await imagery.job(versionId);
                    return [job?.['runOn'], job?.['waitReason'], job?.['status']];
                },
                { timeout: FUNCTIONS_TIMEOUT_MS },
            )
            .toEqual(['local', 'worker', 'queued']);
        await expect(page.locator('hcm-run-place').getByText(text(lang, 'adminWorker.waitWorker'))).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });

        // The starter file's supervisor starts the worker on its own port with no code; the owner clicks Use this computer on the
        // Jobs page, and the admin pairs this computer by itself (finding 72): no code on screen, nothing pasted.
        const versionUrl = page.url();
        const work = testInfo.outputPath('work');
        mkdirSync(work, { recursive: true });
        const worker = LocalWorker.start(imagery.city, work, undefined, WORKER_PORT);
        try {
            const origin = await worker.origin();
            await stateOnce(request, origin, 'pairable', true);
            await page.goto(adminPath(lang, 'jobs'));
            const shown = page.locator('hcm-worker-panel');
            const saved = page.waitForEvent('download');
            await shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.use') }).click({ timeout: FUNCTIONS_TIMEOUT_MS });
            expect((await saved).suggestedFilename()).toBe('hcm-worker.sh');
            await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.connected'), {
                timeout: FUNCTIONS_TIMEOUT_MS,
            });
            const signedIn = await stateOnce(request, origin, 'signedIn', true);
            expect(signedIn).toMatchObject({ city: imagery.city, lastError: null, outdated: false, pairable: false });
            await expect(shown.locator('hcm-worker-local pre')).not.toContainText('--pair');
            await expectStateSound(page, adminVisit('worker.local-connected', lang));
            // M26 (S-A141-HAPPY): This computer's card, and the owner's Quiet kept by the worker on this computer.
            const card = shown.locator('hcm-worker-machine');
            await card
                .getByRole('radio', { name: local(lang, 'adminWorkerLocal.machine.choice.quiet') })
                .click({ timeout: FUNCTIONS_TIMEOUT_MS });
            await expect
                .poll(async () => chosenOf(await stateOnce(request, origin, 'signedIn', true)), { timeout: FUNCTIONS_TIMEOUT_MS })
                .toBe('quiet');
            await expect(card.locator('[data-machine]')).toContainText(local(lang, 'adminWorkerLocal.machine.why.owner'));
            // S-A142-HAPPY-VERSIONS: the worker's /state says its versions; this worker, started with no starter file, has no helper to
            // update and runs the installed image.
            await expect(card.locator('[data-versions-worker]')).toHaveAttribute('data-versions-worker', 'current');
            await expect(card.locator('[data-versions-starter]')).toHaveText(local(lang, 'adminWorkerLocal.versions.byCommand'));
            await expectStateSound(page, adminVisit('worker.local-machine', lang));
            // The session is kept in the work folder (the named volume), readable by the worker's user only.
            expect(filesUnder(work).filter((name) => name.startsWith('.hcm-session-'))).toEqual([`.hcm-session-${imagery.city}.json`]);
            await page.goto(versionUrl);

            // It claims the job and runs every step of the import.
            for (const step of STEPS) {
                await expect(stepRow(page, lang, step)).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS * 2 });
            }
            await expect
                .poll(async () => (await imagery.version(versionId))?.['state'], { timeout: FUNCTIONS_TIMEOUT_MS })
                .toBe('awaiting_approval');
            // The version is told first (by the last step), the job by the run's final write after it.
            await expect
                .poll(async () => (await imagery.job(versionId))?.['status'], { timeout: FUNCTIONS_TIMEOUT_MS })
                .toBe('awaiting_approval');
            const job = (await imagery.job(versionId)) ?? {};
            expect(job).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval', runOn: 'local' });
            expect((job['worker'] as { id?: string } | undefined)?.id).toMatch(/^w-[0-9a-f]{16}$/);
            // No Cloud Run execution was asked for: the job never named one, nor a machine.
            expect(job['executionName']).toBeUndefined();
            expect(job['machine']).toBeUndefined();

            // The version's files are in the bucket; the delivery and the scratch never were.
            const files = await emulators.objectNames(`rasters/${imagery.city}/`);
            for (const name of ['scan.tif', 'cog.tif', 'preview.png', 'studio.tif']) {
                expect(files).toContain(`rasters/${imagery.city}/${String(job['layerId'])}/${versionId}/${name}`);
            }
            expect(await emulators.objectNames('usgs-raw/')).toEqual([]);
            expect(await emulators.objectNames('work/')).toEqual([]);
            // On the computer: the delivery was downloaded there. This synthetic city is too small to prove (M9 §14), so it went through the
            // matcher, and a frame nothing proved keeps its delivery (M9 §6); a proved one's goes (S-P06-HAPPY-VOTES).
            const fetched = String((job['steps'] as Record<string, { gcsPath?: string }>)['fetch']?.gcsPath);
            expect(fetched).toMatch(/^usgs-raw\//);
            expect((await imagery.version(versionId))?.['calibration']).toMatchObject({ how: 'none' });
            expect(existsSync(join(work, fetched))).toBe(true);
            expect(filesUnder(join(work, 'reference')).some((name) => name.endsWith('.tif'))).toBe(true);

            // The worker is idle again, and the admin shows the computer connected with its last job done.
            await expect
                .poll(async () => ((await (await request.get(`${origin}/state`)).json()) as { state?: string }).state, {
                    timeout: FUNCTIONS_TIMEOUT_MS,
                })
                .toBe('idle');
            await expectPanelIdle(page, lang);

            // One Ctrl-C, as the admin guide stops it, ends the worker cleanly (the first signal after a job was once lost:
            // DECISIONS-for-review.md §83j, docs/LESSONS.md 342).
            expect(await worker.stop()).toBe('exit 0');
            expect(worker.output()).toMatch(/worker w-[0-9a-f]{16} stopped/);

            // The supervisor starts it again after a reboot: the kept session signs it in, no new pairing.
            const restarted = LocalWorker.start(imagery.city, work);
            try {
                await stateOnce(request, await restarted.origin(), 'signedIn', true);
            } finally {
                expect(await restarted.stop()).toBe('exit 0');
            }

            await advancedCodeWorksOnce(page, lang, request, testInfo, imagery.city);
        } finally {
            // A test that failed before its stop still ends the worker (a second stop of an ended worker only reads how).
            testInfo.annotations.push({ type: 'worker stop', description: await worker.stop() });
        }
        // The Jobs page's auto-pair kept looking at this computer after its worker stopped (a refused connection).
        consoleErrors.takeMatching(/127\.0\.0\.1:8765/);
    },
);

/** Stand-ins of the Firebase JS SDK's two modules the worker's page loads: a Google popup that never comes back. */
const SDK_STUBS: Readonly<Record<string, string>> = {
    'firebase-app.js': 'export function initializeApp(config) { return { config }; }',
    'firebase-auth.js': [
        'export const inMemoryPersistence = {};',
        'export const browserPopupRedirectResolver = {};',
        'export function initializeAuth() { return {}; }',
        'export function connectAuthEmulator() {}',
        'export class GoogleAuthProvider {}',
        'export function signInWithPopup() { return new Promise(() => {}); }',
        'export function signOut() { return Promise.resolve(); }',
    ].join('\n'),
};

test(
    'A computer set up another way is found with no file, and its worker keeps its id across a restart',
    { tag: ['@S-A62-HAPPY-FIND-COMPUTER'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, request }, testInfo) => {
        // Finding 75 of 2026-11-03: the worker runs, this browser never clicked Use this computer. Finding 77: same id after a restart.
        const owner = adminWorld.accounts.owner;
        const { emulators } = adminWorld;
        const imagery = await readyImagery({ emulators, api: mockApiRequest, upstream }, owner.uid, { autoPublish: false });
        const pipeline = { state: 'installed', release: '1.0.0', checkedAt: IMAGERY_AT.toISOString(), image: DIGEST };
        await emulators.updateFields('setup/status', { install: { pipeline } }, ['install']);
        const work = testInfo.outputPath('work');
        mkdirSync(work, { recursive: true });
        const worker = LocalWorker.start(imagery.city, work, undefined, WORKER_PORT);
        let workerId: unknown;
        try {
            const origin = await worker.origin();
            workerId = (await stateOnce(request, origin, 'pairable', true))['workerId'];
            await page.goto(adminPath(lang, 'jobs'));
            const shown = page.locator('hcm-worker-panel');
            await shown.getByRole('button', { name: local(lang, 'adminWorkerLocal.find') }).click({ timeout: FUNCTIONS_TIMEOUT_MS });
            await expect(shown.locator('[data-local]')).toHaveText(local(lang, 'adminWorkerLocal.connected'), {
                timeout: FUNCTIONS_TIMEOUT_MS,
            });
            await stateOnce(request, origin, 'signedIn', true);
            await expect(shown.getByRole('link', { name: local(lang, 'adminWorkerLocal.getDocker') })).toHaveCount(0);
        } finally {
            expect(await worker.stop()).toBe('exit 0');
        }
        const restarted = LocalWorker.start(imagery.city, work, undefined, WORKER_PORT);
        try {
            const state = await stateOnce(request, await restarted.origin(), 'signedIn', true);
            expect(state['workerId']).toBe(workerId);
        } finally {
            expect(await restarted.stop()).toBe('exit 0');
        }
    },
);

test(
    "The worker page's fallback Google sign-in that never finishes gives up with a message pointing at the admin's command",
    { tag: ['@S-P04-BAD-POPUP-TIMEOUT'] },
    async ({ page }, testInfo) => {
        // Finding 69 of 2026-11-02: on the live project the popup completed but the page stayed "Not signed in", without a
        // word. The page now gives up after 90 seconds and says to choose Use this computer in the admin, which pairs the computer.
        const work = testInfo.outputPath('work');
        mkdirSync(work, { recursive: true });
        const worker = LocalWorker.start('bucharest', work);
        try {
            for (const [file, body] of Object.entries(SDK_STUBS)) {
                await page.route(`https://www.gstatic.com/firebasejs/*/${file}`, (route) =>
                    route.fulfill({ status: 200, contentType: 'text/javascript', body }),
                );
            }
            await page.clock.install();
            await page.goto(`${await worker.origin()}/`);
            const error = page.locator('#error');
            await page.locator('#sign-in').click();
            await page.clock.fastForward(60_000);
            await expect(error).toHaveText('');

            await page.clock.fastForward(31_000);
            await expect(error).toHaveText(/did not finish: choose Use this computer|nu s-a încheiat: alege Folosește acest calculator/);
            // The state polls that follow keep the message (the worker itself has no error to say).
            await page.clock.fastForward(6_000);
            await expect(error).toHaveText(/did not finish|nu s-a încheiat/);
        } finally {
            await worker.stop();
        }
    },
);
