import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { adminContentSecurityPolicy, e2eContentSecurityPolicy } from '../../../scripts/site/src/admin/csp.js';
import { LEGACY_FOLDER } from '../../../scripts/site/src/admin/legacy.js';
import { ADMIN_SHELL_ELEMENT } from '../../../scripts/site/src/admin/page.js';
import { FIREBASE_USER_KEY } from '../support/session.js';
import { fetchOutcome, openHarnessPage } from '../support/harness.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import {
    ADMIN_CONNECT_ORIGINS,
    ADMIN_PATH,
    ADMIN_PROJECT,
    ADMIN_RUNTIME,
    ADMIN_WEB_CONFIG,
    E2E_PROJECT_ID,
    emulatorOrigin,
    PERSONAS,
    type PersonaName,
} from '../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Harness (behaviour A00): the rest of the admin's e2e world (docs/research/M2b-interfaces.md §6.2): the e2e Hosting
 * server serves the built admin under `/admin/` as Hosting does (M6), with the e2e CSP; the admin projects' firewall forwards the fake upstreams'
 * hosts and still blocks every other Google host; a persona's storage state is a Firebase Auth session the Auth
 * emulator accepts; a hidden server is unreachable until shown.
 */

/** The real project, whose auth domains `firebase.json`'s CSP names (the e2e variant keeps them). */
const PROJECT = (
    JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../.firebaserc'), 'utf8')) as { projects: { default: string } }
).projects.default;

test(
    'The admin server serves the e2e build as Hosting does, with the emulators in its CSP',
    { tag: '@S-A00-HAPPY-ADMIN-SERVER' },
    async ({ request }) => {
        const index = await request.get(ADMIN_PATH);
        expect(index.status()).toBe(200);
        expect(await index.text()).toContain(`<${ADMIN_SHELL_ELEMENT}></${ADMIN_SHELL_ELEMENT}>`);
        const headers = index.headers();
        expect(headers['content-security-policy']).toBe(
            e2eContentSecurityPolicy(adminContentSecurityPolicy(PROJECT), ADMIN_CONNECT_ORIGINS),
        );
        expect(headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
        expect(headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');

        // A deep link and a source map (never deployed) both get the app, as Hosting's `/admin/**` rewrite does.
        expect(await (await request.get(`${ADMIN_PATH}photos/abc`)).text()).toBe(await index.text());
        expect((await request.get(`${ADMIN_PATH}admin.mjs`)).headers()['cache-control']).toBe('no-cache');
        expect(await (await request.get('/__/firebase/init.json')).json()).toEqual(ADMIN_WEB_CONFIG);
        expect(await (await request.get(`${ADMIN_PATH}runtime.json`)).json()).toEqual(ADMIN_RUNTIME);
        expect(await (await request.get(`${ADMIN_PATH}project.json`)).json()).toEqual(ADMIN_PROJECT);
        expect(await (await request.get(`${ADMIN_PATH}${LEGACY_FOLDER}/photos.json`)).json()).toHaveLength(57);
        const original = await request.get(`${ADMIN_PATH}${LEGACY_FOLDER}/originals/Ferdinand.png`);
        expect(original.headers()['content-type']).toBe('image/png');
        expect(original.headers()['cache-control']).toBe('public, max-age=86400');
        expect((await request.get(`${ADMIN_PATH}fonts/material-symbols-rounded.woff2`)).headers()['content-type']).toBe('font/woff2');
    },
);

test(
    'A Google host that no fake answers stays blocked in the admin projects',
    { tag: '@S-A00-BAD-UNFAKED-GOOGLE-HOST' },
    async ({ page, firewall, consoleErrors }) => {
        await openHarnessPage(page);
        const firestore = `https://firestore.googleapis.com/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/setup/owner`;

        expect(await page.evaluate(fetchOutcome, { url: firestore })).toBe('network-error');
        expect(firewall.take()).toEqual([firestore]);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('net::ERR_BLOCKED_BY_CLIENT')]);
    },
);

