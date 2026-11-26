import { inflateSync } from 'node:zlib';

import type { Locator, Page, Route } from '@playwright/test';

import { GOOGLE_SCOPES } from '../../../../packages/admin/src/google/scopes.js';
import { blankScrollOf, expectStateSound } from '../../../support/state-check.js';
import type { InputBudget } from '../../../support/budget.js';
import type { SetupBudget } from '../../support/budget.js';
import { adminVisit } from '../../../tour/states.js';
import type { GoogleConsent } from '../../support/consent.js';
import type { ServerDeployment } from '../../support/deployment.js';
import { setupText, shellText } from '../../support/i18n.js';
import { SetupPage } from '../../support/setup-page.js';
import { STEPS_AT, rememberBootstrap, seedClaimedCity, seedSetupStatus } from '../../support/steps.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { ADMIN_RUNTIME, E2E_PROJECT_ID, PERSONAS } from '../../world.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The admin's frame around Setup as the live test of 2026-10-25 found it (docs/research/manual-test-2026-10-25.md,
 * findings 1, 2, 6 and 22; docs/research/M6-interfaces.md §3.1; behaviour A31): the loading screen fits the window, the
 * start-up sign-in card and a refused account's card sit in the middle of a window from the medium class (at the top of
 * a short one, whole), a busy step's chip shows the indicator in place of its icon (a still icon with reduced motion)
 * with its label readable, and the page's root wears the shell's surface, so no band of another colour shows below the
 * content. Each state passes the tour's checkers at the admin tier's five projects.
 */

/** `/runtime.json` of a new map's Hosting-only deploy: start-up mode, no server yet. */
async function startUpDeploy(page: Page, server: ServerDeployment): Promise<void> {
    await server.hide();
    await page.route('**/runtime.json', (route) => route.fulfill({ json: { ...ADMIN_RUNTIME, startUp: true } }));
}

/** The start-up sign-in with `email`'s account: one click, Google's read-only consent. */
async function signIn(page: Page, lang: 'ro' | 'en', consent: GoogleConsent, budget: InputBudget, email: string): Promise<void> {
    const button = page.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') });
    const popup = await consent.opened(page, () => budget.flow('signIn', 1).click(button));
    await popup.chooseAccount(email);
    await popup.allow(budget.flow('signInConsent', 1));
}

/** The box of `locator`, which must be drawn. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await locator.boundingBox();
    expect(box, 'the element is drawn').not.toBeNull();
    return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** How far the page scrolls past the window (0: no page scrollbar). */
function pageOverflow(page: Page): Promise<number> {
    return page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
}

/** A panel's card (`section.panel` in the panel's shadow root). */
function panelCard(page: Page, tag: string): Locator {
    return page.locator(tag).locator('section.panel');
}

/** The card is centred on both axes of the window (it fits), or starts at the top of a window too short for centring. */
async function expectPlaced(page: Page, card: Locator): Promise<void> {
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const box = await boxOf(card);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    const centred = viewport.width >= 600 && viewport.height >= 480 && box.height + 48 <= viewport.height;
    if (centred) {
        expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    } else {
        expect(box.y).toBeGreaterThanOrEqual(23);
        expect(box.y).toBeLessThanOrEqual(25);
    }
}

/** The bootstrap record of a new map whose billing is done and whose project is not prepared yet. */
function billedRecord(): Readonly<Record<string, unknown>> {
    const at = STEPS_AT.toISOString();
    return {
        version: 1,
        projectId: E2E_PROJECT_ID,
        updatedAt: at,
        steps: { signIn: { state: 'ok', checkedAt: at }, billing: { state: 'ok', checkedAt: at } },
        billing: {
            accountName: 'billingAccounts/0E2E00-0E2E00-0E2E01',
            budgetId: 'billingAccounts/0E2E00-0E2E00-0E2E01/budgets/0e2e0000-0000-4000-8000-000000000001',
            budgetAmount: 5,
            currency: 'USD',
        },
    };
}

type Rgb = readonly [number, number, number];

