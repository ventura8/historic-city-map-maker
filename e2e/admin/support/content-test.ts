import { expect, test as base, testIdOf } from '../../support/test.js';
import { GoogleConsent } from './consent.js';
import { ContentWorld } from './content.js';
import { EmulatorWorld } from './emulators.js';
import { engineConsoleErrors, FIRESTORE_COMMIT_RETRIED, GOOGLE_RESOURCE_ABSENT, PROBE_REFUSED } from './test.js';
import { UpstreamControl } from './upstream.js';

/**
 * The fixtures of the content specs and the admin tour (docs/research/M2c-interfaces.md §12.3, CR-M2c-7), on top of every
 * e2e guard of `e2e/support/test.ts`: `content`, the test's own world (a city and a Google account, an admin of the map,
 * `content.ts`), whose account every admin tab of the context opens signed in with (`signedIn: false` opens them signed
 * out); `upstream` and `consent`, the fake upstreams and
 * Google's consent stand-in of the test's own partition. No lock and no lease: the world is the test's alone, and the
 * reset of a locked admin test keeps it, so these tests run on every worker beside the admin tier's chain. A spec that
 * touches `admins/*`, `invites/*` or `setup/*` stays on the admin tier's `test` and its lock (`ADMIN_LOCK`).
 */

interface ContentFixtures {
    /** Option: the admin's tabs open signed in as the world's account (false: signed out). */
    signedIn: boolean;
    content: ContentWorld;
    upstream: UpstreamControl;
    consent: GoogleConsent;
}

export const test = base.extend<ContentFixtures>({
    expectedConsoleErrors: async ({ browserName }, use) => {
        await use([PROBE_REFUSED, GOOGLE_RESOURCE_ABSENT, FIRESTORE_COMMIT_RETRIED, ...engineConsoleErrors(browserName)]);
    },
    content: async ({ mockApiRequest }, use, testInfo) => {
        const world = await ContentWorld.prepare(new EmulatorWorld(mockApiRequest), testIdOf(testInfo));
        await use(world);
        await world.retire();
    },
    signedIn: [true, { option: true }],
    context: async ({ context, content, signedIn }, use) => {
        if (signedIn) {
            await content.signIn(context);
        }
        await use(context);
    },
    upstream: async ({ mockApiRequest }, use, testInfo) => {
        await use(new UpstreamControl(mockApiRequest, testIdOf(testInfo)));
    },
    consent: async ({ mockApiRequest }, use, testInfo) => {
        await use(new GoogleConsent(mockApiRequest, testIdOf(testInfo)));
    },
});

export { expect };
