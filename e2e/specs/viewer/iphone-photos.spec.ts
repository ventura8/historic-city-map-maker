import { expect, test } from '../../support/test.js';
import { hashParam, menuButton, menuItemNamed, openViewer, t, viewer } from '../../support/viewer.js';

/**
 * The Photos switch of the Layers panel (the owner, 2026-11-15, design B), on an iPhone: WebKit with the iPhone 15 profile
 * (project `fn-webkit-iphone15`, e2e/projects.ts). A tap on the switch shows or hides every photo marker; the chevron opens
 * the popover with "All photos" / "Only near the selected year" and ±5 / ±10 / ±25 years, kept in the address.
 */

test.use({
    expectedConsoleErrors: [
        {
            text: /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/,
            url: /^(?:http:\/\/127\.0\.0\.1:\d+\/|$)/,
            why: "Playwright's WebKit inserts <style>body {}</style> from its own inspector (web-inspector://bootstrap.js) after a tap; the page adds no inline style (seen 2026-11-15)",
        },
    ],
});

async function openLayers(page: Parameters<typeof openViewer>[0], lang: 'ro' | 'en') {
    await menuButton(page, lang).tap();
    await menuItemNamed(page, t(lang, 'layers.title')).tap();
    const control = viewer(page).locator('hcm-layer-panel hcm-photos-control');
    await expect(control).toBeVisible();
    return control;
}

test(
    'On an iPhone the Photos switch hides every photo and its popover keeps only the photos near the year',
    { tag: '@S-V04-HAPPY-IPHONE-PHOTOS-SWITCH' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '16/44.44763/26.13822' });
        const control = await openLayers(page, lang);
        const photos = control.getByRole('switch', { name: t(lang, 'layers.photos'), exact: true });
        await expect(photos).toHaveAttribute('aria-checked', 'true');

        await photos.tap();
        await expect(photos).toHaveAttribute('aria-checked', 'false');
        await photos.tap();
        await expect(photos).toHaveAttribute('aria-checked', 'true');

        const chevron = control.getByRole('button', { name: t(lang, 'photosScope.options'), exact: true });
        const box = await chevron.boundingBox();
        expect(box?.height ?? 0, 'the chevron is a 44 px touch target').toBeGreaterThanOrEqual(44);
        await expect(chevron).toHaveAttribute('aria-haspopup', 'true');
        await chevron.tap();
        await expect(chevron).toHaveAttribute('aria-expanded', 'true');
        await control.getByRole('radio', { name: t(lang, 'photosScope.near'), exact: true }).tap();
        await expect.poll(() => hashParam(page, 'near')).toBe('10');
        await expect(control.getByRole('img', { name: t(lang, 'photosScope.nearOn', { years: '10' }), exact: true })).toBeVisible();

        await control.getByRole('radio', { name: t(lang, 'photosScope.years', { years: '25' }), exact: true }).tap();
        await expect.poll(() => hashParam(page, 'near')).toBe('25');
        await page.keyboard.press('Escape');
        await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    },
);

test(
    'On an iPhone a link without near= shows every photo, and All photos takes near= out again',
    { tag: '@S-V04-BAD-IPHONE-PHOTOS-ALL' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: '16/44.44763/26.13822&near=7' });
        const control = await openLayers(page, lang);
        await expect(control.getByRole('img')).toHaveCount(0);

        await control.getByRole('button', { name: t(lang, 'photosScope.options'), exact: true }).tap();
        await expect(control.getByRole('radio', { name: t(lang, 'photosScope.all'), exact: true })).toBeChecked();
        await control.getByRole('radio', { name: t(lang, 'photosScope.years', { years: '5' }), exact: true }).tap();
        await expect.poll(() => hashParam(page, 'near')).toBe('5');
        await control.getByRole('radio', { name: t(lang, 'photosScope.all'), exact: true }).tap();
        await expect.poll(() => hashParam(page, 'near')).toBeNull();
    },
);
