import type { BrowserContext, Locator, Page } from '@playwright/test';

import type { GoogleScope } from '../../../packages/admin/src/google/scopes.js';
import type { SetupStepId } from '../../../packages/admin/src/setup/steps.js';
import { setupText, shellText } from './i18n.js';
import { adminPath, expect } from './test.js';

/**
 * The Setup Assistant as a spec drives it (docs/research/M2b-interfaces.md §3.3, CR-M2b-23): a step's card is
 * `hcm-setup-step[data-step=<id>]` with its `data-state`; the open step is the detail pane beside the list (expanded
 * windows and up) or the open card of the one-column page (compact and medium). Opening a card is navigation, never a
 * counted input.
 */
export class SetupPage {
    readonly page: Page;
    readonly lang: 'ro' | 'en';

    constructor(page: Page, lang: 'ro' | 'en') {
        this.page = page;
        this.lang = lang;
    }

    /** The step's card (its row of the list in list and detail, else its card). */
    card(step: SetupStepId): Locator {
        return this.page.locator(`hcm-setup-step[data-step="${step}"]`).first();
    }

    /** The step's open card: the detail pane, or the open card of the one-column page. */
    open(step: SetupStepId): Locator {
        return this.page.locator(`hcm-setup-step[data-step="${step}"]:is([mode="detail"], [mode="inline"][open])`);
    }

    /**
     * Opens the step's card (a click on its header) unless it is open already; returns the open card. Setup may open
     * another card meanwhile (it moves on once a step is done), so the card is opened again until it stays open.
     */
    async show(step: SetupStepId): Promise<Locator> {
        const open = this.open(step);
        await expect(async () => {
            if (!(await open.isVisible())) {
                await this.card(step).getByRole('button').first().click();
            }
            await expect(open).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 15_000 });
        return open;
    }

    /**
     * Opens Setup and waits until it has settled: its check is done and the step it opens at (`first`, the first not
     * done) is open. A card opened before that is replaced under the spec when Setup opens its own.
     */
    async visit(first: SetupStepId = 'billing'): Promise<void> {
        await this.page.goto(adminPath(this.lang, 'setup'));
        await expect(this.open(first)).toBeVisible();
        await expect(this.page.getByRole('button', { name: setupText(this.lang, 'adminSetup.recheck') }).first()).toBeEnabled();
    }

    async expectState(step: SetupStepId, state: string, timeout = 30_000): Promise<void> {
        await expect(this.card(step)).toHaveAttribute('data-state', state, { timeout });
    }

    /** The doctor's items of the provisioning card (opened first: Setup moves on once the step is done), their state by id. */
    async provisionItems(): Promise<Record<string, string>> {
        await this.show('provision');
        const pairs = await this.open('provision')
            .locator('[data-item]')
            .evaluateAll((items) =>
                items.map((item): [string, string] => [item.getAttribute('data-item') ?? '', item.getAttribute('data-state') ?? '']),
            );
        return Object.fromEntries(pairs);
    }

    /**
     * The inline note before a Google popup (§2.4): why the scope is asked, that it stays in the tab for at most an hour,
     * and how to pass Google's unverified-app screen to the auth domain.
     */
    async expectConsentNote(within: Locator, scope: GoogleScope, params: Readonly<Record<string, string>>): Promise<void> {
        const note = within.getByRole('complementary');
        await expect(note).toContainText(shellText(this.lang, `adminShell.oauth.why.${scope}`, params));
        await expect(note).toContainText(shellText(this.lang, 'adminShell.oauth.notKept'));
        await expect(note).toContainText(shellText(this.lang, 'adminShell.oauth.unverified'));
        await expect(note).toContainText(shellText(this.lang, 'adminShell.oauth.unverifiedHow', { domain: params['domain'] ?? '' }));
    }
}

/**
 * A provider's page a deep link opens in a new tab (Google's consoles, ERS): the human's work there is not the app's,
 * so a stand-in page answers in place of the real host (the firewall would refuse it), and the spec closes the tab.
 */
export async function standInProviderPages(context: BrowserContext, origins: readonly string[]): Promise<void> {
    for (const origin of origins) {
        await context.route(`${origin}/**`, (route) =>
            route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>${origin}</title><p>The provider's page.</p>` }),
        );
    }
}

/** Runs `trigger` (a click on a deep link) and closes the provider's tab it opened. */
export async function followDeepLink(page: Page, trigger: () => Promise<void>): Promise<void> {
    const opened = page.waitForEvent('popup');
    await trigger();
    await (await opened).close();
}
