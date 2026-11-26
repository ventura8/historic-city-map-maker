import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import {
    addPair,
    errorsLine,
    expectPanesAligned,
    expectPanesAlignedAtSizes,
    georeferencerReady,
    georefText,
    landmark,
    openGeoreferencer,
    pairRows,
    removePair,
    scanPane,
    transformRadio,
} from './georef.js';
import { detail, errorText, imageryText, importFromList, readyImagery, versionState } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer (behaviours A12, A16; docs/research/M3-interfaces.md §6, §10.4): a frame whose automatic matching
 * found too few pairs waits for points with its four corner pairs; the admin pairs landmarks of the synthetic world (a
 * click on the scan, a click on the map, or the keyboard's crosshairs), and every change refits live (`fitTransform` of
 * `@hcm/shared`): the residual table, the errors, the transforms each pair count allows, and pairs that span no area are
 * refused (the page's own check, `adminContent.georef.degenerate`; the server's is `apiError.imagery.degenerateGcps`).
 * Save hands the points to `imagery.saveGcps` and the same job continues from georeferencing.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

/** A message with its `{param}` holes as a pattern (`.+` for each, the given ones literally). */
function pattern(text: string): RegExp {
    return new RegExp(text.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\w+\}/g, '.+'));
}

test(
    'GCP editing updates residuals, transform and preview, and saving queues a job',
    { tag: ['@S-A16-HAPPY', '@S-A12-BAD-AUTOGCP-FAILS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The matcher finds too few pairs; once the admin's points are saved, the same job measures 28.4 m.
        await imagery.script({ attempts: [{ outcome: 'no-match' }, { outcome: 'over' }] });
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');

        // The job waits for points, says why, and offers the georeferencer (S-A12-BAD-AUTOGCP-FAILS).
        await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(pattern(errorText(lang, 'apiError.imagery.noMatch')))).toBeVisible();
        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();
        await georeferencerReady(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);
        await expect(page.getByRole('switch', { name: georefText(lang, 'adminContent.georef.preview') })).toBeChecked();

        // Two landmarks paired: six pairs allow the second-order polynomial; two more for the checks below.
        await expect(transformRadio(page, lang, 'poly2')).toBeDisabled();
        await addPair(page, lang, landmark(0));
        await expect(pairRows(page, lang)).toHaveCount(5);
        await expect(pairRows(page, lang).last()).toContainText(georefText(lang, 'adminContent.georef.origin.manual'));
        await addPair(page, lang, landmark(1));
        await expect(transformRadio(page, lang, 'poly2')).toBeEnabled();
        await transformRadio(page, lang, 'poly2').check();
        await addPair(page, lang, landmark(2));
        await addPair(page, lang, landmark(3));
        await expect(pairRows(page, lang)).toHaveCount(8);

        // A pair left out of the fit becomes the checkpoint; another one deleted: seven pairs still fit the polynomial.
        await pairRows(page, lang).first().getByRole('checkbox').uncheck();
        await expect(errorsLine(page)).toContainText(pattern(georefText(lang, 'adminContent.georef.checkpoint', { count: '1' })));
        await removePair(page, lang, 8);
        await expect(pairRows(page, lang)).toHaveCount(7);

        // Save: the waiting job goes on from georeferencing, on the admin's points.
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') }).click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/version/${versionId}$`), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const georef = (await imagery.version(versionId))?.['georef'] as {
            method: string;
            transform: string;
            gcps: { enabled: boolean }[];
        };
        expect([georef.method, georef.transform, georef.gcps.length, georef.gcps.filter((gcp) => !gcp.enabled).length]).toEqual([
            'gcps',
            'poly2',
            7,
            1,
        ]);
        // Attempt 1 downloads on the small job and is processed up to the points (finding 56); the Save is attempt 2.
        expect((await imagery.runs()).map((run) => [run.jobId, run.attempt])).toEqual([
            [versionId, 1],
            [versionId, 1],
            [versionId, 2],
        ]);

        // Over the threshold, the admin's points still need Approve: one click sends the version to the publisher.
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.imagery.approve') })
            .click();
        await expect
            .poll(async () => (await imagery.version(versionId))?.['approval'], { timeout: FUNCTIONS_TIMEOUT_MS })
            .toMatchObject({ auto: false });
    },
);

