import type { Page } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import type { ConsentMessage } from '../../mock-apis/oauth.js';

/**
 * The admin harness's own page (e2e/admin/harness/): a blank document the admin server serves on the admin's origin
 * (`/__harness`, e2e/mock-apis/admin-server.ts), so a harness spec exercises the e2e world (Google's consent stand-in,
 * the forwarding of Google's hosts, the storage state, the hidden server) from where the admin runs, without the admin
 * app booting.
 */

const HARNESS_PATH = '/__harness';

/** Opens the harness page; every message the window receives from the consent stand-in is kept (`receivedMessages`). */
export async function openHarnessPage(page: Page): Promise<void> {
    await page.goto(HARNESS_PATH);
    await page.evaluate((standIn) => {
        const kept: { origin: string; data: unknown }[] = [];
        Object.defineProperty(window, 'hcmHarnessMessages', { value: kept });
        window.addEventListener('message', (event) => {
            // As the admin's e2e Google port does: only the stand-in's origin may post a grant.
            if (event.origin === standIn) {
                kept.push({ origin: event.origin, data: event.data as unknown });
            }
        });
    }, MOCK_API_ORIGIN);
}

/** What the stand-in posts: a grant (Allow) or a cancellation (Cancel). */
type StandInMessage = ConsentMessage | { readonly cancelled: true };

/** The messages the harness page received, oldest first. */
export function receivedMessages(page: Page): Promise<{ readonly origin: string; readonly data: StandInMessage }[]> {
    return page.evaluate(
        () => (window as unknown as { hcmHarnessMessages: { origin: string; data: StandInMessage }[] }).hcmHarnessMessages,
    );
}

/** The grant of the one message the harness page received. */
export async function receivedGrant(page: Page): Promise<ConsentMessage> {
    const [received] = await receivedMessages(page);
    const data = received?.data;
    if (data === undefined || 'cancelled' in data) {
        throw new Error(`no grant received: ${JSON.stringify(data)}`);
    }
    return data;
}

/** The stand-in consent page for `scope` (space-separated), as the admin's e2e Google port opens it. */
export function authorizeUrl(scope: string, loginHint = ''): string {
    return `${MOCK_API_ORIGIN}/__oauth/authorize?${new URLSearchParams({ scope, login_hint: loginHint }).toString()}`;
}

/** Runs in the page: opens `url` in a popup, as Firebase Auth opens Google's. */
export function openPopup(url: string): void {
    window.open(url, 'hcm-google', 'popup,width=500,height=600');
}

/** Runs in the page: `fetch` of `url`, the outcome as text (`<status>` or `network-error`). */
export async function fetchOutcome(request: { readonly url: string; readonly init?: RequestInit }): Promise<string> {
    try {
        return String((await fetch(request.url, request.init)).status);
    } catch {
        return 'network-error';
    }
}

/** Runs in the page: OAuth tokeninfo of an access token, as the admin's Google port calls it. */
export async function tokenInfo(token: string): Promise<{ readonly status: number; readonly body: Record<string, string> }> {
    const response = await fetch('https://oauth2.googleapis.com/tokeninfo', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as Record<string, string> };
}
