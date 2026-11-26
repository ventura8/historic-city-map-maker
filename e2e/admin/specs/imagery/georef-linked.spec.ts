import { expectStateSound } from '../../../support/state-check.js';
import { mapFacts, mapIdle } from '../../../support/map.js';
import { adminVisit } from '../../../tour/states.js';
import { scanPixelOf } from '../../support/imagery-geometry.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { georefText, linkViews, openGeoreferencer, pairRows, removePair, scanCentre, scanPane, showPane } from './georef.js';
import { readyImagery } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer's linked views (behaviour A16; docs/research/M3-interfaces.md §10.4, addendum of 2026-11-12): once the pairs
 * give a fit, zooming or panning the scan moves the map to the same place and the map's moves bring the scan along; Link the views
 * turns it off, and without a fit it is off and says when it will work.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** The map's zoom now. */
async function mapZoom(page: Parameters<typeof mapFacts>[0]): Promise<number> {
    return (await mapFacts(page)).zoom;
}

test(
    'Zooming the scan moves the map to the same place and the map brings the scan along',
    { tag: '@S-A16-HAPPY-GEOREF-LINKED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang, { linked: true });
        // The four corner pairs give an affine fit: the views are linked from the start.
        await expect(linkViews(page, lang)).toHaveAttribute('aria-pressed', 'true');
        const before = await mapZoom(page);

        // A zoom step on the scan (the keyboard's +) jumps the map to the scan's place and scale; the next step (×1.5) zooms the map in
        // by log2(1.5) more.
        await scanPane(page, lang).focus();
        await page.keyboard.press('+');
        await expect.poll(() => mapZoom(page)).not.toBe(before);
        await mapIdle(page);
        const first = await mapZoom(page);
        await page.keyboard.press('+');
        await expect.poll(async () => Math.abs((await mapZoom(page)) - first - Math.log2(1.5))).toBeLessThan(0.02);
        const facts = await mapFacts(page);
        const shown = scanPixelOf({ lng: facts.center[0], lat: facts.center[1] });
        const scan = await scanCentre(page);
        expect(Math.hypot(shown.x - scan.x, shown.y - scan.y), 'the map shows the place at the scan centre').toBeLessThan(80);
        await expectStateSound(page, adminVisit('georef.linked', lang));

        // The map's own Zoom out brings the scan along (it shows less closely).
        await showPane(page, lang, 'map');
        await page
            .locator('hcm-admin-map')
            .getByRole('button', { name: georefText(lang, 'adminContent.map.zoomOut'), exact: true })
            .click();
        await showPane(page, lang, 'scan');
        await expect.poll(async () => (await scanCentre(page)).scale).toBeLessThan(scan.scale);

        // Off: the scan zooms alone.
        await linkViews(page, lang).click();
        await expect(linkViews(page, lang)).toHaveAttribute('aria-pressed', 'false');
        await mapIdle(page);
        const still = await mapZoom(page);
        const alone = (await scanCentre(page)).scale;
        await scanPane(page, lang).focus();
        await page.keyboard.press('+');
        await expect.poll(async () => (await scanCentre(page)).scale).toBeGreaterThan(alone);
        await mapIdle(page);
        expect(await mapZoom(page)).toBe(still);
    },
);

test(
    'Without a fit Link the views is off and says when it will work',
    { tag: '@S-A16-BAD-GEOREF-LINKED-NO-FIT' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang, { linked: true });
        // Two of the four corner pairs removed: too few for any transform, so no fit.
        await removePair(page, lang, 4);
        await removePair(page, lang, 3);
        await expect(pairRows(page, lang)).toHaveCount(2);

        await expect(linkViews(page, lang)).toBeDisabled();
        await expect(linkViews(page, lang)).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByText(georefText(lang, 'adminContent.georef.linkViewsNoFit'))).toBeVisible();
        await mapIdle(page);
        const before = await mapZoom(page);
        const whole = (await scanCentre(page)).scale;
        await scanPane(page, lang).focus();
        await page.keyboard.press('+');
        await page.keyboard.press('+');
        await expect.poll(async () => (await scanCentre(page)).scale).toBeGreaterThan(whole);
        await mapIdle(page);
        expect(await mapZoom(page)).toBe(before);
    },
);

