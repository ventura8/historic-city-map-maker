import type { APIRequestContext } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { expect, test as base, testIdOf, type ExpectedConsoleError } from '../../support/test.js';
import { ADMIN_PATH, PERSONA_NAMES, type PersonaName } from '../world.js';
import { SetupBudget } from './budget.js';
import { GoogleConsent } from './consent.js';
import { ServerDeployment } from './deployment.js';
import { EmulatorWorld, type SignedInAccount } from './emulators.js';
import { SceneWriters } from './server-calls.js';
import { signInContext } from './session.js';
import { UpstreamControl } from './upstream.js';

/**
 * The fixtures of the admin tier (docs/research/M2b-interfaces.md §6.2), on top of every e2e guard of
 * `e2e/support/test.ts` (the firewall, which in the admin projects also forwards the fake upstreams' hosts; the console
 * guard, which expects the probe's 401, Google's 404 for a resource not created yet and a transaction commit Firestore's
 * SDK runs again; the placeholder guard; the input budget):
 *
 * - `adminWorld` (automatic): takes the admin tier's lease (the guard behind `ADMIN_LOCK`, below), so one admin test runs
 *   at a time across projects, workers and even Playwright runs that share the servers; empties the emulators, both
 *   worlds of the fake upstreams and the consent stand-in's records of the test; signs every persona in to the Auth
 *   emulator (`accounts`); with `mapOwner`, records the map as claimed by that persona. Released at teardown.
 * - options `persona` (`null`: the page opens signed out), `mapOwner` (`null`: nobody claimed the map yet), `invited`
 *   (personas with a pending invitation of the owner) and `admins` (personas who already joined as admins); the last two
 *   need a `mapOwner`.
 * - `context`: for a `persona`, every admin tab opens with that account in Firebase Auth's `sessionStorage`, signed in
 *   after the seed (so its ID token carries the claims of `mapOwner`; `session.ts`).
 * - `upstream`: the fake upstreams' scenarios, failures and recorded calls (the browser's world and the server's).
 * - `consent`: Google's consent stand-in (the popup an in-app click opens, and what it recorded).
 * - `setupBudget`: the Setup Assistant's input and consent budgets per step.
 * - `serverDeployment`: "not deployed yet" at the network edge.
 * - `page`: the test ends only once the page's harvest and browse copies (`imagery.search`, `imagery.browse`) have
 *   answered, so their server-side writes never land on the next test's scenes of the shared city (`server-calls.ts`).
 */

interface AdminWorld {
    readonly emulators: EmulatorWorld;
    /** Every persona, signed in to the Auth emulator (the same account the stand-in consent signs in). */
    readonly accounts: Readonly<Record<PersonaName, SignedInAccount>>;
}

interface AdminOptions {
    persona: PersonaName | null;
    mapOwner: PersonaName | null;
    invited: readonly PersonaName[];
    admins: readonly PersonaName[];
}

interface AdminFixtures extends AdminOptions {
    adminWorld: AdminWorld;
    upstream: UpstreamControl;
    consent: GoogleConsent;
    setupBudget: SetupBudget;
    serverDeployment: ServerDeployment;
}

/**
 * The Playwright lock of the admin tier: every admin spec file starts with `test.describe.configure({ lock: ADMIN_LOCK })`,
 * so the dispatcher never starts an admin test while another runs and gives the free workers other tests meanwhile (a
 * worker never waits on the lease). The admin projects come first in e2e/projects.ts, so the admin tests run one after
 * the other beside the viewer tiers instead of after them.
 */
export const ADMIN_LOCK = 'admin-emulators';

/**
 * The lease every admin test holds while it runs (`e2e/mock-apis/lease.ts`): with `ADMIN_LOCK` it is always free in a
 * run; it still keeps two runs that share one set of servers (`reuseExistingServer` outside CI) apart, and an admin spec
 * file that forgot the lock correct (only slower: its workers wait here).
 */
const LEASE = 'admin-emulators';

/** How long a test may wait for the lease: every other admin test of the run may be ahead of it. */
const LEASE_WAIT_MS = 30 * 60 * 1000;