/** Runs in the page: Firebase Auth's persisted user in the tab's sessionStorage (since M6), or null. */
function persistedUser(key: string): unknown {
    const json = sessionStorage.getItem(key);
    return json === null ? null : (JSON.parse(json) as unknown);
}

test.describe('a persona signed in through its session', () => {
    test.use({ persona: 'admin' });

    test(
        "A persona's session is a Firebase Auth session the Auth emulator accepts",
        { tag: '@S-A00-HAPPY-SIGNED-IN-PERSONA' },
        async ({ page, adminWorld }) => {
            await openHarnessPage(page);
            const user = (await page.evaluate(persistedUser, FIREBASE_USER_KEY)) as {
                uid: string;
                email: string;
                stsTokenManager: { accessToken: string };
            };

            expect(user).toEqual(expect.objectContaining({ uid: adminWorld.accounts.admin.uid, email: PERSONAS.admin.email }));
            const lookup = await page.evaluate(
                async ({ url, idToken }) => {
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ idToken }),
                    });
                    return (await response.json()) as { users?: { localId: string; email: string }[] };
                },
                {
                    url: `${emulatorOrigin('auth')}/identitytoolkit.googleapis.com/v1/accounts:lookup?key=${ADMIN_WEB_CONFIG.apiKey}`,
                    idToken: user.stsTokenManager.accessToken,
                },
            );
            expect(lookup.users?.map((account) => [account.localId, account.email])).toEqual([[user.uid, PERSONAS.admin.email]]);
        },
    );
});

test('Without a persona the admin opens signed out', { tag: '@S-A00-BAD-SIGNED-OUT' }, async ({ page }) => {
    await openHarnessPage(page);

    expect(await page.evaluate(persistedUser, FIREBASE_USER_KEY)).toBeNull();
});

test(
    'A hidden server is unreachable until it is shown again',
    { tag: '@S-A00-BAD-SERVER-HIDDEN' },
    async ({ page, serverDeployment, consoleErrors }) => {
        await openHarnessPage(page);
        const session = {
            url: `${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/admin-session`,
            init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"data":{}}' },
        };

        await serverDeployment.hide();
        expect(await page.evaluate(fetchOutcome, session)).toBe('network-error');
        expect(serverDeployment.claimErrors()).toEqual([expect.stringContaining('net::ERR_CONNECTION_REFUSED')]);

        await serverDeployment.show();
        // Deployed, the callable answers an anonymous call with its access rule's refusal.
        expect(await page.evaluate(fetchOutcome, session)).toBe('401');
        // Chromium logs that 401, which the admin tier expects (the probe's refusal), so nothing is left to claim.
        expect(consoleErrors.take()).toEqual([]);
    },
);

test.describe('a map with an owner, an invited persona and an admin', () => {
    test.use({ mapOwner: 'owner', invited: ['admin'], admins: ['editor'] });

    test(
        'The seeded owner, invitation and admin are what admin.session answers',
        { tag: '@S-A00-HAPPY-SEEDED-MAP' },
        async ({ adminWorld, mockApiRequest }) => {
            const url = `${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/admin-session`;
            const session = async (persona: PersonaName): Promise<unknown> => {
                const { idToken } = await adminWorld.emulators.signIn(persona);
                const response = await mockApiRequest.post(url, { headers: { authorization: `Bearer ${idToken}` }, data: { data: {} } });
                return ((await response.json()) as { readonly result?: unknown }).result;
            };

            expect(await session('owner')).toEqual(
                expect.objectContaining({ admin: true, role: 'owner', claim: true, ownerClaimed: true }),
            );
            expect(await session('admin')).toEqual(expect.objectContaining({ admin: false, invitePending: true }));
            expect(await session('editor')).toEqual(expect.objectContaining({ admin: true, role: 'admin', claim: true }));
            expect(await session('stranger')).toEqual(expect.objectContaining({ admin: false, ownerClaimed: true, invitePending: false }));
        },
    );
});
