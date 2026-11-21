import { translateAdminArchive, type AdminArchiveKey } from '@hcm/shared/admin-archive';
import { writeFileSync } from 'node:fs';

import type { Locator, Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import type { ImageryWorld } from '../../support/imagery.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { imageryText, readyImagery } from './world.js';

// One admin test at a time: Import counts today's share across the project's jobs.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Import local files in the admin (docs/research/M20-import-local.md §2.1, §8; behaviour A121): the Upload view's card opens the
 * worker's own import page (the computer's loopback, stubbed here: the worker is the boundary, and its report is what it writes,
 * `cities/{city}/archives/{id}`), the report opens by itself, and one Import makes the series' jobs through `imagery.archiveImport`
 * in the Functions emulator. Choosing the files and Import are the owner's only inputs (the admin-input budget: 3).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const NOW = new Date();
const WORKER = 'w-0123456789abcdef';
const ARCHIVE = 'ar-0123456789abcdef';
const SID = (n: number): string => `s-${String(n).padStart(12, '0')}`;
const CLEAR = { licence: 'PD', state: 'clear', year: '1911' } as const;
const UNCONFIRMED = { licence: 'unknown', state: 'needs-confirmation', year: '1977', author: 'IPB' } as const;

function text(lang: 'ro' | 'en', key: AdminArchiveKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminArchive(lang, key, params);
}

function series(n: number, more: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        seriesId: SID(n),
        class: 'grid',
        title: `Planul IGA ${String(1911 + n)}`,
        year: 1911 + n,
        files: 124,
        bytes: 400_000_000,
        action: 'import',
        encoding: 'lineart',
        rights: CLEAR,
        estimate: { maxzoom: 19, tilesBytes: 900_000_000, minutes: 12, auto: 'likely' },
        order: n,
        ...more,
    };
}

const SERIES = [
    series(0),
    series(1, { class: 'single', title: 'IPB 1974', year: 1974, yearLabel: '1962–1978', rights: UNCONFIRMED }),
    series(2, { action: 'skip', reason: 'do-not-publish', title: 'Oltean 1847', year: 1847 }),
];

/** The worker's report, as `worker.archiveReport` writes it. */
async function seedArchive(imagery: ImageryWorld, owner: string, more: Readonly<Record<string, unknown>> = {}): Promise<void> {
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/archives/${ARCHIVE}`, {
        ...{ name: 'harti.zip', source: 'zip', fileCount: 5703, bytes: 9_000_000_000, scannedAt: NOW, workerId: WORKER },
        ...{ series: SERIES, skipped: { 'not-a-map': 50, 'duplicate-of': 10 } },
        ...{ createdBy: owner, updatedBy: owner, updatedAt: NOW },
        ...more,
    });
}

/** The city's worker, last seen `secondsAgo` before `NOW`. */
async function seedWorker(imagery: ImageryWorld, uid: string, secondsAgo: number): Promise<void> {
    const seen = new Date(NOW.getTime() - secondsAgo * 1000);
    await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/workers/${WORKER}`, {
        ...{ uid, version: '1.0.0', startedAt: seen, lastSeenAt: seen, state: 'idle' },
        ...{ updatedBy: 'system:worker', updatedAt: seen },
    });
}

/** The city's share of new layers a day. */
async function shareOf(imagery: ImageryWorld, rasterJobsPerDay: number): Promise<void> {
    const limits = { computeUnitsPerMonth: 1000, rasterJobsPerDay, aiRequestsPerMonth: 100, geocodeCellsPerDay: 100, exportsPerDay: 5 };
    await imagery.cityWorld.emulators.updateFields(`cities/${imagery.city}`, { limits }, ['limits']);
}

async function openUpload(page: Page, lang: 'ro' | 'en'): Promise<Locator> {
    await page.goto(adminPath(lang, 'imagery'));
    await page.getByRole('radio', { name: imageryText(lang, 'adminContent.imagery.tab.upload') }).click();
    return page.locator('hcm-archive-panel');
}

function report(page: Page): Locator {
    return page.locator('hcm-archive-report');
}

/** The admin's own import's archive on the computer (batch 4). */
const LOCAL_ID = 'ar-00000000000000aa';

