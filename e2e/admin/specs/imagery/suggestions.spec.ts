import { translateAdminContent, type LngLat } from '@hcm/shared';
import type { Locator, Page } from '@playwright/test';

import { mapIdle } from '../../../support/map.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { georefBadgesAt } from '../../support/map.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { addPair, errorsLine, georefText, landmark, openGeoreferencer, pairRows, showPane } from './georef.js';
import { readyImagery, versionState } from './world.js';

// One admin test at a time: the import that waits for points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * Automatic GCP suggestions in the georeferencer (behaviour A44; docs/research/M4-interfaces.md §2.5): the stand-in's
 * `suggestions` outcome leaves the 1966 frame waiting for points with four suggestions (landmarks of the synthetic world
 * on their exact pixels, the golden shape of `version.needs-gcps.suggestions.json`) beside its four corner pairs. Accept
 * all and Save take two inputs (`CONTENT_INPUT_BUDGETS.acceptSuggestions`); a rejected or unaccepted suggestion never
 * reaches `imagery.saveGcps`; the keyboard does what the pointer does; a version the matcher left without suggestions
 * says why and keeps the manual way.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SUGGESTED = ['a001', 'a002', 'a003', 'a004'] as const;

/** A suggestion's row in the panel (its name button is the row's own). */
function suggestionName(page: Page, lang: 'ro' | 'en', label: string): Locator {
    return page.getByRole('button', { name: georefText(lang, 'adminContent.georef.suggestions.name', { label }), exact: true });
}

function decide(page: Page, lang: 'ro' | 'en', decision: 'accept' | 'reject', label: string): Locator {
    return page.getByRole('button', { name: georefText(lang, `adminContent.georef.suggestions.${decision}`, { label }), exact: true });
}

function acceptAll(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: georefText(lang, 'adminContent.georef.suggestions.acceptAll'), exact: true });
}

function save(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') });
}

/** How many suggestions the scan pane draws (dashed) and how many the page lists. */
async function drawnSuggestions(page: Page): Promise<number> {
    return page
        .locator('hcm-scan-viewer')
        .evaluate((viewer) => (viewer as HTMLElement & { suggestions: readonly unknown[] }).suggestions.length);
}

interface SavedGcp {
    readonly id: string;
    readonly origin: string;
}

/** Where the matcher put the version's suggestions on the map (`[longitude, latitude]`), as stored on the version. */
async function suggestedPlaces(imagery: Awaited<ReturnType<typeof readyImagery>>, versionId: string): Promise<readonly LngLat[]> {
    const suggestions = (await imagery.version(versionId))?.['suggestions'] as { pairs: SavedPair[] } | undefined;
    return (suggestions?.pairs ?? []).map((pair) => [pair.geo.lng, pair.geo.lat] as const);
}

interface SavedPair {
    readonly geo: { readonly lng: number; readonly lat: number };
}

/**
 * Zooms the georeferencer's map out with its own button, as a person would, until the badges at `places` show (the map
 * opens on part of the city, and a badge off the view is not drawn); at most five steps.
 */
async function zoomOutToShow(page: Page, lang: 'ro' | 'en', places: readonly LngLat[]): Promise<void> {
    const zoomOut = page
        .locator('hcm-admin-map')
        .getByRole('button', { name: translateAdminContent(lang, 'adminContent.map.zoomOut'), exact: true });
    for (let step = 0; step < 5 && (await georefBadgesAt(page, places)) < places.length; step += 1) {
        await zoomOut.click();
        await mapIdle(page);
    }
}

async function savedGcps(imagery: Awaited<ReturnType<typeof readyImagery>>, versionId: string): Promise<readonly SavedGcp[]> {
    return ((await imagery.version(versionId))?.['georef'] as { gcps: SavedGcp[] } | undefined)?.gcps ?? [];
}

