import { test as base, expect, type APIRequestContext, type ConsoleMessage, type Page, type TestInfo } from '@playwright/test';

import { axeViolations, type AxeOptions, type AxeViolation } from './a11y.js';
import { InputBudget } from './budget.js';
import { ENGINE_EVENTS, instrumentPage, readInstrumentation, type E2eInstrumentation } from './instrumentation.js';
import { installNetwork, Recorder } from './network.js';
import { leakedPlaceholders } from './placeholders.js';
import { MockApis } from './site.js';

/**
 * The fixtures every e2e spec imports instead of `@playwright/test` (docs/research/design-review-testability.md §4.2):
 *
 * - `firewall` (automatic): loopback passes, a mocked host is answered by the mock APIs, anything else is aborted and
 *   recorded, and the test fails at teardown if anything was blocked (support/network.ts). Chromium's host-resolver
 *   rules (playwright.config.ts) are the second layer.
 * - `consoleErrors` (automatic): console errors and uncaught page errors fail the test at teardown, except the ones a
 *   tier expects by design (option `expectedConsoleErrors`: a message text and the URL it is about, with the reason;
 *   the admin tier's anonymous probe of `admin-session`, refused 401 by its access rule, is the only one today).
 * - `placeholderGuard` (automatic): visible text showing `undefined`, `null`, `NaN`, `[object Object]` or an unfilled
 *   `{param}` fails the test at teardown (support/placeholders.ts).
 * - `instrumentation` (automatic init script): the map-instance counter and the engine's events; read them with
 *   `instrumentation.read(page)`.
 * - `mockApis`: this test's calls as the mock APIs recorded them (map loads, analytics beacons, error reports).
 * - `axe`: the WCAG 2.2 AA check of the tour and a11y tiers.
 * - `inputBudget`: counted admin inputs per flow, checked at teardown.
 * - option `lang` (`ro` default, `en` in the English projects): the language a spec opens the viewer in.
 * - option `forwardUpstreams` (`false` default, `true` in the admin projects): the firewall also forwards the fake upstreams'
 *   hosts (Google Cloud, OAuth tokeninfo, Mapbox's APIs, USGS M2M, Nominatim) to the mock APIs (CR-M2-21). The admin
 *   tier's own fixtures build on this `test` (e2e/admin/support/test.ts).
 *
 * A bad-path test that provokes a block or an error on purpose claims it with `take()`, which returns the recorded
 * entries and clears them, and asserts on what it got.
 */

interface Instrumentation {
    read(page: Page): Promise<E2eInstrumentation>;
}

interface Axe {
    violations(options?: AxeOptions): Promise<AxeViolation[]>;
}

/** A console error a tier expects by design: its text and the URL it is about (both must match), and why. */
export interface ExpectedConsoleError {
    readonly text: RegExp;
    readonly url: RegExp;
    readonly why: string;
}

interface TestOptions {
    expectedConsoleErrors: readonly ExpectedConsoleError[];
}

export interface TestFixtures extends TestOptions {
    firewall: Recorder;
    consoleErrors: Recorder;
    placeholderGuard: undefined;
    instrumentation: Instrumentation;
    mockApis: MockApis;
    axe: Axe;
    inputBudget: InputBudget;
}

export interface WorkerOptions {
    /** The viewer language of the project (`?lang=`). */
    lang: 'ro' | 'en';
    /** Forward the fake upstreams' hosts as well (the admin projects). */
    forwardUpstreams: boolean;
}

export interface WorkerFixtures extends WorkerOptions {
    mockApiRequest: APIRequestContext;
}

/** The id that tags a test's forwarded calls and names its partition of the fake upstreams (a retry gets its own). */
export function testIdOf(testInfo: TestInfo): string {
    return `${testInfo.testId}#${String(testInfo.retry)}`;
}

/** A console error as recorded: Chromium's "Failed to load resource" names no address, so the address follows it. */
function described(message: ConsoleMessage): string {
    const text = message.text();
    return text.startsWith('Failed to load resource') ? `${text} (${message.location().url})` : text;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
    lang: ['ro', { option: true, scope: 'worker' }],
    forwardUpstreams: [false, { option: true, scope: 'worker' }],
    expectedConsoleErrors: [[], { option: true }],
    mockApiRequest: [
        async ({ playwright }, use) => {
            const api = await playwright.request.newContext();
            await use(api);
            await api.dispose();
        },
        { scope: 'worker' },
    ],
    firewall: [
        async ({ context, mockApiRequest, forwardUpstreams }, use, testInfo) => {
            const blocked = new Recorder();
            await installNetwork(context, mockApiRequest, testIdOf(testInfo), blocked, { upstream: forwardUpstreams });
            await use(blocked);
            expect(blocked.take(), 'requests outside the loopback and mocked hosts were blocked').toEqual([]);
        },
        { auto: true },
    ],
    consoleErrors: [
        async ({ page, expectedConsoleErrors }, use) => {
            const errors = new Recorder();
            const expected = (message: ConsoleMessage): boolean =>
                expectedConsoleErrors.some((allowed) => allowed.text.test(message.text()) && allowed.url.test(message.location().url));
            page.on('console', (message) => {
                if (message.type() === 'error' && !expected(message)) {
                    errors.record(described(message));
                }
            });
            page.on('pageerror', (error) => {
                errors.record(`uncaught ${error.name}: ${error.message}`);
            });
            await use(errors);
            expect(errors.take(), 'console errors or uncaught page errors').toEqual([]);
        },
        { auto: true },
    ],
    placeholderGuard: [
        async ({ page }, use) => {
            await use(undefined);
            expect(await leakedPlaceholders(page), 'visible text shows a leaked placeholder').toEqual([]);
        },
        { auto: true },
    ],
    instrumentation: [
        async ({ context }, use) => {
            await context.addInitScript(instrumentPage, ENGINE_EVENTS);
            await use({ read: readInstrumentation });
        },
        { auto: true },
    ],
    mockApis: async ({ mockApiRequest }, use, testInfo) => {
        await use(new MockApis(mockApiRequest, testIdOf(testInfo)));
    },
    axe: async ({ page }, use) => {
        await use({ violations: (options = {}) => axeViolations(page, options) });
    },
    inputBudget: async ({ page }, use) => {
        const budget = new InputBudget();
        await use(budget);
        expect(budget.overruns(), `admin flows over their input budget, ending on ${page.url()}`).toEqual([]);
    },
});

export { expect };