/** How far the scan pane is turned, in degrees clockwise. */
async function scanAngle(page: Parameters<typeof mapFacts>[0]): Promise<number> {
    const radians = await page
        .locator('hcm-scan-viewer')
        .evaluate((viewer) => (viewer as unknown as { view: { angle?: number } }).view.angle ?? 0);
    return (radians * 180) / Math.PI;
}

/** The difference of two bearings in degrees, within -180 … 180. */
function turnBetween(from: number, to: number): number {
    return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

test(
    'Each pane turns on its own and, with a fit, the other turns with it',
    { tag: '@S-A16-HAPPY-GEOREF-ROTATE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang, { linked: true });
        const together = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.turn.together') });
        await expect(together).toHaveAttribute('aria-pressed', 'true');

        // A first move links the panes; then r turns the scan 15 degrees clockwise and the map turns with it: its bearing falls by
        // about as much (the stand-in's fit stretches one axis more than the other, so not by exactly 15).
        await scanPane(page, lang).focus();
        await page.keyboard.press('+');
        await mapIdle(page);
        const bearing = (await mapFacts(page)).bearing;
        await page.keyboard.press('r');
        await expect.poll(() => scanAngle(page)).toBeCloseTo(15, 3);
        await expect.poll(async () => Math.abs(turnBetween(bearing, (await mapFacts(page)).bearing) + 15)).toBeLessThan(8);
        await expectStateSound(page, adminVisit('georef.rotated', lang));

        // The map's own Turn left (the ground goes anticlockwise, the bearing rises): the scan turns back with it.
        await showPane(page, lang, 'map');
        await page
            .getByRole('group', { name: georefText(lang, 'adminContent.georef.turn.map') })
            .getByRole('button', { name: georefText(lang, 'adminContent.georef.turn.left') })
            .click();
        await mapIdle(page);
        await showPane(page, lang, 'scan');
        await expect.poll(async () => Math.abs(await scanAngle(page))).toBeLessThan(8);

        // Turn right by its button: 15 degrees from where the map left it (linked, the map's answer may settle it a few degrees
        // on the stand-in's oblique fit); then Upright, as n does.
        const before = await scanAngle(page);
        await page
            .getByRole('group', { name: georefText(lang, 'adminContent.georef.turn.scan') })
            .getByRole('button', { name: georefText(lang, 'adminContent.georef.turn.right') })
            .click();
        await expect.poll(async () => Math.abs((await scanAngle(page)) - before - 15)).toBeLessThan(8);
        await page
            .getByRole('group', { name: georefText(lang, 'adminContent.georef.turn.scan') })
            .getByRole('button', { name: georefText(lang, 'adminContent.georef.turn.scanUp') })
            .click();
        await expect.poll(() => scanAngle(page)).toBeCloseTo(0, 3);
    },
);

test(
    'Turned apart, or without a fit, a pane turns alone',
    { tag: '@S-A16-BAD-GEOREF-ROTATE-APART' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang, { linked: true });
        const together = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.turn.together') });
        await scanPane(page, lang).focus();
        await page.keyboard.press('+');
        await mapIdle(page);

        // Turned apart: the scan turns, the map keeps its bearing.
        await together.click();
        await expect(together).toHaveAttribute('aria-pressed', 'false');
        const bearing = (await mapFacts(page)).bearing;
        await scanPane(page, lang).focus();
        await page.keyboard.press('r');
        await expect.poll(() => scanAngle(page)).toBeCloseTo(15, 3);
        await mapIdle(page);
        expect(turnBetween(bearing, (await mapFacts(page)).bearing)).toBeCloseTo(0, 3);

        // No fit: the toggle is off and cannot be pressed; the scan still turns by itself.
        await removePair(page, lang, 4);
        await removePair(page, lang, 3);
        await expect(pairRows(page, lang)).toHaveCount(2);
        await expect(together).toBeDisabled();
        await scanPane(page, lang).focus();
        await page.keyboard.press('n');
        await expect.poll(() => scanAngle(page)).toBeCloseTo(0, 3);
    },
);