/**
 * Before sign-in the admin probes `admin-session` anonymously (M2b-interfaces §1.4 step 4): a deployed callable refuses
 * it with 401 through CORS, which is how the admin knows the server answers, and Chromium logs every 401 it loads.
 */
export const PROBE_REFUSED: ExpectedConsoleError = {
    text: /status of 401/,
    url: /\/us-central1\/admin-session$/,
    why: "the anonymous probe of admin-session is refused by the callable's access rule, by design",
};

/**
 * Google's REST APIs have no "does it exist" call: the provisioner and the Setup Assistant's detections read a resource
 * and take Google's 404 for "missing" (docs/research/M2b-interfaces.md §3.4), and Chromium logs every 404 it loads.
 */
export const GOOGLE_RESOURCE_ABSENT: ExpectedConsoleError = {
    text: /status of 404/,
    url: /^https:\/\/[a-z0-9-]+\.googleapis\.com\//,
    why: 'a Google resource the provisioner or a detection reads before creating it does not exist yet, by design',
};

/**
 * A transaction's commit Firestore's SDK runs again, which Chromium logs: refused because a document changed between
 * the transaction's read and its commit (`FAILED_PRECONDITION`, 400: a trigger wrote the photo meanwhile), or, in the
 * emulator under a full run's contention, applied and answered 409 `ALREADY_EXISTS` (the trace shows the document stamped
 * by that very commit; `docs/LESSONS.md` 117). The run again succeeds or reports what the editor shows.
 */
export const FIRESTORE_COMMIT_RETRIED: ExpectedConsoleError = {
    text: /status of (400|409)/,
    url: /\/documents:commit\?/,
    why: "Firestore's SDK runs a transaction again after its commit was refused (a document changed since its read) or re-answered",
};

/** What every admin test expects in the console. */
export const ADMIN_EXPECTED_CONSOLE_ERRORS: readonly ExpectedConsoleError[] = [
    PROBE_REFUSED,
    GOOGLE_RESOURCE_ABSENT,
    FIRESTORE_COMMIT_RETRIED,
];

/**
 * WebKit only: Playwright's WebKit instrumentation (`web-inspector://bootstrap.js`) sets inline styles on the page, which
 * the admin's CSP refuses (`style-src` has no `'unsafe-inline'`); the admin's own styles are constructed style sheets,
 * which WebKit applies. The admin is not what logs these (lesson 109).
 */
const WEBKIT_INSPECTOR_STYLES: ExpectedConsoleError = {
    text: /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
    url: /.*/,
    why: "Playwright's WebKit instrumentation sets inline styles the admin's CSP refuses",
};

/**
 * WebKit only: Safari applies `Content-Security-Policy-Report-Only: require-trusted-types-for 'script'` and says the
 * policy has no effect without `report-to`, then reports Firebase Auth's gapi loader (a script URL set as a string).
 * The header is firebase.json's; whether to give it a report endpoint is for the user (DECISIONS-for-review.md §37g).
 */
const WEBKIT_TRUSTED_TYPES_REPORT: ExpectedConsoleError = {
    text: /require-trusted-types-for 'script'/,
    url: /.*/,
    why: "Safari reports the report-only Trusted Types header (no report-to) and Firebase Auth's gapi loader under it",
};

/** What a test expects in the console beyond its tier's own: WebKit's two (above) in the WebKit projects. */
export function engineConsoleErrors(browserName: string): readonly ExpectedConsoleError[] {
    return browserName === 'webkit' ? [WEBKIT_INSPECTOR_STYLES, WEBKIT_TRUSTED_TYPES_REPORT] : [];
}

/** When a seeded map was claimed: a fixed time, never the wall clock. */
const SEED_TIME = new Date('2026-10-01T09:00:00Z');

/**
 * When a seeded invitation expires: the Functions emulator compares it with the system clock, so a test value far in
 * the future encodes "not expired" (the expiry itself is S-A02-BAD-EXPIRED-INVITE, on the functions tier).
 */
const INVITE_EXPIRES = new Date('2100-01-01T00:00:00Z');

interface Seed {
    readonly mapOwner: PersonaName | null;
    readonly invited: readonly PersonaName[];
    readonly admins: readonly PersonaName[];
}

