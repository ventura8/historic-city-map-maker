import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { mapIdle } from '../support/map.js';
import { openLayers, t, viewer } from '../support/viewer.js';

/**
 * The tour's state of the Layers panel's collapsible sections (owner, 2026-11-22): the historical layers section collapsed
 * by its header button. The tour's pages start with every section expanded (e2e/support/test.ts → `layerSections`), so
 * the `layers` state shows them open and this one the collapsed header.
 */
export const LAYER_SECTIONS_STATES = {
    'layers-sections-collapsed': {
        title: 'The Layers panel with its historical layers section collapsed (its header button, aria-expanded false)',
        enter: async ({ page, lang }: { readonly page: Page; readonly lang: Locale }): Promise<void> => {
            await openLayers(page, lang);
            const header = viewer(page)
                .locator('hcm-layer-panel')
                .getByRole('button', { name: t(lang, 'layers.group.historical'), exact: true });
            if ((await header.getAttribute('aria-expanded')) === 'true') {
                await header.click();
            }
            await mapIdle(page);
        },
    },
} as const;
