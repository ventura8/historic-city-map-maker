import type { Page } from '@playwright/test';

import { contentFlowBudget } from '../../../../packages/admin/src/content/budgets.js';
import { adminContentSecurityPolicy, e2eContentSecurityPolicy } from '../../../../scripts/site/src/admin/csp.js';
import { ADMIN_SHELL_ELEMENT } from '../../../../scripts/site/src/admin/page.js';
import { E2E_CITY_ID } from '../../../fixtures/world.js';
import { OLD_PUSH_WORKER_PATH } from '../../../mock-apis/admin-server.js';
import type { InputBudget } from '../../../support/budget.js';
import { hostingUrl, policyHeaders, serveBucketCity, useStartUpVariant } from '../../../support/hosting.js';
import { mapFacts } from '../../../support/map.js';
import { waitForEngineEvent } from '../../../support/viewer.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { shellText } from '../../support/i18n.js';
import { dialog } from '../../support/ops.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { ADMIN_CONNECT_ORIGINS, ADMIN_ORIGIN, ADMIN_PATH, ADMIN_RUNTIME, ADMIN_URL, ADMIN_WEB_CONFIG } from '../../world.js';
import { AT, cityAddress, ownerCity } from '../assists/world.js';
import { failedItemId, failJob, inboxRow, notifyText } from '../notify/world.js';

// One admin test at a time: the owner's devices, invitations and the server's fake FCM are the project's.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The admin under `/admin/` (behaviour A58; docs/research/M6-interfaces.md §2.3, §2.7): since M6 the public map is the
 * Hosting site's root and the admin lives in its folder, on the same origin (the web configuration, the sign-in and the
 * project's storage stay where they were). Its files, its push worker (scope `/admin/`), its invitation and notification
 * links are all under `/admin/`; an old admin address on the root (`/#/<route>`) still reaches it, while a viewer link
 * on the root opens the map; a push worker a pre-M6 admin left at the root is replaced; and no page gets two security
 * policies.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The test's registration, as the `e2e` build's registrar makes it from `?test=`. */
const TEST_ID = 'S-A58-HAPPY';
/** The project's Hosting address in the emulators' world (`adminUrl` of the functions, `demo-hcm`). */
const PROJECT_ADMIN_URL = 'https://demo-hcm.web.app/admin/';

function deviceSwitch(page: Page, lang: 'ro' | 'en') {
    return page.locator('hcm-inbox-page [data-push]').getByRole('switch', { name: notifyText(lang, 'adminContent.notify.push.turnOn') });
}

/** Runs in the page: the scopes of the service workers registered on this origin. */
function workerScopes(page: Page): Promise<string[]> {
    return page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));
}

/** Notifications on this device, granted: the push worker registered and the device stored. */
async function turnPushOn(page: Page, lang: 'ro' | 'en', inputBudget: InputBudget): Promise<void> {
    await inputBudget.flow('pushOn', contentFlowBudget('pushOn')).click(deviceSwitch(page, lang));
    await expect(page.locator('hcm-inbox-page')).toContainText(notifyText(lang, 'adminContent.notify.push.on'), {
        timeout: FUNCTIONS_TIMEOUT_MS,
    });
}