/** The first pixel of a PNG (whatever the row's filter, the first pixel's bytes are its colour). */
function firstPixel(png: Buffer): Rgb {
    const chunks: Buffer[] = [];
    for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset);
        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
            chunks.push(png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    return [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0];
}

function rgbOf(css: string): Rgb {
    const [r = 0, g = 0, b = 0] = (css.match(/\d+/g) ?? []).map(Number);
    return [r, g, b];
}

/** The window's bottom row at its middle, the shell's surface and the page root's background (each RGB). */
async function bottomAndSurface(page: Page): Promise<{ bottom: Rgb; surface: Rgb; root: Rgb }> {
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const bottom = firstPixel(
        await page.screenshot({ clip: { x: Math.floor(viewport.width / 2), y: viewport.height - 2, width: 1, height: 1 } }),
    );
    const colours = await page.evaluate(() => ({
        surface: getComputedStyle(document.querySelector('hcm-admin-shell') ?? document.body).backgroundColor,
        root: getComputedStyle(document.documentElement).backgroundColor,
    }));
    return { bottom, surface: rgbOf(colours.surface), root: rgbOf(colours.root) };
}

/** Two colours alike but for the screenshot's rounding. */
function expectSameColour(actual: Rgb, expected: Rgb): void {
    expect(
        actual.map((channel, index) => Math.abs(channel - (expected[index] ?? 0))).every((delta) => delta <= 2),
        `${actual.join(',')} is ${expected.join(',')}`,
    ).toBe(true);
}

test(
    'The loading screen fits the window: no page scrollbar, the indicator in the middle',
    { tag: ['@S-A31-HAPPY-LOADING-FITS'] },
    async ({ page, lang }) => {
        // The web configuration is held: the shell shows its loading screen until the test ends.
        const held: Route[] = [];
        await page.route('**/__/firebase/init.json', (route) => {
            held.push(route);
        });
        await page.goto(adminPath(lang));

        // Before the boot the shell has no state yet, so it says Loading in the page's own language (Romanian).
        const indicator = page.locator('hcm-admin-shell').getByRole('progressbar', { name: shellText('ro', 'adminShell.loading') });
        await expect(indicator).toBeVisible();
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        const viewport = page.viewportSize() ?? { width: 0, height: 0 };
        const box = await boxOf(page.locator('hcm-loading-indicator'));
        expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
        expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(40);
        await expectStateSound(page, adminVisit('shell.loading', lang));
        expect(held).toHaveLength(1);
    },
);

test(
    'A boot that turns into its error card still fits: the page scrolls only as far as the card needs',
    { tag: ['@S-A31-BAD-LOADING-SLOW'] },
    async ({ page, lang, consoleErrors }) => {
        // The web configuration answers late, then not at all: the configuration-missing card.
        await page.route('**/__/firebase/init.json', async (route) => {
            await new Promise((resolve) => {
                setTimeout(resolve, 1_500);
            });
            await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
        });
        await page.goto(adminPath(lang));
        const card = panelCard(page, 'hcm-blocked-panel');
        await expect(card).toBeVisible();

        for (const size of [
            { width: 320, height: 568 },
            { width: 915, height: 412 },
        ]) {
            await page.setViewportSize(size);
            await expect.poll(async () => (await boxOf(card)).width).toBeLessThanOrEqual(size.width);
            const box = await boxOf(card);
            const scrollTop = await page.evaluate(() => document.documentElement.scrollTop);
            // The panel's own padding (24 px) above and below the card is all the page adds.
            const needed = Math.max(size.height, Math.ceil(box.y + scrollTop + box.height + 24));
            expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(needed + 1);
            await expectPlaced(page, card);
        }
        // The browser's 404, and the admin's own log line that says why it shows the card.
        expect(consoleErrors.takeMatching(/status of 404|web configuration is missing/).length).toBeGreaterThan(0);
    },
);

