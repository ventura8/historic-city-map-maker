import type { Locale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { E2E_XYZ_LAYER } from '../fixtures/world.js';
import { connectPad, installFakePads } from '../support/gamepad.js';
import { dismissToast, holdToast, openViewer, t } from '../support/viewer.js';
import { TV_JOURNEY, TV_STATES } from './tv-states.js';

/**
 * The shortcuts' and the gamepad's states in the tour's inventory (behaviours V36, V37; docs/research/viewer-input.md),
 * visited by the journey `input` of e2e/tour/states.ts at every viewer viewport. Each runs the generic layout and
 * accessibility checkers like every other state. The fake pad is e2e/support/gamepad.ts. The TV's states (V65, V66) have
 * their own journey, `tv` (e2e/tour/tv-states.ts), and join the inventory here.
 */

export interface InputTour {
    readonly page: Page;
    readonly lang: Locale;
}

async function bootInputJourney({ page, lang }: InputTour): Promise<void> {
    await installFakePads(page);
    await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
}

export const INPUT_STATES = {
    'keyboard-help': {
        title: 'The help panel of the keyboard and the gamepad, from `?`',
        enter: async ({ page, lang }: InputTour) => {
            await page.keyboard.press('?');
            await expect(page.getByRole('dialog', { name: t(lang, 'input.help') })).toBeVisible();
        },
        escape: () => ({ opener: null }),
    },
    'input-toast': {
        title: 'A shortcut stepped the year: the toast says it',
        enter: async ({ page, lang }: InputTour) => {
            await page.keyboard.press(',');
            await holdToast(page, t(lang, 'timeline.year', { year: String(E2E_XYZ_LAYER.year) }));
        },
        announcements: (lang: Locale) => [t(lang, 'timeline.year', { year: String(E2E_XYZ_LAYER.year) })],
    },
    'gamepad-refused': {
        title: 'A gamepad without the standard layout: the toast refuses it',
        enter: async ({ page, lang }: InputTour) => {
            await dismissToast(page, lang);
            await connectPad(page, '');
            await holdToast(page, t(lang, 'gamepad.refused'));
        },
        announcements: (lang: Locale) => [t(lang, 'gamepad.refused')],
    },
    ...TV_STATES,
} as const;

/** The journey of these states in e2e/tour/states.ts. */
const INPUT_JOURNEY = {
    title: 'The shortcuts, their help panel and a refused gamepad',
    id: 'input',
    boot: bootInputJourney,
    states: ['keyboard-help', 'input-toast', 'gamepad-refused'],
} as const;

/** The input's journeys in e2e/tour/states.ts: the shortcuts' and the TV's. */
export const INPUT_JOURNEYS = [INPUT_JOURNEY, TV_JOURNEY] as const;
