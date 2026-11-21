import type { Locale } from '@hcm/shared';
import type { BrowserContext, Page } from '@playwright/test';

import { SITE_ORIGIN } from '../fixtures/world.js';
import { mapIdle, photoMarkDrawn } from '../support/map.js';
import { chooseMenuItem, holdToast, t, viewer } from '../support/viewer.js';

/**
 * The states of the camera's two moves to a place in the tour's inventory. Show my location (behaviour V10,
 * `docs/ENGINE_API.md` → *Show my location*), visited by the journey `home` of e2e/tour/states.ts after the refused
 * permission: the browser context grants the position now, so the blue dot, its accuracy circle and the toast that says the
 * accuracy run the generic checkers at every viewport. Show on map in a photo's details (V51, *Show on map*), visited by the
 * journey `photo` right after the photo's sheet: the photo's place beside the sheet, ringed, the sheet still open with the
 * focus on its button.
 */

export interface LocationTour {
    readonly page: Page;
    readonly context: BrowserContext;
    readonly lang: Locale;
}

/** The position the tour gives, with the accuracy its toast says. */
const POSITION = { latitude: 44.4301, longitude: 26.1003, accuracy: 25 };

function shown(lang: Locale): string {
    return t(lang, 'geolocate.shown', { meters: String(POSITION.accuracy) });
}

export const MY_LOCATION_STATES = {
    'my-location': {
        title: 'Show my location on: the blue dot with its accuracy circle, the accuracy said in a toast',
        enter: async ({ page, context, lang }: LocationTour) => {
            await context.grantPermissions(['geolocation'], { origin: SITE_ORIGIN });
            await context.setGeolocation(POSITION);
            await chooseMenuItem(page, lang, t(lang, 'action.locate'));
            await holdToast(page, shown(lang));
            await mapIdle(page);
        },
        announcements: (lang: Locale) => [shown(lang)],
    },
    'photo-located': {
        title: "A photo's sheet after Show on map: its place beside the sheet, ringed",
        enter: async ({ page, lang }: LocationTour) => {
            await viewer(page)
                .getByRole('button', { name: t(lang, 'photo.locate'), exact: true })
                .click();
            await photoMarkDrawn(page);
        },
    },
};
