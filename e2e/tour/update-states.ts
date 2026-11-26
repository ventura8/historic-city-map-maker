import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { openViewer, t, viewer } from '../support/viewer.js';

/**
 * The map's update state in the tour's inventory (behaviour V72, lesson 718; `docs/ENGINE_API.md` → *Installable app* →
 * *Updates*), visited by the journey `update` of e2e/tour/states.ts at every viewer viewport: a new deploy found while the
 * visitor uses the map, so the snackbar "A new version of the map is ready" with Reload shows over the map. The tab is
 * marked as already reloaded for that build (the page script's loop guard), so nothing reloads under the checks.
 */

export interface UpdateTour {
    readonly page: Page;
    readonly lang: Locale;
}

/** The build the deploy serves (`app-build.json`). */
const NEXT_BUILD = 'tour-next-build';

/** Hosting serves a new build, the window gets the focus: the snackbar shows. */
async function deployWhileOpen({ page, lang }: UpdateTour): Promise<void> {
    await page.evaluate((build) => {
        sessionStorage.setItem('hcm-app-reloaded-for', build);
    }, NEXT_BUILD);
    await page.route('**/app-build.json', (route) => route.fulfill({ json: { build: NEXT_BUILD } }));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(viewer(page).locator('hcm-snackbar[data-layout-check="update"]')).toContainText(t(lang, 'app.updateReady'));
}

export const UPDATE_STATES = {
    'update-ready': {
        title: 'A new deploy while the visitor uses the map: A new version of the map is ready, with Reload',
        enter: deployWhileOpen,
        announcements: (lang: Locale): readonly string[] => [t(lang, 'app.updateReady')],
    },
} as const;

export const UPDATE_JOURNEY = {
    title: 'A new version of the map is ready',
    id: 'update',
    boot: ({ page, lang }: UpdateTour): Promise<void> => openViewer(page, { lang }),
    states: ['update-ready'],
} as const;