test(
    'Suggested points are accepted with one click and saved',
    { tag: '@S-A44-HAPPY' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // Once the points are saved the same job measures 28.4 m, over the city's 15 m: the version waits for approval.
        await imagery.script({ attempts: [{ outcome: 'suggestions' }, { outcome: 'over' }] });
        const versionId = await openGeoreferencer(page, lang);

        // Four suggestions, best first, each with its confidence; dashed on the scan; the four corner pairs in the table.
        await expect(page.getByText(georefText(lang, 'adminContent.georef.suggestions.noMatch', { pairs: '1' }))).toBeVisible();
        for (const label of ['a1', 'a2', 'a3', 'a4']) {
            await expect(suggestionName(page, lang, label)).toBeVisible();
        }
        await expect(page.locator('[data-suggestion="a001"]')).toContainText(
            georefText(lang, 'adminContent.georef.suggestions.confidence', {
                level: georefText(lang, 'adminContent.georef.suggestions.level.high'),
                percent: '66',
            }),
        );
        // Each is measured against the page's live fit of the corner pairs, never the matcher's stored residual (review
        // 2026-10-24: a version waiting for points read "No fit to compare it with yet" whatever the page fitted).
        await expect(page.locator('[data-suggestion="a001"]')).not.toContainText(
            georefText(lang, 'adminContent.georef.suggestions.noResidual'),
        );
        expect(await drawnSuggestions(page)).toBe(4);
        // The map paints them as canvas badges, like the scan (DECISIONS-for-review.md §143): a badge at each suggested place.
        const places = await suggestedPlaces(imagery, versionId);
        expect(places).toHaveLength(4);
        await showPane(page, lang, 'map');
        await zoomOutToShow(page, lang, places);
        await expect.poll(() => georefBadgesAt(page, places)).toBe(4);
        await showPane(page, lang, 'scan');
        await expect(pairRows(page, lang)).toHaveCount(4);
        await expectStateSound(page, adminVisit('georef.suggestions', lang));

        // Input 1 of 2: Accept all. The four join the table as automatic pairs, the fit and its errors follow at once.
        const before = await errorsLine(page).innerText();
        await acceptAll(page, lang).click();
        await expect(pairRows(page, lang)).toHaveCount(8);
        await expect(pairRows(page, lang).last()).toContainText(georefText(lang, 'adminContent.georef.origin.auto'));
        await expect(errorsLine(page)).not.toHaveText(before);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.suggestions.allDecided'))).toBeVisible();
        // The list Accept all was in is gone: the keyboard lands on the panel's heading, not the page's body.
        await expect(page.getByRole('heading', { name: georefText(lang, 'adminContent.georef.suggestions.title') })).toBeFocused();
        expect(await drawnSuggestions(page)).toBe(0);
        await expectStateSound(page, adminVisit('georef.suggestions-accepted', lang));

        // Input 2 of 2: Save. The same job goes on from georeferencing, on the corner pairs and the accepted ones.
        await save(page, lang).click();
        await expect(page).toHaveURL(new RegExp(`#/imagery/version/${versionId}$`), { timeout: FUNCTIONS_TIMEOUT_MS });
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const gcps = await savedGcps(imagery, versionId);
        expect(gcps.filter((gcp) => gcp.origin === 'auto').map((gcp) => gcp.id)).toEqual([...SUGGESTED]);
        // Attempt 1 downloads on the small job and is processed up to the points (finding 56); the Save is attempt 2.
        expect((await imagery.runs()).map((run) => [run.jobId, run.attempt])).toEqual([
            [versionId, 1],
            [versionId, 1],
            [versionId, 2],
        ]);
        expect((await imagery.version(versionId))?.['suggestions']).toBeUndefined();
    },
);

