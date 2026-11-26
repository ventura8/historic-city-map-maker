import type { APIRequestContext, Page } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import type { ConsentRecord } from '../../mock-apis/oauth.js';
import type { InputFlow } from '../../support/budget.js';

/**
 * Google's consent, as the admin tier sees it (docs/research/M2b-interfaces.md §2.6): the e2e build opens the mock
 * APIs' stand-in page (`/__oauth/authorize`) in a popup, and the spec acts as the human on it. `opened` waits for the
 * popup an in-app click opens; `allow` and `cancel` are the human's decision, counted in a consent flow of the input
 * budget (§3.5: Google's page is counted apart from the in-app inputs). `requests` reads what the stand-in recorded.
 */

export class ConsentPage {
    readonly page: Page;

    constructor(page: Page) {
        this.page = page;
    }

    /** The scopes the step asked for, beyond the sign-in's own (the ticked checkboxes' values). */
    async requestedScopes(): Promise<string[]> {
        return this.page.locator('input[name="scope"]').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    }

    /** The account the consent is given with (Google's account chooser). */
    async chooseAccount(email: string): Promise<void> {
        await this.page.getByRole('radio', { name: email }).check();
    }

    /** Unticks a requested scope (Google's granular consent). */
    async untick(scope: string): Promise<void> {
        await this.page.getByRole('checkbox', { name: scope }).uncheck();
    }

    /** Allow: the popup posts the grant to the admin and closes. */
    async allow(flow: InputFlow): Promise<void> {
        const closed = this.page.waitForEvent('close');
        await flow.click(this.page.getByRole('button', { name: 'Allow' }));
        await closed;
    }

    /** Cancel: the popup closes without a grant. */
    async cancel(flow: InputFlow): Promise<void> {
        const closed = this.page.waitForEvent('close');
        await flow.click(this.page.getByRole('button', { name: 'Cancel' }));
        await closed;
    }
}

export class GoogleConsent {
    readonly #api: APIRequestContext;
    readonly #testId: string;

    constructor(api: APIRequestContext, testId: string) {
        this.#api = api;
        this.#testId = testId;
    }

    /** Runs `trigger` (the in-app click that asks Google) and returns the consent popup it opened. */
    async opened(page: Page, trigger: () => Promise<void>): Promise<ConsentPage> {
        const popup = page.waitForEvent('popup');
        await trigger();
        const consent = await popup;
        await consent.getByRole('button', { name: 'Allow' }).waitFor();
        return new ConsentPage(consent);
    }

    /** Forgets the consent requests recorded for this test (before it starts). */
    async reset(): Promise<void> {
        const response = await this.#api.post(`${MOCK_API_ORIGIN}/__oauth/reset?test=${encodeURIComponent(this.#testId)}`);
        if (!response.ok()) {
            throw new Error(`consent reset: ${String(response.status())}`);
        }
    }

    /** The consent requests the stand-in recorded for this test, oldest first. */
    async requests(): Promise<ConsentRecord[]> {
        const response = await this.#api.get(`${MOCK_API_ORIGIN}/__oauth/requests?test=${encodeURIComponent(this.#testId)}`);
        return (await response.json()) as ConsentRecord[];
    }
}