/** What the worker answers each of the admin's import requests (`pipeline/src/hcm_pipeline/worker/server.py`). */
function loopbackAnswer(path: string): { status: number; body: string } {
    const answers: Readonly<Record<string, [number, unknown]>> = {
        '/import/session': [201, { token: 'f'.repeat(64) }],
        '/import/new': [201, { archiveId: LOCAL_ID }],
        [`/import/${LOCAL_ID}/file`]: [201, { path: 'harti.zip' }],
        [`/import/${LOCAL_ID}/zip`]: [200, { written: 124, refused: 0 }],
        [`/import/${LOCAL_ID}/scan`]: [202, { state: 'scanning' }],
        [`/import/${LOCAL_ID}`]: [200, { state: 'reported', series: 2, skipped: {} }],
    };
    const [status, body] = answers[path] ?? [404, {}];
    return { status, body: JSON.stringify(body) };
}

test(
    'Choose a zip in the Imagery tab, it goes to the worker, the report opens by itself, one Import starts every series past the daily share',
    {
        tag: [
            '@S-A121-HAPPY-PANEL',
            '@S-A121-HAPPY-BUDGET',
            '@S-A121-HAPPY-IMPORT',
            '@S-A121-HAPPY-LOCAL-UNCAPPED',
            '@S-A121-HAPPY-LOCAL-TAB',
        ],
    },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, inputBudget }, testInfo) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedWorker(imagery, owner, 30);
        await shareOf(imagery, 1);
        // Batch 4: the worker on the computer's loopback (the external boundary), as `worker/server.py` answers the admin's own tab.
        const asked: string[] = [];
        await page.context().route('http://127.0.0.1:8765/**', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const cors = {
                'access-control-allow-origin': (await request.headerValue('origin')) ?? '*',
                'access-control-allow-headers': 'content-type, x-hcm-path, x-hcm-session',
                'access-control-allow-private-network': 'true',
            };
            if (request.method() === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: cors });
                return;
            }
            asked.push(`${request.method()} ${url.pathname}`);
            await route.fulfill({ contentType: 'application/json', headers: cors, ...loopbackAnswer(url.pathname) });
        });
        const flow = inputBudget.flow('scan and import a local archive', 3);

        const panel = await openUpload(page, lang);
        const fallback = panel.getByRole('link', { name: text(lang, 'adminArchive.local.fallback') });
        await expect(fallback).toHaveAttribute('href', /^http:\/\/127\.0\.0\.1:8765\/import\?lat=\d+\.\d{4}$/, {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(panel.getByText(text(lang, 'adminArchive.none'))).toBeVisible();
        await expectStateSound(page, adminVisit('archive.panel-worker', lang));
        const zip = testInfo.outputPath('harti.zip');
        writeFileSync(zip, 'PK\u0005\u0006'.padEnd(22, '\u0000'));
        const chooser = page.waitForEvent('filechooser');
        await flow.click(panel.getByRole('button', { name: text(lang, 'adminArchive.local.zip') }));
        await (await chooser).setFiles(zip);
        await expect(panel.getByRole('status').filter({ hasText: text(lang, 'adminArchive.local.done') })).toBeVisible();
        expect(asked).toEqual([
            'POST /import/session',
            'POST /import/new',
            `POST /import/${LOCAL_ID}/file`,
            `POST /import/${LOCAL_ID}/zip`,
            `POST /import/${LOCAL_ID}/scan`,
            `GET /import/${LOCAL_ID}`,
        ]);
        await seedArchive(imagery, owner);

        const shown = report(page);
        await expect(shown.getByRole('heading', { name: 'harti.zip' })).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page).toHaveURL(new RegExp(`#/imagery/archive/${ARCHIVE}$`));
        await expect(shown.getByText(text(lang, 'adminArchive.action.grid', { files: '124' }))).toBeVisible();
        await expect(shown.getByText(text(lang, 'adminArchive.rights.needs-confirmation'))).toBeVisible();
        await expectStateSound(page, adminVisit('archive.report', lang));
        await flow.click(shown.getByRole('button', { name: text(lang, 'adminArchive.import') }));

        // A share of 1 holds neither series (2026-11-09): a local-only job runs free on the computer, outside the daily cap.
        await expect(shown.getByRole('status').filter({ hasText: text(lang, 'adminArchive.imported', { today: '2' }) })).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        await expect(shown.locator('[data-progress]')).toHaveCount(2);
        await expect(shown.getByText(text(lang, 'adminArchive.state.daily'))).toHaveCount(0);
        const archive = await adminWorld.emulators.document(`cities/${imagery.city}/archives/${ARCHIVE}`);
        const jobs = (archive?.['jobs'] ?? {}) as Readonly<Record<string, string>>;
        expect(Object.keys(jobs).toSorted((a, b) => a.localeCompare(b))).toEqual([SID(0), SID(1)]);
    },
);

