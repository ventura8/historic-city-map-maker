import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { seedLayer } from '../settings/world.js';
import {
    cardImport,
    detail,
    errorText,
    FREE_1968,
    FRESH_HARVEST,
    IMAGERY_AT,
    imageryText,
    listedScenes,
    listedScores,
    mapFootprints,
    openScene,
    PAID_FRAMES,
    readyImagery,
    sceneLink,
    sceneList,
    TARGET_FRAMES,
} from './world.js';

// One admin test at a time: the Imagery area reads setup/status, and the harvest runs in the server's upstream world.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The Imagery area's search (behaviour A11, docs/research/M3-interfaces.md §3, §10.2): the owner of a map whose USGS and
 * Mapbox are set up opens Historical imagery; the harvest (`imagery.search` in the Functions emulator, the fake USGS of the
 * server's world over the three declassified datasets) ranks the scenes over the city, free first, with the reasons in
 * plain words; the filters narrow the list and the map's footprints together; a browse image is read from our bucket
 * (the browser never requests a USGS address: the firewall fails one), and one that cannot be fetched says so.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const ALL_SCENES = [...TARGET_FRAMES, FREE_1968, ...PAID_FRAMES];
const sorted = (ids: readonly string[]): string[] => [...ids].sort((a, b) => a.localeCompare(b));

test(
    'Ranked scenes with footprints and browse previews',
    { tag: '@S-A11-HAPPY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // A recent harvest (the page does not search again on its own) whose 1966 frame has its browse copy in our bucket.
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        await imagery.seedBrowse('DS1035-1057DA023', IMAGERY_AT);
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6);

        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.search') }).click();
        await expect(page.getByText(imageryText(lang, 'adminContent.imagery.searched', { found: '8', added: '0' })).first()).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        // Free first, then by score: the five frames the city wants rank on top, the 1968 frame after them.
        await expect.poll(async () => sorted((await listedScenes(page, lang)).slice(0, 5))).toEqual(sorted(TARGET_FRAMES));
        expect((await listedScenes(page, lang))[5]).toBe(FREE_1968);
        const scores = await listedScores(page, lang);
        expect(scores).toEqual([...scores].sort((a, b) => b - a));
        // The map draws no result's footprint until one is open (finding 51 of 2026-11-01): the city's boundary only.
        await expect.poll(() => mapFootprints(page)).toEqual([]);
        await expectStateSound(page, adminVisit('imagery.results', lang));

        await sceneLink(page, lang, 'DS1035-1057DA023').click();
        const preview = detail(page).getByRole('img', {
            name: imageryText(lang, 'adminContent.imagery.browseAlt', { name: 'DS1035-1057DA023' }),
        });
        await expect(preview).toBeVisible();
        await expect.poll(() => mapFootprints(page)).toEqual(['DS1035-1057DA023']);
        await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(120);
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
        await expectStateSound(page, adminVisit('imagery.scene', lang));
    },
);

test(
    'Every result says why it ranks where it does, in plain words',
    { tag: '@S-A11-HAPPY-RANKING-EXPLAINED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid);
        // A layer of 1968 is already on the map: a frame of that year is worth less than one of a year the city lacks.
        await seedLayer(
            { emulators: adminWorld.emulators, city: imagery.city, uid: adminWorld.accounts.owner.uid },
            'corona-1968',
            IMAGERY_AT,
            {
                year: 1968,
            },
        );
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });

        const corona1966 = sceneLink(page, lang, 'DS1035-1057DA023');
        await expect(corona1966).toContainText(imageryText(lang, 'adminContent.imagery.reason.free'));
        await expect(corona1966).toContainText(imageryText(lang, 'adminContent.imagery.reason.coverage', { percent: '92' }));
        await expect(corona1966).toContainText(imageryText(lang, 'adminContent.imagery.reason.targetYear', { year: '1966' }));
        expect((await listedScenes(page, lang)).at(-1)).toBe(FREE_1968);
        // What lowers the 1968 frame comes first, among the three reasons its card shows (CR-M3-47).
        await expect(sceneLink(page, lang, FREE_1968)).toContainText(
            imageryText(lang, 'adminContent.imagery.reason.sameYear', { year: '1968' }),
        );

        // Their previews are in our bucket already (the harvest copies the best-ranked ones ahead).
        await imagery.seedBrowse('DS1035-1057DA023', IMAGERY_AT);
        await imagery.seedBrowse(FREE_1968, IMAGERY_AT);
        await corona1966.click();
        // The detail lists every reason, the ones past the card's first three too.
        await expect(detail(page).getByRole('list')).toContainText(imageryText(lang, 'adminContent.imagery.reason.cloudUnknown'));
        await openScene(page, FREE_1968);
        await expect(detail(page).getByRole('list')).toContainText(
            imageryText(lang, 'adminContent.imagery.reason.sameYear', { year: '1968' }),
        );
    },
);

