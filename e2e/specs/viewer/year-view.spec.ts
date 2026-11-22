import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { mapFacts } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t } from '../../support/viewer.js';

/**
 * A chosen year is never empty on screen (the owner, 2026-11-22: 1945's only sheet lies north of the city view): when no
 * layer of the year covers the view's centre, the camera moves to them.
 */

const CITY_VIEW = '15/44.42700/26.08530';
const NORTH: Json[] = [
    [25.947, 44.531],
    [26.139, 44.624],
] as unknown as Json[];

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

/** Steps the timeline back from today to 1966, the e2e city's year with a layer (other stops are photo years). */
async function stepTo1966(page: Page, lang: Locale): Promise<void> {
    const control = slider(page, lang);
    const target = t(lang, 'timeline.year', { year: '1966' });
    await control.press('End');
    for (let step = 0; step < 30 && (await control.getAttribute('aria-valuetext')) !== target; step += 1) {
        await control.press('ArrowLeft');
    }
    await expect(control).toHaveAttribute('aria-valuetext', target);
}

/** The map camera's latitude (the URL hash keeps a flown-from view until the visitor moves). */
async function mapLatitude(page: Page): Promise<number> {
    return (await mapFacts(page)).center[1];
}

function withBounds(bounds: Json[] | null): Json {
    const manifest = siteManifestData();
    for (const layer of manifest['layers'] as Json[]) {
        if (bounds === null) {
            delete layer['bounds'];
        } else {
            layer['bounds'] = bounds;
        }
    }
    return manifest;
}

test(
    'A year whose layers lie outside the view moves the map to them',
    { tag: '@S-V04-HAPPY-YEAR-MOVES-TO-LAYERS' },
    async ({ page, lang }) => {
        await serveManifest(page, withBounds(NORTH));
        await openViewer(page, { lang, hash: CITY_VIEW });
        await stepTo1966(page, lang);

        // Towards them: the city's bounds hold the camera, so it moves north as far as they let it.
    await expect.poll(() => mapLatitude(page), { timeout: 90_000 }).toBeGreaterThan(44.435);
    },
);

test(
    'A year whose layers have no bounds leaves the map where it is',
    { tag: '@S-V04-BAD-YEAR-NO-BOUNDS-STAYS' },
    async ({ page, lang }) => {
        await serveManifest(page, withBounds(null));
        await openViewer(page, { lang, hash: CITY_VIEW });
        await stepTo1966(page, lang);

        await expect(slider(page, lang)).not.toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
        expect(await mapLatitude(page)).toBeCloseTo(44.427, 2);
    },
);