test(
    'A worker on this computer not signed in for the city refuses the import, and the card says why',
    { tag: ['@S-A121-BAD-LOCAL-TAB'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }, testInfo) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedWorker(imagery, owner, 30);
        await page.context().route('http://127.0.0.1:8765/**', async (route) => {
            const origin = (await route.request().headerValue('origin')) ?? '*';
            const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type' };
            await route.fulfill(
                route.request().method() === 'OPTIONS'
                    ? { status: 204, headers }
                    : { status: 409, headers, contentType: 'application/json', body: '{"error":"notPaired"}' },
            );
        });

        const panel = await openUpload(page, lang);
        const zip = testInfo.outputPath('harti.zip');
        writeFileSync(zip, 'PK');
        const chooser = page.waitForEvent('filechooser');
        await panel.getByRole('button', { name: text(lang, 'adminArchive.local.zip') }).click({ timeout: FUNCTIONS_TIMEOUT_MS });
        await (await chooser).setFiles(zip);

        const why = text(lang, 'adminArchive.local.failed', { why: text(lang, 'adminArchive.local.notPaired') });
        await expect(panel.getByRole('status').filter({ hasText: why })).toBeVisible();
        await expectStateSound(page, adminVisit('archive.panel-local-refused', lang));
        // The browser logs the worker's 409 itself; the card's words are what the owner reads.
        consoleErrors.takeMatching(/8765\/import\/session/);
    },
);

