import { expect, test } from '../../support/test.js';
import { callController, openLayers, openViewer, t, viewer } from '../../support/viewer.js';

/** The photos-around-the-year chip shows only while the photos are switched on (the owner, 2026-11-22). */

const OBOR_VIEW = '16/44.44763/26.13822';

test(
    'The chip of the photos around the year follows the Photos switch',
    { tag: ['@S-V07-HAPPY-NEAR-YEAR-WITH-PHOTOS', '@S-V07-BAD-NEAR-YEAR-PHOTOS-OFF'] },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await callController(page, 'setYear', 1966);
        const chip = page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) });
        await expect(chip).toBeVisible();

        await openLayers(page, lang);
        const photos = viewer(page)
            .locator('hcm-photos-control')
            .getByRole('switch', { name: t(lang, 'layers.photos'), exact: true });
        await photos.click();
        await expect(photos).toHaveAttribute('aria-checked', 'false');
        await expect(chip).toHaveCount(0);

        await photos.click();
        await expect(photos).toHaveAttribute('aria-checked', 'true');
        // On a phone the Layers sheet covers the map's chips: closed, the chip is back.
        await page.keyboard.press('Escape');
        await expect(chip).toBeVisible();
    },
);
