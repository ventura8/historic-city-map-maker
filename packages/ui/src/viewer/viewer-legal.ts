/**
 * Modal surfaces and the map's legal line (scenario V18; Mapbox terms, docs/research/design-review-security-cost.md §5).
 * While a modal sheet, the lightbox or a dialog covers the map, the frame is inert and the surface sits above Mapbox's
 * own logo and attribution, never under them: the lightbox and a full-screen dialog hide the whole map, so nothing is
 * shown that needs a credit; a modal sheet leaves part of the map in view, and Mapbox's controls move into that part,
 * above a bottom sheet's top edge or beside a side sheet (`viewer-styles.ts`, from the sheet's own `variant` and
 * `detent`), under its scrim like the rest of the map. Until the Pixel 9 Pro review (P3) the viewer showed a copy of the
 * credits in a bar below the surfaces and at the foot of About, which took the last 40 to 80 px of every sheet, the
 * lightbox, About and Settings on a phone.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { isDialogSheet } from './input-commands.js';
import type { SheetMode } from './layout.js';
import type { ViewerState } from './store-port.js';

/**
 * True while a modal surface covers the frame (its content is then inert): the lightbox, About, a modal sheet. The Layers
 * sheet is a standard one, beside a map that stays usable (the owner, 2026-11-15: no dimming while it is open).
 */
export function modalOpen(state: ViewerState | null, mode: SheetMode): boolean {
    return (
        state !== null && (state.lightbox || isDialogSheet(state.sheet) || (mode !== 'docked' && !['none', 'layers'].includes(state.sheet)))
    );
}

/** The consent banner, in its dock over the map. */
export function renderConsentBanner(
    locale: ViewerLocale,
    onConsent: (event: CustomEvent<{ readonly decision: 'granted' | 'denied' }>) => void,
    docked = true,
): TemplateResult {
    // M18 item 8: without a map the card flows in the photo list's column, under the error card, instead of covering it.
    return html`<div class=${docked ? 'dock consent' : 'consent'}>
        <hcm-consent-banner
            data-layout-check="consent"
            .headline=${translate(locale, 'consent.title')}
            .body=${translate(locale, 'consent.body')}
            .acceptLabel=${translate(locale, 'consent.accept')}
            .declineLabel=${translate(locale, 'consent.decline')}
            @hcm-consent=${onConsent}
        ></hcm-consent-banner>
    </div>`;
}