test(
    'With no computer connected the card says to start the worker first and offers no choice of files',
    { tag: ['@S-A121-BAD-NO-WORKER', '@S-A121-BAD-NOT-FOUND'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedWorker(imagery, owner, 600);
        await seedArchive(imagery, owner);

        const panel = await openUpload(page, lang);
        await expect(panel.getByText(text(lang, 'adminArchive.noWorker'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(panel.getByRole('link', { name: text(lang, 'adminArchive.openJobs') })).toHaveAttribute('href', '#/jobs');
        await expect(panel.getByRole('button', { name: text(lang, 'adminArchive.local.zip') })).toHaveCount(0);
        await expect(panel.getByRole('link', { name: /harti\.zip/ })).toHaveAttribute('href', `#/imagery/archive/${ARCHIVE}`);
        await expectStateSound(page, adminVisit('archive.panel-no-worker', lang));

        await page.goto(adminPath(lang, 'imagery/archive/ar-ffffffffffffffff'));
        await expect(report(page).getByText(text(lang, 'adminArchive.notFound'))).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    },
);

test(
    "The owner's title and confirmed rights reach the series' version; a year a layer cannot show stops Import",
    { tag: ['@S-A121-HAPPY-REPORT-EDIT', '@S-A121-BAD-YEAR-EMPTY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedArchive(imagery, owner);

        await page.goto(adminPath(lang, `imagery/archive/${ARCHIVE}`));
        const shown = report(page);
        const year = shown.locator(`#${SID(0)}-year`);
        await year.fill('', { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.getByText(text(lang, 'adminArchive.yearInvalid'))).toBeVisible();
        const importButton = shown.getByRole('button', { name: text(lang, 'adminArchive.import') });
        await expect(importButton).toBeDisabled();
        await expectStateSound(page, adminVisit('archive.report-year-invalid', lang));

        await year.fill('1912');
        await shown.locator(`#${SID(0)}-title`).fill('Planul cadastral 1911–1914');
        await shown.locator(`#${SID(1)}-rights`).fill('Idei Urbane – DocuBucurești');
        await shown.getByRole('button', { name: text(lang, 'adminArchive.rights.confirm') }).click();
        await expect(shown.getByText(text(lang, 'adminArchive.rights.confirmed', { by: 'Idei Urbane – DocuBucurești' }))).toBeVisible();
        await importButton.click();

        await expect(shown.locator('[data-progress]')).toHaveCount(2, { timeout: FUNCTIONS_TIMEOUT_MS });
        const archive = await adminWorld.emulators.document(`cities/${imagery.city}/archives/${ARCHIVE}`);
        const jobs = (archive?.['jobs'] ?? {}) as Readonly<Record<string, string>>;
        expect(await imagery.version(jobs[SID(0)] ?? '')).toMatchObject({ year: 1912, label: { ro: 'Planul cadastral 1911–1914' } });
        expect((await imagery.version(jobs[SID(1)] ?? ''))?.['rights']).toMatchObject({
            licence: 'permission',
            state: 'clear',
            confirmedBy: 'Idei Urbane – DocuBucurești',
        });
    },
);

test(
    'An imported series the placer could not prove waits for points and says why, beside one at work on the computer',
    { tag: ['@S-A121-BAD-LOW-CONFIDENCE', '@S-A121-HAPPY-PROGRESS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const owner = adminWorld.accounts.owner.uid;
        const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, owner);
        await seedArchive(imagery, owner, { jobs: { [SID(0)]: 'ar-points', [SID(1)]: 'ar-running' }, importedBy: owner, importedAt: NOW });
        const params = (n: number) => ({
            archiveId: ARCHIVE,
            seriesId: SID(n),
            class: 'grid',
            sheets: 124,
            encoding: 'lineart',
            order: n,
            referenceLayerIds: [],
        });
        const version = (n: number, state: string, more: Readonly<Record<string, unknown>> = {}) => ({
            ...{ layerId: `plan-${String(n)}`, origin: 'archive', state, year: 1911, label: { ro: `Plan ${String(n)}` } },
            source: { kind: 'archive', archiveId: ARCHIVE, seriesId: SID(n), sheetCount: 124 },
            ...more,
        });
        // The version as the pipeline leaves it (its help is stamped, which `seedVersion`'s check of plain dates cannot read).
        await imagery.cityWorld.emulators.setDocument(`cities/${imagery.city}/layerVersions/ar-points`, {
            ...version(0, 'needs_gcps', { help: { reason: 'low-confidence', note: 'the runner-up agrees too', at: NOW } }),
            ...{ jobId: 'ar-points', createdBy: 'system:imagery', createdAt: NOW, updatedBy: 'system:imagery', updatedAt: NOW },
        });
        await imagery.seedJob(
            'ar-points',
            {
                type: 'archive-series',
                status: 'awaiting_gcps',
                params: params(0),
                versionId: 'ar-points',
                runOn: 'local',
                localOnly: true,
                createdBy: owner,
            },
            NOW,
        );
        await imagery.seedVersion('ar-running', version(1, 'processing'), NOW);
        const running = {
            type: 'archive-series',
            status: 'running',
            step: 'place',
            progress: 0.4,
            params: params(1),
            versionId: 'ar-running',
        };
        await imagery.seedJob('ar-running', { ...running, runOn: 'local', localOnly: true, createdBy: owner }, NOW);

        await page.goto(adminPath(lang, `imagery/archive/${ARCHIVE}`));
        const shown = report(page);
        const points = text(lang, 'adminArchive.state.points', { note: text(lang, 'adminArchive.help.low-confidence') });
        await expect(shown.getByText(points)).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(shown.getByText(text(lang, 'adminArchive.state.running', { step: 'place', percent: '40' }))).toBeVisible();
        await expect(shown.getByRole('button', { name: text(lang, 'adminArchive.import') })).toHaveCount(0);
        await expectStateSound(page, adminVisit('archive.progress', lang));
        await shown.getByRole('link', { name: text(lang, 'adminArchive.openVersion', { title: 'Planul IGA 1911' }) }).click();
        await expect(page).toHaveURL(/#\/imagery\/version\/ar-points$/);
    },
);

test(
    'Settings: drawn maps publish themselves within 60 m by default; the cap changes, and one past its range is said at its field and cannot be saved',
    { tag: ['@S-A121-HAPPY-SETTINGS', '@S-A121-BAD-SETTINGS-RANGE'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );

        await page.goto(adminPath(lang, 'settings/imagery'));
        const cap = page.getByLabel(imageryText(lang, 'adminContent.imagery.settings.mapThresholdMax'));
        await expect(cap).toHaveValue('60', { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(page.getByRole('switch', { name: imageryText(lang, 'adminContent.imagery.settings.mapAutoPublish') })).toBeChecked();
        await expectStateSound(page, adminVisit('archive.settings-maps', lang));
        const save = page.getByRole('button', { name: imageryText(lang, 'adminContent.common.save'), exact: true });

        await cap.fill('500');
        await expect(page.locator('hcm-settings-page .field[data-invalid] #imagery-map-threshold')).toHaveCount(1);
        await expect(save).toBeDisabled();
        await cap.fill('40');
        await save.click();
        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${imagery.city}`))?.['imagery'])
            .toMatchObject({ mapThresholdMaxM: 40 });
    },
);
