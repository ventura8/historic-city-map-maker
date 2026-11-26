import type { Locale } from '@hcm/shared';
import { expect, type BrowserContext, type Page } from '@playwright/test';

import { SECOND_CITY } from '../fixtures/second-city.js';
import { hostingUrl, serveBucketCity, useStartUpVariant } from '../support/hosting.js';
import { recordLiveRegions } from '../support/live-regions.js';
import { expectStateSound } from '../support/state-check.js';
import { waitForEngineEvent } from '../support/viewer.js';

/**
 * The Firebase Hosting site's own states in the tour inventory (M6, behaviour V30; docs/research/M6-interfaces.md §6.3), ids
 * `site.<state>`, each with the journey that visits it on the e2e Hosting server (e2e/mock-apis/admin-server.ts): the
 * start-up root before **Publish the map**, a city made in the admin booted through the generic city page, and the 404
 * page. The two bilingual pages are checked in Romanian, their language (their English part is marked `lang="en"`).
 */
export const SITE_STATES = {
    'start-up': {
        title: 'The Hosting site before Publish the map: the bilingual being-set-up page with the admin’s link',
    },
    'city-generic': {
        title: 'A city made in the admin on the Hosting site: the generic city page boots its map from the public bucket',
    },
    'not-found': {
        title: 'The Hosting site’s 404 page: bilingual, with the map’s and the admin’s links',
    },
} as const;

export type SiteStateId = keyof typeof SITE_STATES;

interface SiteTour {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

/** A city made in the admin: no committed site, so its address is the generic city page's. */
const ADMIN_MADE_CITY = 'bacau';

/** How each journey reaches its state, and the language the state is checked in. */
const JOURNEYS: Readonly<Record<SiteStateId, (tour: SiteTour) => Promise<Locale>>> = {
    'start-up': async ({ page, context }) => {
        await useStartUpVariant(context);
        await page.goto(hostingUrl('/'));
        await expect(page.getByRole('heading', { level: 1, name: 'Harta este în pregătire' })).toBeVisible();
        return 'ro';
    },
    'city-generic': async ({ page, context, lang }) => {
        await context.addInitScript(recordLiveRegions);
        await serveBucketCity(page, { city: ADMIN_MADE_CITY, site: SECOND_CITY });
        await page.goto(hostingUrl(`/${ADMIN_MADE_CITY}/`, { lang }));
        await waitForEngineEvent(page, 'hcm-ready');
        return lang;
    },
    'not-found': async ({ page }) => {
        await page.goto(hostingUrl('/Not_A_City/'));
        await expect(page.getByRole('heading', { level: 1, name: 'Pagina nu există' })).toBeVisible();
        return 'ro';
    },
};

/** Visits the state `id` and checks it with the generic layout and accessibility checkers. */
export async function expectSiteJourneySound(tour: SiteTour, id: SiteStateId): Promise<void> {
    const lang = await JOURNEYS[id](tour);
    await expectStateSound(tour.page, { id: `site.${id}`, title: SITE_STATES[id].title, lang });
}