test(
    'Filters narrow the results',
    { tag: '@S-A11-HAPPY-FILTERS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
        await page.goto(adminPath(lang, 'imagery'));
        const list = sceneList(page, lang);
        await expect(list.getByRole('link')).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });
        const expectNarrowed = async (ids: readonly string[]): Promise<void> => {
            await expect.poll(async () => sorted(await listedScenes(page, lang))).toEqual(sorted(ids));
            // The map follows no filter: it draws no result's footprint while none is open (finding 51).
            expect(await mapFootprints(page)).toEqual([]);
        };
        await expectNarrowed([...TARGET_FRAMES, FREE_1968]);

        // Free only is on by default: off, the two frames that must be ordered join, marked so.
        await page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') }).click();
        await expectNarrowed(ALL_SCENES);
        await expect(sceneLink(page, lang, PAID_FRAMES[0])).toContainText(imageryText(lang, 'adminContent.imagery.tag.needsOrder'));

        // One collection: the KH-9 panoramic frames only.
        const declass3 = page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.dataset.declassiii') });
        await declass3.click();
        await expectNarrowed(['D3C1216-200467A021', 'D3C1209-100055F012']);
        await declass3.click();

        // A year range: the KH-9 mapping frames of 1976 to 1978.
        const from = page.getByRole('textbox', { name: imageryText(lang, 'adminContent.imagery.filter.fromYear') });
        const to = page.getByRole('textbox', { name: imageryText(lang, 'adminContent.imagery.filter.toYear') });
        await from.fill('1976');
        await to.fill('1978');
        await to.press('Tab');
        await expectNarrowed(['DZB1211-500043L007001', 'DZB1213-500159L010001', 'DZB1214-500094L005001']);

        // Cleared, every scene is back, on the list and on the map.
        await from.fill('');
        await to.fill('');
        await to.press('Tab');
        await expectNarrowed(ALL_SCENES);
        // The paid 1968 twin's browse image USGS never serves: when the list asked for its copy before the harvest recorded
        // the failure, the server's 503 is logged (finding 52: the rows ask for the copies they lack).
        consoleErrors.takeMatching(/imagery-browse/);
    },
);