test(
    'A rejected or unaccepted suggestion is never saved',
    { tag: '@S-A44-BAD-REJECTED-NEVER-SAVED' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        // Once the points are saved the same job measures 28.4 m, over the city's 15 m: the version waits for approval.
        await imagery.script({ attempts: [{ outcome: 'suggestions' }, { outcome: 'over' }] });
        const versionId = await openGeoreferencer(page, lang);

        // a3 rejected (gone from the list and the scan), a1 accepted; a2 and a4 left undecided.
        await decide(page, lang, 'reject', 'a3').click();
        await expect(suggestionName(page, lang, 'a3')).toHaveCount(0);
        await decide(page, lang, 'accept', 'a1').click();
        await expect(pairRows(page, lang)).toHaveCount(5);
        expect(await drawnSuggestions(page)).toBe(2);

        // Leaving with the accepted one unsaved (the browser's Back) asks first; staying keeps it, and nothing was written.
        const address = page.url();
        await page.goBack();
        await expect(page.getByRole('dialog', { name: georefText(lang, 'adminContent.common.unsavedTitle') })).toBeVisible();
        await page
            .locator('hcm-dialog[open]')
            .getByRole('button', { name: georefText(lang, 'adminContent.common.keepEditing') })
            .click();
        expect(page.url()).toBe(address);
        await expect(pairRows(page, lang)).toHaveCount(5);
        expect((await savedGcps(imagery, versionId)).map((gcp) => gcp.origin)).toEqual(['corner', 'corner', 'corner', 'corner']);

        // Save: exactly the corner pairs and a1; the rejected a3 and the undecided ones never reach the version.
        await save(page, lang).click();
        await expect(versionState(page, lang, 'adminContent.imagery.version.awaitingApproval')).toBeVisible({
            timeout: FUNCTIONS_TIMEOUT_MS,
        });
        const gcps = await savedGcps(imagery, versionId);
        expect(gcps.filter((gcp) => gcp.origin === 'auto').map((gcp) => gcp.id)).toEqual(['a001']);

        // Opened again, the georeferencer shows the saved pairs and no suggestion comes back.
        await page.goBack();
        await expect(pairRows(page, lang)).toHaveCount(5);
        await expect(page.getByRole('heading', { name: georefText(lang, 'adminContent.georef.suggestions.title') })).toHaveCount(0);
    },
);

test(
    'Suggestions are reviewed without a pointer',
    { tag: '@S-A44-HAPPY-KEYBOARD' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(240_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'suggestions' }] });
        await openGeoreferencer(page, lang);

        // Tab from Accept all reaches the first suggestion; every row's Accept and Reject are named after it.
        await acceptAll(page, lang).focus();
        await page.keyboard.press('Tab');
        await expect(suggestionName(page, lang, 'a1')).toBeFocused();
        await expect(suggestionName(page, lang, 'a1')).toHaveAttribute('aria-current', 'true');
        for (const label of ['a1', 'a2', 'a3', 'a4']) {
            await expect(decide(page, lang, 'accept', label)).toBeVisible();
            await expect(decide(page, lang, 'reject', label)).toBeVisible();
        }

        // Enter accepts, twice in a row: the keyboard stays on the next suggestion each time.
        await page.keyboard.press('Enter');
        await expect(suggestionName(page, lang, 'a2')).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(suggestionName(page, lang, 'a3')).toBeFocused();
        // Delete rejects, twice in a row: the list empties and the keyboard goes to its heading.
        await page.keyboard.press('Delete');
        await expect(suggestionName(page, lang, 'a4')).toBeFocused();
        await page.keyboard.press('Delete');
        await expect(page.getByRole('heading', { name: georefText(lang, 'adminContent.georef.suggestions.title') })).toBeFocused();

        // What the pointer would have made: the corner pairs, then a1 and a2 as automatic pairs.
        await expect(pairRows(page, lang)).toHaveCount(6);
        await expect(pairRows(page, lang).nth(4)).toContainText(georefText(lang, 'adminContent.georef.origin.auto'));
        await expect(page.getByText(georefText(lang, 'adminContent.georef.suggestions.allDecided'))).toBeVisible();
    },
);

test(
    'A scan the matcher could not place says so and keeps the manual way',
    { tag: '@S-A44-BAD-NO-SUGGESTIONS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        test.setTimeout(180_000);
        const imagery = await readyImagery(
            { emulators: adminWorld.emulators, api: mockApiRequest, upstream },
            adminWorld.accounts.owner.uid,
        );
        await imagery.script({ attempts: [{ outcome: 'no-match' }] });
        await openGeoreferencer(page, lang);

        await expect(page.getByText(georefText(lang, 'adminContent.georef.suggestions.noMatch', { pairs: '3' }))).toBeVisible();
        await expect(page.getByText(georefText(lang, 'adminContent.georef.suggestions.none'))).toBeVisible();
        await expect(acceptAll(page, lang)).toHaveCount(0);
        expect(await drawnSuggestions(page)).toBe(0);
        await expectStateSound(page, adminVisit('georef.no-suggestions', lang));

        // Add pairs works as before.
        await addPair(page, lang, landmark(0));
        await expect(pairRows(page, lang)).toHaveCount(5);
        await expect(save(page, lang)).toBeEnabled();
    },
);