test(
    'Too few GCPs disable the transform',
    { tag: '@S-A16-BAD-TOO-FEW-GCPS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);

        // Two of the four corner pairs deleted: two left, one short of an affine fit.
        for (const number of [4, 3]) {
            await removePair(page, lang, number);
        }
        await expect(pairRows(page, lang)).toHaveCount(2);
        await expect(
            page.getByRole('alert').filter({ hasText: georefText(lang, 'adminContent.georef.tooFew.one', { missing: '1' }) }),
        ).toBeVisible();
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeDisabled();
        await expect(transformRadio(page, lang, 'poly2')).toBeDisabled();
        await expect(transformRadio(page, lang, 'tps')).toBeDisabled();
        await expectStateSound(page, adminVisit('georef.too-few', lang));
    },
);

test(
    'An RMSE over the threshold shows a warning',
    { tag: '@S-A16-BAD-RMSE-OVER-THRESHOLD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);

        // A landmark paired 800 m off its place: the checks disagree by far more than the city's 15 m.
        await addPair(page, lang, landmark(0), 800);
        const warning = page
            .getByRole('alert')
            .filter({ hasText: pattern(georefText(lang, 'adminContent.georef.rmseOver', { threshold: '15' })) });
        await expect(warning).toBeVisible();
        await expect(warning).toContainText('15');
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeEnabled();
        await expectStateSound(page, adminVisit('georef.rmse-over', lang));
    },
);

test(
    'Pairs can be placed without a pointer, one after another',
    { tag: '@S-A16-HAPPY-KEYBOARD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        await expect(pairRows(page, lang)).toHaveCount(4);

        // Add at the centres: a pair at both crosshairs, from the keyboard; it is not chosen, so the arrows pan the scan
        // to the next place (CR-M3-47), where a second pair goes the same way.
        const centres = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addAtCentres') });
        await centres.focus();
        await centres.press('Enter');
        await expect(pairRows(page, lang)).toHaveCount(5);
        await scanPane(page, lang).focus();
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowUp');
        await centres.focus();
        await centres.press('Enter');
        await expect(pairRows(page, lang)).toHaveCount(6);
        await expect(pairRows(page, lang).getByRole('button', { pressed: true })).toHaveCount(0);
        await expectStateSound(page, adminVisit('georef.pairs', lang));

        // A pair chosen in the table moves with the arrows (ten preview pixels with Shift), which refits.
        const sixth = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.pairName', { number: '6' }), exact: true });
        await sixth.focus();
        await sixth.press('Enter');
        await expect(sixth).toHaveAttribute('aria-pressed', 'true');
        // Its error in metres: the column every window shows (a narrow table leaves the pixel and the place out).
        const residual = pairRows(page, lang).last().getByRole('cell').filter({ hasText: / m$/ });
        const before = await residual.innerText();
        await scanPane(page, lang).focus();
        await page.keyboard.press('Shift+ArrowRight');
        await expect(residual).not.toHaveText(before);

        // Esc lets it go: the arrows pan again and the pair stays where it is.
        await page.keyboard.press('Escape');
        await expect(sixth).toHaveAttribute('aria-pressed', 'false');
        const moved = await residual.innerText();
        await page.keyboard.press('ArrowRight');
        await expect(residual).toHaveText(moved);

        // Chosen again, Delete removes it.
        await sixth.focus();
        await sixth.press('Enter');
        await scanPane(page, lang).focus();
        await page.keyboard.press('Delete');
        await expect(pairRows(page, lang)).toHaveCount(5);
    },
);

/** Three places on one diagonal of the city, far apart: pairs that span a line, not an area. */
const IN_A_LINE = [
    { lat: 44.36, lng: 25.98 },
    { lat: 44.45, lng: 26.1 },
    { lat: 44.54, lng: 26.22 },
] as const;

test('Pairs in a line are refused', { tag: '@S-A16-BAD-DEGENERATE' }, async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
    test.setTimeout(150_000);
    const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
    await imagery.script({ attempts: [{ outcome: 'no-match' }] });
    await openGeoreferencer(page, lang);

    // Three pairs along one diagonal, then the four corner pairs deleted: three pairs, enough in number, on a line.
    for (const place of IN_A_LINE) {
        await addPair(page, lang, place);
    }
    await expect(pairRows(page, lang)).toHaveCount(7);
    for (const number of [4, 3, 2, 1]) {
        await removePair(page, lang, number);
    }
    await expect(pairRows(page, lang)).toHaveCount(3);
    await expect(page.getByRole('alert').filter({ hasText: georefText(lang, 'adminContent.georef.degenerate') })).toBeVisible();
    await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeDisabled();
    await expectStateSound(page, adminVisit('georef.degenerate', lang));
});