test.describe('with service workers', () => {
    test.use({ serviceWorkers: 'allow' });

    test(
        'The admin boots from /admin/ with everything it needs on the same origin',
        { tag: '@S-A58-HAPPY' },
        async ({ page, lang, request, adminWorld, inputBudget }) => {
            const index = await request.get(ADMIN_URL);
            expect(await index.text()).toContain(`<${ADMIN_SHELL_ELEMENT}></${ADMIN_SHELL_ELEMENT}>`);
            expect(await (await request.get(`${ADMIN_URL}runtime.json`)).json()).toEqual(ADMIN_RUNTIME);
            expect(await (await request.get(`${ADMIN_ORIGIN}/__/firebase/init.json`)).json()).toEqual(ADMIN_WEB_CONFIG);
            const bare = await request.get(`${ADMIN_ORIGIN}/admin`, { maxRedirects: 0 });
            expect([bare.status(), bare.headers()['location']]).toEqual([301, ADMIN_PATH]);

            // Push on this device: the admin's worker, in its folder only.
            const city = ownerCity(adminWorld);
            await page.context().grantPermissions(['notifications', 'clipboard-read', 'clipboard-write'], { origin: ADMIN_ORIGIN });
            await page.goto(cityAddress(lang, 'inbox', TEST_ID));
            await turnPushOn(page, lang, inputBudget);
            await expect.poll(() => workerScopes(page)).toEqual([ADMIN_URL]);

            // A notification's links: the inbox row stays in the admin, the pushed one opens the admin's address.
            await failJob(city, 'j-admin-path', AT);
            const row = inboxRow(page, failedItemId(city, 'j-admin-path'));
            await expect(row).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
            expect(new URL(await row.evaluate((link: HTMLAnchorElement) => link.href)).pathname).toBe(ADMIN_PATH);

            // An invitation's link names the admin's address.
            await page.goto(adminPath(lang, 'admins'));
            const flow = inputBudget.flow('inviteAdmin', contentFlowBudget('inviteAdmin'));
            await flow.click(page.getByRole('button', { name: shellText(lang, 'adminShell.admins.invite') }).first());
            const address = dialog(page).getByLabel(shellText(lang, 'adminShell.admins.email'));
            await flow.fill(address, 'new.admin@e2e.test');
            await flow.press(address, 'Enter');
            await expect(page.getByLabel(shellText(lang, 'adminShell.admins.link'))).toHaveValue(PROJECT_ADMIN_URL);
        },
    );

    test(
        'A push service worker left at the root by an older admin is replaced',
        { tag: '@S-A58-BAD-OLD-SERVICE-WORKER' },
        async ({ page, lang, adminWorld, inputBudget }) => {
            // An admin before M6: the site's root was the admin's, and its worker's scope /.
            await page.goto(`${ADMIN_ORIGIN}/__harness`);
            await page.evaluate(async (script) => {
                await navigator.serviceWorker.register(script, { scope: '/' });
                await navigator.serviceWorker.ready;
            }, OLD_PUSH_WORKER_PATH);
            expect(await workerScopes(page)).toEqual([`${ADMIN_ORIGIN}/`]);

            await page.context().grantPermissions(['notifications'], { origin: ADMIN_ORIGIN });
            await page.goto(cityAddress(lang, 'inbox', 'S-A58-BAD-OLD-SERVICE-WORKER'));
            await turnPushOn(page, lang, inputBudget);

            await expect.poll(() => workerScopes(page)).toEqual([ADMIN_URL]);
            const devices = Object.values(await adminWorld.emulators.collection(`admins/${adminWorld.accounts.owner.uid}/pushDevices`));
            expect(devices).toEqual([expect.objectContaining({ token: 'e2e-fcm-token:S-A58-BAD-OLD-SERVICE-WORKER-browser-0001' })]);

            // The site's root is no admin's any more: no worker controls its pages.
            await page.goto(`${ADMIN_ORIGIN}/__harness`);
            expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
        },
    );
});

test(
    'An old admin address on the root forwards to the admin with the same route',
    { tag: '@S-A58-HAPPY-OLD-LINK' },
    async ({ page, lang, mockApis }) => {
        const engine: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('/engine/')) {
                engine.push(request.url());
            }
        });

        for (const route of ['setup', `c/${E2E_CITY_ID}/photos`]) {
            await page.goto(hostingUrl('/', { lang, hash: `/${route}` }));
            await page.waitForURL(`${ADMIN_URL}**`);

            expect(page.url()).toBe(`${ADMIN_URL}?lang=${lang}#/${route}`);
        }
        expect(engine).toEqual([]);
        expect(await mockApis.mapLoadEvents()).toBe(0);
    },
);

test(
    'An old admin address typed while the start-up root is open forwards on the hash change alone',
    { tag: '@S-A58-HAPPY-OLD-LINK-HASH-CHANGE' },
    async ({ page, context, lang }) => {
        // Finding 25 of docs/research/manual-test-2026-10-25.md (live test 2026-10-31): a fresh load forwarded, a hash change did not.
        await useStartUpVariant(context);
        await page.goto(hostingUrl('/', { lang }));
        await expect(page.getByRole('heading', { level: 1, name: 'Harta este în pregătire' })).toBeVisible();

        await page.goto(hostingUrl('/', { lang, hash: '/setup' }));
        await page.waitForURL(`${ADMIN_URL}**`);

        expect(page.url()).toBe(`${ADMIN_URL}?lang=${lang}#/setup`);
    },
);

test(
    'A viewer hash typed while the start-up root is open stays on the root',
    { tag: '@S-A58-BAD-VIEWER-HASH-CHANGE' },
    async ({ page, context, lang }) => {
        await useStartUpVariant(context);
        await page.goto(hostingUrl('/', { lang }));
        const heading = page.getByRole('heading', { level: 1, name: 'Harta este în pregătire' });
        await expect(heading).toBeVisible();

        await page.goto(hostingUrl('/', { lang, hash: '17/44.42955/26.09560' }));

        await expect(heading).toBeVisible();
        expect(page.url()).toBe(hostingUrl('/', { lang, hash: '17/44.42955/26.09560' }));
    },
);

