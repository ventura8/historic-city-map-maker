import type { Page } from '@playwright/test';
import { REDACTED } from '@hcm/shared';

import { E2E_CITY_ID, E2E_TELEMETRY_HOST, E2E_TILESET_LAYER, SITE_ORIGIN } from '../../fixtures/world.js';
import type { MockApis } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, visibilitySwitch } from '../../support/viewer.js';

/**
 * Crash reporting (behaviour V20, PLAN Addendum 2): an uncaught error is POSTed to the manifest's
 * `analytics.errorEndpoint` (the e2e telemetry host; the `telemetry.reportError` function joins in M2) without
 * personal data: no hash, no query, no token, no e-mail address; at most five reports per page and one per message
 * per 10 s; a reporter that is down changes nothing the visitor sees. The crash itself is thrown into the page from
 * outside, as a bug in any script would.
 */

interface ErrorReport {
    readonly message: string;
    readonly stack?: string;
    readonly release: string;
    readonly cityId: string;
    readonly page: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly windowClass: string;
    readonly locale: string;
    readonly fatal: boolean;
    readonly source: string;
}

/** Throws `message` from a timer: an uncaught error, as a failing script would leave it. */
async function crash(page: Page, message: string): Promise<void> {
    await page.evaluate((text) => {
        setTimeout(() => {
            throw new Error(text);
        }, 0);
    }, message);
}

async function reports(mockApis: MockApis): Promise<ErrorReport[]> {
    return (await mockApis.calls(E2E_TELEMETRY_HOST))
        .filter((call) => call.path === '/report')
        .map((call) => JSON.parse(call.body) as ErrorReport);
}

const SECRET_URL = 'https://api.mapbox.com/v4/ventura86.e2e-1966/14/9369/5955.webp?access_token=pk.e2e-secret-token-123';

test('An uncaught error reaches the error endpoint, redacted', { tag: '@S-V20-HAPPY' }, async ({ page, lang, mockApis, consoleErrors }) => {
    await openViewer(page, { lang, hash: `15/44.37000/25.97000&layers=${E2E_TILESET_LAYER.id}&photo=strandul-opereta-1976` });

    await crash(page, 'e2e crash for visitor someone@example.org');

    await expect.poll(async () => (await reports(mockApis)).length).toBe(1);
    const [report] = await reports(mockApis);
    expect(report).toMatchObject({
        message: `Error: e2e crash for visitor ${REDACTED}`,
        cityId: E2E_CITY_ID,
        page: `${SITE_ORIGIN}/bucharest/`,
        locale: lang,
        fatal: false,
        source: 'window',
        release: expect.any(String),
        windowClass: expect.any(String),
    });
    const viewport = page.viewportSize();
    expect(report?.viewport).toEqual({ width: viewport?.width, height: viewport?.height });
    const body = JSON.stringify(report);
    for (const secret of ['someone@example.org', '44.37', 'strandul', 'layers=', '#']) {
        expect(body, `the report holds no "${secret}"`).not.toContain(secret);
    }
    expect(consoleErrors.take()).toEqual(['uncaught Error: e2e crash for visitor someone@example.org']);
});

test(
    'A tile URL with its access token in a crash reaches the endpoint without the query',
    { tag: '@S-V20-BAD-TOKEN-REDACTED' },
    async ({ page, lang, mockApis, consoleErrors }) => {
        await openViewer(page, { lang });

        await crash(page, `tile failed: ${SECRET_URL}`);

        await expect.poll(async () => (await reports(mockApis)).length).toBe(1);
        const [report] = await reports(mockApis);
        expect(report?.message).toBe('Error: tile failed: https://api.mapbox.com/v4/ventura86.e2e-1966/14/9369/5955.webp');
        expect(JSON.stringify(report)).not.toContain('access_token');
        expect(JSON.stringify(report)).not.toContain('pk.e2e-secret');
        expect(consoleErrors.take()).toEqual([`uncaught Error: tile failed: ${SECRET_URL}`]);
    },
);

test(
    'When the error endpoint is down the visitor sees nothing and the viewer keeps working',
    { tag: '@S-V20-BAD-REPORTER-DOWN' },
    async ({ page, lang, consoleErrors }) => {
        let attempts = 0;
        await page.route(`https://${E2E_TELEMETRY_HOST}/report`, (route) => {
            attempts += 1;
            return route.fulfill({ status: 503, contentType: 'text/plain', body: 'down' });
        });
        await openViewer(page, { lang, hash: '15/44.37000/25.97000' });

        await crash(page, 'e2e crash while the reporter is down');

        await expect.poll(() => attempts).toBe(1);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expect(page.getByRole('status').filter({ hasText: /\S/ })).toHaveCount(0);
        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, 'Corona 1966 (e2e)');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect.poll(() => page.evaluate(() => location.hash)).toContain(`layers=${E2E_TILESET_LAYER.id}`);
        const errors = consoleErrors.take();
        expect(errors).toContain('uncaught Error: e2e crash while the reporter is down');
        expect(errors.filter((error) => !error.startsWith('uncaught') && !error.includes('503'))).toEqual([]);
    },
);

test(
    'An error storm is capped: five reports a page, one per message',
    { tag: '@S-V20-BAD-RATE-LIMITED' },
    async ({ page, lang, mockApis, consoleErrors }) => {
        await openViewer(page, { lang });

        for (const message of ['storm A', 'storm A', 'storm A', 'storm B', 'storm C', 'storm D', 'storm E', 'storm F', 'storm G']) {
            await crash(page, message);
        }

        await expect
            .poll(async () => (await reports(mockApis)).map((report) => report.message))
            .toEqual(['Error: storm A', 'Error: storm B', 'Error: storm C', 'Error: storm D', 'Error: storm E']);
        expect(consoleErrors.take()).toHaveLength(9);
    },
);
