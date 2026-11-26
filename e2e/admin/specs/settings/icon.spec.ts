import { STORAGE_PATHS, translateApiError, type ApiErrorCode } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';

import { E2E_PROJECT_ID } from '../../world.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { expect, test } from '../../support/content-test.js';
import type { ContentWorld } from '../../support/content.js';
import { seedPublicCity } from '../../support/flows.js';
import { text } from './world.js';

/**
 * Settings → Browser tab icon (behaviour A101; docs/research/M2-interfaces.md → The city's tab icon) against the Functions,
 * Firestore and Storage emulators: a fresh city gets the default icon (the Layers panel's map glyph in its colour) from the
 * manifest's build; an editor uploads a PNG, `cities.setIcon` writes the three PNGs at their fixed names in the public bucket
 * (the city pages' tab links), the card previews it as Custom, and Use the default icon draws the default again. An SVG is
 * refused in the browser and a tiny PNG by the server, each with its plain message in the admin's language, and the icon
 * stays as it was. The public bucket's addresses are answered from the Storage emulator, as a visitor's browser reaches them.
 */

const AT = new Date('2026-11-08T09:00:00.000Z');
const PUBLIC_BUCKET = `${E2E_PROJECT_ID}-public`;
/** The default is drawn by the manifest's build, which a new city's write requests (debounced in the emulator too). */
const BUILD_TIMEOUT_MS = 90_000;

function card(page: Page): Locator {
    return page.locator('hcm-settings-page section[data-section="icon"]');
}

async function png(side: number, background: string): Promise<Buffer> {
    return sharp({ create: { width: side, height: side, channels: 4, background } })
        .png()
        .toBuffer();
}

/** The public bucket's icon objects of the city, answered from the Storage emulator (what a visitor's browser fetches). */
async function serveIcons(page: Page, content: ContentWorld): Promise<void> {
    const folder = `https://storage.googleapis.com/${PUBLIC_BUCKET}/cities/${content.city}/`;
    await page.route(`${folder}icon-*.png*`, async (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
        const stored = await content.emulators.storageObject(PUBLIC_BUCKET, `cities/${content.city}/${name}`);
        await (stored === undefined
            ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
            : route.fulfill({ status: 200, contentType: 'image/png', body: stored }));
    });
}

async function iconRecord(content: ContentWorld): Promise<Record<string, unknown> | undefined> {
    return (await content.document())?.['icon'] as Record<string, unknown> | undefined;
}

async function choose(page: Page, file: { readonly name: string; readonly mimeType: string; readonly buffer: Buffer }): Promise<void> {
    await card(page).locator('input[type="file"]').setInputFiles(file);
}

function refusal(lang: 'ro' | 'en', code: ApiErrorCode, params: Readonly<Record<string, string>> = {}): string {
    return translateApiError(lang, code, params);
}

test(
    'A fresh city has the default tab icon, an editor uploads one and goes back to the default',
    { tag: ['@S-A101-HAPPY-DEFAULT', '@S-A101-HAPPY-UPLOAD', '@S-A101-HAPPY-RESET'] },
    async ({ page, lang, content }) => {
        test.setTimeout(180_000);
        await seedPublicCity(content, AT);
        await serveIcons(page, content);
        await expect
            .poll(async () => (await iconRecord(content))?.['source'], {
                message: 'the build drew the default icon',
                timeout: BUILD_TIMEOUT_MS,
            })
            .toBe('default');
        expect(await content.emulators.storageObject(PUBLIC_BUCKET, STORAGE_PATHS.cityIcon(content.city, 32))).toBeDefined();

        await page.goto(content.address(lang, 'settings/icon', { map: false }));
        await expect(card(page).locator('[data-icon-source]')).toHaveText(text(lang, 'adminContent.settings.icon.default'));
        await expect
            .poll(() =>
                card(page)
                    .locator('img[data-icon-preview]')
                    .evaluate((img: HTMLImageElement) => img.naturalWidth),
            )
            .toBe(180);
        await expectStateSound(page, adminVisit('settings.icon-default', lang));

        await choose(page, { name: 'sigla.png', mimeType: 'image/png', buffer: await png(256, '#1d4e89') });

        await expect(page.locator('hcm-snackbar').filter({ hasText: text(lang, 'adminContent.settings.icon.saved') })).toBeVisible();
        await expect.poll(async () => (await iconRecord(content))?.['source']).toBe('custom');
        await expect(card(page).locator('[data-icon-source]')).toHaveText(text(lang, 'adminContent.settings.icon.custom'));
        const preview = card(page).locator('img[data-icon-preview]');
        await expect(preview).toHaveAttribute('src', new RegExp(`/cities/${content.city}/icon-180\\.png\\?v=[a-f0-9]{8}$`));
        await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(180);
        const tab = await content.emulators.storageObject(PUBLIC_BUCKET, STORAGE_PATHS.cityIcon(content.city, 32));
        const { data } = await sharp(tab).raw().toBuffer({ resolveWithObject: true });
        expect(Array.from(data.subarray(0, 3))).toEqual([0x1d, 0x4e, 0x89]);
        await expectStateSound(page, adminVisit('settings.icon-custom', lang));

        await card(page)
            .getByRole('button', { name: text(lang, 'adminContent.settings.icon.reset'), exact: true })
            .click();
        await expect.poll(async () => (await iconRecord(content))?.['source']).toBe('default');
        await expect(card(page).locator('[data-icon-source]')).toHaveText(text(lang, 'adminContent.settings.icon.default'));
    },
);

test(
    'An SVG and a tiny image are refused with a plain message, and the icon stays as it was',
    { tag: ['@S-A101-BAD-SVG', '@S-A101-BAD-SMALL'] },
    async ({ page, lang, content, consoleErrors }) => {
        await seedPublicCity(content, AT);
        await serveIcons(page, content);
        await page.goto(content.address(lang, 'settings/icon', { map: false }));
        await expect(card(page)).toBeVisible();

        // An SVG, even one that calls itself a PNG: refused in the browser from its first bytes, nothing sent.
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><script>alert(1)</script></svg>');
        await choose(page, { name: 'sigla.png', mimeType: 'image/png', buffer: svg });
        await expect(card(page).locator('[data-icon-error]')).toHaveText(refusal(lang, 'apiError.cityIcon.badType'));
        await expectStateSound(page, adminVisit('settings.icon-refused', lang));

        // A PNG of 64 pixels: the server measures it and refuses it.
        await choose(page, { name: 'mica.png', mimeType: 'image/png', buffer: await png(64, '#1d4e89') });
        await expect(card(page).locator('[data-icon-error]')).toHaveText(refusal(lang, 'apiError.cityIcon.tooSmall', { min: '192' }));
        // The callable's refusal is a 400 the browser logs: the only console line of the test.
        expect(consoleErrors.take()).toEqual([expect.stringMatching(/status of 400 .*cities-setIcon/)]);

        // Nothing changed: no upload became the city's icon (the build may have drawn the default meanwhile).
        expect((await iconRecord(content))?.['source']).not.toBe('custom');
    },
);