/** A figure as the georeferencer writes it (one decimal at most). */
function metres(lang: 'ro' | 'en', value: number): string {
    return new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(value);
}

test(
    "A fitted version opens on its own figures; edited pairs are said to be a refit that saving makes the version's map",
    { tag: ['@S-A16-HAPPY-VERSION-FIGURES', '@S-A16-BAD-EDIT-REFITS'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A KH-9 pan frame mapped by its camera (M15): the version stores the camera's figures and residuals, and its lattice.
        await imagery.script({ attempts: [{ outcome: 'over', lattice: true }] });
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const stored = (await imagery.version(versionId))?.['georef'] as {
            fitRmseM: number;
            checkpointRmseM: number;
            checkpointCount: number;
            lattice?: { nodes: unknown[] };
        };
        expect(stored.lattice?.nodes).toHaveLength(289);
        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();
        await georeferencerReady(page, lang);

        // Unedited: the figures the version page shows, not a refit of the pairs.
        const fit = georefText(lang, 'adminContent.georef.fit', { rmse: metres(lang, stored.fitRmseM) });
        const checks = { rmse: metres(lang, stored.checkpointRmseM), count: String(stored.checkpointCount) };
        const refitted = page.getByText(georefText(lang, 'adminContent.georef.refitted'));
        await expect(errorsLine(page)).toContainText(fit);
        await expect(errorsLine(page)).toContainText(georefText(lang, 'adminContent.georef.checkpoint', checks));
        await expect(refitted).toHaveCount(0);

        // A pair left out of the fit: every figure is a refit through the pairs, and the page says so (S-A16-BAD-EDIT-REFITS).
        await pairRows(page, lang).first().getByRole('checkbox').uncheck();
        await expect(refitted).toBeVisible();
        await expect(errorsLine(page)).not.toContainText(fit);
        await expectStateSound(page, adminVisit('georef.refitted', lang));

        // Discard: the version's own figures again.
        await page.getByRole('button', { name: georefText(lang, 'adminContent.common.discard') }).click();
        await expect(errorsLine(page)).toContainText(fit);
        await expect(refitted).toHaveCount(0);
    },
);

test(
    "The georeferencer's lazy chunk that cannot be fetched is said in words, and the page keeps working",
    { tag: ['@S-A16-BAD-TERRAIN-CHUNK', '@S-A89-BAD-SNAP-CHUNK'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'over', lattice: true, terrain: true }] });
        // The map a lattice or terrain publishes and Snap my points are the chunk `georef-extras` (DECISIONS-for-review.md §110):
        // offline, or a deploy replaced it, its fetch fails.
        await page.route('**/georef-extras-*.js', (route) => route.abort('internetdisconnected'));
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const stored = (await imagery.version(versionId))?.['georef'] as { fitRmseM: number };
        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();

        // The snackbar says the version's map did not load; its figures still show and the preview is the pairs' fit.
        await expect(page.getByText(georefText(lang, 'adminContent.georef.mapUnavailable'))).toBeVisible();
        await georeferencerReady(page, lang);
        await expect(errorsLine(page)).toContainText(georefText(lang, 'adminContent.georef.fit', { rmse: metres(lang, stored.fitRmseM) }));
        await expect.poll(async () => (await page.evaluate(warpedCornersInPage)).length).toBe(4);

        // Snap my points: nothing is sent, the page says why and stays where it is (S-A89-BAD-SNAP-CHUNK).
        await addPair(page, lang, landmark(0));
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.snap') }).click();
        await expect(page.getByText(georefText(lang, 'adminContent.georef.snapUnavailable'))).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/georef/${versionId}$`));
        // Chromium logs each aborted fetch of the chunk.
        expect(consoleErrors.takeMatching(/georef-extras-/).length).toBeGreaterThan(0);
    },
);

/** Runs in the page: the corners of the georeferencer's warped preview (`[longitude, latitude]`), none while it is not drawn. */
function warpedCornersInPage(): [number, number][] {
    interface StyleMap {
        getStyle(): { sources: Record<string, { coordinates?: [number, number][] }> };
    }
    const map = (window as unknown as { __hcmE2e?: { maps: StyleMap[] } }).__hcmE2e?.maps.at(-1);
    try {
        return map?.getStyle().sources['hcm-picture-warped']?.coordinates ?? [];
    } catch {
        return [];
    }
}

interface LatticeNode {
    readonly geo: { readonly lat: number; readonly lng: number };
}

test(
    'A frame fitted over terrain previews the map its layer shows, over its heights, beside its figures',
    { tag: ['@S-A16-HAPPY-TERRAIN-PREVIEW'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A KH-9 pan frame over ground 100 m up that its film shows 50 pixels east (M15, *Terrain*): its lattice is the scan's own
        // map, its RPC that map moved by the parallax.
        await imagery.script({ attempts: [{ outcome: 'over', lattice: true, terrain: true }] });
        const versionId = await importFromList(page, lang, 'DS1035-1057DA023');
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const stored = (await imagery.version(versionId))?.['georef'] as {
            fitRmseM: number;
            terrain?: unknown;
            lattice: { nodes: LatticeNode[] };
        };
        expect(stored.terrain).toBeDefined();
        await detail(page)
            .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
            .click();
        await georeferencerReady(page, lang);

        // The figures the version stored, and the preview drawn in the box of the map its layer shows (its lattice: the scan's own
        // map moved 50 pixels by the parallax); its quads read the scan through the RPC over the heights (georef-published.test.ts).
        await expect(errorsLine(page)).toContainText(georefText(lang, 'adminContent.georef.fit', { rmse: metres(lang, stored.fitRmseM) }));
        const west = Math.min(...stored.lattice.nodes.map((node) => node.geo.lng));
        await expect.poll(async () => Math.min(...(await page.evaluate(warpedCornersInPage)).map(([lng]) => lng))).toBeCloseTo(west, 4);
    },
);

test(
    'The georeferencer goes full screen and back (M22 §13.2)',
    {
        tag: [
            '@S-A122-HAPPY-GEOREF-FULL-SCREEN',
            '@S-A122-BAD-GEOREF-FULL-SCREEN-LEFT',
            '@S-A122-BAD-GEOREF-PANES-MISALIGNED',
            '@S-A122-HAPPY-GEOREF-REAL-FULL-SCREEN',
        ],
    },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);
        const enter = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.fullScreen') });
        const viewport = page.viewportSize()?.height ?? 0;
        expect((await page.locator('.panes').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(Math.min(420, 0.7 * viewport) - 1);
        // The map's list of what it shows sits in a header row both panes share: neither view is pushed down (S-A122-BAD-GEOREF-PANES-MISALIGNED).
        await expectPanesAligned(page, lang);

        await enter.click();
        const leave = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.leaveFullScreen') });
        await expect(leave).toBeVisible();
        // The browser's own full screen, not only the page over the window (the owner, 2026-11-16).
        await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeVisible();
        await expectPanesAligned(page, lang);

        // Its own button leaves it; Esc does too.
        await leave.click();
        await expect(enter).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
        await enter.click();
        await page.keyboard.press('Escape');
        await expect(enter).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
    },
);

test(
    'A browser that refuses full screen: the georeferencer fills the window and says why',
    { tag: ['@S-A122-BAD-GEOREF-FULL-SCREEN-REFUSED', '@S-A122-BAD-GEOREF-PANES-MISALIGNED'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await page.addInitScript(() => {
            Element.prototype.requestFullscreen = () => Promise.reject(new TypeError('denied by a policy'));
        });
        await openGeoreferencer(page, lang);

        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.fullScreen') }).click();

        await expect(page.getByText(georefText(lang, 'adminContent.georef.fullScreenRefused'))).toBeVisible();
        await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.leaveFullScreen') })).toBeVisible();
        expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
        // The tour's checkers resize the window, which the browser's real full screen does not allow: the full-screen layout is
        // checked here, over the window, where it is the same page with the note.
        await expectStateSound(page, adminVisit('georef.full-screen', lang));
        await expectStateSound(page, adminVisit('georef.full-screen-refused', lang));
        // A tablet on its side, a wide screen and the owner's (about 2000 × 1125): the panes still line up over the window (the
        // browser's real full screen cannot be resized, so the sizes are walked with the page covering the window instead).
        await expectPanesAlignedAtSizes(page, lang);
    },
);
