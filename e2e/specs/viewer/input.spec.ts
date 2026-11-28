import type { Locale } from '@hcm/shared';
import type { Page, Request } from '@playwright/test';

import { expectMapCounts } from '../../support/compare.js';
import { connectPad, holdButton, installFakePads, nextFrames, pressButton, setAxis, setTabHidden } from '../../support/gamepad.js';
import { focused } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { chooseMenuItem, currentHash, hashParam, menuButton, openViewer, t, viewer } from '../../support/viewer.js';

/**
 * Keyboard shortcuts, the gamepad (a fake pad: no real hardware was available), the basemap's light and the accessibility
 * statement (behaviours V36 to V39, docs/research/viewer-input.md).
 */

const VIEW = '15/44.42700/26.08530';
const AT_1966 = `${VIEW}&layers=e2e-1966`;
/** The bottom sheets' window, where Layers is a modal surface that takes the focus. */
const COMPACT_WINDOW = { width: 400, height: 800 };
/** Where the layers panel is always docked. */
const EXTRA_LARGE_WINDOW = { width: 1920, height: 1080 };
/** The right stick's vertical axis. */
const RIGHT_STICK_Y = 3;
/** A view centred on the one photo there (the lone photo of the keyboard scenarios). */
const ON_A_PHOTO = '18/44.429359/26.095447';
const BUTTON = {
    a: 0,
    b: 1,
    y: 3,
    lb: 4,
    rb: 5,
    leftTrigger: 6,
    rightTrigger: 7,
    back: 8,
    start: 9,
    up: 12,
    down: 13,
    left: 14,
    right: 15,
} as const;