test(
    'A browse image that cannot be fetched shows a placeholder with Try again',
    { tag: '@S-A11-BAD-BROWSE-UNAVAILABLE' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
        await upstream.fail('usgs-browse', 'unavailable', 'server');
        await page.goto(adminPath(lang, 'imagery'));
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6, { timeout: FUNCTIONS_TIMEOUT_MS });

        await sceneLink(page, lang, 'DS1035-1057DA023').click();
        await expect(detail(page).getByRole('alert')).toContainText(errorText(lang, 'apiError.imagery.browseUnavailable'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const tryAgain = detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') });
        await expect(tryAgain).toBeVisible();
        await expectStateSound(page, adminVisit('imagery.browse-unavailable', lang));
        // The rest of the scene works: its reasons, and Import.
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeEnabled();
        await tryAgain.click();
        await expect(detail(page).getByRole('alert')).toContainText(errorText(lang, 'apiError.imagery.browseUnavailable'), {
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        // The callable's 503, which Chromium logs; never a USGS address (the firewall would fail the test).
        expect(consoleErrors.takeMatching(/imagery-browse/).length).toBeGreaterThan(0);
    },
);

test(
    'A routed scene whose read fails says so, and Try again opens it',
    { tag: ['@S-A11-BAD-ROUTED-SCENE-UNREAD', '@S-A11-HAPPY-ROUTED-SCENE-RETRY'] },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        // A document that fails its schema: its read stops with a failure, which is not "no such scene". A frame whose browse
        // image USGS serves: on the paid twin the page's copy then ended in a 503 that raced the test's end (LESSONS).
        const routed = 'DS1035-1057DA023';
        await adminWorld.emulators.setDocument(`cities/${imagery.city}/usgsScenes/${routed}`, { broken: true });
        await page.goto(adminPath(lang, `imagery/scene/${routed}`));

        await expect(detail(page).getByRole('alert')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByText(imageryText(lang, 'adminContent.imagery.sceneNotFound'))).toHaveCount(0);
        await expectStateSound(page, adminVisit('imagery.scene-unread', lang));

        await imagery.seedScene(routed, FRESH_HARVEST, { downloadAvailable: false });
        // A first answer can still be the browser's cached copy of the broken document, which fails the read again: as a
        // person would, click again until the server's copy opens.
        await expect(async () => {
            await detail(page)
                .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
                .click({ timeout: 2_000 });
            await expect(detail(page).locator(`[data-scene="${routed}"]`)).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: FUNCTIONS_TIMEOUT_MS });
        // The picture settled first: with it still on its way, no alert proved nothing.
        await expect(
            detail(page).getByRole('img', { name: imageryText(lang, 'adminContent.imagery.browseAlt', { name: routed }) }),
        ).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(detail(page).getByRole('alert')).toHaveCount(0);
    },
);

test(
    'Try again on the browse image of a scene only the address names reaches it',
    { tag: '@S-A11-HAPPY-BROWSE-RETRY-ROUTED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        // Not free: Free only keeps it off the list, so the page has it from its own read alone.
        const routed = 'DS1035-1057DA023';
        await imagery.seedScene(routed, FRESH_HARVEST, { downloadAvailable: false });
        await upstream.fail('usgs-browse', 'unavailable', 'server');
        await page.goto(adminPath(lang, `imagery/scene/${routed}`));
        const unavailable = detail(page)
            .getByRole('alert')
            .filter({ hasText: errorText(lang, 'apiError.imagery.browseUnavailable') });
        await expect(unavailable).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });

        await upstream.fail('usgs-browse', null, 'server');
        await detail(page)
            .getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })
            .click();

        await expect(
            detail(page).getByRole('img', { name: imageryText(lang, 'adminContent.imagery.browseAlt', { name: routed }) }),
        ).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        consoleErrors.takeMatching(/imagery-browse/);
    },
);

test(
    'Without USGS setup a link to setup is shown',
    { tag: '@S-A11-BAD-USGS-NOT-SET-UP' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
        await adminWorld.emulators.updateFields('setup/status', {}, ['usgs']);
        await page.goto(adminPath(lang, 'imagery'));

        await expect(page.getByText(imageryText(lang, 'adminContent.imagery.usgsMissing'))).toBeVisible();
        await expect(page.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openUsgsSetup') })).toHaveAttribute(
            'href',
            '#/setup/usgs',
        );
        await expect(sceneList(page, lang)).toHaveCount(0);
        expect(await upstream.calls('server', 'usgs')).toEqual([]);
        await expectStateSound(page, adminVisit('imagery.empty-usgs', lang));
    },
);

/** An area of the Black Sea, far from every scene of the fake catalogue (which covers Bucharest). */
const NO_SCENES_HERE = { west: 30.4, south: 43.4, east: 30.8, north: 43.7 } as const;

test('Zero results show guidance', { tag: '@S-A11-BAD-ZERO-RESULTS' }, async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
    const imagery = await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
    // The city's area moved where USGS has no frame: the page's own first search finds nothing.
    await adminWorld.emulators.updateFields(`cities/${imagery.city}`, { bounds: NO_SCENES_HERE }, ['bounds']);
    await page.goto(adminPath(lang, 'imagery'));

    const guidance = page.locator('hcm-imagery-page [data-state="zero-results"]');
    await expect(guidance).toContainText(imageryText(lang, 'adminContent.imagery.zero.try'), { timeout: FUNCTIONS_TIMEOUT_MS });
    await expect(page.getByText(imageryText(lang, 'adminContent.imagery.searched', { found: '0', added: '0' }))).toBeVisible();
    await expect(guidance.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.zero.area') })).toHaveAttribute(
        'href',
        '#/settings/area',
    );
    await expectStateSound(page, adminVisit('imagery.zero-results', lang));

    // Scenes to order too: still none over this area, and the guidance stays.
    await guidance.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.zero.toOrder') }).click();
    await expect(page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.filter.freeOnly') })).toHaveAttribute(
        'aria-pressed',
        'false',
    );
    await expect(guidance).toBeVisible();
    await expect(sceneList(page, lang)).toHaveCount(0);
});