test(
    'The start-up sign-in card is centred from the medium window class; on a short window it starts at the top, whole',
    { tag: ['@S-A31-HAPPY-SIGN-IN-CENTRED'] },
    async ({ page, lang, serverDeployment }) => {
        await startUpDeploy(page, serverDeployment);
        await page.goto(adminPath(lang));
        const card = panelCard(page, 'hcm-sign-in');
        await expect(card.getByRole('button', { name: shellText(lang, 'adminShell.auth.signIn') })).toBeVisible();

        await expectPlaced(page, card);
        await expectStateSound(page, adminVisit('auth.start-up-sign-in', lang));

        // A phone held sideways: compact height, the card from the top, every line reachable by scrolling the page.
        await page.setViewportSize({ width: 915, height: 412 });
        await expect.poll(async () => (await boxOf(card)).y).toBeLessThanOrEqual(25);
        const box = await boxOf(card);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThanOrEqual(Math.floor(box.y + box.height));
    },
);

test(
    "A refused account's longer card stays centred and whole, in the window's language",
    { tag: ['@S-A31-BAD-SIGN-IN-REFUSAL'] },
    async ({ page, lang, consent, inputBudget, serverDeployment }) => {
        await startUpDeploy(page, serverDeployment);
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.editor.email);

        const card = panelCard(page, 'hcm-blocked-panel');
        await expect(card.getByText(shellText(lang, 'adminShell.auth.notOwner', { projectId: E2E_PROJECT_ID }))).toBeVisible();
        await expectPlaced(page, card);
        await expectStateSound(page, adminVisit('auth.not-owner', lang));

        // The smallest phone: the text wraps inside the card, nothing is cut or wider than the window.
        await page.setViewportSize({ width: 320, height: 568 });
        await expect.poll(async () => (await boxOf(card)).width).toBeLessThanOrEqual(320);
        expect(await card.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
        await expectPlaced(page, card);
    },
);

interface StartUpFixtures {
    readonly consent: GoogleConsent;
    readonly inputBudget: InputBudget;
    readonly setupBudget: SetupBudget;
    readonly serverDeployment: ServerDeployment;
}

test.describe('a step at work', () => {
    /** Signs the owner in to start-up mode with billing done, then runs Prepare the project, Google's answers held. */
    async function provisioning(page: Page, lang: 'ro' | 'en', fixtures: StartUpFixtures): Promise<Locator> {
        const { consent, inputBudget, setupBudget, serverDeployment } = fixtures;
        await startUpDeploy(page, serverDeployment);
        await rememberBootstrap(page, E2E_PROJECT_ID, billedRecord());
        await page.goto(adminPath(lang));
        await signIn(page, lang, consent, inputBudget, PERSONAS.owner.email);
        const setup = new SetupPage(page, lang);
        const card = await setup.show('provision');
        const run = card.getByRole('button', { name: setupText(lang, 'adminSetup.provision.run') });
        await expect(run).toBeEnabled();
        // Google's Service Usage does not answer: the step stays at work.
        await page.route('https://serviceusage.googleapis.com/**', () => undefined);
        const popup = await consent.opened(page, () => setupBudget.inputs('provision').click(run));
        expect(await popup.requestedScopes()).toEqual([GOOGLE_SCOPES.cloudPlatform]);
        await popup.allow(setupBudget.consents('provision'));
        return card;
    }

    test(
        "A busy step's chip shows the indicator in place of its icon and says Working, in the list and on the card",
        { tag: ['@S-A31-HAPPY-BUSY-CHIP'] },
        async ({ page, lang, consent, inputBudget, setupBudget, serverDeployment }) => {
            const card = await provisioning(page, lang, { consent, inputBudget, setupBudget, serverDeployment });
            const chips = page.locator('hcm-setup-step[data-step="provision"]').locator('.status[data-busy]');
            await expect(chips.first()).toBeVisible();

            for (const chip of await chips.all()) {
                await expect(chip).toContainText(setupText(lang, 'adminSetup.busy'));
                const indicator = await boxOf(chip.locator('hcm-loading-indicator'));
                const shape = await boxOf(chip.locator('hcm-loading-indicator [part="indicator"]'));
                expect(indicator.width).toBe(18);
                // Turned or not, the shape stays within its box's reach: the label beside it stays whole.
                expect(shape.width).toBeLessThanOrEqual(20);
                expect(Math.abs(shape.x + shape.width / 2 - (indicator.x + indicator.width / 2))).toBeLessThan(1);
            }
            await expect(card.getByRole('progressbar', { name: setupText(lang, 'adminSetup.busy') }).first()).toBeVisible();
            await expectStateSound(page, adminVisit('setup.provision-busy', lang));
        },
    );

    test(
        'With reduced motion the busy chip has a still icon and its label, nothing overlapping',
        { tag: ['@S-A31-BAD-BUSY-REDUCED-MOTION'] },
        async ({ page, lang, consent, inputBudget, setupBudget, serverDeployment }) => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await provisioning(page, lang, { consent, inputBudget, setupBudget, serverDeployment });
            const chip = page.locator('hcm-setup-step[data-step="provision"]').locator('.status[data-busy]').first();

            await expect(chip).toContainText(setupText(lang, 'adminSetup.busy'));
            await expect(chip.locator('hcm-icon.still')).toBeVisible();
            await expect(chip.locator('hcm-loading-indicator')).toBeHidden();
            await expectStateSound(page, adminVisit('setup.provision-busy', lang));
        },
    );
});

