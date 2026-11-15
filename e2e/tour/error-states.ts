import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { t } from '../support/viewer.js';

/** The tour's states of the viewer's error card and of a browser without WebGL, from e2e/tour/states.ts. */

interface ErrorState {
    readonly title: string;
    readonly enter: (tour: { readonly page: Page; readonly lang: Locale }) => Promise<void>;
    readonly announcements?: (lang: Locale) => readonly string[];
}

/** The error card is an alert carrying `message`. */
export async function expectErrorCard(page: Page, message: string): Promise<void> {
    await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible();
}

export const ERROR_STATES = {
    'error-not-found': {
        title: 'The error card: the manifest is not found (404)',
        enter: ({ page, lang }) => expectErrorCard(page, t(lang, 'error.manifest.notFound')),
        announcements: (lang) => [t(lang, 'error.manifest.notFound')],
    },
    'error-network': {
        title: 'The error card: the network failed',
        enter: ({ page, lang }) => expectErrorCard(page, t(lang, 'error.manifest.network')),
        announcements: (lang) => [t(lang, 'error.manifest.network')],
    },
    'no-webgl': {
        title: 'No WebGL: the error card and the photo list instead of the map',
        enter: async ({ page, lang }) => {
            await expect(page.getByText(t(lang, 'error.webgl'))).toBeVisible();
        },
    },
} as const satisfies Record<string, ErrorState>;