test(
    'An M2M error shows an actionable message',
    { tag: '@S-A11-BAD-M2M-ERROR' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream, consoleErrors }) => {
        await readyImagery({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid);
        const failed = page.locator('hcm-imagery-page [data-state="search-error"]');
        const search = page.getByRole('button', { name: imageryText(lang, 'adminContent.imagery.search') });

        // Maintenance: the search says to try again later, and offers Try again (nothing retries a search by itself).
        await upstream.fail('usgs', 'maintenance', 'server');
        await page.goto(adminPath(lang, 'imagery'));
        await expect(failed).toContainText(errorText(lang, 'apiError.usgs.maintenance'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(failed.getByRole('link')).toHaveCount(0);
        await expect(failed.getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') })).toBeVisible();

        // Not answering: Try again, which searches once more.
        await upstream.fail('usgs', 'unavailable', 'server');
        await search.click();
        await expect(failed).toContainText(errorText(lang, 'apiError.usgs.unavailable'), { timeout: FUNCTIONS_TIMEOUT_MS });
        const before = (await upstream.calls('server', 'usgs')).length;
        await failed.getByRole('button', { name: imageryText(lang, 'adminContent.common.retry') }).click();
        await expect
            .poll(async () => (await upstream.calls('server', 'usgs')).length, { timeout: FUNCTIONS_TIMEOUT_MS })
            .toBeGreaterThan(before);
        await expect(failed).toContainText(errorText(lang, 'apiError.usgs.unavailable'), { timeout: FUNCTIONS_TIMEOUT_MS });

        // The token refused: the way to Setup's USGS step, where a new one is pasted.
        await upstream.fail('usgs', 'unauthorized', 'server');
        await search.click();
        await expect(failed).toContainText(errorText(lang, 'apiError.usgs.credentials'), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(failed.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openUsgsSetup') })).toHaveAttribute(
            'href',
            '#/setup/usgs',
        );
        await expectStateSound(page, adminVisit('imagery.search-credentials', lang));
        await upstream.fail('usgs', null, 'server');
        // Each refused search is the callable's error, which the browser logs.
        expect(consoleErrors.takeMatching(/imagery-search/).length).toBeGreaterThan(0);
    },
);

test(
    'Before USGS approves downloads, results show but Import waits',
    { tag: '@S-A11-BAD-DOWNLOAD-NOT-APPROVED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // The account has the search role only: M2M has not approved its downloads yet.
        await adminWorld.emulators.updateFields('setup/status', { usgs: { state: 'pending', role: 'search', checkedAt: IMAGERY_AT } }, [
            'usgs',
        ]);
        for (const entityId of ALL_SCENES) {
            await imagery.seedScene(entityId, FRESH_HARVEST);
        }
        await page.goto(adminPath(lang, 'imagery'));

        // The ranked results show, with the note; no card offers Import.
        await expect(sceneList(page, lang).getByRole('link')).toHaveCount(6);
        await expect(page.getByText(imageryText(lang, 'adminContent.imagery.downloadsPending'))).toBeVisible();
        await expect(cardImport(page, lang, 'DS1035-1057DA023')).toHaveCount(0);

        // A free scene's Import is off, with why and the way to Setup.
        await openScene(page, 'DS1035-1057DA023');
        const pending = detail(page)
            .getByRole('alert')
            .filter({ hasText: errorText(lang, 'apiError.usgs.accessPending') });
        await expect(pending).toBeVisible();
        await expect(pending.getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openUsgsSetup') })).toHaveAttribute(
            'href',
            '#/setup/usgs',
        );
        await expect(detail(page).getByRole('button', { name: imageryText(lang, 'adminContent.imagery.import') })).toBeDisabled();
        await expectStateSound(page, adminVisit('imagery.downloads-pending', lang));
        expect(await upstream.calls('server', 'usgs.download')).toEqual([]);
    },
);