test.describe('the page under the shell', () => {
    test.use({ persona: 'owner', mapOwner: 'owner' });

    test.beforeEach(async ({ adminWorld }) => {
        await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
        await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
    });

    test(
        "The shell's surface fills the window when the content is short, to the bottom edge",
        { tag: ['@S-A31-HAPPY-SURFACE-FILLS'] },
        async ({ page, lang }) => {
            await page.setViewportSize({ width: 2560, height: 1440 });
            await new SetupPage(page, lang).visit('mapbox');
            await page.evaluate(() => {
                window.scrollTo(0, document.documentElement.scrollHeight);
            });

            const colours = await bottomAndSurface(page);
            expectSameColour(colours.root, colours.surface);
            expectSameColour(colours.bottom, colours.surface);
        },
    );

    test(
        'Scrolling past the end of the page shows no band of another colour',
        { tag: ['@S-A31-BAD-OVERSCROLL-BAND'] },
        async ({ page, lang }) => {
            await new SetupPage(page, lang).visit('mapbox');
            // The page goes 400 px past the shell (what an overscroll or a taller window shows), scrolled to its end.
            await page.evaluate(() => {
                document.body.style.paddingBlockEnd = '400px';
                window.scrollTo(0, document.documentElement.scrollHeight);
            });
            await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

            const colours = await bottomAndSurface(page);
            expectSameColour(colours.bottom, colours.surface);
        },
    );

    test(
        'The framed admin is an app shell: the window never scrolls into blank space under it',
        { tag: ['@S-A31-HAPPY-NO-BLANK-SCROLL'] },
        async ({ page, lang }) => {
            await new SetupPage(page, lang).visit('mapbox');
            await page.mouse.wheel(0, 3000);

            expect(await page.evaluate(() => window.scrollY)).toBe(0);
            expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe('none');
            expect(await blankScrollOf(page)).toEqual([]);
        },
    );

    test(
        'A blank area left under the framed admin is found by the no-blank-scroll checker',
        { tag: ['@S-A31-BAD-NO-BLANK-SCROLL'] },
        async ({ page, lang }) => {
            await new SetupPage(page, lang).visit('mapbox');
            // A fixture's fault: 400 px of nothing under the shell, as an element escaping the frame once left.
            await page.evaluate(() => {
                const blank = document.createElement('div');
                blank.style.blockSize = '400px';
                document.body.append(blank);
            });

            const messages = (await blankScrollOf(page)).map((violation) => violation.message);
            expect(messages.some((message) => /^the app shell's page is \d+ px tall in a \d+ px window$/.test(message))).toBe(true);
            expect(messages).toContain('scrolling the window moves the app shell 400 px');
        },
    );
});
