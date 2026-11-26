/**
 * The photos near the selected year, one press away (V04): an icon button named in full, the name also its tooltip, on
 * phones and tablets (the owner, 2026-11-12 and 11-13: no wide text pill there); a text chip only on a large screen: an
 * expanded or wider window that is not short (`textChip`) and that a mouse points at (the viewer's `finePointer`: a
 * tablet on its side is as wide as a laptop). No year (today) or no photo near it: nothing. Its dock is `.dock.chip` of
 * `dock-styles.ts`.
 */
import { translate, type ViewerLocale, type Photo } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { WindowClass } from '../theme/tokens.js';
import { photosNearYear } from './timeline-model.js';

/** Window classes wide enough for the text chip (M3 expanded and up): a desktop's, or a tablet's on its side. */
const TEXT_CHIP_CLASSES: ReadonlySet<WindowClass> = new Set(['expanded', 'large', 'extra-large']);

/** Whether a window may show the text chip: expanded or wider, and not short (a phone on its side). */
export function textChip(windowClass: WindowClass, compactHeight: boolean): boolean {
    return TEXT_CHIP_CLASSES.has(windowClass) && !compactHeight;
}

export function nearYearChip(
    view: { readonly locale: ViewerLocale; readonly wide: boolean },
    year: number | null,
    photos: readonly Photo[],
    onNearYear: () => void,
): TemplateResult {
    if (year === null || photosNearYear(photos, year).length === 0) {
        return EMPTY;
    }
    const label = translate(view.locale, 'photos.nearYear', { year: String(year) });
    const chip = view.wide
        ? html`<hcm-button variant="tonal" icon="photo_library" data-layout-check="near-year" @click=${onNearYear}>${label}</hcm-button>`
        : html`<hcm-icon-button
              variant="tonal"
              icon="photo_library"
              data-layout-check="near-year"
              .label=${label}
              title=${label}
              @click=${onNearYear}
          ></hcm-icon-button>`;
    return html`<div class="dock chip">${chip}</div>`;
}