/** The map's owner, invitations and admins, as the callables would have left them. */
async function seedMap(emulators: EmulatorWorld, accounts: Readonly<Record<PersonaName, SignedInAccount>>, seed: Seed): Promise<void> {
    if (seed.mapOwner === null) {
        expect(seed.invited.length + seed.admins.length, 'invitations and admins need a mapOwner').toBe(0);
        return;
    }
    const owner = accounts[seed.mapOwner];
    await emulators.claimFor(owner, SEED_TIME);
    for (const name of seed.invited) {
        await emulators.invite(accounts[name].email, owner, SEED_TIME, INVITE_EXPIRES);
    }
    for (const name of seed.admins) {
        await emulators.addAdmin(accounts[name], owner, SEED_TIME);
    }
}

async function lease(api: APIRequestContext, action: 'acquire' | 'release', holder: string, ttlMs: number): Promise<void> {
    const query = new URLSearchParams({ name: LEASE, holder, ttl: String(ttlMs) });
    const response = await api.post(`${MOCK_API_ORIGIN}/__lease/${action}?${query.toString()}`, { timeout: LEASE_WAIT_MS });
    expect(response.status(), `lease ${action}`).toBe(204);
}

async function signInEveryPersona(emulators: EmulatorWorld): Promise<Record<PersonaName, SignedInAccount>> {
    const accounts: Partial<Record<PersonaName, SignedInAccount>> = {};
    for (const name of PERSONA_NAMES) {
        accounts[name] = await emulators.signIn(name);
    }
    return accounts as Record<PersonaName, SignedInAccount>;
}

export const test = base.extend<AdminFixtures>({
    persona: [null, { option: true }],
    mapOwner: [null, { option: true }],
    invited: [[], { option: true }],
    admins: [[], { option: true }],
    expectedConsoleErrors: [ADMIN_EXPECTED_CONSOLE_ERRORS, { scope: 'test' }],
    adminWorld: [
        async ({ mockApiRequest, mapOwner, invited, admins }, use, testInfo) => {
            const holder = testIdOf(testInfo);
            // A holder that crashed loses the lease a minute after its test would have timed out.
            await lease(mockApiRequest, 'acquire', holder, testInfo.timeout + 60_000);
            try {
                const emulators = new EmulatorWorld(mockApiRequest);
                await emulators.reset();
                await new UpstreamControl(mockApiRequest, holder).reset();
                await new GoogleConsent(mockApiRequest, holder).reset();
                const accounts = await signInEveryPersona(emulators);
                await seedMap(emulators, accounts, { mapOwner, invited, admins });
                await use({ emulators, accounts });
            } finally {
                await lease(mockApiRequest, 'release', holder, 1);
            }
        },
        { auto: true, timeout: LEASE_WAIT_MS },
    ],
    page: async ({ page }, use) => {
        const writers = new SceneWriters(page);
        await use(page);
        await writers.settled();
    },
    context: async ({ context, persona, adminWorld }, use) => {
        if (persona !== null) {
            // The token's expiry is the browser's wall-clock time, which Firebase Auth compares it with.
            await signInContext(context, await adminWorld.emulators.signIn(persona), Date.now());
        }
        await use(context);
    },
    upstream: async ({ mockApiRequest }, use, testInfo) => {
        await use(new UpstreamControl(mockApiRequest, testIdOf(testInfo)));
    },
    consent: async ({ mockApiRequest }, use, testInfo) => {
        await use(new GoogleConsent(mockApiRequest, testIdOf(testInfo)));
    },
    setupBudget: async ({ inputBudget }, use) => {
        await use(new SetupBudget(inputBudget));
    },
    serverDeployment: async ({ context, consoleErrors }, use) => {
        await use(new ServerDeployment(context, consoleErrors));
    },
});

export { expect };

/** The admin's address in the project's language, optionally at a route (`setup`, `photos/<id>`): below `/admin/` (M6). */
export function adminPath(lang: 'ro' | 'en', route?: string): string {
    const hash = route === undefined ? '' : `#/${route}`;
    return `${ADMIN_PATH}?lang=${lang}${hash}`;
}