/** Runs in a page: where this origin's storage holds Firebase Auth's signed-in user, by kind (none: an empty list). */
async function signInStorage(): Promise<string[]> {
    const holds = (storage: Storage): boolean => Object.keys(storage).some((key) => key.startsWith('firebase:authUser:'));
    const databases = (await indexedDB.databases()).map((database) => database.name ?? '');
    return [
        ...(holds(localStorage) ? ['localStorage'] : []),
        ...(holds(sessionStorage) ? ['sessionStorage'] : []),
        ...(databases.includes('firebaseLocalStorageDb') ? ['indexedDB'] : []),
    ];
}

test(
    "The owner's sign-in lives in the admin's tab only: a reload keeps it, the origin's shared storage never holds it",
    { tag: '@S-A58-HAPPY-SIGN-IN-IN-TAB' },
    async ({ page, lang }) => {
        await page.goto(adminPath(lang, 'home'));
        await expect(page.locator('hcm-home-page')).toBeVisible();

        await page.reload();

        await expect(page.locator('hcm-home-page')).toBeVisible();
        expect(await page.evaluate(signInStorage)).toEqual(['sessionStorage']);
    },
);

test(
    "A page of the public map, on the admin's own origin, finds no sign-in to read",
    { tag: '@S-A58-BAD-VIEWER-READS-NO-SIGN-IN' },
    async ({ page, lang }) => {
        // Finding 1 of the M6 security review: since M6 a viewer page shares the admin's origin, so a script there could
        // read an origin-wide sign-in (IndexedDB, localStorage) and act as the owner. The admin keeps it in its tab.
        await page.goto(adminPath(lang, 'home'));
        await expect(page.locator('hcm-home-page')).toBeVisible();
        const viewer = await page.context().newPage();
        await serveBucketCity(viewer, { city: E2E_CITY_ID, site: 'bucharest' });

        await viewer.goto(hostingUrl('/', { lang }));
        await waitForEngineEvent(viewer, 'hcm-ready');

        expect(await viewer.evaluate(signInStorage)).toEqual([]);
        await viewer.close();
    },
);

test('A viewer link on the root is never sent to the admin', { tag: '@S-A58-BAD-VIEWER-HASH' }, async ({ page, lang }) => {
    await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });

    await page.goto(hostingUrl('/', { lang, hash: '15.5/44.4271/26.0853/90/!a3!p2' }));
    await waitForEngineEvent(page, 'hcm-ready');

    expect(new URL(page.url()).pathname).toBe('/');
    await expect.poll(async () => (await mapFacts(page)).zoom).toBeCloseTo(15.5, 1);

    await page.goto(hostingUrl('/', { lang, hash: 'photo=strandul-opereta-1976' }));
    await waitForEngineEvent(page, 'hcm-ready');

    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
});

test(
    'No page gets two security policies, and the admin’s never reaches the viewer',
    { tag: '@S-A58-BAD-CSP-PER-PATH' },
    async ({ page, request, consoleErrors }) => {
        const adminPolicy = e2eContentSecurityPolicy(adminContentSecurityPolicy('bucurestiul-disparut'), ADMIN_CONNECT_ORIGINS);
        for (const path of [ADMIN_PATH, `${ADMIN_PATH}admin.mjs`, `${ADMIN_PATH}photos/abc`]) {
            expect(policyHeaders((await request.get(`${ADMIN_ORIGIN}${path}`)).headersArray()), path).toEqual([adminPolicy]);
        }
        for (const path of [
            '/',
            '/index.html',
            '/engine/engine.mjs',
            '/e2e-second/',
            '/bacau/',
            '/city/',
            '/release.json',
            '/Not_A_City/',
        ]) {
            expect(policyHeaders((await request.get(`${ADMIN_ORIGIN}${path}`)).headersArray()), path).toEqual([]);
        }
        for (const path of ['/', '/e2e-second/', '/bacau/', '/Not_A_City/']) {
            const html = await (await request.get(`${ADMIN_ORIGIN}${path}`)).text();
            expect(html.match(/http-equiv="Content-Security-Policy"/g), path).toHaveLength(1);
        }

        // A viewer page's own policy: Google's sign-in cannot be framed there.
        await serveBucketCity(page, { city: E2E_CITY_ID, site: 'bucharest' });
        await page.goto(hostingUrl('/'));
        await waitForEngineEvent(page, 'hcm-ready');
        const violated = await page.evaluate(
            () =>
                new Promise<string>((resolve) => {
                    document.addEventListener('securitypolicyviolation', (event) => {
                        resolve(event.effectiveDirective);
                    });
                    const frame = document.createElement('iframe');
                    frame.src = 'https://accounts.google.com/';
                    document.body.append(frame);
                }),
        );
        expect(['frame-src', 'child-src', 'default-src']).toContain(violated);
        expect(consoleErrors.take().filter((error) => !error.includes('Content Security Policy'))).toEqual([]);
    },
);