function timeline(page: Page, lang: Locale): ReturnType<Page['getByRole']> {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

function helpDialog(page: Page, lang: Locale): ReturnType<Page['getByRole']> {
    return page.getByRole('dialog', { name: t(lang, 'input.help') });
}

/** What the dialog holds: its content is slotted, so not a DOM descendant of the kit's native `<dialog>`. */
function dialogContent(page: Page): ReturnType<ReturnType<typeof viewer>['locator']> {
    return viewer(page).locator('hcm-about-dialog');
}

function toast(page: Page, message: string): ReturnType<ReturnType<typeof viewer>['locator']> {
    return viewer(page).locator('hcm-snackbar .snackbar').filter({ hasText: message });
}

function viewOf(hash: string): readonly number[] {
    return hash.replace('#', '').split('&')[0]?.split('/').map(Number) ?? [];
}

test.describe('Keyboard shortcuts (V36)', () => {
    test('Year, opacity, photos, Layers and the help panel from single keys', { tag: '@S-V36-HAPPY' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: AT_1966 });
        const before = await timeline(page, lang).getAttribute('aria-valuetext');

        await page.keyboard.press('.');
        await expect(timeline(page, lang)).not.toHaveAttribute('aria-valuetext', before ?? '');
        await page.keyboard.press(',');
        await expect(timeline(page, lang)).toHaveAttribute('aria-valuetext', before ?? '');
        await expect(toast(page, t(lang, 'timeline.year', { year: '1966' }))).toBeVisible();

        await page.keyboard.press('i');
        await expect(viewer(page).locator('hcm-snackbar .snackbar').filter({ hasText: /%/ })).toBeVisible();
        await expect.poll(() => currentHash(page)).toMatch(/op=|opacity=/);

        await page.keyboard.press('l');
        await expect(page.getByRole('heading', { name: t(lang, 'layers.title'), exact: true }).first()).toBeVisible();

        await page.keyboard.press('?');
        await expect(helpDialog(page, lang)).toBeVisible();
        await expect(dialogContent(page)).toContainText(t(lang, 'input.year'));
        await expect(dialogContent(page)).toContainText(t(lang, 'input.padTitle'));
    });

    test('Next and previous photo step through the list and back', { tag: '@S-V36-HAPPY-PHOTOS' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: VIEW });

        await page.keyboard.press('n');
        await expect.poll(() => hashParam(page, 'photo')).not.toBeNull();
        const first = await hashParam(page, 'photo');
        await page.keyboard.press('n');
        await expect.poll(() => hashParam(page, 'photo')).not.toBe(first);
        await page.keyboard.press('p');
        await expect.poll(() => hashParam(page, 'photo')).toBe(first);
    });

    test(
        'Typing in a field of the page takes no shortcut, nor does a key with a modifier',
        { tag: '@S-V36-BAD-TYPING' },
        async ({ page, lang }) => {
            await openViewer(page, { lang, hash: VIEW });
            await page.evaluate(() => {
                const field = document.createElement('input');
                field.id = 'host-field';
                field.setAttribute('aria-label', 'host');
                document.body.prepend(field);
                field.focus();
            });
            const before = await currentHash(page);

            await page.keyboard.type('lnop?.,');

            await expect(page.locator('#host-field')).toHaveValue('lnop?.,');
            await expect(helpDialog(page, lang)).toBeHidden();
            expect(await currentHash(page)).toBe(before);

            await page.evaluate(() => {
                (document.activeElement as HTMLElement | null)?.blur();
            });
            await page.keyboard.press('Alt+?');
            await expect(helpDialog(page, lang)).toBeHidden();
        },
    );

    test(
        'Turned off in the help panel they stay off, and About still opens the panel',
        { tag: '@S-V36-BAD-TURNED-OFF' },
        async ({ page, lang }) => {
            await openViewer(page, { lang, hash: VIEW });
            await page.keyboard.press('?');
            await dialogContent(page)
                .getByRole('switch', { name: t(lang, 'input.toggle') })
                .click();
            await page.keyboard.press('Escape');
            await expect(helpDialog(page, lang)).toBeHidden();

            await page.reload();
            await expect(menuButton(page, lang)).toBeVisible();
            await page.keyboard.press('?');
            await expect(helpDialog(page, lang)).toBeHidden();

            await chooseMenuItem(page, lang, t(lang, 'about.title'));
            await page.getByRole('button', { name: t(lang, 'input.help') }).click();
            await expect(helpDialog(page, lang)).toBeVisible();
            await expect(dialogContent(page).getByRole('switch', { name: t(lang, 'input.toggle') })).toHaveAttribute(
                'aria-checked',
                'false',
            );
        },
    );

    test(
        'On an extra-large window Layers only moves the focus: the photo beside the panel stays open',
        { tag: '@S-V36-BAD-DOCKED-KEEPS-PHOTO' },
        async ({ page, lang }) => {
            await page.setViewportSize(EXTRA_LARGE_WINDOW);
            await openViewer(page, { lang, hash: VIEW });
            await page.keyboard.press('n');
            await expect.poll(() => hashParam(page, 'photo')).not.toBeNull();
            const photo = await hashParam(page, 'photo');

            await page.keyboard.press('l');

            await expect(viewer(page).locator('hcm-layer-panel:focus-within')).toHaveCount(1);
            await expect(
                viewer(page)
                    .locator('hcm-layer-panel')
                    .getByRole('heading', { name: t(lang, 'layers.title'), exact: true }),
            ).toBeVisible();
            expect(await hashParam(page, 'photo')).toBe(photo);
            await expect(viewer(page).locator('hcm-photo-sheet').getByRole('heading').first()).toBeVisible();
        },
    );

    test('Opacity without a layer on show says so and changes nothing', { tag: '@S-V36-BAD-NO-LAYER' }, async ({ page, lang }) => {
        await openViewer(page, { lang, hash: VIEW });
        await page.keyboard.press('o');

        await expect(toast(page, t(lang, 'input.noLayer'))).toBeVisible();
        expect(await hashParam(page, 'op')).toBeNull();
    });
});

/** A pad the loop has read once: what the first frame sees counts as already held. */
async function connectedPad(page: Page, lang: Locale): Promise<void> {
    await connectPad(page);
    await expect(toast(page, t(lang, 'gamepad.ready'))).toBeVisible();
    await nextFrames(page);
}

