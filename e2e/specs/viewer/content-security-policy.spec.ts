import type { Page, Route } from '@playwright/test';
import type { Locale } from '@hcm/shared';

import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { callController, chooseMenuItem, openLayers,
    openPhotoOptions, opacitySlider, t, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The page's meta Content Security Policy (behaviour V16, bad path; docs/research/design-review-security-cost.md §1.8):
 * markup that somehow reached the DOM cannot run code or contact a host the site does not use. An inline script is
 * refused (`script-src` has no `'unsafe-inline'`), and an image from an unknown host is refused before any request,
 * so not even the firewall sees it.
 */

interface Violation {
    readonly directive: string;
    readonly blocked: string;
}

/** Runs in the page: adds an element built with DOM calls only and reports the CSP violation it causes. */
function injectAndReport(kind: string): Promise<Violation> {
    return new Promise((resolve) => {
        document.addEventListener(
            'securitypolicyviolation',
            (event) => {
                resolve({ directive: event.violatedDirective, blocked: event.blockedURI });
            },
            { once: true },
        );
        if (kind === 'script') {
            const script = document.createElement('script');
            script.textContent = 'document.documentElement.dataset.injected = "yes";';
            document.body.append(script);
        } else {
            const image = document.createElement('img');
            image.alt = '';
            image.src = 'https://tracker.invalid/pixel.png';
            document.body.append(image);
        }
    });
}

test(
    'An inline script or an unknown host is refused by the page policy',
    { tag: '@S-V16-BAD-INLINE-SCRIPT' },
    async ({ page, firewall, consoleErrors }) => {
        await page.goto(sitePath('bucharest'));

        expect(await page.evaluate(injectAndReport, 'script')).toEqual({ directive: 'script-src-elem', blocked: 'inline' });
        await expect(page.locator('html')).not.toHaveAttribute('data-injected');
        expect(await page.evaluate(injectAndReport, 'image')).toEqual({
            directive: 'img-src',
            blocked: 'https://tracker.invalid/pixel.png',
        });

        expect(firewall.take()).toEqual([]);
        expect(consoleErrors.take()).toEqual([
            expect.stringContaining('Content Security Policy'),
            expect.stringContaining('Content Security Policy'),
        ]);
    },
);

/** Runs in the page before its scripts: keeps every CSP violation the page reports. */
function recordViolations(): void {
    const seen: string[] = [];
    Object.defineProperty(window, 'hcmE2eViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`);
    });
}

async function violations(page: Page): Promise<string[]> {
    return page.evaluate(() => (window as unknown as { hcmE2eViolations: string[] }).hcmE2eViolations);
}

async function closeVisibleSheet(page: Page, lang: Locale): Promise<void> {
    const close = page.getByRole('button', { name: t(lang, 'action.close'), exact: true }).filter({ visible: true });
    if ((await close.count()) > 0) {
        await close.first().click();
    }
}

test(
    'Every styled part of the viewer renders under the page policy without a violation',
    { tag: '@S-V16-BAD-INLINE-STYLE' },
    async ({ page, lang }) => {
        await page.addInitScript(recordViolations);
        const held: Route[] = [];
        await page.route('**/bucharest/data/manifest.json', (route) => {
            held.push(route);
        });
        await page.goto(sitePath('bucharest', { lang, hash: '16/44.42680/26.08720&layers=e2e-1966' }));
        await expect(page.getByRole('status').filter({ hasText: t(lang, 'viewer.loading') })).toBeVisible();
        await expect.poll(() => held.length).toBe(1);
        await held[0]?.fallback();
        await waitForEngineEvent(page, 'hcm-ready');

        const timeline = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        await timeline.focus();
        await timeline.press('End');
        await openLayers(page, lang);
        await openPhotoOptions(page, lang);
        const photos = opacitySlider(page, lang, t(lang, 'layers.photos'));
        await photos.focus();
        await photos.press('PageDown');
        await closeVisibleSheet(page, lang);

        await callController(page, 'openPoi', 'fixture-cladire');
        await expect(
            page.getByRole('heading', { name: lang === 'ro' ? 'Clădire demolată (fixture)' : 'Demolished building (fixture)' }),
        ).toBeVisible();
        await callController(page, 'openPhoto', 'strandul-opereta-1976');
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        await page.keyboard.press('+');
        await page.keyboard.press('Escape');
        await closeVisibleSheet(page, lang);
        await chooseMenuItem(page, lang, t(lang, 'photos.list'));
        await closeVisibleSheet(page, lang);
        await chooseMenuItem(page, lang, t(lang, 'about.title'));
        await expect(page.getByRole('dialog', { name: t(lang, 'about.title') })).toBeVisible();

        expect(await violations(page)).toEqual([]);
    },
);
