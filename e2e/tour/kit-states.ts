import { expect, type Page, type TestInfo } from '@playwright/test';

import { KIT_PATH, revealLateNotes, serveKit } from '../support/kit.js';
import { expectStateSound } from '../support/state-check.js';

/**
 * The starter kit's states in the tour inventory (M5, behaviour V27; docs/research/M5-interfaces.md §7.3), ids
 * `kit.<state>`, with the journey that visits them over the template page the site server serves at `/kit/`.
 */
const KIT_STATES = {
    'loading-note': {
        title: 'The starter kit with its engine refused: the bilingual note in place of the map, saying to reload the page once the engine is late',
    },
} as const;

/** The note's first sentence in each language (templates/starter-kit/index.html). */
const NOTES = { ro: 'Harta se încarcă.', en: 'The map is loading.' } as const;

/** The late note's advice, once the engine is late (the visitor's next step: the owner's check is in the README). */
const LATE = { ro: 'Reîncarcă pagina.', en: 'Reload the page.' } as const;

/**
 * The kit's journey: its page from `/kit/` with the engine's script answered 404 (the jsDelivr folder unreachable or a
 * version that does not exist), so the element stays undefined and its note stays; the state is checked as the page shows
 * it, in Romanian (the template's language: no engine runs to switch it).
 */
export async function expectKitJourneySound({ page }: { readonly page: Page }, testInfo: TestInfo): Promise<void> {
    await serveKit(page, testInfo);
    await page.route('https://cdn.jsdelivr.net/**/engine.iife.js', (route) =>
        route.fulfill({ status: 404, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body: 'Not found' }),
    );
    await page.goto(KIT_PATH);
    await expect(page.getByText(NOTES.ro)).toBeVisible();
    await expect(page.getByText(NOTES.en)).toBeVisible();
    await revealLateNotes(page);
    await expect(page.getByText(LATE.ro)).toBeVisible();
    await expect(page.getByText(LATE.en)).toBeVisible();
    await expectStateSound(page, { id: 'kit.loading-note', title: KIT_STATES['loading-note'].title, lang: 'ro' });
}