test.describe('The gamepad, a fake pad (V37)', () => {
    test('Its chunk comes only with a pad; the sticks and triggers move the map', { tag: '@S-V37-HAPPY' }, async ({ page, lang }) => {
        const chunks: string[] = [];
        page.on('request', (request: Request) => {
            if (/gamepad-[^/]*\.js/.test(request.url())) {
                chunks.push(request.url());
            }
        });
        await installFakePads(page);
        await openViewer(page, { lang, hash: VIEW });
        expect(chunks).toEqual([]);

        await connectPad(page);
        await expect(toast(page, t(lang, 'gamepad.ready'))).toBeVisible();
        expect(chunks).toHaveLength(1);

        const start = viewOf(await currentHash(page));
        await setAxis(page, 0, 1);
        await expect.poll(async () => viewOf(await currentHash(page))[2]).toBeGreaterThan(start[2] ?? 0);
        await setAxis(page, 0, 0);

        const zoom = viewOf(await currentHash(page))[0] ?? 0;
        await holdButton(page, BUTTON.rightTrigger, 1);
        await expect.poll(async () => viewOf(await currentHash(page))[0]).toBeGreaterThan(zoom);
        await holdButton(page, BUTTON.rightTrigger, 0);

        const zoomed = viewOf(await currentHash(page))[0] ?? 0;
        await holdButton(page, BUTTON.leftTrigger, 1);
        await expect.poll(async () => viewOf(await currentHash(page))[0]).toBeLessThan(zoomed);
        await holdButton(page, BUTTON.leftTrigger, 0);

        const lower = viewOf(await currentHash(page))[0] ?? 0;
        await setAxis(page, RIGHT_STICK_Y, -1);
        await expect.poll(async () => viewOf(await currentHash(page))[0]).toBeGreaterThan(lower);
        await setAxis(page, RIGHT_STICK_Y, 0);
        await expectMapCounts(page, 1, 0);
    });
});

test.describe('The gamepad, its buttons and a modal surface (V37)', () => {
    test(
        'Its buttons: the menu, a visible focus, close, Layers, photos, the year and help',
        { tag: '@S-V37-HAPPY-BUTTONS' },
        async ({ page, lang }) => {
            await installFakePads(page);
            await openViewer(page, { lang, hash: AT_1966 });
            await connectedPad(page, lang);

            await pressButton(page, BUTTON.start);
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
            await pressButton(page, BUTTON.down);
            await expect.poll(async () => (await focused(page))?.role).toBe('menuitem');
            await pressButton(page, BUTTON.b);
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeHidden();

            await pressButton(page, BUTTON.down);
            await expect.poll(async () => (await focused(page))?.ringVisible).toBe(true);

            await timeline(page, lang).focus();
            const year = await timeline(page, lang).getAttribute('aria-valuetext');
            await pressButton(page, BUTTON.right);
            await expect(timeline(page, lang)).not.toHaveAttribute('aria-valuetext', year ?? '');
            await pressButton(page, BUTTON.left);
            await expect(timeline(page, lang)).toHaveAttribute('aria-valuetext', year ?? '');

            await pressButton(page, BUTTON.rb);
            await expect.poll(() => hashParam(page, 'photo')).not.toBeNull();
            const photo = await hashParam(page, 'photo');
            await pressButton(page, BUTTON.rb);
            await expect.poll(() => hashParam(page, 'photo')).not.toBe(photo);
            await pressButton(page, BUTTON.lb);
            await expect.poll(() => hashParam(page, 'photo')).toBe(photo);
            await pressButton(page, BUTTON.b);
            await expect.poll(() => hashParam(page, 'photo')).toBeNull();

            await pressButton(page, BUTTON.y);
            await expect(page.getByRole('heading', { name: t(lang, 'layers.title'), exact: true }).first()).toBeVisible();
            await pressButton(page, BUTTON.y);

            await pressButton(page, BUTTON.back);
            await expect(helpDialog(page, lang)).toBeVisible();
            await pressButton(page, BUTTON.b);
            await expect(helpDialog(page, lang)).toBeHidden();
        },
    );

    test(
        "A presses what has the focus, and with none the photo at the map's centre",
        { tag: '@S-V37-HAPPY-ACTIVATE' },
        async ({ page, lang }) => {
            await installFakePads(page);
            await openViewer(page, { lang, hash: ON_A_PHOTO });
            await connectedPad(page, lang);
            await expect.poll(() => hashParam(page, 'photo')).toBeNull();

            await pressButton(page, BUTTON.a);
            await expect.poll(() => hashParam(page, 'photo')).not.toBeNull();

            await pressButton(page, BUTTON.b);
            await expect.poll(() => hashParam(page, 'photo')).toBeNull();
            await menuButton(page, lang).focus();
            await pressButton(page, BUTTON.a);
            await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
        },
    );

    test('After a mouse click the pad still shows where the focus went', { tag: '@S-V37-HAPPY-RING' }, async ({ page, lang }) => {
        await page.setViewportSize(COMPACT_WINDOW);
        await installFakePads(page);
        await openViewer(page, { lang, hash: VIEW });
        await connectedPad(page, lang);
        await viewer(page).locator('canvas.mapboxgl-canvas').click();

        await pressButton(page, BUTTON.y);
        await expect(page.getByRole('heading', { name: t(lang, 'layers.title'), exact: true }).first()).toBeVisible();
        await expect.poll(async () => (await focused(page))?.outlined).toBe(true);
        await pressButton(page, BUTTON.b);

        await viewer(page).locator('canvas.mapboxgl-canvas').click();
        await pressButton(page, BUTTON.start);
        await expect.poll(async () => (await focused(page))?.role).toBe('menuitem');
        await expect.poll(async () => (await focused(page))?.outlined).toBe(true);
    });

    test(
        'Start under a modal surface opens no menu behind it, and B closes the surface at once',
        { tag: '@S-V37-BAD-START-UNDER-MODAL' },
        async ({ page, lang }) => {
            await installFakePads(page);
            await openViewer(page, { lang, hash: VIEW });
            await connectedPad(page, lang);
            await pressButton(page, BUTTON.back);
            await expect(helpDialog(page, lang)).toBeVisible();

            await pressButton(page, BUTTON.start);
            await expect(viewer(page).locator('hcm-fab-menu')).not.toHaveAttribute('open');

            await pressButton(page, BUTTON.b);
            await expect(helpDialog(page, lang)).toBeHidden();
            await expect(viewer(page).locator('hcm-fab-menu')).not.toHaveAttribute('open');
        },
    );
});

