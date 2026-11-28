import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { connectPad, installFakePads, nextFrames, pressButton, setAxis } from '../../support/gamepad.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t } from '../../support/viewer.js';

test(
    'The year pill cycles the front date, retains focus and toggles the panel',
    { tag: ['@S-V68-HAPPY-PILL-CONTENT', '@S-V68-BAD-PILL-NO-CONTENT'] },
    async ({ page, lang }) => {
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang });
        const pill = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        const panel = page.locator('hcm-date-menu');
        const live = page.locator('hcm-timeline [aria-live]');
        await pill.press('Home');
        await pill.press('ArrowDown');
        await expect(panel.locator('.item').first()).toHaveAttribute('data-front', '');
        await expect(live).toContainText('Corona');
        await expect(pill).toBeFocused();
        await pill.press('ArrowUp');
        await expect(panel.locator('.item').last()).toHaveAttribute('data-front', '');
        await pill.press('Space');
        await expect(panel).toHaveCount(0);
        await expect(live).toHaveText(t(lang, 'timeline.datesClosed', { year: '1980' }));
        await pill.press('Enter');
        await expect(live).toHaveText(t(lang, 'timeline.datesOpened', { year: '1980' }));
        await expect(panel).toBeVisible();
        await pill.press('End');
        await expect(live).toHaveText(t(lang, 'timeline.present'));
        await pill.press('ArrowDown');
        await expect(panel).toHaveCount(0);
        await expect(pill).toBeFocused();
    },
);

test(
    'The gamepad owns the year pill only while it has focus',
    { tag: ['@S-V68-HAPPY-PILL-GAMEPAD', '@S-V68-BAD-PILL-GAMEPAD-BLUR'] },
    async ({ page, lang }) => {
        await installFakePads(page);
        await serveManifest(page, twoDatesOf1980());
        await openViewer(page, { lang });
        await connectPad(page);
        const pill = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        await pill.press('End');
        await pressButton(page, 14);
        await expect(pill).toHaveAttribute('aria-valuenow', '0');
        await pressButton(page, 0);
        await expect(page.locator('hcm-date-menu')).toBeVisible();
        await pill.blur();
        await setAxis(page, 0, 1);
        await nextFrames(page);
        await expect(pill).toHaveAttribute('aria-valuenow', '0');
    },
);
