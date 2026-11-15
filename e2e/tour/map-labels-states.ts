import type { Locale } from '@hcm/shared';
import { translate } from '@hcm/shared';
import { translateMapLabels } from '@hcm/shared/map-labels';
import { expect, type Page } from '@playwright/test';

import { siteManifestData } from '../fixtures/manifest.js';
import { E2E_PLAIN_STYLE_ID } from '../fixtures/world.js';
import { mapIdle } from '../support/map.js';
import { openLayers, openViewer, serveManifest } from '../support/viewer.js';

/** The tour's states of the basemap's own labels (V31; docs/ENGINE_API.md → Map labels), from e2e/tour/states.ts. */

interface MapLabelState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
}

function streetsSwitch(page: Page, lang: Locale): ReturnType<Page['getByRole']> {
    return page.getByRole('switch', { name: translateMapLabels(lang, 'mapLabels.streets'), exact: true });
}

export const MAP_LABEL_STATES = {
    'layers-map-labels': {
        title: "The Layers panel's Map labels group, street names turned off from the keyboard",
        enter: async ({ page, lang }) => {
            const streets = streetsSwitch(page, lang);
            await streets.focus();
            await streets.press('Space');
            await expect(streets).toHaveAttribute('aria-checked', 'false');
        },
    },
    'layers-photos-scope': {
        title: "The Photos switch's popover under Map labels (design B), Only near the selected year chosen from the keyboard",
        enter: async ({ page, lang }) => {
            const options = page.getByRole('button', { name: translate(lang, 'photosScope.options'), exact: true });
            await options.click();
            const near = page.getByRole('radio', { name: translate(lang, 'photosScope.near'), exact: true });
            await near.check();
            await expect(
                page.getByRole('img', { name: translate(lang, 'photosScope.nearOn', { years: '10' }), exact: true }),
            ).toBeVisible();
        },
    },
    'layers-no-map-labels': {
        title: 'The Layers panel of a custom basemap: no Map labels group, nothing to switch',
        enter: async ({ page, lang }) => {
            await openLayers(page, lang);
            await expect(streetsSwitch(page, lang)).toHaveCount(0);
            await mapIdle(page);
        },
    },
} as const satisfies Record<string, MapLabelState>;

/** A city whose basemap is a custom style: the fixture with the e2e world's plain style. */
export const MAP_LABEL_JOURNEY = {
    title: "A city whose basemap is a custom style, without Standard's labels",
    id: 'custom-basemap',
    boot: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
        const manifest = siteManifestData();
        const city = manifest['city'] as Record<string, unknown>;
        city['basemap'] = { style: `mapbox://styles/hcm-e2e/${E2E_PLAIN_STYLE_ID}` };
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
    },
    states: ['layers-no-map-labels'] as const,
};