test.describe('The gamepad refused, hidden or covered (V37)', () => {
    test('A pad without the standard layout is refused and moves nothing', { tag: '@S-V37-BAD-NOT-STANDARD' }, async ({ page, lang }) => {
        await installFakePads(page);
        await openViewer(page, { lang, hash: VIEW });
        const before = await currentHash(page);

        await connectPad(page, '');
        await expect(toast(page, t(lang, 'gamepad.refused'))).toBeVisible();
        await setAxis(page, 0, 1);
        await nextFrames(page);

        expect(await currentHash(page)).toBe(before);
    });

    test('It stops while the tab is hidden and goes on when it comes back', { tag: '@S-V37-BAD-TAB-HIDDEN' }, async ({ page, lang }) => {
        await installFakePads(page);
        await openViewer(page, { lang, hash: VIEW });
        await connectedPad(page, lang);
        await setTabHidden(page, true);
        const before = viewOf(await currentHash(page));

        await setAxis(page, 0, 1);
        await nextFrames(page);
        expect(viewOf(await currentHash(page))).toEqual(before);

        await setTabHidden(page, false);
        await expect.poll(async () => viewOf(await currentHash(page))[2]).toBeGreaterThan(before[2] ?? 0);
    });

    test('A modal surface keeps the map still', { tag: '@S-V37-BAD-COVERED-MAP' }, async ({ page, lang }) => {
        await installFakePads(page);
        await openViewer(page, { lang, hash: VIEW });
        await connectedPad(page, lang);
        await pressButton(page, BUTTON.back);
        await expect(helpDialog(page, lang)).toBeVisible();
        const before = await currentHash(page);

        await setAxis(page, 0, 1);
        await nextFrames(page);

        expect(await currentHash(page)).toBe(before);
    });
});

/** The basemap's light as Mapbox GL reports it, on each live map. */
